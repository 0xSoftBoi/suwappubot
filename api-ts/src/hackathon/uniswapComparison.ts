/**
 * HACKATHON (ETHGlobal Tokyo 2026) — Uniswap Trading API comparison quote.
 *
 * Mirrors the KyberSwap comparison-only race in SwapService: forked, bounded
 * by Effect.timeout, swallowed by Effect.option, polled non-blockingly via
 * Fiber.poll, and logged as route_race telemetry. Can never win execution —
 * Li.Fi stays the only executable provider (same rationale as the KyberSwap
 * comment block above SwapServiceLive).
 *
 * Opt-in only: UNISWAP_COMPARISON_ENABLED=true (default off) plus
 * UNISWAP_API_KEY. Zero added latency to the user path either way.
 */

import { Effect } from 'effect'
import { UniswapTradingProvider } from './tokyo2026/uniswap/routeAdapter'
import { isTradingApiConfigured } from './tokyo2026/uniswap/tradingApi'
import { uniswapComparisonEnabled } from './env'
import type { Env } from '../config/EnvService'

export interface UniswapComparisonQuote {
	provider: 'uniswap'
	toAmount: string
	toAmountUsd: number | null
	gasUsd: number | null
}

/**
 * Fetch a Uniswap Trading API quote for comparison/telemetry only.
 * Same-chain EVM only — the caller gates on fromChainId === toChainId, same
 * as the KyberSwap race. Fails (→ None via Effect.option at the call site)
 * when disabled, unconfigured, or on any provider error.
 */
export function fetchUniswapComparisonQuote(
	env: Env,
	params: {
		fromChainId: number
		fromToken: string
		toToken: string
		fromAmount: string
	},
): Effect.Effect<UniswapComparisonQuote, Error> {
	return Effect.tryPromise({
		try: async () => {
			if (!uniswapComparisonEnabled(env) || !isTradingApiConfigured()) {
				throw new Error('uniswap comparison disabled or UNISWAP_API_KEY not configured')
			}
			const provider = new UniswapTradingProvider()
			const q = await provider.quote({
				tokenInChainId: params.fromChainId,
				tokenOutChainId: params.fromChainId,
				tokenIn: params.fromToken,
				tokenOut: params.toToken,
				amount: params.fromAmount,
				type: 'EXACT_INPUT',
				routingPreference: 'BEST_PRICE',
			})
			return {
				provider: 'uniswap' as const,
				toAmount: q.amountOut,
				toAmountUsd: q.usdValue ?? null,
				gasUsd: q.gasFeeUsd ?? null,
			}
		},
		catch: (e) => (e instanceof Error ? e : new Error(String(e))),
	})
}
