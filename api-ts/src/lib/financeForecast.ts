export type FinanceScenarioName = 'survival' | 'base' | 'growth'

export interface FinanceForecastPoint {
	week: number
	cashInflowUsd: number
	operatingBurnUsd: number | null
	endingCashUsd: number | null
}

export interface FinanceScenarioForecast {
	name: FinanceScenarioName
	inflowMultiplier: number
	weeklyCashInflowUsd: number
	weeklyNetCashUsd: number | null
	endingCashUsd: number | null
	runwayWeeks: number | null
	points: FinanceForecastPoint[]
}

export interface BuildFinanceForecastInput {
	observedWeeklyCashInflowUsd: number
	startingCashUsd?: number | null
	weeklyOperatingBurnUsd?: number | null
	weeks?: number
}

const DEFAULT_SCENARIOS: ReadonlyArray<{
	name: FinanceScenarioName
	inflowMultiplier: number
}> = [
	{ name: 'survival', inflowMultiplier: 0.5 },
	{ name: 'base', inflowMultiplier: 1 },
	{ name: 'growth', inflowMultiplier: 2 },
]

function finiteNonNegative(value: number | null | undefined): number | null {
	if (value === null || value === undefined || !Number.isFinite(value) || value < 0) return null
	return value
}

function usd(value: number): number {
	return Math.round((value + Number.EPSILON) * 100) / 100
}

export function buildFinanceForecast(input: BuildFinanceForecastInput): FinanceScenarioForecast[] {
	const weeks = Math.min(Math.max(Math.trunc(input.weeks ?? 13), 1), 52)
	const observedWeeklyCashInflowUsd = finiteNonNegative(input.observedWeeklyCashInflowUsd) ?? 0
	const startingCashUsd = finiteNonNegative(input.startingCashUsd)
	const weeklyOperatingBurnUsd = finiteNonNegative(input.weeklyOperatingBurnUsd)

	return DEFAULT_SCENARIOS.map(({ name, inflowMultiplier }) => {
		const weeklyCashInflowUsd = usd(observedWeeklyCashInflowUsd * inflowMultiplier)
		const weeklyNetCashUsd =
			weeklyOperatingBurnUsd === null
				? null
				: usd(weeklyCashInflowUsd - weeklyOperatingBurnUsd)

		let cash = startingCashUsd
		const points: FinanceForecastPoint[] = []

		for (let week = 1; week <= weeks; week += 1) {
			if (cash !== null && weeklyOperatingBurnUsd !== null) {
				cash = usd(cash + weeklyCashInflowUsd - weeklyOperatingBurnUsd)
			}

			points.push({
				week,
				cashInflowUsd: weeklyCashInflowUsd,
				operatingBurnUsd: weeklyOperatingBurnUsd,
				endingCashUsd: cash,
			})
		}

		const runwayWeeks =
			startingCashUsd !== null && weeklyNetCashUsd !== null && weeklyNetCashUsd < 0
				? usd(startingCashUsd / Math.abs(weeklyNetCashUsd))
				: null

		return {
			name,
			inflowMultiplier,
			weeklyCashInflowUsd,
			weeklyNetCashUsd,
			endingCashUsd: cash,
			runwayWeeks,
			points,
		}
	})
}
