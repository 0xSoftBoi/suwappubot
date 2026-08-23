/**
 * Stage 5 — execute.
 *
 * Two implementations behind one interface:
 *
 *  - `PaperExecutor` simulates the fill from the pool depth the thesis was
 *    formed on. It is the default, and the only one that runs unless an
 *    operator explicitly puts an agent in `live` mode.
 *  - `ManagedExecutor` goes through our own public agent API (quote →
 *    swap/execute) with the autopilot's API key, so every existing money-path
 *    control — policy gate, spend limits, approvals, fee handling, idempotency
 *    — applies unchanged. The autopilot deliberately owns no signing path of
 *    its own.
 */
import { logger } from '../../lib/logger'
import type { ExecutionRequest, ExecutionResult } from './types'

export interface Executor {
	readonly mode: 'paper' | 'live'
	execute(
		req: ExecutionRequest & { referencePriceUsd?: number; liquidityUsd?: number },
	): Promise<ExecutionResult>
}

/**
 * Simulated fill against a constant-product curve.
 *
 * For reserves X (quote) and Y (token), spending dx returns dy = Y*dx/(X+dx),
 * so the effective price is (X+dx)/Y against a mid of X/Y — an impact of
 * exactly dx/X. Note both what X is and what it is not: it is the QUOTE-side
 * reserve, which is half the pool. Every depth number we ingest —
 * GeckoTerminal's `reserve_in_usd`, DexScreener's `liquidity.usd` — reports
 * TOTAL TVL across both sides, so dividing by it directly models half the
 * slippage we would really pay. That understatement is invisible in the
 * output; it just makes every paper trade look better than it was.
 */
export class PaperExecutor implements Executor {
	readonly mode = 'paper' as const

	async execute(
		req: ExecutionRequest & {
			referencePriceUsd?: number
			liquidityUsd?: number
			feeBps?: number
		},
	): Promise<ExecutionResult> {
		const price = req.referencePriceUsd
		if (!price || price <= 0) {
			return { ok: false, error: 'paper fill needs a reference price', paper: true }
		}

		const liquidity = req.liquidityUsd ?? 0
		// Half the reported TVL is the side we trade against. Impact is dx/X, and
		// it is deliberately unbounded: on a constant-product curve you cannot buy
		// out the reserve, so a trade that dwarfs the pool must price as absurd
		// rather than asymptote to a comfortable-looking 100%.
		const quoteReserveUsd = liquidity / 2
		const impact = quoteReserveUsd > 0 ? req.amountUsd / quoteReserveUsd : 0.01
		const feeBps = req.feeBps ?? 0
		const cost = impact + feeBps / 10_000
		const slippageBps = Math.round(impact * 10_000)

		if (slippageBps > req.slippageBps) {
			return {
				ok: false,
				error: `simulated slippage ${slippageBps}bps exceeds the ${req.slippageBps}bps limit`,
				paper: true,
			}
		}

		// Direction matters. A buy lifts the offer and fills ABOVE mid; a sell hits
		// the bid and fills BELOW it. Both are worse than mid — modelling a sell
		// with `1 + impact` hands the paper book a better price than the market
		// would give, and every closed trade then reads better than it was.
		const fillPriceUsd = req.side === 'sell' ? price * (1 - cost) : price * (1 + cost)
		return {
			ok: true,
			paper: true,
			fillPriceUsd,
			fillAmount: (req.amountUsd / fillPriceUsd).toString(),
			realizedSlippageBps: slippageBps,
			txHash: `paper:${req.idempotencyKey.slice(0, 32)}`,
		}
	}
}

export interface ManagedExecutorConfig {
	/** Base URL of our own API, e.g. https://api.suwappu.bot */
	apiBaseUrl: string
	/** Autopilot's agent API key (suwappu_sk_...). */
	apiKey: string
	timeoutMs?: number
}

interface QuoteResponse {
	success?: boolean
	quote_id?: string
	quote?: {
		quote_id?: string
		to_amount_human?: number
		from_amount_human?: number
		price_impact?: number
		exchange_rate?: number
	}
	error?: string
}

interface ExecuteResponse {
	success?: boolean
	tx_hash?: string
	transaction_hash?: string
	status?: string
	error?: string
	error_code?: string
}

export class ManagedExecutor implements Executor {
	readonly mode = 'live' as const

	constructor(private readonly config: ManagedExecutorConfig) {}

	private headers(extra: Record<string, string> = {}): Record<string, string> {
		return {
			'Content-Type': 'application/json',
			Authorization: `Bearer ${this.config.apiKey}`,
			...extra,
		}
	}

	async execute(
		req: ExecutionRequest & { referencePriceUsd?: number; amountHuman?: string },
	): Promise<ExecutionResult> {
		const timeout = this.config.timeoutMs ?? 30_000

		// The amount is denominated in the token we are spending: USDC notional
		// for an entry, token units for an exit.
		const amount =
			req.amountHuman ??
			(req.referencePriceUsd && req.referencePriceUsd > 0
				? (req.amountUsd / req.referencePriceUsd).toString()
				: req.amountUsd.toString())

		let quote: QuoteResponse
		try {
			const res = await fetch(`${this.config.apiBaseUrl}/v1/agent/quote`, {
				method: 'POST',
				headers: this.headers(),
				body: JSON.stringify({
					from_token: req.fromToken,
					to_token: req.toToken,
					amount,
					chain: req.chain,
					slippage: req.slippageBps / 100,
					...(req.walletAddress ? { wallet_address: req.walletAddress } : {}),
				}),
				signal: AbortSignal.timeout(timeout),
			})
			quote = (await res.json()) as QuoteResponse
			if (!res.ok) {
				return { ok: false, paper: false, error: quote.error ?? `quote failed (${res.status})` }
			}
		} catch (err) {
			return { ok: false, paper: false, error: `quote request failed: ${String(err)}` }
		}

		const quoteId = quote.quote_id ?? quote.quote?.quote_id
		if (!quoteId) return { ok: false, paper: false, error: 'quote returned no quote_id' }

		try {
			const res = await fetch(`${this.config.apiBaseUrl}/v1/agent/swap/execute`, {
				method: 'POST',
				headers: this.headers({ 'Idempotency-Key': req.idempotencyKey.slice(0, 64) }),
				body: JSON.stringify({ quote_id: quoteId }),
				signal: AbortSignal.timeout(timeout),
			})
			const data = (await res.json()) as ExecuteResponse
			if (!res.ok || data.success === false) {
				return {
					ok: false,
					paper: false,
					quoteId,
					error: data.error ?? `execute failed (${res.status})`,
				}
			}

			const result: ExecutionResult = { ok: true, paper: false, quoteId }
			const txHash = data.tx_hash ?? data.transaction_hash
			if (txHash) result.txHash = txHash
			const toAmount = quote.quote?.to_amount_human
			if (typeof toAmount === 'number' && toAmount > 0) {
				result.fillAmount = toAmount.toString()
				if (req.amountUsd > 0) result.fillPriceUsd = req.amountUsd / toAmount
			}
			if (typeof quote.quote?.price_impact === 'number') {
				result.realizedSlippageBps = Math.round(quote.quote.price_impact * 10_000)
			}
			return result
		} catch (err) {
			logger.error({ err: String(err), quoteId }, 'autopilot: managed execution failed')
			return { ok: false, paper: false, quoteId, error: `execute request failed: ${String(err)}` }
		}
	}
}
