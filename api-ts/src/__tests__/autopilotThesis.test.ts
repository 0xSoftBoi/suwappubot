import { describe, expect, it } from 'bun:test'
import { PaperExecutor } from '../services/autopilot/executor'
import { DEFAULT_RULES_ENGINE_CONFIG, RulesThesisEngine } from '../services/autopilot/thesis'
import type { Candidate, OpenPositionSummary } from '../services/autopilot/types'

const engine = new RulesThesisEngine()

const candidate = (over: Partial<Candidate> = {}): Candidate => ({
	chain: 'base',
	tokenAddress: '0x1111111111111111111111111111111111111111',
	symbol: 'GOOD',
	priceUsd: 0.01,
	liquidityUsd: 500_000,
	volume24hUsd: 1_000_000,
	priceChange1hPct: 12,
	priceChange24hPct: 40,
	ageMinutes: 5_000,
	...over,
})

const ctx = { availableUsd: 1000, maxPositionUsd: 100, openPositions: [] }

describe('RulesThesisEngine scoring', () => {
	it('scores a healthy candidate above the floor', () => {
		const s = engine.score(candidate())
		expect(s.composite).toBeGreaterThan(DEFAULT_RULES_ENGINE_CONFIG.minScore)
	})

	it('fades a parabolic move rather than chasing it', () => {
		const calm = engine.score(candidate({ priceChange1hPct: 15 }))
		const parabolic = engine.score(candidate({ priceChange1hPct: 400 }))
		expect(parabolic.momentumScore).toBeLessThan(calm.momentumScore)
		expect(parabolic.composite).toBeLessThan(calm.composite)
	})

	it('gives no momentum credit to a falling token', () => {
		expect(engine.score(candidate({ priceChange1hPct: -10 })).momentumScore).toBe(0)
	})

	it('penalises thin depth and dead turnover', () => {
		expect(engine.score(candidate({ liquidityUsd: 5_000 })).depthScore).toBeLessThan(0.2)
		expect(engine.score(candidate({ volume24hUsd: 1_000 })).turnoverScore).toBeLessThan(0.2)
	})

	it('treats suspiciously high turnover as a wash-trade smell', () => {
		const healthy = engine.score(candidate({ volume24hUsd: 1_000_000 }))
		const washy = engine.score(candidate({ volume24hUsd: 100_000_000 }))
		expect(washy.turnoverScore).toBeLessThan(healthy.turnoverScore)
	})

	it('gives no age credit when pool age is unknown', () => {
		const unknown = candidate()
		delete (unknown as { ageMinutes?: unknown }).ageMinutes
		expect(engine.score(unknown).ageScore).toBe(0)
	})
})

describe('RulesThesisEngine.formEntry', () => {
	it('produces a complete, committed thesis', async () => {
		const t = await engine.formEntry(candidate(), ctx)
		expect(t).not.toBeNull()
		expect(t?.action).toBe('buy')
		expect(t?.sizeUsd).toBeGreaterThan(0)
		expect(t?.exit.stopLossPct).toBe(DEFAULT_RULES_ENGINE_CONFIG.stopLossPct)
		expect(t?.exit.invalidation.length).toBeGreaterThan(10)
		expect(t?.engine).toBe('rules')
		expect(Object.keys(t?.evidence ?? {})).toContain('turnover')
	})

	it('refuses a candidate below the score floor', async () => {
		const weak = candidate({ liquidityUsd: 2_000, volume24hUsd: 100, priceChange1hPct: -50 })
		expect(await engine.formEntry(weak, ctx)).toBeNull()
	})

	it('never sizes above the per-position cap or the free capital slice', async () => {
		const t = await engine.formEntry(candidate(), { ...ctx, availableUsd: 100 })
		expect(t?.sizeUsd).toBeLessThanOrEqual(10)
	})

	it('is deterministic — same snapshot, same thesis', async () => {
		const c = candidate()
		const a = await engine.formEntry(c, ctx)
		const b = await engine.formEntry(c, ctx)
		expect({ ...a, formedAt: '' }).toEqual({ ...b, formedAt: '' } as never)
	})
})

describe('RulesThesisEngine.formExit', () => {
	const position: OpenPositionSummary = {
		chain: 'base',
		tokenAddress: '0x1111111111111111111111111111111111111111',
		symbol: 'GOOD',
		amount: '1000',
		costBasisUsd: 100,
		avgEntryPriceUsd: 0.1,
		openedAt: Date.now() - 60_000,
	}

	it('states the trigger and the realized move', async () => {
		const t = await engine.formExit(position, 0.05, 'stop-loss hit: -50.0% <= -20%')
		expect(t.action).toBe('sell')
		expect(t.confidence).toBe(1)
		expect(t.headline).toContain('Exit GOOD')
		expect(t.evidence.pnlPct).toBe(-50)
	})
})

describe('PaperExecutor', () => {
	const executor = new PaperExecutor()
	const base = {
		chain: 'base',
		fromToken: 'USDC',
		toToken: 'GOOD',
		amountUsd: 100,
		slippageBps: 150,
		idempotencyKey: 'a'.repeat(64),
	}

	it('fills with depth-derived impact', async () => {
		const r = await executor.execute({ ...base, referencePriceUsd: 1, liquidityUsd: 1_000_000 })
		expect(r.ok).toBe(true)
		expect(r.paper).toBe(true)
		expect(r.fillPriceUsd).toBeGreaterThan(1)
		expect(r.realizedSlippageBps).toBeLessThan(10)
		expect(r.txHash).toStartWith('paper:')
	})

	it('refuses a fill that would blow through the slippage limit', async () => {
		const r = await executor.execute({ ...base, referencePriceUsd: 1, liquidityUsd: 500 })
		expect(r.ok).toBe(false)
		expect(r.error).toContain('slippage')
	})

	it('refuses without a reference price instead of inventing one', async () => {
		const r = await executor.execute({ ...base, liquidityUsd: 1_000_000 })
		expect(r.ok).toBe(false)
	})
})
