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
	maxSlippageBps: number
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
	maxSlippageBps: 150,
	paperFeeBps: 30,
	allowedChains: ['base', 'arbitrum', 'solana'],
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
	/** tokenAddress (lowercased) → epoch ms of the last decision on it. */
	lastTradeAtByToken: Record<string, number>
}

export interface OpenPositionSummary {
	chain: string
	tokenAddress: string
	symbol: string
	amount: string
	costBasisUsd: number
	avgEntryPriceUsd: number
	takeProfitPct?: number | undefined
	stopLossPct?: number | undefined
	invalidation?: string | undefined
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

export interface ExecutionResult {
	ok: boolean
	txHash?: string
	quoteId?: string
	fillPriceUsd?: number
	fillAmount?: string
	realizedSlippageBps?: number
	error?: string
	/** True when the fill was simulated rather than broadcast. */
	paper: boolean
}
