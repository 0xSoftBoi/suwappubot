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
): EconomicTerms {
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
		valueUsd: parseFloat(quote.fromAmountUsd ?? '0') || 0,
	}
}
