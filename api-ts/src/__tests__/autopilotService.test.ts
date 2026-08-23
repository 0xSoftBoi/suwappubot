import { describe, expect, it } from 'bun:test'
import type { AutopilotDecision } from '../db'
import { computeEquity, resolveRules, toPublicDecision } from '../services/AutopilotService'
import { DEFAULT_RULES } from '../services/autopilot/types'

describe('resolveRules', () => {
	it('falls back to the compiled defaults for an empty config', () => {
		expect(resolveRules({})).toEqual(DEFAULT_RULES)
		expect(resolveRules(null)).toEqual(DEFAULT_RULES)
		expect(resolveRules(undefined)).toEqual(DEFAULT_RULES)
	})

	it('applies stored overrides', () => {
		const r = resolveRules({ maxPositionUsd: 25, allowedChains: ['base'] })
		expect(r.maxPositionUsd).toBe(25)
		expect(r.allowedChains).toEqual(['base'])
		expect(r.minLiquidityUsd).toBe(DEFAULT_RULES.minLiquidityUsd)
	})

	it('ignores nulls and unknown keys rather than corrupting the rule set', () => {
		const r = resolveRules({ maxPositionUsd: null, somethingElse: 1 } as never)
		expect(r.maxPositionUsd).toBe(DEFAULT_RULES.maxPositionUsd)
		expect((r as Record<string, unknown>).somethingElse).toBeUndefined()
	})
})

describe('computeEquity', () => {
	it('is starting capital when nothing has happened', () => {
		expect(computeEquity(1000, [], 0)).toEqual({
			cashUsd: 1000,
			deployedUsd: 0,
			marketValueUsd: 0,
			equityUsd: 1000,
		})
	})

	it('marks open positions to market without double-counting the cash spent', () => {
		const e = computeEquity(1000, [{ costBasisUsd: 200, marketValueUsd: 260 }], 0)
		expect(e.cashUsd).toBe(800)
		expect(e.deployedUsd).toBe(200)
		expect(e.equityUsd).toBe(1060)
	})

	it('folds realized P&L back into cash', () => {
		const e = computeEquity(1000, [], -150)
		expect(e.equityUsd).toBe(850)
	})
})

const row = (over: Partial<AutopilotDecision> = {}): AutopilotDecision =>
	({
		id: 7,
		agentId: 1,
		cycleId: 2,
		action: 'buy',
		chain: 'base',
		tokenAddress: '0xabc',
		tokenSymbol: 'CATE',
		sizeUsd: 25,
		confidence: 0.7,
		headline: 'depth is rising',
		thesis: null,
		sealAlgo: 'sha256-canonical-v1',
		commitment: 'f'.repeat(64),
		nonce: 'a'.repeat(64),
		sealedAt: new Date('2026-08-01T00:00:00Z'),
		sealTxHash: null,
		sealChain: null,
		gatePassed: true,
		gates: [],
		rejectionReason: null,
		status: 'filled',
		txHash: '0xdead',
		quoteId: null,
		executedAt: new Date('2026-08-01T00:00:05Z'),
		fillPriceUsd: 0.0012,
		fillAmount: '1000',
		realizedSlippageBps: 12,
		executionError: null,
		revealedAt: null,
		createdAt: new Date('2026-08-01T00:00:00Z'),
		...over,
	}) as AutopilotDecision

describe('toPublicDecision', () => {
	it('withholds the nonce and the thesis while the decision is still sealed', () => {
		const pub = toPublicDecision(row())
		expect(pub.commitment).toBe('f'.repeat(64))
		expect(pub.sealMemo).toBe(`suwappu-autopilot:v1:sha256-canonical-v1:${'f'.repeat(64)}`)
		expect(pub.nonce).toBeUndefined()
		expect(pub.thesis).toBeUndefined()
		expect(pub.revealedAt).toBeUndefined()
		expect(pub.headline).toBe('depth is rising')
	})

	it('publishes the nonce and thesis once revealed', () => {
		const pub = toPublicDecision(
			row({ revealedAt: new Date('2026-08-01T00:01:00Z'), thesis: { action: 'buy' } as never }),
		)
		expect(pub.nonce).toBe('a'.repeat(64))
		expect(pub.thesis).toEqual({ action: 'buy' })
		expect(pub.revealedAt).toBe('2026-08-01T00:01:00.000Z')
	})

	it('publishes refusals with their gate verdict', () => {
		const pub = toPublicDecision(
			row({
				status: 'rejected',
				gatePassed: false,
				rejectionReason: 'min_liquidity: liquidity $900 vs floor $50000',
				gates: [{ rule: 'min_liquidity', passed: false, detail: 'too thin' }] as never,
			}),
		)
		expect(pub.gatePassed).toBe(false)
		expect(pub.rejectionReason).toContain('min_liquidity')
		expect(pub.gates).toHaveLength(1)
	})
})
