import { and, eq, sql } from 'drizzle-orm'
import { Context, Effect, Layer } from 'effect'
import { type DrizzleService, requireDb } from '../db'
import { agentTrust } from '../db/schema/agentTrust'
import { logger } from '../lib/logger'

/**
 * AgentTrustService — per-agent trust record for the api-ts agent-to-agent
 * surface (A2A/MCP). Mirrors the Python `bot/services/aegis_trust.py` /
 * `bot/models/aegis_trust.py` semantics (Phase 2.3 of
 * docs/plans/aegis-fork-extend.md), adapted to key on the numeric
 * `agents.id` PK instead of (platform, user_id).
 *
 * RECORD-ONLY: `getTrust` is not called by any gate/limiter yet.
 * Enforcement is deferred to a later phase, after telemetry review — this
 * service only maintains the score. See the auth.ts wiring: the score is
 * read and stashed on the request context for future use, but nothing
 * denies or throttles on it today.
 *
 * Write-amplification guard (same as Python): a threat verdict always
 * creates the row if missing and always writes. A clean verdict NEVER
 * creates a row (an agent with zero threats has no row; getTrust() returns
 * the TRUST_DEFAULT for them) and only recovers an EXISTING row's score,
 * gated by RECOVERY_INTERVAL_MS, bounding write volume to at most one
 * recovery bump per agent per interval.
 *
 * All public methods are fail-open: any DB error is caught, logged at
 * debug, and swallowed — never propagated as a failure into the caller's
 * Effect (recordVerdict is `Effect<void, never, ...>`, getTrust is
 * `Effect<number, never, ...>`, defaulting to TRUST_DEFAULT).
 *
 * Dual-ORM note: the Python stack's `aegis_user_trust` table is a SEPARATE
 * concern — it's keyed on (platform, user_id) and tracks bot end-user trust
 * across telegram/whatsapp/nl_intent. This table tracks registered-agent
 * trust on the A2A/MCP surface, keyed on agents.id. Do not attempt to share
 * a table across the two ORMs; see the convergence note in the schema file.
 */

export const TRUST_DEFAULT = 100
export const TRUST_MIN = 0
export const TRUST_MAX = 100
export const THREAT_PENALTY = 15
export const RECOVERY_STEP = 1
export const RECOVERY_INTERVAL_MS = 60 * 60 * 1000 // 1 hour

export interface AgentTrustServiceInterface {
	/**
	 * Record one scan verdict against an agent's trust score.
	 *
	 * Threat path: create the row if missing (seeded at TRUST_DEFAULT, then
	 * immediately penalized), decrement trustScore by THREAT_PENALTY (floored
	 * at TRUST_MIN), bump threatCount, stamp lastThreatAt/lastSeenAt.
	 *
	 * Clean path: see the write-amplification guard in the module docstring —
	 * never creates a row, and only bumps an existing row's trustScore when
	 * RECOVERY_INTERVAL_MS has elapsed since it was last touched.
	 *
	 * Never fails: any DB error is caught, logged at debug, and swallowed.
	 */
	readonly recordVerdict: (
		agentId: number,
		isThreat: boolean,
	) => Effect.Effect<void, never, DrizzleService>

	/**
	 * Return the current trust score for `agentId`. Defaults to TRUST_DEFAULT
	 * when no row exists (including for unknown agents) and on any DB error
	 * (fail-open).
	 */
	readonly getTrust: (agentId: number) => Effect.Effect<number, never, DrizzleService>
}

export class AgentTrustService extends Context.Tag('AgentTrustService')<
	AgentTrustService,
	AgentTrustServiceInterface
>() {}

const toError = (e: unknown): Error => (e instanceof Error ? e : new Error(String(e)))

export const AgentTrustServiceLive = Layer.succeed(
	AgentTrustService,
	AgentTrustService.of({
		recordVerdict: (agentId, isThreat) =>
			Effect.gen(function* () {
				const db = yield* requireDb
				const now = new Date()

				if (isThreat) {
					// Atomic upsert: a single INSERT ... ON CONFLICT (agent_id) DO
					// UPDATE statement. The insert branch seeds a fresh row already
					// penalized (no prior row); the conflict branch recomputes
					// trustScore/threatCount from the CURRENT row via SQL expressions
					// evaluated server-side — never from a value read by a prior
					// SELECT in this process, so concurrent verdicts for the same
					// agent can't race a read-modify-write and lose a penalty/counter.
					yield* Effect.tryPromise({
						try: () =>
							db
								.insert(agentTrust)
								.values({
									agentId,
									trustScore: Math.max(TRUST_MIN, TRUST_DEFAULT - THREAT_PENALTY),
									threatCount: 1,
									cleanCount: 0,
									lastThreatAt: now,
									lastSeenAt: now,
								})
								.onConflictDoUpdate({
									target: agentTrust.agentId,
									set: {
										trustScore: sql`greatest(${TRUST_MIN}, ${agentTrust.trustScore} - ${THREAT_PENALTY})`,
										threatCount: sql`${agentTrust.threatCount} + 1`,
										lastThreatAt: now,
										lastSeenAt: now,
									},
								}),
						catch: toError,
					})
					return
				}

				// Clean path — write-amplification guard (see module docstring):
				// NEVER create a row for an agent with zero threats, and only
				// recover an EXISTING row's score once RECOVERY_INTERVAL_MS has
				// elapsed since it was last touched (lastSeenAt, falling back to
				// createdAt when never set). Expressed as a single conditional
				// UPDATE ... WHERE so "a row exists" AND "the interval elapsed" are
				// checked and applied atomically in one statement — no separate
				// SELECT that a concurrent verdict could race between the check and
				// the write.
				const recoveryCutoff = new Date(now.getTime() - RECOVERY_INTERVAL_MS)
				yield* Effect.tryPromise({
					try: () =>
						db
							.update(agentTrust)
							.set({
								trustScore: sql`least(${TRUST_MAX}, ${agentTrust.trustScore} + ${RECOVERY_STEP})`,
								cleanCount: sql`${agentTrust.cleanCount} + 1`,
								lastSeenAt: now,
							})
							.where(
								and(
									eq(agentTrust.agentId, agentId),
									sql`coalesce(${agentTrust.lastSeenAt}, ${agentTrust.createdAt}) <= ${recoveryCutoff}`,
								),
							),
					catch: toError,
				})
			}).pipe(
				Effect.catchAll((e) => {
					logger.debug(
						{ err: e instanceof Error ? e.message : String(e), agentId, isThreat },
						'[AgentTrustService] recordVerdict failed (fail-open)',
					)
					return Effect.succeed(undefined)
				}),
			),

		getTrust: (agentId) =>
			Effect.gen(function* () {
				const db = yield* requireDb
				const rows = yield* Effect.tryPromise({
					try: () =>
						db
							.select({ trustScore: agentTrust.trustScore })
							.from(agentTrust)
							.where(eq(agentTrust.agentId, agentId))
							.limit(1),
					catch: toError,
				})
				return rows[0]?.trustScore ?? TRUST_DEFAULT
			}).pipe(
				Effect.catchAll((e) => {
					logger.debug(
						{ err: e instanceof Error ? e.message : String(e), agentId },
						'[AgentTrustService] getTrust failed (fail-open, default 100)',
					)
					return Effect.succeed(TRUST_DEFAULT)
				}),
			),
	}),
)
