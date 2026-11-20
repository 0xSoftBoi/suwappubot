/**
 * Uniswap Trading API client (developers.uniswap.org).
 *
 * Endpoints (per the Trading API integration guide):
 *   POST /v1/quote          — best route across Classic / UniswapX
 *   POST /v1/swap           — classic swap transaction (or wrap/unwrap/bridge)
 *   POST /v1/order          — UniswapX order (Dutch / Priority)
 *   POST /v1/check_approval — Permit2-aware approval status
 *
 * Auth: x-api-key header. Get a key at developers.uniswap.org/dashboard.
 */
import { z } from 'zod'

export interface TradingApiConfig {
	apiKey: string
	baseUrl: string
	timeoutMs: number
}

export function loadTradingApiConfig(env: NodeJS.ProcessEnv = process.env): TradingApiConfig {
	const apiKey = env['UNISWAP_API_KEY']
	if (!apiKey) {
		throw new Error('Uniswap Trading API not configured — set UNISWAP_API_KEY (developers.uniswap.org/dashboard)')
	}
	return {
		apiKey,
		baseUrl: (env['UNISWAP_BASE_URL'] ?? 'https://trade-api.gateway.uniswap.org').replace(/\/$/, ''),
		timeoutMs: Number(env['UNISWAP_TIMEOUT_MS'] ?? 10000),
	}
}

export function isTradingApiConfigured(env: NodeJS.ProcessEnv = process.env): boolean {
	return Boolean(env['UNISWAP_API_KEY'])
}

const QuoteRequest = z.object({
	tokenInChainId: z.number(),
	tokenOutChainId: z.number(),
	tokenIn: z.string(),
	tokenOut: z.string(),
	amount: z.string(), // raw units, tokenIn decimals
	type: z.enum(['EXACT_INPUT', 'EXACT_OUTPUT']).default('EXACT_INPUT'),
	swapper: z.string().optional(),
	routingPreference: z.enum(['CLASSIC', 'UNISWAPX', 'BEST_PRICE']).default('BEST_PRICE'),
	permitData: z.unknown().optional(),
})
export type QuoteRequest = z.infer<typeof QuoteRequest>

const QuoteResponse = z.object({
	quote: z.object({
		routeType: z.enum(['CLASSIC', 'DUTCH_LIMIT', 'DUTCH_V2', 'PRIORITY', 'WRAP', 'UNWRAP', 'BRIDGE']),
		chainId: z.number(),
		tokenIn: z.string(),
		tokenOut: z.string(),
		amountIn: z.string(),
		amountOut: z.string(),
		usdValue: z.number().optional(),
		gasFeeUsd: z.number().optional(),
	}).passthrough(),
	requestId: z.string().optional(),
}).passthrough()
export type QuoteResponse = z.infer<typeof QuoteResponse>

async function post<T>(cfg: TradingApiConfig, path: string, body: unknown, schema: z.ZodType<T>): Promise<T> {
	const ctrl = new AbortController()
	const t = setTimeout(() => ctrl.abort(), cfg.timeoutMs)
	try {
		const res = await fetch(`${cfg.baseUrl}${path}`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json', 'x-api-key': cfg.apiKey },
			body: JSON.stringify(body),
			signal: ctrl.signal,
		})
		if (!res.ok) {
			const text = await res.text().catch(() => '')
			throw new Error(`uniswap ${path} → http ${res.status} ${text.slice(0, 300)}`)
		}
		return schema.parse(await res.json())
	} finally {
		clearTimeout(t)
	}
}

/** Best route for a swap, across Classic and UniswapX. */
export function getQuote(cfg: TradingApiConfig, req: QuoteRequest): Promise<QuoteResponse> {
	return post(cfg, '/v1/quote', QuoteRequest.parse(req), QuoteResponse)
}

/**
 * Dispatch on routeType — the routing core:
 *  CLASSIC / WRAP / UNWRAP / BRIDGE → /v1/swap (onchain transaction)
 *  DUTCH_LIMIT / DUTCH_V2 / PRIORITY → /v1/order (UniswapX order)
 * Chained actions (multi-step, e.g. bridge+swap) → caller composes via
 * /v1/swap per leg; see routeAdapter.ts.
 */
export function getExecution(cfg: TradingApiConfig, quote: QuoteResponse, params: Record<string, unknown>) {
	const rt = quote.quote.routeType
	if (rt === 'CLASSIC' || rt === 'WRAP' || rt === 'UNWRAP' || rt === 'BRIDGE') {
		return post(cfg, '/v1/swap', { ...params, quote: quote.quote }, z.unknown())
	}
	if (rt === 'DUTCH_LIMIT' || rt === 'DUTCH_V2' || rt === 'PRIORITY') {
		return post(cfg, '/v1/order', { ...params, quote: quote.quote }, z.unknown())
	}
	throw new Error(`unsupported routeType from quote: ${rt}`)
}

/** Permit2-aware approval check before building the swap transaction. */
export function checkApproval(
	cfg: TradingApiConfig,
	params: { chainId: number; token: string; wallet: string; amount: string; spender?: string },
): Promise<unknown> {
	return post(cfg, '/v1/check_approval', params, z.unknown())
}
