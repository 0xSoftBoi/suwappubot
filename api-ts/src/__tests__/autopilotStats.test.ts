import { describe, expect, it } from 'bun:test'
import {
	benchmarkComparison,
	calibration,
	deflatedSharpe,
	expectedMaxSharpe,
	minTrackRecordLength,
	moments,
	normalCdf,
	normalInv,
	probabilisticSharpe,
	trackRecord,
} from '../services/autopilot/stats'
import { buildAgentStats } from '../services/AutopilotService'

/** Same mean and stdev, skew exactly negated. Reflecting about the mean does it. */
const reflect = (xs: number[]) => {
	const mu = xs.reduce((s, x) => s + x, 0) / xs.length
	return xs.map((x) => 2 * mu - x)
}

/** A skewed series: lots of small wins, one big loss. The memecoin shape. */
const SKEWED_LOSS_TAIL = [
	0.04, 0.03, 0.05, 0.02, 0.04, 0.03, 0.06, 0.02, 0.05, 0.03, 0.04, 0.02, 0.05, 0.03, -0.35,
]

describe('normal distribution helpers', () => {
	it('agrees with the textbook quantiles', () => {
		expect(normalCdf(0)).toBeCloseTo(0.5, 6)
		expect(normalCdf(1.959964)).toBeCloseTo(0.975, 5)
		expect(normalCdf(-1.644854)).toBeCloseTo(0.05, 5)
		expect(normalInv(0.975)).toBeCloseTo(1.959964, 4)
		expect(normalInv(0.95)).toBeCloseTo(1.644854, 4)
	})

	it('round-trips across the range including the tails', () => {
		for (const p of [0.001, 0.01, 0.1, 0.3, 0.5, 0.7, 0.9, 0.99, 0.999]) {
			expect(normalCdf(normalInv(p))).toBeCloseTo(p, 6)
		}
	})
})

describe('moments', () => {
	it('refuses to describe a series of one', () => {
		expect(moments([])).toBeNull()
		expect(moments([0.1])).toBeNull()
	})

	it('reports non-excess kurtosis, so a normal-ish series sits near 3', () => {
		const m = moments([-2, -1, -1, 0, 0, 0, 0, 1, 1, 2])
		expect(m!.kurtosis).toBeGreaterThan(2)
		expect(m!.kurtosis).toBeLessThan(3.5)
		expect(m!.skew).toBeCloseTo(0, 6)
	})
})

describe('probabilisticSharpe', () => {
	it('returns null rather than a coin flip when there is no data', () => {
		// "We cannot say" and "we say 50%" are different answers and must not be
		// flattened into one — the dashboard renders them differently.
		expect(probabilisticSharpe([])).toBeNull()
		expect(probabilisticSharpe([0.1])).toBeNull()
		expect(probabilisticSharpe([0.1, 0.1, 0.1])).toBeNull() // zero variance
	})

	it('rises with sample length for an identical return distribution', () => {
		const short = probabilisticSharpe(SKEWED_LOSS_TAIL)!
		const long = probabilisticSharpe([
			...SKEWED_LOSS_TAIL,
			...SKEWED_LOSS_TAIL,
			...SKEWED_LOSS_TAIL,
		])!
		// Not exactly equal: the sample stdev uses an n-1 denominator, so repeating
		// a series nudges the Sharpe. Near-identical is the point — the same edge,
		// observed for longer, must read as stronger evidence.
		expect(long.sharpe).toBeCloseTo(short.sharpe, 2)
		expect(long.psr).toBeGreaterThan(short.psr)
	})

	it('penalises a fat LEFT tail relative to the mirror-image right tail', () => {
		// This is the entire reason we compute PSR instead of printing a Sharpe.
		// Both series have the same mean, stdev and therefore the same Sharpe;
		// only the direction of the tail differs. The one that occasionally loses
		// 35% is weaker evidence, and the statistic has to say so.
		const lossTail = probabilisticSharpe(SKEWED_LOSS_TAIL)!
		const winTail = probabilisticSharpe(reflect(SKEWED_LOSS_TAIL))!
		expect(lossTail.sharpe).toBeCloseTo(winTail.sharpe, 6)
		expect(lossTail.moments.skew).toBeLessThan(0)
		expect(winTail.moments.skew).toBeGreaterThan(0)
		expect(lossTail.psr).toBeLessThan(winTail.psr)
	})
})

describe('minTrackRecordLength', () => {
	it('is null for a record that does not beat the benchmark', () => {
		// No quantity of further losing trades makes a losing edge significant.
		// A finite number here would be a lie about what more data could buy.
		expect(minTrackRecordLength([-0.05, -0.02, -0.08, -0.01, -0.04])).toBeNull()
	})

	it('demands more trades of a weaker edge', () => {
		const strong = [0.09, 0.11, 0.1, 0.12, 0.08, 0.1, 0.11, 0.09, 0.1, 0.12]
		const weak = strong.map((r) => r - 0.085)
		expect(minTrackRecordLength(weak)!).toBeGreaterThan(minTrackRecordLength(strong)!)
	})

	it('demands more trades at higher confidence', () => {
		const rs = [0.05, 0.02, 0.07, 0.01, 0.04, 0.03, 0.06, -0.02, 0.05, 0.03]
		expect(minTrackRecordLength(rs, 0, 0.99)!).toBeGreaterThan(
			minTrackRecordLength(rs, 0, 0.9)!,
		)
	})
})

describe('deflatedSharpe', () => {
	it('collapses to PSR against zero when only one variant was ever tried', () => {
		// We run one live configuration and have never swept variants, so there is
		// no selection to deflate. Claiming a deflated number here would overstate
		// the rigour, not understate it.
		expect(expectedMaxSharpe(1, 0.05)).toBe(0)
		const dsr = deflatedSharpe(SKEWED_LOSS_TAIL, 1, 0.05)!
		expect(dsr.benchmark).toBe(0)
		expect(dsr.dsr).toBeCloseTo(probabilisticSharpe(SKEWED_LOSS_TAIL)!.psr, 10)
	})

	it('raises the bar as more variants are tried', () => {
		expect(expectedMaxSharpe(100, 0.05)).toBeGreaterThan(expectedMaxSharpe(10, 0.05))
		const few = deflatedSharpe(SKEWED_LOSS_TAIL, 10, 0.05)!
		const many = deflatedSharpe(SKEWED_LOSS_TAIL, 100, 0.05)!
		expect(many.dsr).toBeLessThan(few.dsr)
	})
})

describe('trackRecord', () => {
	it('says plainly that a short record proves nothing', () => {
		const v = trackRecord(SKEWED_LOSS_TAIL)
		expect(v.significant).toBe(false)
		expect(v.summary).toContain('NOT yet')
		expect(v.tradesRemaining).toBeGreaterThan(0)
	})

	it('does not promise that more trades would rescue a losing record', () => {
		const v = trackRecord([-0.05, -0.02, -0.08, -0.01, -0.04])
		expect(v.significant).toBe(false)
		expect(v.minTrackRecordLength).toBeNull()
		expect(v.tradesRemaining).toBeNull()
		expect(v.summary).toContain('strategy would have to change')
	})

	it('handles the empty book without pretending', () => {
		const v = trackRecord([])
		expect(v.trades).toBe(0)
		expect(v.sharpe).toBeNull()
		expect(v.summary).toContain('nothing here to evaluate')
	})

	it('concedes significance once the record is genuinely long enough', () => {
		const consistent = Array.from({ length: 400 }, (_, i) => 0.05 + (i % 5) * 0.004 - 0.008)
		const v = trackRecord(consistent)
		expect(v.significant).toBe(true)
		expect(v.summary).toContain('distinguishable from luck')
	})
})

describe('calibration', () => {
	it('detects a systematically overconfident model', () => {
		// Says 0.8, wins 40% of the time. We size positions on this number.
		const outcomes = Array.from({ length: 40 }, (_, i) => ({
			confidence: 0.8,
			won: i % 5 < 2,
		}))
		const report = calibration(outcomes)
		expect(report.bias!).toBeLessThan(-0.1)
		expect(report.summary).toContain('Overconfident')
		expect(report.summary).toContain('sizing map')
	})

	it('keeps a maximally confident call on the curve', () => {
		// A confidence of exactly 1.0 must land in the top bucket rather than
		// falling through every half-open interval and vanishing from the chart.
		const report = calibration([{ confidence: 1, won: false }])
		expect(report.samples).toBe(1)
		expect(report.buckets).toHaveLength(1)
		expect(report.buckets[0]!.count).toBe(1)
	})

	it('refuses to draw conclusions from a handful of trades', () => {
		const report = calibration([
			{ confidence: 0.9, won: false },
			{ confidence: 0.9, won: false },
		])
		expect(report.summary).toContain('too few')
	})

	it('scores a perfectly calibrated model as unbiased', () => {
		const outcomes = [
			...Array.from({ length: 20 }, (_, i) => ({ confidence: 0.5, won: i % 2 === 0 })),
			...Array.from({ length: 20 }, (_, i) => ({ confidence: 0.9, won: i % 10 !== 0 })),
		]
		const report = calibration(outcomes)
		expect(Math.abs(report.bias!)).toBeLessThan(0.05)
		expect(report.brierScore!).toBeLessThan(0.25)
	})
})

describe('benchmarkComparison', () => {
	it('says out loud when doing nothing would have been better', () => {
		const c = benchmarkComparison({
			startingEquityUsd: 1000,
			currentEquityUsd: 1010,
			baseStartPriceUsd: 100,
			baseNowPriceUsd: 130,
			baseSymbol: 'WETH',
		})!
		expect(c.beatsBenchmark).toBe(false)
		expect(c.summary).toContain('doing nothing would have done better')
		expect(c.excessReturnPct).toBeCloseTo(1 - 30, 6)
	})

	it('treats a stablecoin base as a flat line', () => {
		const c = benchmarkComparison({
			startingEquityUsd: 1000,
			currentEquityUsd: 1050,
			baseSymbol: 'USDC',
		})!
		expect(c.benchmarkReturnPct).toBe(0)
		expect(c.strategyReturnPct).toBeCloseTo(5, 6)
		expect(c.beatsBenchmark).toBe(true)
	})

	it('returns null rather than dividing by a zero book', () => {
		expect(benchmarkComparison({ startingEquityUsd: 0, currentEquityUsd: 10 })).toBeNull()
	})
})

describe('buildAgentStats', () => {
	const base = {
		startingEquityUsd: 1000,
		currentEquityUsd: 1030,
		baseTokenSymbol: 'USDC',
		paperFeeBps: 30,
	}

	it('scores one observation per closed trade, on capital actually risked', () => {
		const stats = buildAgentStats({
			...base,
			closed: [
				{ costBasisUsd: 100, realizedPnlUsd: 20, entryDecisionId: 1 },
				{ costBasisUsd: 50, realizedPnlUsd: -10, entryDecisionId: 2 },
				// No cost basis: nothing was ever risked, so it is not evidence.
				{ costBasisUsd: 0, realizedPnlUsd: 5, entryDecisionId: 3 },
			],
			confidenceByDecisionId: { 1: 0.9, 2: 0.7 },
		})
		expect(stats.closed_trades).toBe(2)
		expect(stats.calibration.samples).toBe(2)
	})

	it('drops trades whose entry decision recorded no confidence', () => {
		const stats = buildAgentStats({
			...base,
			closed: [
				{ costBasisUsd: 100, realizedPnlUsd: 20, entryDecisionId: 1 },
				{ costBasisUsd: 100, realizedPnlUsd: 20, entryDecisionId: null },
				{ costBasisUsd: 100, realizedPnlUsd: 20, entryDecisionId: 99 },
			],
			confidenceByDecisionId: { 1: 0.9 },
		})
		expect(stats.closed_trades).toBe(3)
		// A missing confidence is not a zero confidence — it must not enter the
		// reliability curve as a maximally underconfident call.
		expect(stats.calibration.samples).toBe(1)
	})

	it('publishes the friction it charges', () => {
		const stats = buildAgentStats({ ...base, closed: [], confidenceByDecisionId: {} })
		expect(stats.costs.paper_fee_bps_per_side).toBe(30)
		expect(stats.costs.impact_model).toContain('quote-side reserve')
	})

	it('reports an empty book honestly instead of as a flat zero', () => {
		const stats = buildAgentStats({ ...base, closed: [], confidenceByDecisionId: {} })
		expect(stats.closed_trades).toBe(0)
		expect(stats.track_record.sharpe).toBeNull()
		expect(stats.track_record.significant).toBe(false)
		expect(stats.calibration.brierScore).toBeNull()
	})

	it('never puts a camelCase key on the wire', () => {
		// This has leaked twice. Both times the dashboard read the missing key as
		// falsy and rendered every filled trade as a refusal.
		const stats = buildAgentStats({
			...base,
			closed: [{ costBasisUsd: 100, realizedPnlUsd: 20, entryDecisionId: 1 }],
			confidenceByDecisionId: { 1: 0.9 },
		})
		for (const key of Object.keys(stats)) {
			expect(key).not.toMatch(/[A-Z]/)
		}
	})
})
