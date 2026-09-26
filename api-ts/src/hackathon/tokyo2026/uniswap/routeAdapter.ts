/**
 * Route adapter: Uniswap Trading API as a first-class quote/execution source
 * alongside Suwappu's existing aggregators.
 *
 * Integration point (api-ts): the swap routing layer that today fans out to
 * aggregators (see api-ts/src/services — SwapService / route providers).
 * Register `UniswapTradingProvider` there; it implements the same
 * quote(normalizedRequest) → normalizedQuote interface and participates in
 * best-price selection. The dispatch below decides CLASSIC vs UniswapX vs
 * chained per quote.
 *
 * For the hackathon demo this module is exercised directly (no api-ts edits
 * required to demo the flow end-to-end).
 */
import {
	loadTradingApiConfig,
	getQuote,
	getExecution,
	checkApproval,
	type TradingApiConfig,
	type QuoteRequest,
	type QuoteResponse,
} from './tradingApi.ts'

export interface NormalizedQuote {
	source: 'uniswap'
	routeType: QuoteResponse['quote']['routeType']
	tokenIn: string
	tokenOut: string
	chainId: number
	amountIn: string
	amountOut: string
	usdValue?: number
	gasFeeUsd?: number
	raw: QuoteResponse
}

export interface SwapParams {
	slippageBps?: number
	recipient?: string
	deadlineSeconds?: number
	permitSignature?: string
}

export class UniswapTradingProvider {
	constructor(private readonly cfg: TradingApiConfig = loadTradingApiConfig()) {}

	async quote(req: QuoteRequest): Promise<NormalizedQuote> {
		const res = await getQuote(this.cfg, req)
		const q = res.quote
		return {
			source: 'uniswap',
			routeType: q.routeType,
			tokenIn: q.tokenIn,
			tokenOut: q.tokenOut,
			chainId: q.chainId,
			amountIn: q.amountIn,
			amountOut: q.amountOut,
			usdValue: q.usdValue,
			gasFeeUsd: q.gasFeeUsd,
			raw: res,
		}
	}

	/**
	 * Build the executable for a quoted route.
	 * CLASSIC/WRAP/UNWRAP/BRIDGE → transaction request for /execute.
	 * DUTCH/Priority → UniswapX order payload (gasless — demo the order id).
	 */
	async buildExecution(quote: NormalizedQuote, params: SwapParams = {}): Promise<unknown> {
		return getExecution(this.cfg, quote.raw, {
			slippageTolerance: params.slippageBps != null ? `${params.slippageBps / 10000}` : undefined,
			recipient: params.recipient,
			deadline: params.deadlineSeconds,
			permitSignature: params.permitSignature,
		})
	}

	/**
	 * Permit2-aware approval flow: check whether the wallet has approved the
	 * Universal Router; the caller turns a missing approval into an approval
	 * transaction BEFORE requesting /swap. Never request a swap that will
	 * revert on allowance.
	 */
	async ensureApproval(params: {
		chainId: number
		token: string
		wallet: string
		amount: string
	}): Promise<{ approved: boolean; raw: unknown }> {
		const raw = await checkApproval(this.cfg, params)
		const approved =
			typeof raw === 'object' &&
			raw !== null &&
			(raw as { approved?: boolean }).approved === true
		return { approved, raw }
	}
}
