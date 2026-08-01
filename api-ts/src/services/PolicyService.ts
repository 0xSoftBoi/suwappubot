import { and, desc, eq, gte, isNull, or, sql } from 'drizzle-orm'
import { Context, Effect, Layer } from 'effect'
import { type DrizzleService, requireDb } from '../db'
import { DatabaseError } from '../errors'
import { logger } from '../lib/logger'
import {
	type Policy,
	policies,
	policyDecisions,
	policyKillSwitches,
} from '../db/schema/policies'

/**
 * PolicyService — the unified policy decision engine.
 *
 * Evaluates a transaction intent against the org's policy rules + agent spend
 * profile + multi-scope kill switches, returns a verdict, and writes an
 * append-only decision record. This is the institutional control plane's gate;
 * wire `evaluate()` into the swap /build step.
 *
 * Enforcement strength is honest-by-design (see schema/policies.ts): a server
 * gate is hard enforcement for custodial + Suwappu-issued-key flows, advisory
 * for self-signing EOAs.
 */

export type PolicyVerdict = 'allow' | 'block' | 'require_approval'

export interface PolicyIntent {
	/** Org context. When absent, the request is un-orged (retail) and is allowed. */
	organizationId?: string | null
	agentId?: string | null
	/** Chain key/id, lowercased for comparison (e.g. '1', 'solana', 'base'). */
	chain: string
	/** Source + destination token contract addresses (lowercased). */
	fromToken?: string | null
	toToken?: string | null
	/** Destination/counterparty address, if the route sends to a third party. */
	destinationAddress?: string | null
	/** USD value of the trade. */
	valueUsd: number
	slippageBps?: number | null
	gasUsd?: number | null
}

export interface PolicyDecisionResult {
	decision: PolicyVerdict
	reason?: string
	matchedPolicyId?: string
	/** id of the append-only policy_decisions row this evaluation wrote — lets
	 * callers (e.g. ApprovalService) link an approval request back to the
	 * decision that triggered it. */
	id?: number
}

/** Result of reserveApprovalAllowance: either the reserved decision row id, or
 * a fresh block (a concurrent reservation used up the cap first). */
export type ReserveResult = { id: number } | { blocked: true; reason: string }

export interface PolicyServiceInterface {
	readonly evaluate: (
		intent: PolicyIntent,
	) => Effect.Effect<PolicyDecisionResult, DatabaseError, DrizzleService>

	/**
	 * Atomically re-checks daily/session/velocity caps AND inserts the
	 * cap-accounting 'allow' row for an approved human-in-the-loop trade, all
	 * inside one DB transaction serialized by a per-org advisory lock. This
	 * MUST run BEFORE the transaction is built (see agent.ts's approval-resubmit
	 * path) — it is the reservation that closes the TOCTOU where two concurrent
	 * approved resubmits both read the pre-insert cap sum and jointly exceed it.
	 * Callers MUST call releaseApprovalAllowance(id) if the build subsequently
	 * fails, and rely on the partial unique index on
	 * policy_decisions(approval_id) for at-most-once insertion either way.
	 */
	readonly reserveApprovalAllowance: (
		intent: PolicyIntent,
		approvalId: string,
	) => Effect.Effect<ReserveResult, DatabaseError, DrizzleService>

	/** Compensating rollback for reserveApprovalAllowance when the build that
	 * followed it failed — deletes the reserved row so it never counts toward
	 * caps for a trade that never executed. */
	readonly releaseApprovalAllowance: (
		id: number,
	) => Effect.Effect<void, DatabaseError, DrizzleService>
}

export class PolicyService extends Context.Tag('PolicyService')<
	PolicyService,
	PolicyServiceInterface
>() {}

const lc = (s: string | null | undefined): string | null =>
	s == null ? null : s.toLowerCase()

/**
 * Evaluate the per-transaction (stateless) rules of a single policy.
 * Returns a block reason, an approval reason, or null (passes).
 */
function evalStateless(
	p: Policy,
	intent: PolicyIntent,
): { block?: string; approval?: string } {
	const chain = lc(intent.chain)
	const fromTok = lc(intent.fromToken)
	const toTok = lc(intent.toToken)
	const dest = lc(intent.destinationAddress)

	if (p.maxTxUsd != null && intent.valueUsd > p.maxTxUsd) {
		return { block: `tx $${intent.valueUsd.toFixed(2)} exceeds per-tx limit $${p.maxTxUsd}` }
	}
	if (
		p.maxSlippageBps != null &&
		intent.slippageBps != null &&
		intent.slippageBps > p.maxSlippageBps
	) {
		return { block: `slippage ${intent.slippageBps}bps exceeds limit ${p.maxSlippageBps}bps` }
	}
	if (p.maxGasUsd != null && intent.gasUsd != null && intent.gasUsd > p.maxGasUsd) {
		return { block: `gas $${intent.gasUsd} exceeds limit $${p.maxGasUsd}` }
	}
	if (chain) {
		if (p.blockedChains?.map((c) => c.toLowerCase()).includes(chain)) {
			return { block: `chain ${chain} is blocked` }
		}
		if (p.allowedChains && p.allowedChains.length > 0) {
			if (!p.allowedChains.map((c) => c.toLowerCase()).includes(chain)) {
				return { block: `chain ${chain} is not in the allowlist` }
			}
		}
	}
	const tokens = [fromTok, toTok].filter((t): t is string => t != null)
	if (p.blockedTokens && p.blockedTokens.length > 0) {
		const blocked = p.blockedTokens.map((t) => t.toLowerCase())
		const hit = tokens.find((t) => blocked.includes(t))
		if (hit) return { block: `token ${hit} is blocked` }
	}
	if (p.allowedTokens && p.allowedTokens.length > 0) {
		const allowed = p.allowedTokens.map((t) => t.toLowerCase())
		const bad = tokens.find((t) => !allowed.includes(t))
		if (bad) return { block: `token ${bad} is not in the allowlist` }
	}
	if (p.destinationAllowlist && p.destinationAllowlist.length > 0 && dest) {
		const allowed = p.destinationAllowlist.map((d) => d.toLowerCase())
		if (!allowed.includes(dest)) {
			return { block: `destination ${dest} is not whitelisted` }
		}
	}
	if (p.requireApprovalAboveUsd != null && intent.valueUsd > p.requireApprovalAboveUsd) {
		return { approval: `tx $${intent.valueUsd.toFixed(2)} exceeds approval threshold $${p.requireApprovalAboveUsd}` }
	}
	return {}
}

export const PolicyServiceLive = Layer.succeed(
	PolicyService,
	PolicyService.of({
		evaluate: (intent) =>
			Effect.gen(function* () {
				const db = yield* requireDb

				// Un-orged requests (retail) are not gated by the institutional engine.
				if (!intent.organizationId) {
					return { decision: 'allow' as PolicyVerdict }
				}
				const orgId = intent.organizationId

				const log = (
					result: PolicyDecisionResult,
				): Effect.Effect<PolicyDecisionResult, never, DrizzleService> =>
					Effect.gen(function* () {
						const inserted = yield* Effect.tryPromise({
							try: () =>
								db
									.insert(policyDecisions)
									.values({
										organizationId: orgId,
										agentId: intent.agentId ?? null,
										decision: result.decision,
										reason: result.reason?.slice(0, 300) ?? null,
										matchedPolicyId: result.matchedPolicyId ?? null,
										intent: intent as unknown as Record<string, unknown>,
										valueUsd: intent.valueUsd,
									})
									.returning({ id: policyDecisions.id }),
							catch: (e) => (e instanceof Error ? e : new Error(String(e))),
						}).pipe(
							Effect.catchAll((e) => {
								logger.warn(`[policy] decision log failed: ${e}`)
								return Effect.succeed([] as Array<{ id: number }>)
							}),
						)
						return { ...result, id: inserted[0]?.id }
					})

				// 1. Kill switches (global / org / agent) — any active match blocks.
				const killScopes: Array<ReturnType<typeof and>> = [
					and(eq(policyKillSwitches.scope, 'global'), eq(policyKillSwitches.active, true)),
					and(
						eq(policyKillSwitches.scope, 'org'),
						eq(policyKillSwitches.scopeId, orgId),
						eq(policyKillSwitches.active, true),
					),
				]
				if (intent.agentId) {
					killScopes.push(
						and(
							eq(policyKillSwitches.scope, 'agent'),
							eq(policyKillSwitches.scopeId, intent.agentId),
							eq(policyKillSwitches.active, true),
						),
					)
				}
				const kills = yield* Effect.tryPromise({
					try: () =>
						db
							.select()
							.from(policyKillSwitches)
							.where(or(...killScopes))
							.limit(1),
					catch: (e) =>
						new DatabaseError({ message: `kill-switch query failed: ${e}`, cause: e }),
				})
				if (kills.length > 0) {
					return yield* log({
						decision: 'block',
						reason: `kill switch active (${kills[0].scope})`,
					})
				}

				// 2. Load enabled policies for this org, applying to all (agentId null)
				//    or to this specific agent. Lowest priority first.
				const rows = yield* Effect.tryPromise({
					try: () =>
						db
							.select()
							.from(policies)
							.where(
								and(
									eq(policies.organizationId, orgId),
									eq(policies.enabled, true),
									intent.agentId
										? or(isNull(policies.agentId), eq(policies.agentId, intent.agentId))
										: isNull(policies.agentId),
								),
							)
							.orderBy(policies.priority),
					catch: (e) => new DatabaseError({ message: `policy query failed: ${e}`, cause: e }),
				})

				if (rows.length === 0) {
					return yield* log({ decision: 'allow', reason: 'no policies configured' })
				}

				// 3. Stateless evaluation — first BLOCK wins; remember any approval.
				let pendingApproval: PolicyDecisionResult | null = null
				for (const p of rows) {
					const r = evalStateless(p, intent)
					if (r.block) {
						return yield* log({ decision: 'block', reason: r.block, matchedPolicyId: p.id })
					}
					if (r.approval && !pendingApproval) {
						pendingApproval = {
							decision: 'require_approval',
							reason: r.approval,
							matchedPolicyId: p.id,
						}
					}
				}

				// 4. Stateful caps (daily / session / velocity) from the decision log of
				//    prior ALLOWED decisions. NOTE: build-gate proxy — counts allowed
				//    /build decisions, not confirmed on-chain executions. Reconcile with
				//    swapTransactions in a later pass for exact spend.
				const now = Date.now()
				const dayAgo = new Date(now - 24 * 60 * 60 * 1000)
				const hourAgo = new Date(now - 60 * 60 * 1000)

				const needsDaily = rows.some((p) => p.dailyCapUsd != null)
				const needsSession = rows.some((p) => p.sessionCapUsd != null)
				const needsVelocity = rows.some((p) => p.maxTxPerHour != null)

				const agentFilter = intent.agentId
					? eq(policyDecisions.agentId, intent.agentId)
					: eq(policyDecisions.organizationId, orgId)

				if (needsDaily || needsSession || needsVelocity) {
					const [agg] = yield* Effect.tryPromise({
						try: () =>
							db
								.select({
									daySum: sql<number>`coalesce(sum(case when ${policyDecisions.createdAt} >= ${dayAgo} then ${policyDecisions.valueUsd} else 0 end), 0)`,
									hourSum: sql<number>`coalesce(sum(case when ${policyDecisions.createdAt} >= ${hourAgo} then ${policyDecisions.valueUsd} else 0 end), 0)`,
									hourCount: sql<number>`coalesce(sum(case when ${policyDecisions.createdAt} >= ${hourAgo} then 1 else 0 end), 0)`,
								})
								.from(policyDecisions)
								.where(
									and(
										agentFilter,
										eq(policyDecisions.decision, 'allow'),
										gte(policyDecisions.createdAt, dayAgo),
									),
								),
						catch: (e) =>
							new DatabaseError({ message: `spend aggregate failed: ${e}`, cause: e }),
					})
					const daySum = Number(agg?.daySum ?? 0)
					const hourSum = Number(agg?.hourSum ?? 0)
					const hourCount = Number(agg?.hourCount ?? 0)

					for (const p of rows) {
						if (p.dailyCapUsd != null && daySum + intent.valueUsd > p.dailyCapUsd) {
							return yield* log({
								decision: 'block',
								reason: `daily cap $${p.dailyCapUsd} would be exceeded ($${daySum.toFixed(2)} used)`,
								matchedPolicyId: p.id,
							})
						}
						if (p.sessionCapUsd != null && hourSum + intent.valueUsd > p.sessionCapUsd) {
							return yield* log({
								decision: 'block',
								reason: `session cap $${p.sessionCapUsd} would be exceeded ($${hourSum.toFixed(2)} used)`,
								matchedPolicyId: p.id,
							})
						}
						if (p.maxTxPerHour != null && hourCount + 1 > p.maxTxPerHour) {
							return yield* log({
								decision: 'block',
								reason: `velocity limit ${p.maxTxPerHour}/hr exceeded`,
								matchedPolicyId: p.id,
							})
						}
					}
				}

				if (pendingApproval) {
					return yield* log(pendingApproval)
				}
				return yield* log({ decision: 'allow' })
			}),

		reserveApprovalAllowance: (intent, approvalId) =>
			Effect.gen(function* () {
				const db = yield* requireDb
				const orgId = intent.organizationId
				if (!orgId) {
					return yield* Effect.fail(
						new DatabaseError({ message: 'reserveApprovalAllowance requires an organizationId' }),
					)
				}

				return yield* Effect.tryPromise({
					try: () =>
						db.transaction(async (tx) => {
							// Serialize concurrent reservations for the same org so the cap
							// read below can never race another reservation's read — the tx
							// that loses the lock blocks until the winner commits (or rolls
							// back), then re-reads sums that already include it.
							await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${orgId})::bigint)`)

							const rows = await tx
								.select()
								.from(policies)
								.where(
									and(
										eq(policies.organizationId, orgId),
										eq(policies.enabled, true),
										intent.agentId
											? or(isNull(policies.agentId), eq(policies.agentId, intent.agentId))
											: isNull(policies.agentId),
									),
								)
								.orderBy(policies.priority)

							const now = Date.now()
							const dayAgo = new Date(now - 24 * 60 * 60 * 1000)
							const hourAgo = new Date(now - 60 * 60 * 1000)
							const agentFilter = intent.agentId
								? eq(policyDecisions.agentId, intent.agentId)
								: eq(policyDecisions.organizationId, orgId)

							const [agg] = await tx
								.select({
									daySum: sql<number>`coalesce(sum(case when ${policyDecisions.createdAt} >= ${dayAgo} then ${policyDecisions.valueUsd} else 0 end), 0)`,
									hourSum: sql<number>`coalesce(sum(case when ${policyDecisions.createdAt} >= ${hourAgo} then ${policyDecisions.valueUsd} else 0 end), 0)`,
									hourCount: sql<number>`coalesce(sum(case when ${policyDecisions.createdAt} >= ${hourAgo} then 1 else 0 end), 0)`,
								})
								.from(policyDecisions)
								.where(
									and(
										agentFilter,
										eq(policyDecisions.decision, 'allow'),
										gte(policyDecisions.createdAt, dayAgo),
									),
								)

							const daySum = Number(agg?.daySum ?? 0)
							const hourSum = Number(agg?.hourSum ?? 0)
							const hourCount = Number(agg?.hourCount ?? 0)

							for (const p of rows) {
								if (p.dailyCapUsd != null && daySum + intent.valueUsd > p.dailyCapUsd) {
									return {
										blocked: true as const,
										reason: `daily cap $${p.dailyCapUsd} would be exceeded ($${daySum.toFixed(2)} used)`,
									}
								}
								if (p.sessionCapUsd != null && hourSum + intent.valueUsd > p.sessionCapUsd) {
									return {
										blocked: true as const,
										reason: `session cap $${p.sessionCapUsd} would be exceeded ($${hourSum.toFixed(2)} used)`,
									}
								}
								if (p.maxTxPerHour != null && hourCount + 1 > p.maxTxPerHour) {
									return {
										blocked: true as const,
										reason: `velocity limit ${p.maxTxPerHour}/hr exceeded`,
									}
								}
							}

							const inserted = await tx
								.insert(policyDecisions)
								.values({
									organizationId: orgId,
									agentId: intent.agentId ?? null,
									decision: 'allow',
									reason: 'human-in-the-loop approval override',
									intent: intent as unknown as Record<string, unknown>,
									valueUsd: intent.valueUsd,
									approvalId,
								})
								.onConflictDoNothing()
								.returning({ id: policyDecisions.id })

							// onConflictDoNothing means a re-entrant reservation for the same
							// approvalId (partial unique index) returns no row rather than a
							// duplicate — treat that as an already-reserved success rather
							// than a fresh insert, so a retried resubmit doesn't spuriously block.
							if (!inserted[0]) {
								const existing = await tx
									.select({ id: policyDecisions.id })
									.from(policyDecisions)
									.where(eq(policyDecisions.approvalId, approvalId))
									.limit(1)
								return { id: existing[0]?.id ?? -1 }
							}
							return { id: inserted[0].id }
						}),
					catch: (e) =>
						new DatabaseError({ message: `reserveApprovalAllowance failed: ${e}`, cause: e }),
				})
			}),

		releaseApprovalAllowance: (id) =>
			Effect.gen(function* () {
				if (id < 0) return
				const db = yield* requireDb
				yield* Effect.tryPromise({
					try: () => db.delete(policyDecisions).where(eq(policyDecisions.id, id)),
					catch: (e) => new DatabaseError({ message: `releaseApprovalAllowance failed: ${e}`, cause: e }),
				})
			}),
	}),
)
