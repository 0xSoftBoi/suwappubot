/** Shared types for the autopilot loop: read → think → gate → seal → execute → journal → reveal. */

export type AutopilotAction = 'buy' | 'sell' | 'hold'

/** Stage 1 (read): a token the screener surfaced, with the facts we scored it on. */
export interface Candidate {
	chain: string
	tokenAddress: string
	symbol: string
	priceUsd: number
	liquidityUsd: number
	volume24hUsd: number
	marketCapUsd?: number
	priceChange5mPct?: number
	priceChange1hPct?: number
	priceChange24hPct?: number
	holders?: number
	/** Minutes since the pool was created. */
	ageMinutes?: number
	/** Token-security verdict, from the existing token_security pipeline. */
	security?: TokenSecurity
	/** Which discovery list surfaced this, and where it placed in that list. */
	source?: 'trending' | 'new'
	sourceRank?: number
	/** Free-form extras the thesis engine may cite. */
	signals?: Record<string, number | string | boolean>
}

export interface TokenSecurity {
	isHoneypot?: boolean
	buyTaxBps?: number
	sellTaxBps?: number
	/** Percentage of supply held by the top 10 wallets, 0–100. */
	topHolderPct?: number
	lpLocked?: boolean
	mintable?: boolean
	freezable?: boolean
	verified?: boolean
}

/** Stage 2 (think): what the agent believes and what would prove it wrong. */
export interface Thesis {
	action: AutopilotAction
	chain: string
	tokenAddress: string
	symbol: string
	/** Intended notional in USD. Zero for `hold`. */
	sizeUsd: number
	/** 0–1. Gates can require a floor. */
	confidence: number
	/** One line, publishable at seal time without revealing the full thesis. */
	headline: string
	/** The actual argument — revealed only after execution. */
	reasoning: string
	/** Named observations the reasoning rests on. */
	evidence: Record<string, number | string | boolean>
	/** The exit plan, committed at entry. */
	exit: ExitPlan
	/** Which engine produced this and at what version. */
	engine: string
	engineVersion: string
	/** ISO timestamp of when the thesis was formed. */
	formedAt: string
}

export interface ExitPlan {
	takeProfitPct?: number
	stopLossPct?: number
	/** Plain-language condition that invalidates the thesis. Required by the gate. */
	invalidation: string
	/** Hard time stop in minutes — close regardless of P&L. */
	maxHoldMinutes?: number
}

/** Stage 3 (gate): every rule that ran, and what it said. */
export interface GateResult {
	rule: string
	passed: boolean
	/** Human-readable reason — always populated on failure. */
	detail: string
	observed?: number | string | boolean
	limit?: number | string | boolean
}

export interface GateVerdict {
	passed: boolean
	results: GateResult[]
	/** First failing rule's detail — what we store as rejectionReason. */
	rejectionReason?: string
}

/** Risk rules. Every field has a conservative default in DEFAULT_RULES. */
export interface AutopilotRules {
	maxPositionUsd: number
	maxOpenPositions: number
	maxPortfolioExposurePct: number
	minLiquidityUsd: number
	/** Position must be at most this share of the pool, or we are the exit liquidity. */
	maxPoolSharePct: number
	minTokenAgeMinutes: number
	maxBuyTaxBps: number
	maxSellTaxBps: number
	maxTopHolderPct: number
	requireLpLocked: boolean
	minConfidence: number
	dailySpendCapUsd: number
	/** Halt the agent for the rest of the day after this much realized loss. */
	dailyLossHaltUsd: number
	/** Refuse a re-entry into the same token within this window. */
	tokenCooldownMinutes: number
	/**
	 * Hard ceiling on how long ANY position may be held, whatever its thesis
	 * committed to. The effective stop is the tighter of the two. A book with no
	 * time stop never closes anything, and a track record needs closed trades.
	 */
	maxHoldMinutes: number
	maxSlippageBps: number
	/**
	 * Ceiling the slippage allowance may escalate to when an exit keeps failing.
	 * An exit that cannot fill is not an exit: if 150bps is too tight for a
	 * market moving against us, retrying at 150bps fails on exactly the days it
	 * matters while the position runs past the stop it was meant to enforce.
	 * Entries never escalate — refusing to buy costs nothing.
	 */
	exitSlippageCeilingBps: number
	/**
	 * Round-trip cost charged per side in paper mode: DEX fee plus our own.
	 * A paper record that trades for free is not a forecast of a live one.
	 */
	paperFeeBps: number
	allowedChains: string[]
	deniedTokens: string[]
	requireExitPlan: boolean
}

export const DEFAULT_RULES: AutopilotRules = {
	maxPositionUsd: 100,
	maxOpenPositions: 5,
	maxPortfolioExposurePct: 60,
	minLiquidityUsd: 50_000,
	maxPoolSharePct: 1,
	minTokenAgeMinutes: 60,
	maxBuyTaxBps: 500,
	maxSellTaxBps: 500,
	maxTopHolderPct: 40,
	requireLpLocked: true,
	minConfidence: 0.6,
	dailySpendCapUsd: 500,
	dailyLossHaltUsd: 200,
	tokenCooldownMinutes: 240,
	maxHoldMinutes: 2880,
	maxSlippageBps: 150,
	exitSlippageCeilingBps: 600,
	paperFeeBps: 30,
	allowedChains: ['base', 'solana', 'bsc', 'hyperevm', 'robinhood'],
	deniedTokens: [],
	requireExitPlan: true,
}

/** Portfolio facts the gate needs. Supplied by the service, kept out of the pure rules. */
export interface PortfolioState {
	/** The asset the book is denominated in. Never a valid thing to buy. */
	baseToken?: string | undefined
	equityUsd: number
	deployedUsd: number
	openPositions: OpenPositionSummary[]
	spentTodayUsd: number
	realizedPnlTodayUsd: number
	/**
	 * Mark-to-market on the open book. The loss halt counts this: an agent whose
	 * positions are deeply underwater has realized nothing, so a halt on realized
	 * P&L alone never fires — which is the ordinary way an automated strategy
	 * blows up. The losses are all unrealized right up until they are not.
	 */
	unrealizedPnlUsd: number
	/** tokenAddress (lowercased) → epoch ms of the last decision on it. */
	lastTradeAtByToken: Record<string, number>
}

export interface OpenPositionSummary {
	/** Row id — needed to update the position without matching on token+agent. */
	id: number
	chain: string
	tokenAddress: string
	symbol: string
	amount: string
	costBasisUsd: number
	avgEntryPriceUsd: number
	takeProfitPct?: number | undefined
	stopLossPct?: number | undefined
	invalidation?: string | undefined
	maxHoldMinutes?: number | undefined
	/** Consecutive failed attempts to close this position. Drives escalation. */
	exitAttempts?: number | undefined
	openedAt: number
}

/** Stage 5 (execute). */
export interface ExecutionRequest {
	chain: string
	/**
	 * Which way the trade goes. Slippage is directional — a buy fills above mid,
	 * a sell below it — so an executor that ignores side systematically flatters
	 * one of them.
	 */
	side: 'buy' | 'sell'
	fromToken: string
	toToken: string
	amountUsd: number
	slippageBps: number
	walletAddress?: string | undefined
	/** Idempotency key — the decision's commitment. */
	idempotencyKey: string
}

/**
 * Everything an executor may be handed. One honest type for both
 * implementations: fields a given executor ignores are optional, rather than
 * being smuggled past the compiler with a cast at the call that spends money.
 */
export interface ExecutionCall extends ExecutionRequest {
	/** Mid price the thesis was formed on. Required by the paper executor. */
	referencePriceUsd?: number | undefined
	/** Pool depth, for modelling impact. Absent on exits. */
	liquidityUsd?: number | undefined
	/** Simulated round-trip cost per side. Ignored by the live executor. */
	feeBps?: number | undefined
	/** Amount in the token being spent, when it is not a USD notional. */
	amountHuman?: string | undefined
}

export interface ExecutionResult {
	ok: boolean
	txHash?: string
	quoteId?: string
	fillPriceUsd?: number
	fillAmount?: string
	realizedSlippageBps?: number
	error?: string
	/**
	 * Set when a failure leaves the on-chain outcome genuinely unknown — the
	 * order was sent and no answer came back. Distinct from `ok: false`, which
	 * on its own means "did not happen". Treating the two the same is how an
	 * agent buys the same position twice: it books nothing, still believes it
	 * holds the cash, and spends it again on the next cycle.
	 */
	mayHaveBroadcast?: boolean
	/** True when the fill was simulated rather than broadcast. */
	paper: boolean
}
