import { describe, expect, it } from 'bun:test'
import { buildCfoExceptions, buildCfoScenarios, providerConcentration } from '../lib/cfoOperatingSystem'

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


describe('buildCfoExceptions', () => {
	it('surfaces bounded review triggers without inventing actions', () => {
		const rows = buildCfoExceptions({
			baseFirstCashOutWeek: 8,
			topProvider: 'lifi',
			topProviderShare: 0.6,
			stripePaymentFailures30d: 2,
			recurringOverdue: 1,
			feeCollectionRate: 0.7,
			feesAccruedUsd: 100,
			quoteToExecutionRate: 0.4,
			quotesObserved: 20,
		})

		expect(rows.map((row) => row.code)).toEqual([
			'RUNWAY_BREACH',
			'PROVIDER_CONCENTRATION',
			'PAYMENT_RECOVERY',
			'FEE_COLLECTION',
			'FUNNEL_BREAKAGE',
		])
		expect(rows[0]?.severity).toBe('critical')
	})

	it('does not flag funnel conversion on tiny samples', () => {
		const rows = buildCfoExceptions({
			baseFirstCashOutWeek: null,
			topProvider: null,
			topProviderShare: null,
			stripePaymentFailures30d: 0,
			recurringOverdue: 0,
			feeCollectionRate: null,
			feesAccruedUsd: 0,
			quoteToExecutionRate: 0.1,
			quotesObserved: 3,
		})

		expect(rows).toHaveLength(0)
	})
})
