export type CfoScenarioName = 'downside' | 'base' | 'upside'

export interface CfoScenarioPoint {
	week: number
	volumeUsd: number
	feeCashInflowUsd: number
	nonFeeCashInflowUsd: number
	totalCashInflowUsd: number
	fixedBurnUsd: number | null
	variableCostUsd: number
	netCashUsd: number | null
	endingCashUsd: number | null
}

export interface CfoScenarioForecast {
	name: CfoScenarioName
	assumptions: {
		initialVolumeMultiplier: number
		initialNonFeeCashMultiplier: number
		feeCaptureMultiplier: number
		fixedBurnMultiplier: number
		volumeGrowthPct: number
		nonFeeCashGrowthPct: number
		variableCostBps: number
	}
	endingCashUsd: number | null
	firstCashOutWeek: number | null
	cumulativeCashInflowUsd: number
	cumulativeNetCashUsd: number | null
	points: CfoScenarioPoint[]
}

export interface BuildCfoScenariosInput {
	observedWeeklyVolumeUsd: number
	observedFeeCaptureBps: number
	observedFeeCollectionRate: number
	observedWeeklyNonFeeCashInflowUsd: number
	startingCashUsd?: number | null
	weeklyFixedBurnUsd?: number | null
	variableCostBps?: number | null
	volumeGrowthPct?: number | null
	nonFeeCashGrowthPct?: number | null
	weeks?: number
}

export interface ProviderExposureInput {
	provider: string
	volumeUsd: number
}

export interface ProviderConcentration {
	totalVolumeUsd: number
	topProvider: string | null
	topProviderShare: number | null
	hhi: number | null
	risk: 'unknown' | 'low' | 'moderate' | 'high'
}

const SCENARIOS: ReadonlyArray<{
	name: CfoScenarioName
	initialVolumeMultiplier: number
	initialNonFeeCashMultiplier: number
	feeCaptureMultiplier: number
	fixedBurnMultiplier: number
}> = [
	{ name: 'downside', initialVolumeMultiplier: 0.6, initialNonFeeCashMultiplier: 0.75, feeCaptureMultiplier: 0.85, fixedBurnMultiplier: 1.1 },
	{ name: 'base', initialVolumeMultiplier: 1, initialNonFeeCashMultiplier: 1, feeCaptureMultiplier: 1, fixedBurnMultiplier: 1 },
	{ name: 'upside', initialVolumeMultiplier: 1.5, initialNonFeeCashMultiplier: 1.25, feeCaptureMultiplier: 1.05, fixedBurnMultiplier: 1 },
]

function finite(value: number | null | undefined, fallback = 0): number {
	return value !== null && value !== undefined && Number.isFinite(value) ? value : fallback
}

function nonNegative(value: number | null | undefined, fallback = 0): number {
	return Math.max(0, finite(value, fallback))
}

function clamp(value: number, min: number, max: number): number {
	return Math.min(Math.max(value, min), max)
}

function usd(value: number): number {
	return Math.round((value + Number.EPSILON) * 100) / 100
}

/**
 * Driver-based 13-week cash model.
 *
 * This intentionally does NOT call itself an ML prediction. It projects observed
 * transaction volume, observed fee capture/collection, non-fee cash inflow, and
 * founder-entered cost drivers through explicit scenarios.
 */
export function buildCfoScenarios(input: BuildCfoScenariosInput): CfoScenarioForecast[] {
	const weeks = Math.min(Math.max(Math.trunc(input.weeks ?? 13), 1), 52)
	const weeklyVolume = nonNegative(input.observedWeeklyVolumeUsd)
	const feeCaptureBps = nonNegative(input.observedFeeCaptureBps)
	const collectionRate = clamp(finite(input.observedFeeCollectionRate, 1), 0, 1)
	const weeklyNonFeeCash = nonNegative(input.observedWeeklyNonFeeCashInflowUsd)
	const startingCash = input.startingCashUsd == null ? null : nonNegative(input.startingCashUsd)
	const fixedBurn = input.weeklyFixedBurnUsd == null ? null : nonNegative(input.weeklyFixedBurnUsd)
	const variableCostBps = clamp(nonNegative(input.variableCostBps), 0, 10_000)
	const volumeGrowthPct = clamp(finite(input.volumeGrowthPct), -50, 100)
	const nonFeeCashGrowthPct = clamp(finite(input.nonFeeCashGrowthPct), -50, 100)

	return SCENARIOS.map((scenario) => {
		let cash = startingCash
		let firstCashOutWeek: number | null = null
		let cumulativeCashInflowUsd = 0
		let cumulativeNetCashUsd = 0
		const points: CfoScenarioPoint[] = []

		for (let week = 1; week <= weeks; week += 1) {
			const volumeUsd = weeklyVolume * scenario.initialVolumeMultiplier * Math.pow(1 + volumeGrowthPct / 100, week - 1)
			const nonFeeCashInflowUsd = weeklyNonFeeCash * scenario.initialNonFeeCashMultiplier * Math.pow(1 + nonFeeCashGrowthPct / 100, week - 1)
			const scenarioFeeBps = feeCaptureBps * scenario.feeCaptureMultiplier
			const feeCashInflowUsd = volumeUsd * (scenarioFeeBps / 10_000) * collectionRate
			const totalCashInflowUsd = feeCashInflowUsd + nonFeeCashInflowUsd
			const variableCostUsd = volumeUsd * (variableCostBps / 10_000)
			const scenarioFixedBurn = fixedBurn === null ? null : fixedBurn * scenario.fixedBurnMultiplier
			const netCashUsd = scenarioFixedBurn === null ? null : totalCashInflowUsd - scenarioFixedBurn - variableCostUsd

			if (cash !== null && netCashUsd !== null) {
				cash += netCashUsd
				if (cash <= 0 && firstCashOutWeek === null) firstCashOutWeek = week
			}

			cumulativeCashInflowUsd += totalCashInflowUsd
			if (netCashUsd !== null) cumulativeNetCashUsd += netCashUsd

			points.push({
				week,
				volumeUsd: usd(volumeUsd),
				feeCashInflowUsd: usd(feeCashInflowUsd),
				nonFeeCashInflowUsd: usd(nonFeeCashInflowUsd),
				totalCashInflowUsd: usd(totalCashInflowUsd),
				fixedBurnUsd: scenarioFixedBurn === null ? null : usd(scenarioFixedBurn),
				variableCostUsd: usd(variableCostUsd),
				netCashUsd: netCashUsd === null ? null : usd(netCashUsd),
				endingCashUsd: cash === null ? null : usd(cash),
			})
		}

		return {
			name: scenario.name,
			assumptions: {
				initialVolumeMultiplier: scenario.initialVolumeMultiplier,
				initialNonFeeCashMultiplier: scenario.initialNonFeeCashMultiplier,
				feeCaptureMultiplier: scenario.feeCaptureMultiplier,
				fixedBurnMultiplier: scenario.fixedBurnMultiplier,
				volumeGrowthPct,
				nonFeeCashGrowthPct,
				variableCostBps,
			},
			endingCashUsd: cash === null ? null : usd(cash),
			firstCashOutWeek,
			cumulativeCashInflowUsd: usd(cumulativeCashInflowUsd),
			cumulativeNetCashUsd: fixedBurn === null ? null : usd(cumulativeNetCashUsd),
			points,
		}
	})
}

/**
 * HHI is calculated on volume share. Thresholds are conventional concentration
 * cutoffs, used here only as an operational dependency-risk signal.
 */
export function providerConcentration(rows: ProviderExposureInput[]): ProviderConcentration {
	const normalized = rows
		.map((row) => ({ provider: row.provider || 'unknown', volumeUsd: nonNegative(row.volumeUsd) }))
		.filter((row) => row.volumeUsd > 0)
	const totalVolumeUsd = normalized.reduce((sum, row) => sum + row.volumeUsd, 0)

	if (totalVolumeUsd <= 0) {
		return { totalVolumeUsd: 0, topProvider: null, topProviderShare: null, hhi: null, risk: 'unknown' }
	}

	const shares = normalized
		.map((row) => ({ ...row, share: row.volumeUsd / totalVolumeUsd }))
		.sort((a, b) => b.share - a.share)
	const hhi = shares.reduce((sum, row) => sum + Math.pow(row.share * 100, 2), 0)
	const top = shares[0] ?? null

	return {
		totalVolumeUsd: usd(totalVolumeUsd),
		topProvider: top?.provider ?? null,
		topProviderShare: top?.share ?? null,
		hhi: Math.round(hhi),
		risk: hhi >= 2500 ? 'high' : hhi >= 1500 ? 'moderate' : 'low',
	}
}


export interface CfoOperatingException {
	code: 'RUNWAY_BREACH' | 'PROVIDER_CONCENTRATION' | 'PAYMENT_RECOVERY' | 'FEE_COLLECTION' | 'FUNNEL_BREAKAGE'
	severity: 'info' | 'warning' | 'critical'
	title: string
	evidence: string
	recommendedAction: string
}

export interface BuildCfoExceptionsInput {
	baseFirstCashOutWeek: number | null
	topProvider: string | null
	topProviderShare: number | null
	stripePaymentFailures30d: number
	recurringOverdue: number
	feeCollectionRate: number | null
	feesAccruedUsd: number
	quoteToExecutionRate: number | null
	quotesObserved: number
}

/**
 * Bounded exception policy for the founder control plane.
 *
 * These are REVIEW triggers only. No exception grants authority to move funds,
 * message customers, change routing, or mutate billing.
 */
export function buildCfoExceptions(input: BuildCfoExceptionsInput): CfoOperatingException[] {
	const out: CfoOperatingException[] = []

	if (input.baseFirstCashOutWeek !== null && input.baseFirstCashOutWeek <= 13) {
		out.push({
			code: 'RUNWAY_BREACH',
			severity: 'critical',
			title: 'Base scenario breaches cash inside 13 weeks',
			evidence: `First projected cash-out: week ${input.baseFirstCashOutWeek}`,
			recommendedAction: 'Review burn, financing, collections, and discretionary spend before committing new capital.',
		})
	}

	if (input.topProviderShare !== null && input.topProviderShare >= 0.5) {
		out.push({
			code: 'PROVIDER_CONCENTRATION',
			severity: input.topProviderShare >= 0.75 ? 'critical' : 'warning',
			title: 'Routing volume is concentrated in one provider',
			evidence: `${input.topProvider ?? 'Top provider'} carries ${(input.topProviderShare * 100).toFixed(1)}% of observed volume`,
			recommendedAction: 'Verify fallback coverage, compare economics, and test failover before the dependency becomes an outage or pricing risk.',
		})
	}

	const paymentExceptions = Math.max(0, input.stripePaymentFailures30d) + Math.max(0, input.recurringOverdue)
	if (paymentExceptions > 0) {
		out.push({
			code: 'PAYMENT_RECOVERY',
			severity: paymentExceptions >= 5 ? 'warning' : 'info',
			title: 'Payment-cycle exceptions need review',
			evidence: `${input.stripePaymentFailures30d} Stripe failure events; ${input.recurringOverdue} recurring crypto charges overdue`,
			recommendedAction: 'Review retry state and customer context before any dunning or account downgrade action.',
		})
	}

	if (input.feesAccruedUsd > 0 && input.feeCollectionRate !== null && input.feeCollectionRate < 0.8) {
		out.push({
			code: 'FEE_COLLECTION',
			severity: input.feeCollectionRate < 0.5 ? 'critical' : 'warning',
			title: 'Recorded fee collection trails fee accrual',
			evidence: `Collection ratio is ${(input.feeCollectionRate * 100).toFixed(1)}%`,
			recommendedAction: 'Reconcile fee sweep/collector state and determine whether the gap is timing, user-borne fees, or an actual collection failure.',
		})
	}

	if (
		input.quotesObserved >= 10 &&
		input.quoteToExecutionRate !== null &&
		input.quoteToExecutionRate < 0.5
	) {
		out.push({
			code: 'FUNNEL_BREAKAGE',
			severity: input.quoteToExecutionRate < 0.25 ? 'critical' : 'warning',
			title: 'Quote-to-execution conversion is weak',
			evidence: `${(input.quoteToExecutionRate * 100).toFixed(1)}% of ${input.quotesObserved} observed quotes linked to execution`,
			recommendedAction: 'Segment drop-off by surface, route, chain, and error signature before changing pricing or UX.',
		})
	}

	return out
}
