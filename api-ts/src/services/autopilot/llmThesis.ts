/**
 * Stage 2, LLM variant — Claude writes the argument, our code writes the trade.
 *
 * The split matters. The model receives a fixed set of measured facts and
 * returns only *judgement*: a direction, a conviction, the reasoning, and the
 * conditions that would invalidate it. Everything that moves money — which
 * token, which chain, how much — is set by this file from the candidate and the
 * caller's budget. A model that hallucinated a ticker or a $10,000 size could
 * not express it through this interface.
 *
 * Every LLM thesis also carries the deterministic engine's score breakdown in
 * its evidence, so a reader can always see whether the narrative agreed with
 * the numbers or overrode them.
 */
import Anthropic from '@anthropic-ai/sdk'
import { logger } from '../../lib/logger'
import { RulesThesisEngine, type ThesisContext, type ThesisEngine } from './thesis'
import type { Candidate, ExitPlan, OpenPositionSummary, Thesis } from './types'

export const DEFAULT_MODEL = 'claude-opus-5'

/** The only shape the model is allowed to return. */
const THESIS_SCHEMA = {
	type: 'object',
	additionalProperties: false,
	required: ['action', 'confidence', 'headline', 'reasoning', 'key_risks', 'exit'],
	properties: {
		action: { type: 'string', enum: ['buy', 'hold'] },
		confidence: { type: 'number', minimum: 0, maximum: 1 },
		headline: { type: 'string', maxLength: 160 },
		reasoning: { type: 'string', maxLength: 1200 },
		key_risks: { type: 'array', maxItems: 4, items: { type: 'string', maxLength: 200 } },
		exit: {
			type: 'object',
			additionalProperties: false,
			required: ['stop_loss_pct', 'take_profit_pct', 'invalidation'],
			properties: {
				stop_loss_pct: { type: 'number', minimum: 1, maximum: 90 },
				take_profit_pct: { type: 'number', minimum: 1, maximum: 1000 },
				invalidation: { type: 'string', maxLength: 300 },
				max_hold_minutes: { type: 'number', minimum: 5, maximum: 43200 },
			},
		},
	},
} as const

export interface LlmVerdict {
	action: 'buy' | 'hold'
	confidence: number
	headline: string
	reasoning: string
	key_risks: string[]
	exit: {
		stop_loss_pct: number
		take_profit_pct: number
		invalidation: string
		max_hold_minutes?: number
	}
}

const SYSTEM_PROMPT = `You are the analyst for an autonomous crypto trading agent.

You are shown one token, the measured facts about it, and a deterministic
scoring model's breakdown of those same facts. You return a judgement.

Rules you are held to:
- Answer only from the facts given. Do not assert anything about the team, the
  roadmap, social activity, listings or narrative — you were not shown any of
  that, and inventing it is the failure mode that gets an agent liquidated.
- Depth is the constraint that matters most. A position that cannot be exited is
  not a position.
- Turnover far above the pool's depth is more often wash trading than demand.
- A token already vertical on the hour is someone else's exit, not your entry.
- The invalidation condition must be checkable against the same fields you were
  shown, and specific enough that a machine could evaluate it later.
- Say hold whenever the facts do not support a position. Refusing is a correct,
  common answer, and it costs nothing.

Your reasoning is published verbatim next to the trade's outcome. Write it so it
reads honestly when the trade loses.`

export interface LlmThesisConfig {
	apiKey: string
	model?: string
	/** Reasoning depth. Screening runs constantly, so this defaults low. */
	effort?: 'low' | 'medium' | 'high'
	maxTokens?: number
	/** Hard ceiling on model calls per cycle — the cost guard. */
	maxCallsPerCycle?: number
	/**
	 * Only ask the model about candidates the deterministic engine already
	 * scores above this. Paying Claude to look at obvious junk is waste.
	 */
	minPrescreenScore?: number
	/**
	 * Override the model call. Exists so the engine's guarantees — identity and
	 * size come from us, never from the response — can be tested without a
	 * network round trip, and so a different judge can be swapped in.
	 */
	judge?: (candidate: Candidate, scores: Scores) => Promise<LlmVerdict | null>
}

export type Scores = ReturnType<RulesThesisEngine['score']>

export class LlmThesisEngine implements ThesisEngine {
	readonly id = 'llm'
	readonly version = '1.0.0'

	private readonly client: Anthropic
	private readonly rules = new RulesThesisEngine()
	private callsThisCycle = 0

	constructor(private readonly config: LlmThesisConfig) {
		this.client = new Anthropic({ apiKey: config.apiKey })
	}

	/** Call at the top of each cycle so the per-cycle spend cap resets. */
	resetCycle(): void {
		this.callsThisCycle = 0
	}

	async formEntry(candidate: Candidate, ctx: ThesisContext): Promise<Thesis | null> {
		const scores = this.rules.score(candidate)

		if (scores.composite < (this.config.minPrescreenScore ?? 0.35)) return null
		if (this.callsThisCycle >= (this.config.maxCallsPerCycle ?? 8)) {
			logger.info({ symbol: candidate.symbol }, 'autopilot: LLM call budget spent this cycle')
			return null
		}

		this.callsThisCycle++
		const verdict = await (this.config.judge
			? this.config.judge(candidate, scores)
			: this.ask(candidate, scores))
		if (!verdict || verdict.action !== 'buy') return null

		// Size is ours, never the model's: its conviction only scales a budget the
		// caller already decided it could lose.
		const budget = Math.min(ctx.maxPositionUsd, ctx.availableUsd * 0.1)
		const sizeUsd = Math.floor(budget * verdict.confidence * 100) / 100
		if (sizeUsd <= 0) return null

		const exit: ExitPlan = {
			stopLossPct: verdict.exit.stop_loss_pct,
			takeProfitPct: verdict.exit.take_profit_pct,
			invalidation: verdict.exit.invalidation,
			...(verdict.exit.max_hold_minutes ? { maxHoldMinutes: verdict.exit.max_hold_minutes } : {}),
		}

		return {
			action: 'buy',
			// Identity comes from the candidate we screened, not from the model.
			chain: candidate.chain,
			tokenAddress: candidate.tokenAddress,
			symbol: candidate.symbol,
			sizeUsd,
			confidence: Number(verdict.confidence.toFixed(3)),
			headline: verdict.headline,
			reasoning: verdict.reasoning,
			evidence: {
				priceUsd: candidate.priceUsd,
				liquidityUsd: Math.round(candidate.liquidityUsd),
				volume24hUsd: Math.round(candidate.volume24hUsd),
				priceChange1hPct: candidate.priceChange1hPct ?? 0,
				priceChange24hPct: candidate.priceChange24hPct ?? 0,
				ageMinutes: candidate.ageMinutes ?? -1,
				// The deterministic second opinion travels with every LLM thesis.
				rulesComposite: Number(scores.composite.toFixed(3)),
				rulesDepthScore: Number(scores.depthScore.toFixed(3)),
				rulesTurnoverScore: Number(scores.turnoverScore.toFixed(3)),
				rulesMomentumScore: Number(scores.momentumScore.toFixed(3)),
				rulesAgreed: scores.composite >= 0.6,
				keyRisks: verdict.key_risks.join(' | '),
				model: this.config.model ?? DEFAULT_MODEL,
			},
			exit,
			engine: this.id,
			engineVersion: this.version,
			formedAt: new Date().toISOString(),
		}
	}

	/** Exits stay mechanical — the plan was committed at entry, not renegotiated now. */
	formExit(
		position: OpenPositionSummary,
		currentPriceUsd: number,
		reason: string,
	): Promise<Thesis> {
		return this.rules.formExit(position, currentPriceUsd, reason)
	}

	private async ask(candidate: Candidate, scores: Scores): Promise<LlmVerdict | null> {
		try {
			const response = await this.client.messages.create({
				model: this.config.model ?? DEFAULT_MODEL,
				max_tokens: this.config.maxTokens ?? 2000,
				// The system prompt is byte-stable across every candidate, so it
				// caches and each extra call only pays for the facts block.
				system: [{ type: 'text', text: SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } }],
				output_config: {
					effort: this.config.effort ?? 'low',
					format: { type: 'json_schema', schema: THESIS_SCHEMA },
				},
				messages: [{ role: 'user', content: renderFacts(candidate, scores) }],
			})

			if (response.stop_reason === 'refusal') {
				logger.warn({ symbol: candidate.symbol }, 'autopilot: LLM declined to judge')
				return null
			}

			const text = response.content.find((b) => b.type === 'text')
			if (!text || text.type !== 'text') return null
			return validateVerdict(JSON.parse(text.text))
		} catch (err) {
			// A model outage must degrade the agent to "forms no theses", never to
			// "trades on a half-parsed answer".
			logger.error({ err: String(err), symbol: candidate.symbol }, 'autopilot: LLM call failed')
			return null
		}
	}
}

/** The exact fact sheet the model is allowed to reason from. */
export function renderFacts(candidate: Candidate, scores: Scores): string {
	const sec = candidate.security
	const lines = [
		`Token: ${candidate.symbol} on ${candidate.chain}`,
		`Price: $${candidate.priceUsd}`,
		`Pool liquidity: $${Math.round(candidate.liquidityUsd).toLocaleString()}`,
		`24h volume: $${Math.round(candidate.volume24hUsd).toLocaleString()}`,
		`Turnover (24h volume / liquidity): ${scores.turnover.toFixed(2)}x`,
		`Price change 1h: ${candidate.priceChange1hPct ?? 'unknown'}%`,
		`Price change 24h: ${candidate.priceChange24hPct ?? 'unknown'}%`,
		`Pool age: ${candidate.ageMinutes ?? 'unknown'} minutes`,
		'',
		'Deterministic scorer (0-1 each, composite is the weighted blend):',
		`  depth ${scores.depthScore.toFixed(2)}, turnover ${scores.turnoverScore.toFixed(2)}, momentum ${scores.momentumScore.toFixed(2)}, age ${scores.ageScore.toFixed(2)}`,
		`  composite ${scores.composite.toFixed(3)} (its own buy floor is 0.60)`,
	]

	if (sec) {
		lines.push(
			'',
			'Token security scan:',
			`  honeypot: ${sec.isHoneypot ?? 'unknown'}`,
			`  buy tax: ${sec.buyTaxBps ?? 'unknown'} bps, sell tax: ${sec.sellTaxBps ?? 'unknown'} bps`,
			`  top holders: ${sec.topHolderPct ?? 'unknown'}%`,
			`  LP locked: ${sec.lpLocked ?? 'unknown'}`,
		)
	} else {
		lines.push('', 'Token security scan: unavailable.')
	}

	lines.push(
		'',
		'Return your judgement in the required JSON shape. Nothing you write selects',
		'the token or the position size — those are already fixed. You are deciding',
		'whether this is worth owning at all, and on what terms it stops being worth owning.',
	)
	return lines.join('\n')
}

/**
 * Trust nothing that came back over the wire. The schema is enforced server-side,
 * but a malformed or partial response must produce null, never a half-built thesis.
 */
export function validateVerdict(raw: unknown): LlmVerdict | null {
	if (!raw || typeof raw !== 'object') return null
	const v = raw as Record<string, unknown>
	const exit = v.exit as Record<string, unknown> | undefined

	if (v.action !== 'buy' && v.action !== 'hold') return null
	if (typeof v.confidence !== 'number' || !(v.confidence >= 0 && v.confidence <= 1)) return null
	if (typeof v.headline !== 'string' || v.headline.length === 0) return null
	if (typeof v.reasoning !== 'string' || v.reasoning.length === 0) return null
	if (!exit) return null
	if (typeof exit.stop_loss_pct !== 'number' || !(exit.stop_loss_pct > 0)) return null
	if (typeof exit.take_profit_pct !== 'number' || !(exit.take_profit_pct > 0)) return null
	if (typeof exit.invalidation !== 'string' || exit.invalidation.trim().length < 10) return null

	const risks = Array.isArray(v.key_risks)
		? v.key_risks.filter((r): r is string => typeof r === 'string')
		: []

	return {
		action: v.action,
		confidence: v.confidence,
		headline: v.headline,
		reasoning: v.reasoning,
		key_risks: risks,
		exit: {
			stop_loss_pct: exit.stop_loss_pct,
			take_profit_pct: exit.take_profit_pct,
			invalidation: exit.invalidation,
			...(typeof exit.max_hold_minutes === 'number'
				? { max_hold_minutes: exit.max_hold_minutes }
				: {}),
		},
	}
}
