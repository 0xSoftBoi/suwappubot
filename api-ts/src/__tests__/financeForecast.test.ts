import { describe, expect, it } from 'bun:test'
import { buildFinanceForecast } from '../lib/financeForecast'

describe('buildFinanceForecast', () => {
	it('builds 13-week survival/base/growth scenarios from observed inflow', () => {
		const [survival, base, growth] = buildFinanceForecast({
			observedWeeklyCashInflowUsd: 1000,
			startingCashUsd: 10000,
			weeklyOperatingBurnUsd: 1500,
			weeks: 13,
		})

		expect(survival.weeklyCashInflowUsd).toBe(500)
		expect(base.weeklyNetCashUsd).toBe(-500)
		expect(base.runwayWeeks).toBe(20)
		expect(base.endingCashUsd).toBe(3500)
		expect(growth.weeklyNetCashUsd).toBe(500)
		expect(growth.endingCashUsd).toBe(16500)
	})

	it('keeps cash fields unknown until planning inputs are supplied', () => {
		const base = buildFinanceForecast({ observedWeeklyCashInflowUsd: 250 })[1]

		expect(base.weeklyNetCashUsd).toBeNull()
		expect(base.endingCashUsd).toBeNull()
		expect(base.points).toHaveLength(13)
		expect(base.points[0]?.endingCashUsd).toBeNull()
	})
})
