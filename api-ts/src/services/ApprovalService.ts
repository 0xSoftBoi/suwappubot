import { createHash, randomBytes } from 'node:crypto'
import { and, desc, eq, gt, or, sql } from 'drizzle-orm'
import { Context, Effect, Layer } from 'effect'
import { type DrizzleService, requireDb } from '../db'
import { agents } from '../db/schema/agents'
import { approvalRequests, approvalVotes, type ApprovalRequest } from '../db/schema/approvals'
import { approvalStepUpChallenges } from '../db/schema/approvalStepUpChallenges'
import { organizationMembers, organizations } from '../db/schema/organizations'
import { policies, policyDecisions } from '../db/schema/policies'
import { DatabaseError, ForbiddenError, NotFoundError, ValidationError } from '../errors'
import { coreTermsOf, type EconomicTerms } from '../lib/approvalTerms'
import { validateStepUpChallenge } from '../lib/stepUpChallenge'

/**
 * Thrown INSIDE the db.transaction in decideApproveWithStepUp() when the
 * presented step-up challenge fails validation. Caught by the surrounding
 * Effect.tryPromise's `catch` and re-mapped to a ValidationError whose
 * message is prefixed with STEP_UP_REJECTED_PREFIX so the route layer can
 * tell "the step-up nonce itself was bad" apart from "the approval was
 * already decided/expired" without a second DB round-trip.
 */
export const STEP_UP_REJECTED_PREFIX = 'STEP_UP_REJECTED: '

class StepUpRejectedInternal extends Error {}

/** How long a require_approval verdict stays actionable before auto-expiring. */
export const APPROVAL_TTL_MS = 15 * 60 * 1000

/** Canonical JSON — stable key ordering so the same logical payload always hashes the same. */
function canonicalize(value: unknown): string {
	if (value === null || typeof value !== 'object') return JSON.stringify(value)
	if (Array.isArray(value)) return `[${value.map(canonicalize).join(',')}]`
	const keys = Object.keys(value as Record<string, unknown>).sort()
	return `{${keys
		.map((k) => `${JSON.stringify(k)}:${canonicalize((value as Record<string, unknown>)[k])}`)
		.join(',')}}`
}

/** Hash of the CORE (immutable) terms only — excludes amountOutMin (checked via
 * inequality at consumption, not equality) and valueUsd (re-derived fresh). */
export function hashCoreTerms(terms: EconomicTerms): string {
	return createHash('sha256').update(canonicalize(coreTermsOf(terms))).digest('hex')
}

export interface ApprovalProgress {
	approvalCount: number
	requiredApprovals: number
	remainingApprovals: number
}

export interface CreateApprovalInput {
	agentId: string
	organizationId?: string | null
	userId?: number | null
	actionType: string
	payload: EconomicTerms
	policyDecisionId?: number | null
	reason?: string | null
}

export interface ApprovalServiceInterface {
	readonly create: (
		input: CreateApprovalInput,
	) => Effect.Effect<ApprovalRequest, DatabaseError, DrizzleService>

	/** Agent-scoped read — the requesting agent may only see its own request. */
	readonly getForAgent: (
		id: string,
		agentId: string,
	) => Effect.Effect<ApprovalRequest, DatabaseError | NotFoundError | ForbiddenError, DrizzleService>

	/** Human approver-scoped list — pending (or filtered) requests for orgs the user owns.
	 * When status is 'pending', an expiry filter (expires_at > now()) is applied
	 * so stale-but-not-yet-swept rows don't show as actionable. */
	readonly listForOwner: (
		userId: number,
		status?: string,
	) => Effect.Effect<ApprovalRequest[], DatabaseError, DrizzleService>

	readonly progress: (
		id: string,
	) => Effect.Effect<ApprovalProgress, DatabaseError | NotFoundError, DrizzleService>

	/**
	 * Human approver-scoped race-safe decision. Uses a conditional UPDATE ... WHERE
	 * status='pending' so a concurrent double-click / retry can only ever win once.
	 */
	readonly decide: (
		id: string,
		userId: number,
		outcome: 'approved' | 'denied',
	) => Effect.Effect<ApprovalRequest, DatabaseError | NotFoundError | ForbiddenError | ValidationError, DrizzleService>

	/**
	 * Human approver-scoped approve decision that ALSO validates + consumes a
	 * server-issued step-up challenge (see approvalStepUpChallenges.ts),
	 * atomically in one db.transaction: challenge-row lookup + validation +
	 * marking it used, AND the conditional approvalRequests status UPDATE,
	 * all succeed or all roll back together. Never used for 'denied' — deny
	 * never requires step-up. On step-up validation failure the rejected
	 * Effect's ValidationError.message is prefixed with
	 * STEP_UP_REJECTED_PREFIX so the route can surface a distinct
	 * `code: 'STEP_UP_REQUIRED'` response instead of a generic 400.
	 */
	readonly decideApproveWithStepUp: (
		id: string,
		userId: number,
		stepUpChallenge: string,
	) => Effect.Effect<ApprovalRequest, DatabaseError | ForbiddenError | ValidationError, DrizzleService>

	/**
	 * Human approver-scoped: issues a fresh single-use step-up nonce for a pending
	 * approval the caller owns. Mirrors decide()'s ownership+pending+not-expired
	 * pre-check so a caller with no access to this approval never learns
	 * anything about its state. The raw challenge value is returned to the
	 * caller exactly once and must never be logged.
	 */
	readonly issueStepUpChallenge: (
		id: string,
		userId: number,
	) => Effect.Effect<
		{ challenge: string; expiresAt: Date; insertedId: number },
		DatabaseError | ForbiddenError | ValidationError,
		DrizzleService
	>

	/**
	 * Validate-only step at resubmit time — does NOT mutate status. Checks
	 * agent ownership, org match (an org-scoped approval can only be consumed
	 * by a request presenting the SAME org context), status='approved', not
	 * expired, and that the freshly re-quoted core terms match while the fresh
	 * amount_out_min is >= the approved minimum (never a worse price). Callers
	 * must re-run PolicyService.evaluate() themselves (block still 403s) and
	 * only call finalizeConsume() after the transaction is actually built.
	 */
	readonly validateForExecution: (
		id: string,
		agentId: string,
		organizationId: string | null,
		freshTerms: EconomicTerms,
	) => Effect.Effect<ApprovalRequest, DatabaseError | NotFoundError | ForbiddenError | ValidationError, DrizzleService>

	/**
	 * Single-use consumption: flips 'approved' -> 'consumed' with a conditional
	 * UPDATE so a concurrent re-submit can only ever win once. Call ONLY after
	 * the transaction has been successfully built (a build that fails after
	 * consumption would burn the approval for nothing).
	 */
	readonly finalizeConsume: (
		id: string,
	) => Effect.Effect<ApprovalRequest, DatabaseError | ValidationError, DrizzleService>
}

export class ApprovalService extends Context.Tag('ApprovalService')<
	ApprovalService,
	ApprovalServiceInterface
>() {}

const isExpired = (row: ApprovalRequest) => row.expiresAt.getTime() < Date.now()

/**
 * The ownership predicate used everywhere a caller must prove they may act on
 * an approval request: EITHER they own the org the request belongs to
 * (organizations.ownerId = userId — requires a LEFT JOIN on organizations so
 * org-less rows still evaluate), OR the request's own user_id (set from the
 * org owner at creation time, or — for org-less agents — from
 * agents.owner_user_id, see create() below) equals the caller directly. This
 * This narrow predicate remains exported for backwards compatibility; the
 * enterprise decision path wraps it with explicit org approver membership.
 */
export function approvalOwnershipCondition(userId: number) {
	return or(eq(organizations.ownerId, userId), eq(approvalRequests.userId, userId))
}

/**
 * Enterprise maker/checker authorization.
 *
 * Keep approvalOwnershipCondition() as the narrow backwards-compatible owner /
 * direct-user predicate. Institutional approvals additionally allow an explicit
 * org member with the 'approver' role to review and decide org-scoped requests.
 *
 * This is intentionally NOT admin/member based: managing the workspace must not
 * implicitly grant authority to approve fund-moving actions.
 */
export function approvalActorCondition(userId: number) {
	return or(
		approvalOwnershipCondition(userId),
		sql<boolean>`exists (
			select 1
			from ${organizationMembers}
			where ${organizationMembers.organizationId} = ${approvalRequests.organizationId}
				and ${organizationMembers.userId} = ${userId}
				and ${organizationMembers.role} in ('owner', 'approver')
		)`,
	)
}

async function approvalProgressTx(
	tx: any,
	id: string,
	requiredApprovals: number,
): Promise<ApprovalProgress> {
	const [countRow] = await tx
		.select({ count: sql<number>`count(*)` })
		.from(approvalVotes)
		.where(
			and(
				eq(approvalVotes.approvalRequestId, id),
				eq(approvalVotes.decision, 'approved'),
			),
		)
	const approvalCount = Number(countRow?.count ?? 0)
	return {
		approvalCount,
		requiredApprovals,
		remainingApprovals: Math.max(requiredApprovals - approvalCount, 0),
	}
}

export const ApprovalServiceLive = Layer.succeed(ApprovalService, {
	create: (input) =>
		Effect.gen(function* () {
			const db = yield* requireDb
			const payloadHash = hashCoreTerms(input.payload)
			const expiresAt = new Date(Date.now() + APPROVAL_TTL_MS)

			// Resolve the human who may approve this request. Callers pass the
			// org owner (organizations.ownerId) as input.userId when an org
			// context exists — that resolution order is preserved and NOT
			// overridden here. But an org-less agent (plain agent-token/MCP
			// auth, no organizationId) has no org owner to resolve, so
			// input.userId arrives null and the request would otherwise be
			// created with user_id=null — unapprovable forever, since
			// listForOwner()/decide() only ever match on user_id. Fall back to
			// the agent's own linked owner (agents.owner_user_id, set via the
			// /link/code + /claim flow) so an org-less agent's approvals still
			// resolve to a real human. Best-effort and null-safe: any lookup
			// failure here must never fail approval creation, so it degrades to
			// the pre-existing null (unapprovable) behavior rather than
			// throwing.
			let requiredApprovals = 1
			if (input.policyDecisionId != null) {
				const quorumRows = yield* Effect.tryPromise({
					try: () =>
						db
							.select({ requiredApprovals: policies.requiredApprovals })
							.from(policyDecisions)
							.leftJoin(policies, eq(policyDecisions.matchedPolicyId, policies.id))
							.where(eq(policyDecisions.id, input.policyDecisionId!))
							.limit(1),
					catch: () => null,
				}).pipe(
					Effect.catchAll(() =>
						Effect.succeed([] as Array<{ requiredApprovals: number | null }>),
					),
				)
				requiredApprovals = Math.min(
					10,
					Math.max(1, Number(quorumRows[0]?.requiredApprovals ?? 1)),
				)
			}

			let resolvedUserId = input.userId ?? null
			// Only fall back to the agent's own linked owner for ORG-LESS
			// requests. An org-scoped request (organizationId set) with no
			// resolved owner means the org-owner lookup failed to find a row —
			// that must surface as an unapprovable (null) request rather than
			// silently handing decision power to whatever human happens to be
			// personally linked to the agent, who may have no relationship to
			// the org at all.
			if (resolvedUserId == null && (input.organizationId ?? null) == null) {
				const fallbackRows = yield* Effect.tryPromise({
					try: () =>
						db
							.select({ ownerUserId: agents.ownerUserId })
							.from(agents)
							// agentId may be the stable uuid, or (for pre-uuid agents) the
							// numeric id stringified — see agentIdentifierOf() in routes/agent.ts.
							.where(or(eq(agents.uuid, input.agentId), sql`${agents.id}::text = ${input.agentId}`))
							.limit(1),
					catch: () => null,
				}).pipe(Effect.catchAll(() => Effect.succeed([] as { ownerUserId: number | null }[])))
				resolvedUserId = fallbackRows[0]?.ownerUserId ?? null
			}

			const rows = yield* Effect.tryPromise({
				try: () =>
					db
						.insert(approvalRequests)
						.values({
							agentId: input.agentId,
							organizationId: input.organizationId ?? null,
							userId: resolvedUserId,
							actionType: input.actionType,
							payload: input.payload as unknown as Record<string, unknown>,
							payloadHash,
							policyDecisionId: input.policyDecisionId ?? null,
							reason: input.reason ?? null,
							requiredApprovals,
							status: 'pending',
							expiresAt,
						})
						.returning(),
				catch: (e) =>
					new DatabaseError({ message: 'Failed to create approval request', cause: e }),
			})

			const row = rows[0]
			if (!row) {
				return yield* Effect.fail(
					new DatabaseError({ message: 'Approval request insert returned no row' }),
				)
			}
			return row
		}),

	getForAgent: (id, agentId) =>
		Effect.gen(function* () {
			const db = yield* requireDb
			const rows = yield* Effect.tryPromise({
				try: () => db.select().from(approvalRequests).where(eq(approvalRequests.id, id)).limit(1),
				catch: (e) => new DatabaseError({ message: 'Failed to load approval request', cause: e }),
			})
			const row = rows[0]
			if (!row) return yield* Effect.fail(new NotFoundError({ resource: 'approval_request' }))
			if (row.agentId !== agentId) {
				return yield* Effect.fail(
					new ForbiddenError({ message: 'This approval request belongs to a different agent' }),
				)
			}
			// Lazily reflect expiry on read (no write needed for a poll — the
			// authoritative expiry check happens again at decide()/consume() time).
			if (row.status === 'pending' && isExpired(row)) {
				return { ...row, status: 'expired' as const }
			}
			return row
		}),

	listForOwner: (userId, status) =>
		Effect.gen(function* () {
			const db = yield* requireDb
			// Ownership predicate: the caller owns the org the approval belongs to
			// (organizations.ownerId = userId, via LEFT JOIN so org-less rows still
			// survive), OR the approval's own user_id (set from the org owner, or
			// — for org-less agents — from agents.owner_user_id, see
			// ApprovalService.create()) equals the caller directly. This is
			// additive only: it never grants access to an org member who is
			// neither the org owner nor the recorded user_id.
			const conditions = [approvalActorCondition(userId)]
			if (status) {
				conditions.push(eq(approvalRequests.status, status))
				if (status === 'pending') {
					// expiresAt is a naive `timestamp` column storing UTC wall-clock
					// values (from JS Date.now() + APPROVAL_TTL_MS). Bare `now()` is a
					// timestamptz that gets cast to `timestamp` using the DB session's
					// configured timezone, not necessarily UTC — comparing against it
					// directly can silently misjudge expiry on a non-UTC session. Force
					// the UTC wall-clock reading so it matches how expiresAt was written.
					conditions.push(gt(approvalRequests.expiresAt, sql`(now() at time zone 'utc')`))
				}
			}
			const rows = yield* Effect.tryPromise({
				try: () =>
					db
						.select({ approval: approvalRequests })
						.from(approvalRequests)
						// LEFT JOIN (not INNER) — an org-less approval (organizationId
						// null) must still be listable via the direct user_id match.
						.leftJoin(organizations, eq(approvalRequests.organizationId, organizations.id))
						.where(and(...conditions))
						.orderBy(desc(approvalRequests.createdAt))
						.limit(200),
				catch: (e) => new DatabaseError({ message: 'Failed to list approval requests', cause: e }),
			})
			return rows.map((r) => r.approval)
		}),

	progress: (id) =>
		Effect.gen(function* () {
			const db = yield* requireDb
			const rows = yield* Effect.tryPromise({
				try: () =>
					db
						.select({ requiredApprovals: approvalRequests.requiredApprovals })
						.from(approvalRequests)
						.where(eq(approvalRequests.id, id))
						.limit(1),
				catch: (e) =>
					new DatabaseError({ message: 'Failed to load approval progress', cause: e }),
			})
			if (!rows[0]) {
				return yield* Effect.fail(new NotFoundError({ resource: 'approval_request' }))
			}
			const requiredApprovals = Math.max(1, Number(rows[0].requiredApprovals ?? 1))
			return yield* Effect.tryPromise({
				try: () => approvalProgressTx(db, id, requiredApprovals),
				catch: (e) =>
					new DatabaseError({ message: 'Failed to load approval progress', cause: e }),
			})
		}),

	decide: (id, userId, outcome) =>
		Effect.gen(function* () {
			const db = yield* requireDb
			return yield* Effect.tryPromise({
				try: () =>
					db.transaction(async (tx) => {
						await tx.execute(
							sql`select pg_advisory_xact_lock(hashtext(${id})::bigint)`,
						)

						const rows = await tx
							.select({ approval: approvalRequests })
							.from(approvalRequests)
							.leftJoin(
								organizations,
								eq(approvalRequests.organizationId, organizations.id),
							)
							.where(
								and(
									eq(approvalRequests.id, id),
									approvalActorCondition(userId),
								),
							)
							.limit(1)
						const existing = rows[0]?.approval
						if (!existing) {
							throw new ForbiddenError({
								message: 'Approval request not found for your organizations',
							})
						}
						if (existing.status !== 'pending' || isExpired(existing)) {
							throw new ValidationError({
								message:
									existing.status !== 'pending'
										? `Approval request already ${existing.status}`
										: 'Approval request has expired',
							})
						}

						const existingVotes = await tx
							.select({ decision: approvalVotes.decision })
							.from(approvalVotes)
							.where(
								and(
									eq(approvalVotes.approvalRequestId, id),
									eq(approvalVotes.userId, userId),
								),
							)
							.limit(1)
						const priorVote = existingVotes[0]?.decision
						if (priorVote && priorVote !== outcome) {
							throw new ValidationError({
								message: `You already voted '${priorVote}' on this approval request`,
							})
						}
						if (!priorVote) {
							await tx.insert(approvalVotes).values({
								approvalRequestId: id,
								userId,
								decision: outcome,
							})
						}

						if (outcome === 'denied') {
							const denied = await tx
								.update(approvalRequests)
								.set({
									status: 'denied',
									decidedBy: userId,
									decidedAt: new Date(),
								})
								.where(
									and(
										eq(approvalRequests.id, id),
										eq(approvalRequests.status, 'pending'),
										sql`${approvalRequests.expiresAt} > (now() at time zone 'utc')`,
									),
								)
								.returning()
							if (!denied[0]) {
								throw new ValidationError({
									message: 'Approval request was already decided or expired',
								})
							}
							return denied[0]
						}

						const requiredApprovals = Math.max(
							1,
							Number(existing.requiredApprovals ?? 1),
						)
						const progress = await approvalProgressTx(tx, id, requiredApprovals)
						if (progress.approvalCount < requiredApprovals) {
							return existing
						}

						const approved = await tx
							.update(approvalRequests)
							.set({
								status: 'approved',
								decidedBy: userId,
								decidedAt: new Date(),
							})
							.where(
								and(
									eq(approvalRequests.id, id),
									eq(approvalRequests.status, 'pending'),
									sql`${approvalRequests.expiresAt} > (now() at time zone 'utc')`,
								),
							)
							.returning()
						if (!approved[0]) {
							throw new ValidationError({
								message: 'Approval request was already decided or expired',
							})
						}
						return approved[0]
					}),
				catch: (e) => {
					if (
						e instanceof ForbiddenError ||
						e instanceof ValidationError
					) {
						return e
					}
					return new DatabaseError({
						message: 'Failed to record approval vote',
						cause: e,
					})
				},
			})
		}),

	decideApproveWithStepUp: (id, userId, stepUpChallenge) =>
		Effect.gen(function* () {
			const db = yield* requireDb
			return yield* Effect.tryPromise({
				try: () =>
					db.transaction(async (tx) => {
						await tx.execute(
							sql`select pg_advisory_xact_lock(hashtext(${id})::bigint)`,
						)

						const owned = await tx
							.select({ approval: approvalRequests })
							.from(approvalRequests)
							.leftJoin(
								organizations,
								eq(approvalRequests.organizationId, organizations.id),
							)
							.where(
								and(
									eq(approvalRequests.id, id),
									approvalActorCondition(userId),
								),
							)
							.limit(1)
						const existing = owned[0]?.approval
						if (!existing) {
							throw new ForbiddenError({
								message: 'Approval request not found for your organizations',
							})
						}
						if (existing.status !== 'pending' || isExpired(existing)) {
							throw new ValidationError({
								message:
									existing.status !== 'pending'
										? `Approval request already ${existing.status}`
										: 'Approval request has expired',
							})
						}

						const priorVotes = await tx
							.select({ decision: approvalVotes.decision })
							.from(approvalVotes)
							.where(
								and(
									eq(approvalVotes.approvalRequestId, id),
									eq(approvalVotes.userId, userId),
								),
							)
							.limit(1)
						if (priorVotes[0]) {
							throw new ValidationError({
								message: `You already voted '${priorVotes[0].decision}' on this approval request`,
							})
						}

						const challengeRows = await tx
							.select()
							.from(approvalStepUpChallenges)
							.where(eq(approvalStepUpChallenges.challenge, stepUpChallenge))
							.limit(1)
						const challengeRow = challengeRows[0]
						const validation = validateStepUpChallenge(
							challengeRow
								? {
										userId: challengeRow.userId,
										approvalId: challengeRow.approvalId,
										usedAt: challengeRow.usedAt,
										expiresAt: challengeRow.expiresAt,
									}
								: null,
							{ userId, approvalId: id, now: new Date() },
						)
						if (!validation.valid) {
							throw new StepUpRejectedInternal(validation.reason)
						}

						await tx
							.update(approvalStepUpChallenges)
							.set({ usedAt: new Date() })
							.where(eq(approvalStepUpChallenges.id, challengeRow!.id))
						await tx.insert(approvalVotes).values({
							approvalRequestId: id,
							userId,
							decision: 'approved',
						})

						const requiredApprovals = Math.max(
							1,
							Number(existing.requiredApprovals ?? 1),
						)
						const progress = await approvalProgressTx(tx, id, requiredApprovals)
						if (progress.approvalCount < requiredApprovals) {
							return existing
						}

						const updated = await tx
							.update(approvalRequests)
							.set({
								status: 'approved',
								decidedBy: userId,
								decidedAt: new Date(),
							})
							.where(
								and(
									eq(approvalRequests.id, id),
									eq(approvalRequests.status, 'pending'),
									sql`${approvalRequests.expiresAt} > (now() at time zone 'utc')`,
								),
							)
							.returning()
						if (!updated[0]) {
							throw new ValidationError({
								message: 'Approval request was already decided or expired',
							})
						}
						return updated[0]
					}),
				catch: (e) => {
					if (e instanceof StepUpRejectedInternal) {
						return new ValidationError({
							message: `${STEP_UP_REJECTED_PREFIX}${e.message}`,
						})
					}
					if (
						e instanceof ForbiddenError ||
						e instanceof ValidationError
					) {
						return e
					}
					return new DatabaseError({
						message: 'Failed to record step-up approval vote',
						cause: e,
					})
				},
			})
		}),

	issueStepUpChallenge: (id, userId) =>
		Effect.gen(function* () {
			const db = yield* requireDb

			// Same ownership+pending+not-expired pre-check as decide() /
			// decideApproveWithStepUp() — never reveal a challenge for an approval
			// the caller doesn't own or that isn't actionable.
			const owned = yield* Effect.tryPromise({
				try: () =>
					db
						.select({ approval: approvalRequests })
						.from(approvalRequests)
						// LEFT JOIN — see listForOwner() for why org-less approvals must
						// still resolve via the direct user_id match below.
						.leftJoin(organizations, eq(approvalRequests.organizationId, organizations.id))
						.where(and(eq(approvalRequests.id, id), approvalActorCondition(userId)))
						.limit(1),
				catch: (e) => new DatabaseError({ message: 'Failed to load approval request', cause: e }),
			})
			const existing = owned[0]?.approval
			if (!existing) {
				return yield* Effect.fail(
					new ForbiddenError({ message: 'Approval request not found for your organizations' }),
				)
			}
			if (existing.status !== 'pending' || isExpired(existing)) {
				return yield* Effect.fail(
					new ValidationError({
						message:
							existing.status !== 'pending'
								? `Approval request already ${existing.status}`
								: 'Approval request has expired',
					}),
				)
			}

			const challenge = randomBytes(24).toString('hex')
			const expiresAt = new Date(Date.now() + 2 * 60 * 1000)

			const rows = yield* Effect.tryPromise({
				try: () =>
					db
						.insert(approvalStepUpChallenges)
						.values({
							userId,
							approvalId: id,
							challenge,
							expiresAt,
						})
						.returning(),
				catch: (e) => new DatabaseError({ message: 'Failed to issue step-up challenge', cause: e }),
			})

			const row = rows[0]
			if (!row) {
				return yield* Effect.fail(
					new DatabaseError({ message: 'Step-up challenge insert returned no row' }),
				)
			}
			return { challenge: row.challenge, expiresAt: row.expiresAt, insertedId: row.id }
		}),

	validateForExecution: (id, agentId, organizationId, freshTerms) =>
		Effect.gen(function* () {
			const db = yield* requireDb
			const rows = yield* Effect.tryPromise({
				try: () => db.select().from(approvalRequests).where(eq(approvalRequests.id, id)).limit(1),
				catch: (e) => new DatabaseError({ message: 'Failed to load approval request', cause: e }),
			})
			const existing = rows[0]
			if (!existing) return yield* Effect.fail(new NotFoundError({ resource: 'approval_request' }))
			if (existing.agentId !== agentId) {
				return yield* Effect.fail(
					new ForbiddenError({ message: 'This approval request belongs to a different agent' }),
				)
			}
			// Org-scoped approvals may only be consumed by a request presenting the
			// SAME org context. create() never leaves organizationId set without an
			// org context, so an org-less resubmit against an org-scoped approval
			// is always rejected here.
			if (existing.organizationId != null && existing.organizationId !== organizationId) {
				return yield* Effect.fail(
					new ForbiddenError({ message: 'Approval request belongs to a different organization' }),
				)
			}
			if (existing.status !== 'approved') {
				return yield* Effect.fail(
					new ValidationError({
						message: `Approval request is '${existing.status}', not 'approved'`,
					}),
				)
			}
			if (isExpired(existing)) {
				return yield* Effect.fail(new ValidationError({ message: 'Approval request has expired' }))
			}

			const storedTerms = existing.payload as unknown as EconomicTerms
			const freshHash = hashCoreTerms(freshTerms)
			if (freshHash !== existing.payloadHash) {
				return yield* Effect.fail(
					new ValidationError({
						message: 'Resubmitted trade parameters do not match the approved request',
					}),
				)
			}

			// Never execute at a worse price than what the human approved.
			let freshMin: bigint
			let approvedMin: bigint
			try {
				freshMin = BigInt(freshTerms.amountOutMin)
				approvedMin = BigInt(storedTerms.amountOutMin)
			} catch {
				return yield* Effect.fail(
					new ValidationError({ message: 'Invalid amount_out_min for comparison' }),
				)
			}
			if (freshMin < approvedMin) {
				return yield* Effect.fail(
					new ValidationError({
						message:
							'Current market price is worse than the approved minimum — re-request approval',
					}),
				)
			}

			return existing
		}),

	finalizeConsume: (id) =>
		Effect.gen(function* () {
			const db = yield* requireDb
			const updated = yield* Effect.tryPromise({
				try: () =>
					db
						.update(approvalRequests)
						.set({ status: 'consumed', consumedAt: new Date() })
						.where(and(eq(approvalRequests.id, id), eq(approvalRequests.status, 'approved')))
						.returning(),
				catch: (e) => new DatabaseError({ message: 'Failed to consume approval request', cause: e }),
			})
			const row = updated[0]
			if (!row) {
				return yield* Effect.fail(
					new ValidationError({
						message: 'Approval request was already consumed (concurrent execute)',
					}),
				)
			}
			return row
		}),
})
