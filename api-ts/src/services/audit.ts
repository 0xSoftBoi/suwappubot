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
					})
				}),
			catch: (e) => (e instanceof Error ? e : new Error(String(e))),
		})
	}).pipe(
		Effect.catchAll((e) =>
			Effect.sync(() => logger.warn(`[audit] write failed (${event.eventType}): ${e}`)),
		),
	)

/**
 * Fire-and-forget audit write for plain async (non-Effect) call sites such as
 * Hono middleware. Does not block or throw.
 */
export const writeAuditLog = (event: AuditEvent): void => {
	// Lazy import to break the module cycle audit -> runtime -> MainLayer ->
	// AgentService -> audit, which caused a TDZ crash ("Cannot access
	// 'AgentServiceLive' before initialization") when a route/test pulled
	// AgentService before the runtime. runEffect is only needed at call time.
	void import('../runtime')
		.then(({ runEffect }) => runEffect(auditLog(event)))
		.catch((e) => logger.warn(`[audit] runtime load failed (${event.eventType}): ${e}`))
}
