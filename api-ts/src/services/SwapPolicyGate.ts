/**
 * Shared swap policy-intent builder + evaluator — MONEY-PATH.
 *
 * Both entry points that gate a swap on org policy — POST /v1/agent/swap/build
 * (routes/agent.ts) and the MCP execute_swap tool (routes/mcp.ts, via
 * McpPolicyGate.ts) — build their PolicyIntent from the exact same swap-quote
 * shape (Li.Fi quote for EVM, Jupiter quote for Solana). This module is the
 * single place that mapping happens, so the two paths can never drift
 * (chain-key basis, agentId basis, valueUsd basis, etc).
 *
 * agent.ts predates the MCP path — conventions here match it: `chain` is the
 * Li.Fi chain KEY (e.g. "base"), not a numeric chainId; agentId is
 * `agent.uuid ?? String(agent.id)`; EVM valueUsd is `fromAmountUsd`.
 */

import { Effect, Either } from 'effect'
import { PolicyService, type PolicyIntent, type PolicyDecisionResult } from './PolicyService'
import { runEffectEither } from '../runtime'
import { logger } from '../lib/logger'

/** Minimal EVM (Li.Fi) quote shape needed to build a PolicyIntent. */
export interface EvmQuoteForPolicy {
	fromChain: string | number
	fromToken?: { address?: string | null } | null
	toToken?: { address?: string | null } | null
	fromAmountUsd?: string | null
	estimatedGasUsd?: string | null
	slippage?: number | null
}

/** Minimal Solana (Jupiter) quote shape needed to build a PolicyIntent. */
export interface SolanaQuoteForPolicy {
	inputMint?: string | null
	outputMint?: string | null
	slippageBps?: number | null
}

export interface SwapPolicyGateResult {
	decision: PolicyDecisionResult['decision']
	reason?: string
	matchedPolicyId?: string
	/** True if this decision came from the fail-closed "cannot price" path,
	 * not from PolicyService.evaluate() itself — useful for audit logging. */
	unpriceable?: boolean
}

/**
 * Build the PolicyIntent for an EVM swap. `canPriceUsd` is always true here —
 * Li.Fi quotes always carry a USD estimate.
 */
export function buildEvmPolicyIntent(
	quote: EvmQuoteForPolicy,
	organizationId: string,
	agentIdStr: string,
): { intent: PolicyIntent; canPriceUsd: boolean } {
	return {
		intent: {
			organizationId,
			agentId: agentIdStr,
			chain: String(quote.fromChain),
			fromToken: quote.fromToken?.address ?? null,
			toToken: quote.toToken?.address ?? null,
			valueUsd: parseFloat(quote.fromAmountUsd ?? '0') || 0,
			gasUsd: parseFloat(quote.estimatedGasUsd ?? '0') || 0,
			slippageBps: quote.slippage != null ? Math.round(quote.slippage * 10_000) : null,
		},
		canPriceUsd: true,
	}
}

/**
 * Build the PolicyIntent for a Solana swap. `canPriceUsd` is always false —
 * JupiterQuote carries no USD field (no fromAmountUsd/toAmountUsd), so
 * valueUsd is a placeholder 0. Callers MUST check `canPriceUsd` before
 * trusting USD-denominated rules — see evaluateSwapPolicy's fail-closed path.
 */
export function buildSolanaPolicyIntent(
	quote: SolanaQuoteForPolicy,
	organizationId: string,
	agentIdStr: string,
): { intent: PolicyIntent; canPriceUsd: boolean } {
	return {
		intent: {
			organizationId,
			agentId: agentIdStr,
			chain: 'solana',
			fromToken: quote.inputMint ?? null,
			toToken: quote.outputMint ?? null,
			valueUsd: 0, // cannot price — see canPriceUsd
			slippageBps: quote.slippageBps ?? null,
		},
		canPriceUsd: false,
	}
}

/**
 * Evaluate a swap PolicyIntent against org policy, with the shared
 * fail-open / fail-closed rules:
 *
 * - No organizationId → allow (retail / un-orged, matches PolicyService's own
 *   internal behavior — this is just a short-circuit to skip a DB round trip).
 * - Cannot price the trade in USD (canPriceUsd: false, i.e. Solana today) AND
 *   the org has ANY enabled USD-denominated rule (maxTxUsd / dailyCapUsd /
 *   requireApprovalAboveUsd) → FAIL CLOSED: block with a distinct reason.
 *   Chain/token allow-block-list-only orgs are unaffected and proceed to
 *   normal evaluation (those rules don't need a USD value).
 * - PolicyService.evaluate() itself throws/errors → FAIL OPEN: allow + warn.
 *   This is the one deliberate fail-open path — an infra hiccup must never
 *   silently block real trades.
 */
export async function evaluateSwapPolicy(
	organizationId: string | null | undefined,
	agentIdStr: string,
	intent: PolicyIntent,
	canPriceUsd: boolean,
): Promise<SwapPolicyGateResult> {
	if (!organizationId) return { decision: 'allow' }

	if (!canPriceUsd) {
		const usdRuleCheck = await runEffectEither(
			Effect.gen(function* () {
				const policyService = yield* PolicyService
				return yield* policyService.hasUsdDenominatedPolicy(organizationId, agentIdStr)
			}),
		)
		// If even the "does a USD rule exist" check errors, fail open (same
		// posture as the main evaluate() error path below) rather than
		// blocking on a DB hiccup.
		if (Either.isRight(usdRuleCheck) && usdRuleCheck.right) {
			logger.warn(
				`[policy] org ${organizationId} agent ${agentIdStr}: unpriceable trade (chain=${intent.chain}) against a USD-denominated policy — failing CLOSED`,
			)
			return {
				decision: 'block',
				reason: 'cannot price Solana trade for policy enforcement',
				unpriceable: true,
			}
		}
		if (Either.isLeft(usdRuleCheck)) {
			logger.warn(`[policy] hasUsdDenominatedPolicy check failed: ${usdRuleCheck.left}; failing open`)
		}
	}

	const result = await runEffectEither(
		Effect.gen(function* () {
			const policyService = yield* PolicyService
			return yield* policyService.evaluate(intent)
		}),
	)

	if (Either.isLeft(result)) {
		// Fail-open on infra error — never block a legitimate trade because the
		// policy DB hiccuped. Deliberate, matches routes/agent.ts's existing
		// posture.
		logger.warn(`[policy] evaluate() failed for org ${organizationId}: ${result.left}; failing open (allow)`)
		return { decision: 'allow' }
	}

	return result.right
}
