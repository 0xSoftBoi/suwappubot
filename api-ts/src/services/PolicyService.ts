import { and, desc, eq, gte, isNull, or, sql } from 'drizzle-orm'
import { Context, Effect, Layer } from 'effect'
import { type DrizzleService, requireDb } from '../db'
import { approvalRequests } from '../db/schema/approvals'
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
	/**
	 * Org context. When BOTH organizationId and agentId are absent, the request
	 * is fully un-orged (retail) and is allowed with no evaluation. A bare
	 * agentId with no organizationId (plain agent-token/MCP auth) IS gated —
	 * org-less per-agent policy rows (organizationId null, agentId set) apply.
	 */
	organizationId?: string | null
	agentId?: string | null
	/** Chain key/id, lowercased for comparison (e.g. '1', 'solana', 'base'). */
	chain: string
	/** Source + destination token contract addresses (lowercased). */
	fromToken?: string | null
	toToken?: string | null
	/** Destination/counterparty address, if the route sends to a third party. */
	destinationAddress?: string | null
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
	/** id of the append-only policy_decisions row this evaluation wrote — lets
	 * callers (e.g. ApprovalService) link an approval request back to the
	 * decision that triggered it. */
	id?: number
}

/** Result of reserveApprovalAllowance: either the reserved decision row id
 * (with `created` telling the caller whether THIS call inserted it — false
 * means a prior call already reserved it, e.g. a retried resubmit; only the
 * call that actually created the row may ever release/delete it), or a fresh
 * block (a concurrent reservation used up the cap first). */
export type ReserveResult = { id: number; created: boolean } | { blocked: true; reason: string }

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

	/**
	 * Compensating rollback for reserveApprovalAllowance when the build that
	 * followed it failed — deletes the reserved row so it never counts toward
	 * caps for a trade that never executed. Callers MUST only call this when
	 * `created === true` from the matching reserveApprovalAllowance() result —
	 * releasing a row this call didn't create could delete a concurrent
	 * winner's reservation for an executed trade. As a second safety net, this
	 * refuses to delete when the approval itself is already 'consumed' (i.e.
	 * the trade did in fact execute), even if the caller mistakenly asks.
	 */
	readonly releaseApprovalAllowance: (
		id: number,
		approvalId: string,
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
	if (p.allowedContracts && p.allowedContracts.length > 0) {
		// `contractAddress === undefined` means "not applicable on this chain"
		// (e.g. Solana/Jupiter trades have no EVM router to check) — allowedContracts
		// is an EVM-router allowlist concept, so those intents are simply not
		// subject to it. `contractAddress === null` means "expected but unresolved"
		// (an EVM quote whose transactionRequest.to is missing) — that DOES fail
		// closed below, since we configured a control we can't verify.
		if (intent.contractAddress !== undefined) {
			const allowedContracts = p.allowedContracts.map((c) => c.toLowerCase())
			const contract = lc(intent.contractAddress)
			if (!contract) {
				// Fail CLOSED: an allowlist is configured but this intent carries no
				// resolvable contract address (e.g. transactionRequest.to missing) —
				// we cannot verify it against the allowlist, so block rather than
				// silently letting it through.
				return { block: 'contract address unknown — cannot verify allowlist' }
			}
			if (!allowedContracts.includes(contract)) {
				return { block: `contract ${contract} is not in the allowlist` }
			}
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
		evaluate: (intent) =>
			Effect.gen(function* () {
				const db = yield* requireDb

				// Fully un-orged, un-agented requests (retail) are not gated by the
				// institutional engine. A bare agentId (plain agent-token/MCP auth, no
				// org) IS gated below — an org-less per-agent policy row
				// (organizationId null, agentId set) applies to it.
				if (!intent.organizationId && !intent.agentId) {
					return { decision: 'allow' as PolicyVerdict }
				}
				const orgId = intent.organizationId ?? null
				// Stable per-scope key for the cap-check advisory lock below — orgId
				// when present, else the agent id (org-less per-agent grants still need
				// serialized cap reads).
				const lockKey = orgId ?? `agent:${intent.agentId}`

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

				// 2. Load enabled policies scoped to this org (applying to all agents
				//    or narrowed to this one) OR, when there's no org, to org-less
				//    per-agent policy rows for this agent. Lowest priority first. An
				//    org query must still pin organizationId = orgId and must NOT match
				//    org-less rows for other tenants — org-less rows only surface on the
				//    no-org (bare agent-token) branch.
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
										: and(
												isNull(policies.organizationId),
												eq(policies.agentId, intent.agentId as string),
											),
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
				//
				// The cap read + the decision-log insert below run inside ONE DB
				// transaction, serialized by the SAME per-org pg_advisory_xact_lock
				// reserveApprovalAllowance() takes. Without this, a plain execute
				// hitting this cap-check-then-insert path concurrently with an
				// approval resubmit's reservation could each read a cap sum that
				// doesn't yet include the other's pending insert, and jointly exceed
				// the cap (the same TOCTOU class as the approval-resubmit fix, just
				// via a different caller).
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

				// Captured from inside the transaction so a write failure AFTER the
				// verdict is computed can fail closed (return the computed block with
				// only the decision-log row lost) instead of surfacing Left, which
				// every caller treats as fail-open (PR #617 review, round 3 M2).
				let computedVerdict: PolicyDecisionResult | null = null
				const capChecked = yield* Effect.tryPromise({
					try: () =>
						db.transaction(async (tx) => {
							await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${lockKey})::bigint)`)

							let verdict: PolicyDecisionResult = pendingApproval ?? { decision: 'allow' }

							if (needsDaily || needsSession || needsVelocity) {
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

								for (const p of activeRows) {
									if (p.dailyCapUsd != null && daySum + intent.valueUsd > p.dailyCapUsd) {
										verdict = {
											decision: 'block',
											reason: `daily cap $${p.dailyCapUsd} would be exceeded ($${daySum.toFixed(2)} used)`,
											matchedPolicyId: p.id,
										}
										break
									}
									if (p.sessionCapUsd != null && hourSum + intent.valueUsd > p.sessionCapUsd) {
										verdict = {
											decision: 'block',
											reason: `session cap $${p.sessionCapUsd} would be exceeded ($${hourSum.toFixed(2)} used)`,
											matchedPolicyId: p.id,
										}
										break
									}
									if (p.maxTxPerHour != null && hourCount + 1 > p.maxTxPerHour) {
										verdict = {
											decision: 'block',
											reason: `velocity limit ${p.maxTxPerHour}/hr exceeded`,
											matchedPolicyId: p.id,
										}
										break
									}
								}
							}

							computedVerdict = verdict

							const inserted = await tx
								.insert(policyDecisions)
								.values({
									organizationId: orgId,
									agentId: intent.agentId ?? null,
									decision: verdict.decision,
									reason: verdict.reason?.slice(0, 300) ?? null,
									matchedPolicyId: verdict.matchedPolicyId ?? null,
									intent: intent as unknown as Record<string, unknown>,
									valueUsd: intent.valueUsd,
								})
								.returning({ id: policyDecisions.id })

							return { ...verdict, id: inserted[0]?.id }
						}),
					catch: (e) => new DatabaseError({ message: `cap check + decision log failed: ${e}`, cause: e }),
				}).pipe(
					Effect.catchAll((e) =>
						computedVerdict !== null
							? Effect.succeed(computedVerdict)
							: Effect.fail(e),
					),
				)

				return capChecked
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
							// Expired grants are skipped entirely here too, for consistency
							// with evaluate()'s activeRows filtering.
							const activeRows = rows.filter(
								(p) => !p.expiresAt || p.expiresAt.getTime() > now,
							)
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

							for (const p of activeRows) {
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
							// than a fresh insert, so a retried resubmit doesn't spuriously
							// block. created=false here so the caller knows this call did NOT
							// mint the row and must never delete it — otherwise two concurrent
							// resubmits could share one reserved id and the loser's cleanup
							// would delete the winner's already-executed trade's cap row.
							if (!inserted[0]) {
								const existing = await tx
									.select({ id: policyDecisions.id })
									.from(policyDecisions)
									.where(eq(policyDecisions.approvalId, approvalId))
									.limit(1)
								return { id: existing[0]?.id ?? -1, created: false }
							}
							return { id: inserted[0].id, created: true }
						}),
					catch: (e) =>
						new DatabaseError({ message: `reserveApprovalAllowance failed: ${e}`, cause: e }),
				})
			}),

		releaseApprovalAllowance: (id, approvalId) =>
			Effect.gen(function* () {
				if (id < 0) return
				const db = yield* requireDb
				// Audit-trail note (PR #617 review): this hard-deletes an append-only
				// decision row. A softer alternative — insert a compensating
				// decision='released' row and exclude released/reserved pairs from the
				// cap sums in evaluate() — would preserve the full history, but ripples
				// into every cap aggregate query. Keeping the DELETE for now; revisit
				// if the decision log needs to be provably append-only for compliance.
				yield* Effect.tryPromise({
					try: async () => {
						// Provenance is the gate: callers only release reservations they
						// minted (created === true). /swap/execute consumes BEFORE the
						// internal broadcast, so a status check here would silently skip
						// every legitimate post-consume release on that route and leak
						// cap budget (PR #617 review, round 3 M1). approvalId is kept in
						// the signature for auditability/logging.
						void approvalId
						await db.delete(policyDecisions).where(eq(policyDecisions.id, id))
					},
					catch: (e) => new DatabaseError({ message: `releaseApprovalAllowance failed: ${e}`, cause: e }),
				})
			}),
	}),
)
