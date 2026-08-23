/**
 * Stage 2 — think.
 *
 * A thesis engine turns a screened candidate into a claim the agent is willing
 * to be judged on: an action, a size, a confidence, the evidence it rests on,
 * and — required — the condition that would prove it wrong.
 *
 * The engine is pluggable. `RulesThesisEngine` is the deterministic default:
 * every thesis it produces is reproducible from the candidate snapshot alone,
 * so a third party can re-derive the decision, not just read the story.
 */
import type { Candidate, ExitPlan, OpenPositionSummary, Thesis } from './types'

export interface ThesisContext {
	/** Free capital the agent could deploy right now. */
	availableUsd: number
	maxPositionUsd: number
	/** Positions already open — an engine may size down as the book fills. */
	openPositions: OpenPositionSummary[]
}

export interface ThesisEngine {
	readonly id: string
	readonly version: string
	/** Returns null when the candidate is not worth a thesis at all. */
	formEntry(candidate: Candidate, ctx: ThesisContext): Promise<Thesis | null>
	/** Exits are mechanical: the plan was committed at entry. */
	formExit(position: OpenPositionSummary, currentPriceUsd: number, reason: string): Promise<Thesis>
}

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n))

/** 0–1 score that peaks inside a band and decays outside it. */
function bandScore(value: number, lo: number, hi: number): number {
	if (!Number.isFinite(value)) return 0
	if (value >= lo && value <= hi) return 1
	if (value < lo) return clamp(value / lo, 0, 1)
	return clamp(hi / value, 0, 1)
}

export interface RulesEngineConfig {
	/** Fraction of free capital to risk on a full-confidence entry, 0–1. */
	riskPerTradePct: number
	stopLossPct: number
	takeProfitPct: number
	maxHoldMinutes: number
	/** Refuse anything below this composite score. */
	minScore: number
}

export const DEFAULT_RULES_ENGINE_CONFIG: RulesEngineConfig = {
	riskPerTradePct: 0.1,
	stopLossPct: 20,
	takeProfitPct: 60,
	maxHoldMinutes: 2880,
	minScore: 0.6,
}

/**
 * Deterministic momentum-and-structure engine.
 *
 * It looks for tokens whose depth and turnover support the move, and
 * deliberately fades parabolas: a token already up 200% in an hour scores
 * near zero, because the trade there is someone else's exit.
 */
export class RulesThesisEngine implements ThesisEngine {
	readonly id = 'rules'
	readonly version = '1.0.0'

	constructor(private readonly config: RulesEngineConfig = DEFAULT_RULES_ENGINE_CONFIG) {}

	async formEntry(candidate: Candidate, ctx: ThesisContext): Promise<Thesis | null> {
		const scores = this.score(candidate)
		const composite = scores.composite

		if (composite < this.config.minScore) return null

		const budget = Math.min(ctx.maxPositionUsd, ctx.availableUsd * this.config.riskPerTradePct)
		const sizeUsd = Math.floor(budget * composite * 100) / 100
		if (sizeUsd <= 0) return null

		const exit: ExitPlan = {
			stopLossPct: this.config.stopLossPct,
			takeProfitPct: this.config.takeProfitPct,
			maxHoldMinutes: this.config.maxHoldMinutes,
			invalidation: `liquidity falls below $${Math.round(candidate.liquidityUsd * 0.5)}, 24h volume falls below $${Math.round(candidate.volume24hUsd * 0.25)}, or price is ${this.config.stopLossPct}% below entry`,
		}

		return {
			action: 'buy',
			chain: candidate.chain,
			tokenAddress: candidate.tokenAddress,
			symbol: candidate.symbol,
			sizeUsd,
			confidence: Number(composite.toFixed(3)),
			headline: `${candidate.symbol} on ${candidate.chain}: turnover ${scores.turnover.toFixed(2)}x on $${Math.round(candidate.liquidityUsd).toLocaleString()} depth`,
			reasoning: [
				`24h volume of $${Math.round(candidate.volume24hUsd).toLocaleString()} against $${Math.round(candidate.liquidityUsd).toLocaleString()} of liquidity is a turnover of ${scores.turnover.toFixed(2)}x (score ${scores.turnoverScore.toFixed(2)}).`,
				`1h price change ${(candidate.priceChange1hPct ?? 0).toFixed(1)}% (score ${scores.momentumScore.toFixed(2)}) — the engine fades parabolic moves rather than chasing them.`,
				`Depth score ${scores.depthScore.toFixed(2)} and age score ${scores.ageScore.toFixed(2)} (${candidate.ageMinutes ?? 'unknown'} minutes old).`,
				`Composite ${composite.toFixed(3)} clears the ${this.config.minScore} floor, so size is ${(composite * 100).toFixed(0)}% of the $${budget.toFixed(2)} budget.`,
			].join(' '),
			evidence: {
				priceUsd: candidate.priceUsd,
				liquidityUsd: Math.round(candidate.liquidityUsd),
				volume24hUsd: Math.round(candidate.volume24hUsd),
				turnover: Number(scores.turnover.toFixed(4)),
				priceChange1hPct: candidate.priceChange1hPct ?? 0,
				priceChange24hPct: candidate.priceChange24hPct ?? 0,
				ageMinutes: candidate.ageMinutes ?? -1,
				depthScore: Number(scores.depthScore.toFixed(3)),
				turnoverScore: Number(scores.turnoverScore.toFixed(3)),
				momentumScore: Number(scores.momentumScore.toFixed(3)),
				ageScore: Number(scores.ageScore.toFixed(3)),
			},
			exit,
			engine: this.id,
			engineVersion: this.version,
			formedAt: new Date().toISOString(),
		}
	}

	async formExit(
		position: OpenPositionSummary,
		currentPriceUsd: number,
		reason: string,
	): Promise<Thesis> {
		const pnlPct =
			position.avgEntryPriceUsd > 0
				? ((currentPriceUsd - position.avgEntryPriceUsd) / position.avgEntryPriceUsd) * 100
				: 0
		return {
			action: 'sell',
			chain: position.chain,
			tokenAddress: position.tokenAddress,
			symbol: position.symbol,
			sizeUsd: position.costBasisUsd * (1 + pnlPct / 100),
			confidence: 1,
			headline: `Exit ${position.symbol}: ${reason}`,
			reasoning: `Exit plan committed at entry fired. ${reason}. Entry $${position.avgEntryPriceUsd}, current $${currentPriceUsd}, unrealized ${pnlPct.toFixed(1)}%.`,
			evidence: {
				entryPriceUsd: position.avgEntryPriceUsd,
				currentPriceUsd,
				pnlPct: Number(pnlPct.toFixed(2)),
				trigger: reason,
			},
			exit: { invalidation: 'n/a — this is the exit' },
			engine: this.id,
			engineVersion: this.version,
			formedAt: new Date().toISOString(),
		}
	}

	/** Exposed for tests and for the `/explain` endpoint. */
	score(candidate: Candidate): {
		turnover: number
		depthScore: number
		turnoverScore: number
		momentumScore: number
		ageScore: number
		composite: number
	} {
		const turnover =
			candidate.liquidityUsd > 0 ? candidate.volume24hUsd / candidate.liquidityUsd : 0

		// Depth: $50k is thin, $1M is comfortable. Log-scaled.
		const depthScore = clamp(
			Math.log10(Math.max(candidate.liquidityUsd, 1) / 50_000) / Math.log10(20),
			0,
			1,
		)

		// Turnover: real interest is 0.5x–5x daily. Below is dead, far above is a wash-trade smell.
		const turnoverScore = bandScore(turnover, 0.5, 5)

		// Momentum: want up, not vertical. Peak 5–40% on the hour, decay past that.
		const h1 = candidate.priceChange1hPct ?? 0
		const momentumScore = h1 <= 0 ? 0 : bandScore(h1, 5, 40)

		// Age: 6h–30d. Younger is unpriced risk, much older is usually a corpse.
		const age = candidate.ageMinutes
		const ageScore = age === undefined ? 0 : bandScore(age, 360, 43_200)

		const composite =
			depthScore * 0.3 + turnoverScore * 0.3 + momentumScore * 0.25 + ageScore * 0.15

		return { turnover, depthScore, turnoverScore, momentumScore, ageScore, composite }
	}
}
