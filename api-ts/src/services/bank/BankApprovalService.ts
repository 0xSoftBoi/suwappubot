/**
 * BankApprovalService — approval policies, requests, quorum, signed approval
 * tokens, and the policy-enforcing org transfer.
 *
 * Flow: a caller proposes (action, payload). If a policy matches, an approval
 * request is created; eligible approvers (policy roles, never the requester)
 * approve until quorum; the requester then mints a short-lived token bound to
 * (org, action, sha256(canonical payload)) and presents it with the same
 * payload. The token is verified (HMAC + expiry + binding) and consumed
 * atomically (single use) before money moves.
 *
 * Other modules: `verifyApprovalToken` (stateless check) and
 * `consumeApprovalToken` (check + single-use consume) are exported below.
 */
import { and, desc, eq, inArray, lte, sql } from 'drizzle-orm'
import { Context, Effect, Layer } from 'effect'
import type { EnvService } from '../../config/EnvService'
import {
	type BankApprovalRequest,
	type BankTransfer,
	type DrizzleService,
	bankApprovalDecisions,
	bankApprovalPolicies,
	bankApprovalRequests,
	bankOrgCategories,
	bankOrgPayees,
} from '../../db'
import { ingestBooks, valueInReporting } from './BankBooksService'
import { BankLedgerService } from './BankLedgerService'
import { type OrgCtx, authorize, authorizeActor, nid, orgSecret, resolveActor, writeAudit } from './BankOrgService'
import { BankTransferService, type BankDeps } from './BankTransferService'
import {
	type ApprovalContext,
	type DecisionLite,
	type OrgRole,
	type PolicyLite,
	type RuleType,
	can,
	hashPayload,
	matchPolicy,
	mintApprovalToken,
	tally,
	validateDecision,
	verifyApprovalTokenWith,
} from './bankOrgPure'
import { type BankOwner, bankDb } from './db'
import { type BankError, bankErr } from './errors'

type Fx<A, R = DrizzleService> = Effect.Effect<A, BankError, R>
type FxE<A> = Effect.Effect<A, BankError, DrizzleService | EnvService>

const toPolicyLite = (p: typeof bankApprovalPolicies.$inferSelect): PolicyLite => ({
	id: p.id,
	ruleType: p.ruleType,
	thresholdMinor: p.thresholdMinor === null ? null : BigInt(p.thresholdMinor),
	requiredApprovals: p.requiredApprovals,
	approverRoles: p.approverRoles,
	expiryHours: p.expiryHours,
	enabled: p.enabled === 1,
})

const loadPolicies = (orgId: string) =>
	bankDb(async (db) => (await db.select().from(bankApprovalPolicies).where(eq(bankApprovalPolicies.orgId, orgId))).map(toPolicyLite))

const expireStale = (orgId: string): Fx<void> =>
	bankDb(async (db) => {
		await db
			.update(bankApprovalRequests)
			.set({ status: 'expired' })
			.where(and(eq(bankApprovalRequests.orgId, orgId), inArray(bankApprovalRequests.status, ['pending', 'approved']), lte(bankApprovalRequests.expiresAt, new Date())))
	})

/** Create (or reuse an open one for the same requester + payload) an approval request. */
const openRequest = (orgId: string, requestedBy: number, action: string, payload: Record<string, unknown>, policy: PolicyLite): Fx<BankApprovalRequest> =>
	Effect.gen(function* () {
		const hash = hashPayload(payload)
		yield* expireStale(orgId)
		const existing = yield* bankDb(async (db) =>
			(
				await db
					.select()
					.from(bankApprovalRequests)
					.where(
						and(
							eq(bankApprovalRequests.orgId, orgId),
							eq(bankApprovalRequests.action, action),
							eq(bankApprovalRequests.payloadHash, hash),
							eq(bankApprovalRequests.requestedBy, requestedBy),
							inArray(bankApprovalRequests.status, ['pending', 'approved']),
						),
					)
					.limit(1)
			)[0],
		)
		if (existing) return existing
		return yield* bankDb(async (db) => {
			const [r] = await db
				.insert(bankApprovalRequests)
				.values({
					id: nid('apr'),
					orgId,
					action,
					payload,
					payloadHash: hash,
					requestedBy,
					policyId: policy.id,
					requiredApprovals: policy.requiredApprovals,
					approverRoles: policy.approverRoles,
					expiresAt: new Date(Date.now() + policy.expiryHours * 3_600_000),
				})
				.returning()
			return r!
		})
	})

/** Stateless verification for other modules (payroll, transfers): signature + expiry + (org, action, payload) binding. */
export const verifyApprovalToken = (token: string, expect: { orgId: string; action: string; payload: unknown }): Effect.Effect<{ requestId: string }, BankError, EnvService> =>
	Effect.gen(function* () {
		const secret = yield* orgSecret
		const r = verifyApprovalTokenWith(secret, token, expect)
		if (!r.ok) return yield* Effect.fail(bankErr('FORBIDDEN', `Approval token rejected: ${r.reason.replace(/_/g, ' ')}`))
		return { requestId: r.claims.req }
	})

/** Verify AND consume (single use). Use immediately before executing the approved action. */
export const consumeApprovalToken = (token: string, expect: { orgId: string; action: string; payload: unknown }): FxE<{ requestId: string }> =>
	Effect.gen(function* () {
		const { requestId } = yield* verifyApprovalToken(token, expect)
		const hash = hashPayload(expect.payload)
		const r = yield* bankDb((db) =>
			db
				.update(bankApprovalRequests)
				.set({ status: 'consumed', consumedAt: new Date() })
				.where(
					and(
						eq(bankApprovalRequests.id, requestId),
						eq(bankApprovalRequests.orgId, expect.orgId),
						eq(bankApprovalRequests.action, expect.action),
						eq(bankApprovalRequests.payloadHash, hash),
						eq(bankApprovalRequests.status, 'approved'),
						sql`expires_at > now()`,
					),
				)
				.returning({ id: bankApprovalRequests.id }),
		)
		if (r.length === 0) return yield* Effect.fail(bankErr('CONFLICT', 'Approval already used, expired, or not approved'))
		return { requestId }
	})

/** Undo a consume when the guarded action failed before moving money. */
export const releaseApproval = (requestId: string): Fx<void> =>
	bankDb(async (db) => {
		await db
			.update(bankApprovalRequests)
			.set({ status: 'approved', consumedAt: null })
			.where(and(eq(bankApprovalRequests.id, requestId), eq(bankApprovalRequests.status, 'consumed')))
	})

export interface OrgTransferInput {
	idempotencyKey: string
	fromAccountId: string
	toAccountId?: string | undefined
	toExternal?: { address: string } | undefined
	amountMinor: string
	memo?: string | undefined
	categoryId?: string | undefined
	approvalToken?: string | undefined
}

export type OrgTransferResult =
	| { approvalRequired: false; transfer: BankTransfer }
	| { approvalRequired: true; reason: string; request: BankApprovalRequest }

const normAddr = (a: string): string => (a.startsWith('0x') ? a.toLowerCase() : a)

/**
 * MONEY-PATH. Policy-enforcing org transfer. `ctx` MUST come from authorize()/authorizeActor().
 * Shared by the HTTP route (user/agent) and the bill-payment job (as the scheduling member).
 */
export const performOrgTransfer = (
	ctx: OrgCtx,
	i: OrgTransferInput,
): Effect.Effect<OrgTransferResult, BankError, BankDeps | BankTransferService | EnvService> =>
	Effect.gen(function* () {
		const orgOwner: BankOwner = { ownerType: 'org', ownerId: ctx.org.id }
		if (!/^[1-9]\d*$/.test(i.amountMinor)) return yield* Effect.fail(bankErr('VALIDATION', 'amountMinor must be a positive integer string'))
		if (!!i.toAccountId === !!i.toExternal) return yield* Effect.fail(bankErr('VALIDATION', 'Provide exactly one of toAccountId or toExternal'))
		const amount = BigInt(i.amountMinor)
		const ledger = yield* BankLedgerService
		// Source account must be this org's (getAccount is owner-scoped: foreign ids read as NOT_FOUND).
		const from = yield* ledger.getAccount(orgOwner, i.fromAccountId)
		const toAcct = i.toAccountId ? yield* ledger.getAccountById(i.toAccountId) : null
		const toExternal = i.toExternal ? { address: normAddr(i.toExternal.address), chain: from.chain } : null
		const ownToOwn = !!toAcct && toAcct.ownerType === 'org' && toAcct.ownerId === ctx.org.id

		if (i.categoryId) {
			const cat = yield* bankDb((db) => db.select({ id: bankOrgCategories.id }).from(bankOrgCategories).where(and(eq(bankOrgCategories.id, i.categoryId!), eq(bankOrgCategories.orgId, ctx.org.id))).limit(1))
			if (!cat.length) return yield* Effect.fail(bankErr('NOT_FOUND', 'Category not found in this organisation'))
		}

		let newPayee = false
		if (toExternal) {
			const p = yield* bankDb((db) =>
				db.select({ id: bankOrgPayees.id }).from(bankOrgPayees).where(and(eq(bankOrgPayees.orgId, ctx.org.id), eq(bankOrgPayees.chain, toExternal.chain), eq(bankOrgPayees.address, toExternal.address))).limit(1),
			)
			newPayee = p.length === 0
		}

		let policy: PolicyLite | null = null
		if (!ownToOwn) {
			const policies = yield* loadPolicies(ctx.org.id)
			const ctxp: ApprovalContext = { action: 'transfer', newPayee }
			// Fail closed: a value policy that cannot be priced blocks the transfer with a typed error.
			if (policies.some((p) => p.enabled && p.ruleType === 'transfer_over'))
				ctxp.amountReportingMinor = (yield* valueInReporting(from.asset, from.chain, amount, ctx.org.reportingCurrency)).reportingMinor
			policy = matchPolicy(policies, ctxp)
		}

		const payload = { from: from.id, to: toAcct ? toAcct.id : null, external: toExternal, amountMinor: amount.toString() }
		let approvalRequestId: string | null = null
		if (policy) {
			if (!i.approvalToken) {
				const request = yield* openRequest(ctx.org.id, ctx.actor.userId, 'transfer', payload, policy)
				yield* writeAudit({ orgId: ctx.org.id, actor: ctx.actor, action: 'approval.requested', targetType: 'approval', targetId: request.id, detail: { rule: policy.ruleType, amountMinor: payload.amountMinor } })
				return { approvalRequired: true as const, reason: `Policy ${policy.ruleType} requires ${policy.requiredApprovals} approval(s) from ${policy.approverRoles.join('/')}`, request }
			}
			approvalRequestId = (yield* consumeApprovalToken(i.approvalToken, { orgId: ctx.org.id, action: 'transfer', payload })).requestId
		}

		const ts = yield* BankTransferService
		const transfer = yield* ts
			.transfer({
				owner: orgOwner,
				// Approved transfers are keyed by the approval so a retry can never pay twice.
				idempotencyKey: approvalRequestId ? `orgapp-${approvalRequestId}` : i.idempotencyKey,
				type: toAcct ? 'internal' : 'onchain',
				fromAccountId: from.id,
				toAccountId: toAcct?.id,
				toExternal: toExternal ? { address: toExternal.address } : undefined,
				amountMinor: amount.toString(),
				memo: i.memo,
				metadata: { orgId: ctx.org.id, actorUserId: ctx.actor.userId, actorKind: ctx.actor.via, categoryId: i.categoryId ?? null, approvalRequestId },
			})
			.pipe(
				Effect.tapError(() => (approvalRequestId ? releaseApproval(approvalRequestId).pipe(Effect.ignore) : Effect.void)),
			)

		if (toExternal)
			yield* bankDb((db) =>
				db.insert(bankOrgPayees).values({ id: nid('pay'), orgId: ctx.org.id, address: toExternal.address, chain: toExternal.chain, label: i.memo ?? null, addedBy: ctx.actor.userId }).onConflictDoNothing(),
			)
		yield* writeAudit({ orgId: ctx.org.id, actor: ctx.actor, action: 'transfer.create', targetType: 'transfer', targetId: transfer.id, detail: { amountMinor: amount.toString(), from: from.id, to: toAcct?.id ?? toExternal, approvalRequestId } })
		// Book the movement now so the rate is (near) transaction-time.
		yield* ingestBooks(ctx.org.id).pipe(Effect.ignore)
		return { approvalRequired: false as const, transfer }
	})

const REFUSAL: Record<string, [Parameters<typeof bankErr>[0], string]> = {
	NOT_PENDING: ['CONFLICT', 'Request is no longer pending'],
	EXPIRED: ['CONFLICT', 'Approval request expired'],
	SELF_APPROVAL: ['FORBIDDEN', 'You cannot decide your own request'],
	NO_PERMISSION: ['FORBIDDEN', 'Your role may not decide approvals'],
	ROLE_NOT_ELIGIBLE: ['FORBIDDEN', 'Your role is not an eligible approver for this request'],
	ALREADY_DECIDED: ['CONFLICT', 'You already decided this request'],
}

const impl = {
	createPolicy: (
		owner: BankOwner,
		orgId: string,
		i: { ruleType: RuleType; thresholdMinor?: string | undefined; requiredApprovals: number; approverRoles: OrgRole[]; expiryHours: number },
	) =>
		Effect.gen(function* () {
			const c = yield* authorize(owner, orgId, 'policy.manage')
			if (i.ruleType === 'transfer_over' && !i.thresholdMinor) return yield* Effect.fail(bankErr('VALIDATION', 'transfer_over requires thresholdMinor (reporting-currency minor units)'))
			if (i.approverRoles.some((r) => !can(r, 'approval.decide'))) return yield* Effect.fail(bankErr('VALIDATION', 'approverRoles may only contain roles that can decide approvals'))
			const row = yield* bankDb(async (db) => {
				const [r] = await db
					.insert(bankApprovalPolicies)
					.values({
						id: nid('apl'),
						orgId,
						ruleType: i.ruleType,
						thresholdMinor: i.ruleType === 'transfer_over' ? i.thresholdMinor! : null,
						requiredApprovals: i.requiredApprovals,
						approverRoles: i.approverRoles,
						expiryHours: i.expiryHours,
						createdBy: c.actor.userId,
					})
					.returning()
				return r!
			})
			yield* writeAudit({ orgId, actor: c.actor, action: 'policy.create', targetType: 'policy', targetId: row.id, detail: i as unknown as Record<string, unknown> })
			return { policy: row }
		}),

	listPolicies: (owner: BankOwner, orgId: string) =>
		Effect.gen(function* () {
			yield* authorize(owner, orgId, 'approval.view')
			return { policies: yield* bankDb((db) => db.select().from(bankApprovalPolicies).where(eq(bankApprovalPolicies.orgId, orgId))) }
		}),

	deletePolicy: (owner: BankOwner, orgId: string, policyId: string) =>
		Effect.gen(function* () {
			const c = yield* authorize(owner, orgId, 'policy.manage')
			const r = yield* bankDb((db) => db.delete(bankApprovalPolicies).where(and(eq(bankApprovalPolicies.id, policyId), eq(bankApprovalPolicies.orgId, orgId))).returning({ id: bankApprovalPolicies.id }))
			if (!r.length) return yield* Effect.fail(bankErr('NOT_FOUND', 'Policy not found'))
			yield* writeAudit({ orgId, actor: c.actor, action: 'policy.delete', targetType: 'policy', targetId: policyId })
			return { deleted: true }
		}),

	/** For payroll / other modules: does `action` need approval? If so, open (or reuse) the request. */
	requestApproval: (owner: BankOwner, orgId: string, i: { action: 'payroll_run' | 'new_payee'; payload: Record<string, unknown> }) =>
		Effect.gen(function* () {
			const c = yield* authorize(owner, orgId, i.action === 'payroll_run' ? 'payroll.run' : 'approval.request')
			const policy = matchPolicy(yield* loadPolicies(orgId), { action: i.action, newPayee: i.action === 'new_payee' })
			if (!policy) return { required: false as const }
			const request = yield* openRequest(orgId, c.actor.userId, i.action, i.payload, policy)
			yield* writeAudit({ orgId, actor: c.actor, action: 'approval.requested', targetType: 'approval', targetId: request.id, detail: { action: i.action } })
			return { required: true as const, request }
		}),

	listRequests: (owner: BankOwner, orgId: string, status?: string) =>
		Effect.gen(function* () {
			yield* authorize(owner, orgId, 'approval.view')
			yield* expireStale(orgId)
			const conds = [eq(bankApprovalRequests.orgId, orgId)]
			if (status) conds.push(eq(bankApprovalRequests.status, status as BankApprovalRequest['status']))
			const requests = yield* bankDb((db) => db.select().from(bankApprovalRequests).where(and(...conds)).orderBy(desc(bankApprovalRequests.createdAt)).limit(200))
			const decisions = requests.length
				? yield* bankDb((db) => db.select().from(bankApprovalDecisions).where(inArray(bankApprovalDecisions.requestId, requests.map((r) => r.id))))
				: []
			return { requests: requests.map((r) => ({ ...r, decisions: decisions.filter((d) => d.requestId === r.id) })) }
		}),

	decide: (owner: BankOwner, requestId: string, decision: 'approve' | 'reject', comment?: string) =>
		Effect.gen(function* () {
			const actor = yield* resolveActor(owner)
			// Org id comes from the stored request, then membership is verified against it.
			const req = yield* bankDb(async (db) => (await db.select().from(bankApprovalRequests).where(eq(bankApprovalRequests.id, requestId)).limit(1))[0])
			if (!req) return yield* Effect.fail(bankErr('NOT_FOUND', 'Approval request not found'))
			const c = yield* authorizeActor(actor, req.orgId, 'approval.view')
			const existing = yield* bankDb((db) => db.select().from(bankApprovalDecisions).where(eq(bankApprovalDecisions.requestId, requestId)))
			const refusal = validateDecision({
				status: req.status,
				expiresAt: req.expiresAt,
				requestedBy: req.requestedBy,
				approverRoles: req.approverRoles,
				decider: { userId: actor.userId, role: c.role, via: actor.via },
				existing: existing.map((d) => ({ userId: d.userId, role: d.role as OrgRole, decision: d.decision })),
				now: new Date(),
			})
			if (refusal) {
				if (refusal === 'EXPIRED') yield* expireStale(req.orgId)
				const [code, msg] = REFUSAL[refusal]!
				return yield* Effect.fail(bankErr(code, msg))
			}
			yield* bankDb(async (db) => {
				try {
					await db.insert(bankApprovalDecisions).values({ id: nid('apd'), requestId, userId: actor.userId, role: c.role, decision, comment: comment ?? null })
				} catch {
					throw bankErr('CONFLICT', 'You already decided this request')
				}
			})
			// Re-tally from storage so concurrent approvals cannot miss each other.
			const all = yield* bankDb((db) => db.select().from(bankApprovalDecisions).where(eq(bankApprovalDecisions.requestId, requestId)))
			const decisions: DecisionLite[] = all.map((d) => ({ userId: d.userId, role: d.role as OrgRole, decision: d.decision }))
			const verdict = tally({ required: req.requiredApprovals, approverRoles: req.approverRoles, requestedBy: req.requestedBy, decisions })
			if (verdict !== 'pending')
				yield* bankDb((db) =>
					db
						.update(bankApprovalRequests)
						.set({ status: verdict, decidedAt: new Date() })
						.where(and(eq(bankApprovalRequests.id, requestId), eq(bankApprovalRequests.status, 'pending'))),
				)
			yield* writeAudit({ orgId: req.orgId, actor, action: `approval.${decision}`, targetType: 'approval', targetId: requestId, detail: { verdict, comment: comment ?? null } })
			return { requestId, verdict, approvals: decisions.filter((d) => d.decision === 'approve').length, required: req.requiredApprovals }
		}),

	cancelRequest: (owner: BankOwner, requestId: string) =>
		Effect.gen(function* () {
			const actor = yield* resolveActor(owner)
			const req = yield* bankDb(async (db) => (await db.select().from(bankApprovalRequests).where(eq(bankApprovalRequests.id, requestId)).limit(1))[0])
			if (!req) return yield* Effect.fail(bankErr('NOT_FOUND', 'Approval request not found'))
			const c = yield* authorizeActor(actor, req.orgId, 'approval.request')
			if (req.requestedBy !== actor.userId && !can(c.role, 'policy.manage')) return yield* Effect.fail(bankErr('FORBIDDEN', 'Only the requester or an admin can cancel'))
			const r = yield* bankDb((db) => db.update(bankApprovalRequests).set({ status: 'cancelled' }).where(and(eq(bankApprovalRequests.id, requestId), inArray(bankApprovalRequests.status, ['pending', 'approved']))).returning({ id: bankApprovalRequests.id }))
			if (!r.length) return yield* Effect.fail(bankErr('CONFLICT', 'Request is not open'))
			yield* writeAudit({ orgId: req.orgId, actor, action: 'approval.cancel', targetType: 'approval', targetId: requestId })
			return { cancelled: true }
		}),

	/** Requester mints a short-lived token for an APPROVED request. */
	issueToken: (owner: BankOwner, requestId: string): Effect.Effect<{ token: string; expiresInSeconds: number; action: string }, BankError, DrizzleService | EnvService> =>
		Effect.gen(function* () {
			const actor = yield* resolveActor(owner)
			const req = yield* bankDb(async (db) => (await db.select().from(bankApprovalRequests).where(eq(bankApprovalRequests.id, requestId)).limit(1))[0])
			if (!req) return yield* Effect.fail(bankErr('NOT_FOUND', 'Approval request not found'))
			yield* authorizeActor(actor, req.orgId, 'approval.request')
			if (req.requestedBy !== actor.userId) return yield* Effect.fail(bankErr('FORBIDDEN', 'Only the requester can obtain the approval token'))
			if (req.status !== 'approved') return yield* Effect.fail(bankErr('CONFLICT', `Request is ${req.status}, not approved`))
			if (req.expiresAt.getTime() <= Date.now()) return yield* Effect.fail(bankErr('CONFLICT', 'Approval expired'))
			const secret = yield* orgSecret
			const token = mintApprovalToken(secret, { orgId: req.orgId, action: req.action, payload: req.payload, requestId, nowMs: Date.now() })
			yield* writeAudit({ orgId: req.orgId, actor, action: 'approval.token_issued', targetType: 'approval', targetId: requestId })
			return { token, expiresInSeconds: 900, action: req.action }
		}),

	/** Policy-enforcing org transfer endpoint (see performOrgTransfer). */
	transfer: (owner: BankOwner, orgId: string, i: OrgTransferInput): Effect.Effect<OrgTransferResult, BankError, BankDeps | BankTransferService | EnvService> =>
		Effect.gen(function* () {
			const c = yield* authorize(owner, orgId, 'transfer.create')
			return yield* performOrgTransfer(c, i)
		}),
}

export class BankApprovalService extends Context.Tag('BankApprovalService')<BankApprovalService, typeof impl>() {}
export const BankApprovalServiceLive = Layer.succeed(BankApprovalService, impl)
export { mintApprovalToken, hashPayload }
