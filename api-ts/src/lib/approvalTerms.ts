/**
 * Economic terms captured for a deferred (require_approval) swap execution.
 *
 * CRITICAL: quote_id is NEVER stored here. Cached quotes expire in 60s
 * (AGENT_QUOTE_TTL in quoteCache.ts) and the cache is per-process, so by the
 * time a human approves (up to APPROVAL_TTL_MS later) the quote_id is
 * guaranteed to be gone. Instead we store the raw, re-quotable trade
 * parameters (chain/tokens/amount-in/wallet) plus the worst acceptable
 * amount_out_min at approval time. On resubmit, the execute path re-quotes
 * server-side from these terms and requires the fresh amount_out_min to be
 * >= the approved one (never a worse price) — see ApprovalService.
 */
export interface EconomicTerms {
	isSolana: boolean
	/** EVM: numeric chain id as a string. Solana: 'solana'. */
	fromChain: string
	toChain: string
	fromToken: string
	toToken: string
	/** Raw base-unit amount (wei / lamports / smallest unit) as a string. */
	amountIn: string
	/** Raw base-unit minimum-out amount as a string. */
	amountOutMin: string
	walletAddress: string
	slippageBps?: number
	slippage?: number
	valueUsd: number
}

/** Fields that define "the same trade" — excludes amountOutMin (checked via
 * inequality, not equality) and valueUsd (informational / re-derived fresh). */
type CoreTerms = Omit<EconomicTerms, 'amountOutMin' | 'valueUsd'>

export function coreTermsOf(terms: EconomicTerms): CoreTerms {
	const { amountOutMin: _amountOutMin, valueUsd: _valueUsd, ...core } = terms
	return core
}

/** Minimal shape both JupiterQuote and the internal getQuote call site need. */
export function termsFromSolanaQuote(
	quote: {
		inputMint: string
		outputMint: string
		inAmount: string
		otherAmountThreshold: string
		slippageBps: number
	},
	walletAddress: string,
): EconomicTerms {
	return {
		isSolana: true,
		fromChain: 'solana',
		toChain: 'solana',
		fromToken: quote.inputMint,
		toToken: quote.outputMint,
		amountIn: quote.inAmount,
		amountOutMin: quote.otherAmountThreshold,
		walletAddress,
		slippageBps: quote.slippageBps,
		// Solana quotes carry no USD value at this layer; caps that key on USD
		// value are skipped for Solana trades (see PolicyIntent callers).
		valueUsd: 0,
	}
}

/**
 * Parses an EVM quote's USD value, returning null when it can't be priced
 * (missing, non-finite, or <= 0 fromAmountUsd). Callers MUST refuse the
 * approval flow on null rather than defaulting to 0 — a $0 valueUsd would
 * silently bypass daily/session/velocity USD caps for a trade that may be
 * worth real money (mirrors the Solana refusal in agent.ts, which has the
 * same problem for a different reason: no USD pricing at that layer at all).
 *
 * <= 0 is treated as unpriced, not just missing/non-finite: SwapService's
 * Li.Fi quote mapping always emits `fromUsd.toFixed(2)` (see SwapService.ts),
 * so a token LI.FI can't price comes through as the finite string "0.00"
 * rather than absent — a bare null/NaN check alone would miss it and let a
 * genuinely unpriceable trade through with valueUsd 0.
 */
export function evmQuoteUsdValue(fromAmountUsd: string | undefined): number | null {
	if (fromAmountUsd == null) return null
	const n = parseFloat(fromAmountUsd)
	return Number.isFinite(n) && n > 0 ? n : null
}

export function termsFromEvmQuote(
	quote: {
		fromChain: string
		toChain: string
		fromToken: { address: string }
		toToken: { address: string }
		fromAmount: string
		toAmountMin: string
		slippage: number
		fromAmountUsd?: string
	},
	walletAddress: string,
): EconomicTerms | null {
	const valueUsd = evmQuoteUsdValue(quote.fromAmountUsd)
	if (valueUsd == null) return null
	return {
		isSolana: false,
		fromChain: String(quote.fromChain),
		toChain: String(quote.toChain),
		fromToken: quote.fromToken.address,
		toToken: quote.toToken.address,
		amountIn: quote.fromAmount,
		amountOutMin: quote.toAmountMin,
		walletAddress,
		slippage: quote.slippage,
		valueUsd,
	}
}
