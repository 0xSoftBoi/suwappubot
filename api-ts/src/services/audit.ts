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

/**
 * Effect-native audit write — use inside Effect pipelines with `yield* auditLog(...)`.
 * Self-contained (R = DrizzleService, E = never): swallows + logs any failure.
 */
export const auditLog = (event: AuditEvent) =>
	Effect.gen(function* () {
		const db = yield* requireDb
		yield* Effect.tryPromise({
			try: () =>
				db.insert(auditLogs).values({
					userId: event.userId,
					orgId: event.orgId ?? null,
					agentId: event.agentId?.slice(0, 64) ?? null,
					eventType: event.eventType.slice(0, 50),
					details: serializeDetails(event.details),
					ipAddress: event.ipAddress?.slice(0, 45) ?? null,
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
