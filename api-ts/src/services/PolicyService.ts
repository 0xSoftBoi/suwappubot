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
}

export interface PolicyServiceInterface {
	readonly evaluate: (
		intent: PolicyIntent,
	) => Effect.Effect<PolicyDecisionResult, DatabaseError, DrizzleService>
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
						yield* Effect.tryPromise({
							try: () =>
								db.insert(policyDecisions).values({
									organizationId: orgId,
									agentId: intent.agentId ?? null,
									decision: result.decision,
									reason: result.reason?.slice(0, 300) ?? null,
									matchedPolicyId: result.matchedPolicyId ?? null,
									intent: intent as unknown as Record<string, unknown>,
									valueUsd: intent.valueUsd,
								}),
							catch: (e) => (e instanceof Error ? e : new Error(String(e))),
						}).pipe(
							Effect.catchAll((e) =>
								Effect.sync(() => logger.warn(`[policy] decision log failed: ${e}`)),
							),
						)
						return result
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
	}),
)
