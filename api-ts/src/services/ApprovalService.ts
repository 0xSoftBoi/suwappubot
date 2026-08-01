import { createHash } from 'node:crypto'
import { and, desc, eq, gt, sql } from 'drizzle-orm'
import { Context, Effect, Layer } from 'effect'
import { type DrizzleService, requireDb } from '../db'
import { approvalRequests, type ApprovalRequest } from '../db/schema/approvals'
import { organizations } from '../db/schema/organizations'
import { DatabaseError, ForbiddenError, NotFoundError, ValidationError } from '../errors'
import { coreTermsOf, type EconomicTerms } from '../lib/approvalTerms'

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

	/** Owner-scoped list — pending (or filtered) requests for orgs the user owns.
	 * When status is 'pending', an expiry filter (expires_at > now()) is applied
	 * so stale-but-not-yet-swept rows don't show as actionable. */
	readonly listForOwner: (
		userId: number,
		status?: string,
	) => Effect.Effect<ApprovalRequest[], DatabaseError, DrizzleService>

	/**
	 * Owner-scoped race-safe decision. Uses a conditional UPDATE ... WHERE
	 * status='pending' so a concurrent double-click / retry can only ever win once.
	 */
	readonly decide: (
		id: string,
		userId: number,
		outcome: 'approved' | 'denied',
	) => Effect.Effect<ApprovalRequest, DatabaseError | NotFoundError | ForbiddenError | ValidationError, DrizzleService>

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

export const ApprovalServiceLive = Layer.succeed(ApprovalService, {
	create: (input) =>
		Effect.gen(function* () {
			const db = yield* requireDb
			const payloadHash = hashCoreTerms(input.payload)
			const expiresAt = new Date(Date.now() + APPROVAL_TTL_MS)

			const rows = yield* Effect.tryPromise({
				try: () =>
					db
						.insert(approvalRequests)
						.values({
							agentId: input.agentId,
							organizationId: input.organizationId ?? null,
							userId: input.userId ?? null,
							actionType: input.actionType,
							payload: input.payload as unknown as Record<string, unknown>,
							payloadHash,
							policyDecisionId: input.policyDecisionId ?? null,
							reason: input.reason ?? null,
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
			const conditions = [eq(organizations.ownerId, userId)]
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
						.innerJoin(organizations, eq(approvalRequests.organizationId, organizations.id))
						.where(and(...conditions))
						.orderBy(desc(approvalRequests.createdAt))
						.limit(200),
				catch: (e) => new DatabaseError({ message: 'Failed to list approval requests', cause: e }),
			})
			return rows.map((r) => r.approval)
		}),

	decide: (id, userId, outcome) =>
		Effect.gen(function* () {
			const db = yield* requireDb

			// Ownership check first (cheap, and gives a clean 403 vs a silent no-op).
			const owned = yield* Effect.tryPromise({
				try: () =>
					db
						.select({ approval: approvalRequests })
						.from(approvalRequests)
						.innerJoin(organizations, eq(approvalRequests.organizationId, organizations.id))
						.where(and(eq(approvalRequests.id, id), eq(organizations.ownerId, userId)))
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

			// Race-safe: conditional UPDATE only succeeds if the row is still
			// 'pending' AND not expired at the moment of the write. Two concurrent
			// approve/deny calls can only ever have one succeed.
			const updated = yield* Effect.tryPromise({
				try: () =>
					db
						.update(approvalRequests)
						.set({
							status: outcome,
							decidedBy: userId,
							decidedAt: new Date(),
						})
						.where(
							and(
								eq(approvalRequests.id, id),
								eq(approvalRequests.status, 'pending'),
								// See listForOwner for why this is `now() at time zone 'utc'`
								// rather than bare `now()` against a naive timestamp column.
								sql`${approvalRequests.expiresAt} > (now() at time zone 'utc')`,
							),
						)
						.returning(),
				catch: (e) => new DatabaseError({ message: 'Failed to record approval decision', cause: e }),
			})

			const row = updated[0]
			if (!row) {
				return yield* Effect.fail(
					new ValidationError({
						message: 'Approval request was already decided or expired (concurrent update)',
					}),
				)
			}
			return row
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
