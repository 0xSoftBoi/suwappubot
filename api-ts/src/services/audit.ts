import { createHash } from 'node:crypto'
import { desc, eq, isNull, sql } from 'drizzle-orm'
import { Effect } from 'effect'
import { requireDb } from '../db'
import { auditLogs } from '../db/schema/security'
import { logger } from '../lib/logger'

/**
 * Append-only audit trail writer for the Enterprise control plane.
 *
 * `audit_logs` previously had zero write sites. These helpers add INSERT-only
 * records for security-relevant events (subscription changes, key issuance,
 * admin access). Writes must NEVER fail the calling money/auth path, so every
 * error is caught and logged.
 *
 * Schema note: `audit_logs.user_id` is NOT-NULL and there is no `agent_id`
 * column, so agent-scoped events reuse `userId` for the agent id (and also stamp
 * it in `details.agentId`). System events (e.g. admin-key auth, which isn't tied
 * to a user) use userId 0.
 *
 * Hash chain (tamper evidence): every insert computes
 *   entryHash = sha256(canonical JSON of {userId, orgId, agentId, eventType,
 *     details, ts, prevHash})
 * chained per-org (a shared 'global' chain covers org-less entries). Reads for
 * the previous hash + the insert happen inside one transaction guarded by a
 * Postgres advisory lock keyed on the chain, so two concurrent writers to the
 * same chain can never both read the same prevHash.
 */
export interface AuditEvent {
	userId: number
	/** Org id for org-scoped events — enables enterprise org-wide audit queries. */
	orgId?: string | null
	/** Agent id for agent-scoped events (kept separate from userId). */
	agentId?: string | null
	eventType: string
	details?: Record<string, unknown> | string | null
	ipAddress?: string | null
}

const serializeDetails = (details: AuditEvent['details']): string | null => {
	if (details == null) return null
	return typeof details === 'string' ? details : JSON.stringify(details)
}

/** Chain key for a given org id — 'global' covers org-less (userId 0 / no org) entries. */
const chainKeyOf = (orgId: string | null): string => orgId ?? 'global'

export const computeEntryHash = (input: {
	userId: number
	orgId: string | null
	agentId: string | null
	eventType: string
	details: string | null
	ts: string
	prevHash: string | null
}): string => {
	// Canonical (fixed key order) JSON so the hash is deterministic regardless
	// of object construction order.
	const canonical = JSON.stringify({
		userId: input.userId,
		orgId: input.orgId,
		agentId: input.agentId,
		eventType: input.eventType,
		details: input.details,
		ts: input.ts,
		prevHash: input.prevHash,
	})
	return createHash('sha256').update(canonical).digest('hex')
}

/**
 * Effect-native audit write — use inside Effect pipelines with `yield* auditLog(...)`.
 * Self-contained (R = DrizzleService, E = never): swallows + logs any failure.
 */
export const auditLog = (event: AuditEvent) =>
	Effect.gen(function* () {
		const db = yield* requireDb
		const orgId = event.orgId ?? null
		const agentId = event.agentId?.slice(0, 64) ?? null
		const eventType = event.eventType.slice(0, 50)
		const details = serializeDetails(event.details)
		const ipAddress = event.ipAddress?.slice(0, 45) ?? null
		const chainKey = chainKeyOf(orgId)

		yield* Effect.tryPromise({
			try: () =>
				db.transaction(async (tx) => {
					// Serialize concurrent inserts to the same chain: an advisory lock
					// held for the lifetime of this transaction. hashtext() maps the
					// chain key to a stable int4 for pg_advisory_xact_lock.
					await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${chainKey}))`)

					const [prev] = orgId
						? await tx
								.select({ entryHash: auditLogs.entryHash })
								.from(auditLogs)
								.where(eq(auditLogs.orgId, orgId))
								.orderBy(desc(auditLogs.id))
								.limit(1)
						: await tx
								.select({ entryHash: auditLogs.entryHash })
								.from(auditLogs)
								.where(isNull(auditLogs.orgId))
								.orderBy(desc(auditLogs.id))
								.limit(1)

					const prevHash = prev?.entryHash ?? null
					// Fix the timestamp ourselves (rather than relying on the column's
					// defaultNow()) so the exact value hashed is the exact value stored —
					// verification recomputes from the stored createdAt.
					const now = new Date()
					const ts = now.toISOString()
					const entryHash = computeEntryHash({
						userId: event.userId,
						orgId,
						agentId,
						eventType,
						details,
						ts,
						prevHash,
					})

					await tx.insert(auditLogs).values({
						userId: event.userId,
						orgId,
						agentId,
						eventType,
						details,
						ipAddress,
						createdAt: now,
						prevHash,
						entryHash,
						tsRaw: ts,
					})
				}),
			catch: (e) => (e instanceof Error ? e : new Error(String(e))),
		})
	}).pipe(
		Effect.catchAll((e) =>
			Effect.sync(() => logger.warn(`[audit] write failed (${event.eventType}): ${e}`)),
		),
	)

export interface AuditVerifyResult {
	valid: boolean
	checked: number
	firstBreakId?: number
}

/**
 * Walk a hash chain (scoped by orgId, or the org-less/global chain when
 * `orgId` is null) and confirm every row's `entryHash` matches
 * `computeEntryHash` of its own fields chained to the previous row's
 * `entryHash`. Shared by every audit-verify surface so the walk logic — and
 * its "skip rows written before the hash-chain migration" behavior — lives
 * in exactly one place.
 */
export const verifyAuditChain = (orgId: string | null, limit: number) =>
	Effect.gen(function* () {
		const db = yield* requireDb
		const rows = yield* Effect.tryPromise({
			try: () =>
				db
					.select({
						id: auditLogs.id,
						userId: auditLogs.userId,
						orgId: auditLogs.orgId,
						agentId: auditLogs.agentId,
						eventType: auditLogs.eventType,
						details: auditLogs.details,
						createdAt: auditLogs.createdAt,
						prevHash: auditLogs.prevHash,
						entryHash: auditLogs.entryHash,
						tsRaw: auditLogs.tsRaw,
					})
					.from(auditLogs)
					.where(orgId ? eq(auditLogs.orgId, orgId) : isNull(auditLogs.orgId))
					.orderBy(desc(auditLogs.id))
					.limit(limit),
			catch: (e) => (e instanceof Error ? e : new Error(String(e))),
		})

		// Fetch one anchor row just older than the window (same org scope) so the
		// window's boundary row's prevHash link can actually be verified against
		// the anchor's real entryHash, instead of being seeded from itself (which
		// makes that one comparison tautological and lets an attacker tamper
		// exactly the boundary row's prevHash undetected).
		const anchorRows = yield* Effect.tryPromise({
			try: () =>
				db
					.select({ entryHash: auditLogs.entryHash })
					.from(auditLogs)
					.where(orgId ? eq(auditLogs.orgId, orgId) : isNull(auditLogs.orgId))
					.orderBy(desc(auditLogs.id))
					.limit(1)
					.offset(limit),
			catch: (e) => (e instanceof Error ? e : new Error(String(e))),
		})
		const anchor = anchorRows[0]

		let valid = true
		let firstBreakId: number | undefined
		// Rows are newest-first; walk oldest->newest logically by iterating in
		// reverse so each row's expected prevHash is the previous row's entryHash.
		//
		// The query above is windowed (LIMIT `limit`, newest-first). When an
		// older anchor row exists, seed the expectation from the anchor's real
		// entryHash so the window's boundary link IS verified. Only when there is
		// no older row (the window covers the whole chain) do we fall back to the
		// boundary row's own prevHash, since there's nothing to check it against.
		const oldestFirst = [...rows].reverse()
		let expectedPrevHash: string | null = anchor
			? (anchor.entryHash ?? null)
			: (oldestFirst[0]?.prevHash ?? null)
		let walked = 0
		for (const row of oldestFirst) {
			walked++
			// Rows written before this migration have null hashes — skip them
			// (chain starts fresh at the first hashed row) rather than flagging a
			// false break.
			if (row.entryHash == null && row.prevHash == null) {
				expectedPrevHash = null
				continue
			}
			if (row.prevHash !== expectedPrevHash) {
				valid = false
				firstBreakId = row.id
				break
			}
			const recomputed = computeEntryHash({
				userId: row.userId,
				orgId: row.orgId,
				agentId: row.agentId,
				eventType: row.eventType,
				details: row.details,
				// Prefer the exact string hashed at insert time (tsRaw) over
				// recomputing from createdAt — the latter is a `timestamp`
				// WITHOUT time zone column, so round-tripping it through
				// `new Date(...).toISOString()` is process-TZ-dependent and
				// would flag every historical row as tampered after a TZ
				// change. Rows written before this column existed (tsRaw
				// null) fall back to the old recomputation.
				ts: row.tsRaw ?? (row.createdAt ? new Date(row.createdAt).toISOString() : ''),
				prevHash: row.prevHash,
			})
			if (recomputed !== row.entryHash) {
				valid = false
				firstBreakId = row.id
				break
			}
			expectedPrevHash = row.entryHash
		}

		return { valid, checked: walked, firstBreakId } as AuditVerifyResult
	})

/**
 * Fire-and-forget audit write for plain async (non-Effect) call sites such as
 * Hono middleware. Does not block or throw.
 */
export const writeAuditLog = (event: AuditEvent): void => {
	// Lazy import to break the module cycle audit -> runtime -> MainLayer ->
	// route service -> audit, which could otherwise cause a TDZ crash if a
	// route/test pulled a service before the runtime. runEffect is only
	// needed at call time.
	void import('../runtime')
		.then(({ runEffect }) => runEffect(auditLog(event)))
		.catch((e) => logger.warn(`[audit] runtime load failed (${event.eventType}): ${e}`))
}
