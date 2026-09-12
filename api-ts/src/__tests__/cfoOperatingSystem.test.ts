import { describe, expect, it } from 'bun:test'
import { buildCfoScenarios, providerConcentration } from '../lib/cfoOperatingSystem'

describe('buildCfoScenarios', () => {
	it('models volume, fee capture, non-fee inflow, burn, and variable costs explicitly', () => {
		const rows = buildCfoScenarios({
			observedWeeklyVolumeUsd: 100_000,
			observedFeeCaptureBps: 50,
			observedFeeCollectionRate: 0.8,
			observedWeeklyNonFeeCashInflowUsd: 500,
			startingCashUsd: 10_000,
			weeklyFixedBurnUsd: 1_000,
			variableCostBps: 10,
			weeks: 2,
		})
		const base = rows.find((row) => row.name === 'base')!

		expect(base.points[0]?.feeCashInflowUsd).toBe(400)
		expect(base.points[0]?.nonFeeCashInflowUsd).toBe(500)
		expect(base.points[0]?.variableCostUsd).toBe(100)
		expect(base.points[0]?.netCashUsd).toBe(-200)
		expect(base.endingCashUsd).toBe(9600)
	})

	it('keeps ending cash unknown without a founder-supplied balance or burn', () => {
		const base = buildCfoScenarios({
			observedWeeklyVolumeUsd: 10_000,
			observedFeeCaptureBps: 10,
			observedFeeCollectionRate: 1,
			observedWeeklyNonFeeCashInflowUsd: 0,
		})[1]

		expect(base?.endingCashUsd).toBeNull()
		expect(base?.cumulativeNetCashUsd).toBeNull()
	})
})

describe('providerConcentration', () => {
	it('flags a dominant provider as high concentration', () => {
		const result = providerConcentration([
			{ provider: 'a', volumeUsd: 90 },
			{ provider: 'b', volumeUsd: 10 },
		])

		expect(result.topProvider).toBe('a')
		expect(result.topProviderShare).toBeCloseTo(0.9)
		expect(result.hhi).toBe(8200)
		expect(result.risk).toBe('high')
	})

	it('returns unknown for an empty window', () => {
		expect(providerConcentration([]).risk).toBe('unknown')
	})
})
