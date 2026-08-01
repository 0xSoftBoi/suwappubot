import { and, desc, eq, gte, isNull, or, sql } from 'drizzle-orm'
import { Context, Effect, Either, Layer } from 'effect'
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
	/** Sending wallet address, when known (binds an approval to a specific wallet). */
	walletAddress?: string | null
	/** Contract/router address the tx calls into, if known (allowedContracts gate). */
	contractAddress?: string | null
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
	/**
	 * True if ANY enabled, non-expired policy scoped to this org/agent carries a
	 * USD-denominated rule (maxTxUsd, dailyCapUsd, sessionCapUsd,
	 * requireApprovalAboveUsd). Used by callers that cannot resolve a real
	 * valueUsd (e.g. Solana pricing outage, the NL /execute path with no USD
	 * quote field) to decide whether it's safe to evaluate the intent at
	 * valueUsd: 0 (no USD rules configured — chain/token allow-blocklists and
	 * kill switches still apply and are meaningful at $0) or whether that would
	 * silently bypass a real spend control (a USD rule exists — force
	 * require_approval instead of ever gating a real trade at a fake $0).
	 */
	readonly hasUsdRules: (
		organizationId: string | null | undefined,
		agentId: string | null | undefined,
	) => Effect.Effect<boolean, DatabaseError, DrizzleService>
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
	if (p.allowedContracts && p.allowedContracts.length > 0) {
		const allowedContracts = p.allowedContracts.map((c) => c.toLowerCase())
		const contract = lc(intent.contractAddress)
		if (contract && !allowedContracts.includes(contract)) {
			return { block: `contract ${contract} is not in the allowlist` }
		}
	}

	// Approval escalation. 'autonomous' never escalates (caps/blocks above still
	// apply); 'always_ask' escalates unconditionally; default 'above_limit' keeps
	// the existing threshold behavior.
	if (p.approvalMode === 'autonomous') {
		return {}
	}
	if (p.approvalMode === 'always_ask') {
		return { approval: 'policy requires approval for every transaction (always_ask)' }
	}
	if (p.requireApprovalAboveUsd != null && intent.valueUsd > p.requireApprovalAboveUsd) {
		return { approval: `tx $${intent.valueUsd.toFixed(2)} exceeds approval threshold $${p.requireApprovalAboveUsd}` }
	}
	return {}
}

export const PolicyServiceLive = Layer.succeed(
	PolicyService,
	PolicyService.of({
		hasUsdRules: (organizationId, agentId) =>
			Effect.gen(function* () {
				if (!organizationId && !agentId) return false
				const db = yield* requireDb
				const orgId = organizationId ?? null
				const rows = yield* Effect.tryPromise({
					try: () =>
						db
							.select({
								maxTxUsd: policies.maxTxUsd,
								dailyCapUsd: policies.dailyCapUsd,
								sessionCapUsd: policies.sessionCapUsd,
								requireApprovalAboveUsd: policies.requireApprovalAboveUsd,
								expiresAt: policies.expiresAt,
							})
							.from(policies)
							.where(
								and(
									eq(policies.enabled, true),
									orgId
										? and(
												eq(policies.organizationId, orgId),
												agentId
													? or(isNull(policies.agentId), eq(policies.agentId, agentId))
													: isNull(policies.agentId),
											)
										: and(isNull(policies.organizationId), eq(policies.agentId, agentId as string)),
								),
							),
					catch: (e) => new DatabaseError({ message: `hasUsdRules query failed: ${e}`, cause: e }),
				})
				const now = Date.now()
				return rows.some(
					(p) =>
						(!p.expiresAt || p.expiresAt.getTime() > now) &&
						(p.maxTxUsd != null ||
							p.dailyCapUsd != null ||
							p.sessionCapUsd != null ||
							p.requireApprovalAboveUsd != null),
				)
			}),
		evaluate: (intent) =>
			Effect.gen(function* () {
				// Fully unscoped requests (no org, no agent) are retail flows outside
				// the institutional/agent-spend control plane — not gated. A bare
				// agentId (plain agent-token auth, no org key) IS gated below — an
				// org-less per-agent policy row (organizationId null) applies to it.
				// Checked BEFORE acquiring the db handle so this path never depends on
				// DB availability at all.
				if (!intent.organizationId && !intent.agentId) {
					return { decision: 'allow' as PolicyVerdict }
				}
				const orgId = intent.organizationId ?? null

				// The db handle itself is the single point of failure for the entire
				// kill-switch guarantee below: if we can't even acquire it, treat that
				// exactly like an unreadable kill-switch table — fail CLOSED with a
				// block, rather than propagate a Left that runPolicyCheck's generic
				// policy-read-error handler (fail-OPEN) would otherwise catch.
				const dbOrError = yield* Effect.either(requireDb)
				if (Either.isLeft(dbOrError)) {
					return {
						decision: 'block' as PolicyVerdict,
						reason: 'kill-switch indeterminable — failing closed (database unavailable)',
					}
				}
				const db = dbOrError.right

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
				]
				if (orgId) {
					killScopes.push(
						and(
							eq(policyKillSwitches.scope, 'org'),
							eq(policyKillSwitches.scopeId, orgId),
							eq(policyKillSwitches.active, true),
						),
					)
				}
				if (intent.agentId) {
					killScopes.push(
						and(
							eq(policyKillSwitches.scope, 'agent'),
							eq(policyKillSwitches.scopeId, intent.agentId),
							eq(policyKillSwitches.active, true),
						),
					)
				}
				// Kill-switch lookup is fail-CLOSED: unlike ordinary policy-read errors
				// below (which fail open — never block legit trades on an infra hiccup),
				// an unreadable kill-switch table means we cannot rule out an active
				// kill switch, so we block rather than risk executing under one.
				const killsOrError = yield* Effect.tryPromise({
					try: () =>
						db
							.select()
							.from(policyKillSwitches)
							.where(or(...killScopes))
							.limit(1),
					catch: (e) =>
						new DatabaseError({ message: `kill-switch query failed: ${e}`, cause: e }),
				}).pipe(Effect.either)

				if (Either.isLeft(killsOrError)) {
					return yield* log({
						decision: 'block',
						reason: `kill-switch check failed — failing closed: ${killsOrError.left.message}`,
					})
				}
				const kills = killsOrError.right
				if (kills.length > 0) {
					return yield* log({
						decision: 'block',
						reason: `kill switch active (${kills[0].scope})`,
					})
				}

				// 2. Load enabled, non-expired policies scoped to this org (applying to
				//    all agents or narrowed to this one) OR, when there's no org, to
				//    org-less per-agent policy rows for this agent. Lowest priority first.
				const rows = yield* Effect.tryPromise({
					try: () =>
						db
							.select()
							.from(policies)
							.where(
								and(
									eq(policies.enabled, true),
									orgId
										? and(
												eq(policies.organizationId, orgId),
												intent.agentId
													? or(isNull(policies.agentId), eq(policies.agentId, intent.agentId))
													: isNull(policies.agentId),
											)
										: and(isNull(policies.organizationId), eq(policies.agentId, intent.agentId as string)),
								),
							)
							.orderBy(policies.priority),
					catch: (e) => new DatabaseError({ message: `policy query failed: ${e}`, cause: e }),
				})

				// Expired grants are skipped entirely (treated as if not configured).
				const activeRows = rows.filter((p) => !p.expiresAt || p.expiresAt.getTime() > Date.now())

				if (activeRows.length === 0) {
					return yield* log({ decision: 'allow', reason: 'no active policies configured' })
				}

				// 3. Stateless evaluation — first BLOCK wins; remember any approval.
				let pendingApproval: PolicyDecisionResult | null = null
				for (const p of activeRows) {
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

				const needsDaily = activeRows.some((p) => p.dailyCapUsd != null)
				const needsSession = activeRows.some((p) => p.sessionCapUsd != null)
				const needsVelocity = activeRows.some((p) => p.maxTxPerHour != null)

				// orgId is guaranteed non-null whenever intent.agentId is falsy here —
				// the only way to reach this point with both null is the fully-unscoped
				// early return above.
				const agentFilter = intent.agentId
					? eq(policyDecisions.agentId, intent.agentId)
					: eq(policyDecisions.organizationId, orgId as string)

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

					for (const p of activeRows) {
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
