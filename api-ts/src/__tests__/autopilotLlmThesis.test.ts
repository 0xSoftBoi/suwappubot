import { describe, expect, it } from 'bun:test'
import {
	LlmThesisEngine,
	type LlmVerdict,
	renderFacts,
	validateVerdict,
} from '../services/autopilot/llmThesis'
import { RulesThesisEngine } from '../services/autopilot/thesis'
import type { Candidate } from '../services/autopilot/types'

const candidate = (over: Partial<Candidate> = {}): Candidate => ({
	chain: 'base',
	tokenAddress: '0xREAL0000000000000000000000000000000000001',
	symbol: 'REAL',
	priceUsd: 2,
	liquidityUsd: 800_000,
	volume24hUsd: 2_000_000,
	priceChange1hPct: 10,
	priceChange24hPct: 25,
	ageMinutes: 6_000,
	...over,
})

const verdict = (over: Partial<LlmVerdict> = {}): LlmVerdict => ({
	action: 'buy',
	confidence: 0.8,
	headline: 'depth supports the move',
	reasoning: 'turnover is 2.5x against deep liquidity and the move is not vertical',
	key_risks: ['liquidity could be pulled'],
	exit: { stop_loss_pct: 15, take_profit_pct: 45, invalidation: 'liquidity falls under $400k' },
	...over,
})

const ctx = { availableUsd: 1000, maxPositionUsd: 100, openPositions: [] }

const engineWith = (judge: (c: Candidate, s: never) => Promise<LlmVerdict | null>, over = {}) =>
	new LlmThesisEngine({
		apiKey: 'test-key',
		judge: judge as never,
		...over,
	})

describe('LlmThesisEngine — the model judges, the code trades', () => {
	it('takes identity from the candidate, not from anything the model said', async () => {
		const engine = engineWith(async () => verdict())
		const thesis = await engine.formEntry(candidate(), ctx)
		expect(thesis?.tokenAddress).toBe(candidate().tokenAddress)
		expect(thesis?.symbol).toBe('REAL')
		expect(thesis?.chain).toBe('base')
	})

	it('sizes from our budget scaled by conviction, never above the cap', async () => {
		const engine = engineWith(async () => verdict({ confidence: 1 }))
		const thesis = await engine.formEntry(candidate(), { ...ctx, availableUsd: 1000 })
		// 10% of available, capped by maxPositionUsd, times confidence.
		expect(thesis?.sizeUsd).toBeLessThanOrEqual(100)
		expect(thesis?.sizeUsd).toBeGreaterThan(0)

		const small = engineWith(async () => verdict({ confidence: 1 }))
		const t2 = await small.formEntry(candidate(), { ...ctx, availableUsd: 100 })
		expect(t2?.sizeUsd).toBeLessThanOrEqual(10)
	})

	it('carries the deterministic score alongside the narrative', async () => {
		const engine = engineWith(async () => verdict())
		const thesis = await engine.formEntry(candidate(), ctx)
		expect(thesis?.evidence.rulesComposite).toBeGreaterThan(0)
		expect(typeof thesis?.evidence.rulesAgreed).toBe('boolean')
		expect(thesis?.engine).toBe('llm')
	})

	it('forms nothing on hold, on a refusal, or on a failed call', async () => {
		expect(
			await engineWith(async () => verdict({ action: 'hold' })).formEntry(candidate(), ctx),
		).toBeNull()
		expect(await engineWith(async () => null).formEntry(candidate(), ctx)).toBeNull()
	})

	it('does not pay the model to look at obvious junk', async () => {
		let calls = 0
		const engine = engineWith(async () => {
			calls++
			return verdict()
		})
		const junk = candidate({
			liquidityUsd: 900,
			volume24hUsd: 50,
			priceChange1hPct: -60,
			ageMinutes: 3,
		})
		expect(await engine.formEntry(junk, ctx)).toBeNull()
		expect(calls).toBe(0)
	})

	it('stops calling the model once the per-cycle budget is spent', async () => {
		let calls = 0
		const engine = engineWith(
			async () => {
				calls++
				return verdict()
			},
			{ maxCallsPerCycle: 2 },
		)
		for (let i = 0; i < 5; i++) await engine.formEntry(candidate(), ctx)
		expect(calls).toBe(2)

		engine.resetCycle()
		await engine.formEntry(candidate(), ctx)
		expect(calls).toBe(3)
	})

	it('keeps exits mechanical — the committed plan, not a fresh opinion', async () => {
		let calls = 0
		const engine = engineWith(async () => {
			calls++
			return verdict()
		})
		const exit = await engine.formExit(
			{
				chain: 'base',
				tokenAddress: '0xREAL0000000000000000000000000000000000001',
				symbol: 'REAL',
				amount: '10',
				costBasisUsd: 100,
				avgEntryPriceUsd: 2,
				openedAt: Date.now(),
			},
			1.5,
			'stop-loss hit',
		)
		expect(exit.action).toBe('sell')
		expect(calls).toBe(0)
	})
})

describe('validateVerdict', () => {
	it('accepts a well-formed verdict', () => {
		expect(validateVerdict(verdict())).not.toBeNull()
	})

	it('rejects anything malformed rather than half-building a thesis', () => {
		expect(validateVerdict(null)).toBeNull()
		expect(validateVerdict('nope')).toBeNull()
		expect(validateVerdict({ ...verdict(), action: 'sell' })).toBeNull()
		expect(validateVerdict({ ...verdict(), confidence: 2 })).toBeNull()
		expect(validateVerdict({ ...verdict(), reasoning: '' })).toBeNull()
		expect(validateVerdict({ ...verdict(), exit: undefined })).toBeNull()
		expect(
			validateVerdict({ ...verdict(), exit: { ...verdict().exit, stop_loss_pct: 0 } }),
		).toBeNull()
		expect(
			validateVerdict({ ...verdict(), exit: { ...verdict().exit, invalidation: 'nope' } }),
		).toBeNull()
	})

	it('drops non-string risks instead of trusting the array', () => {
		const v = validateVerdict({ ...verdict(), key_risks: ['ok', 42, null] })
		expect(v?.key_risks).toEqual(['ok'])
	})
})

describe('renderFacts', () => {
	const scores = new RulesThesisEngine().score(candidate())

	it('shows the model the measured facts and the deterministic score', () => {
		const text = renderFacts(candidate(), scores)
		expect(text).toContain('REAL on base')
		expect(text).toContain('Pool liquidity')
		expect(text).toContain('composite')
	})

	it('says a missing security scan is missing rather than omitting it', () => {
		expect(renderFacts(candidate(), scores)).toContain('Token security scan: unavailable.')
		const withSec = renderFacts(
			candidate({ security: { isHoneypot: false, topHolderPct: 12, lpLocked: true } }),
			scores,
		)
		expect(withSec).toContain('honeypot: false')
		expect(withSec).toContain('LP locked: true')
	})
})
