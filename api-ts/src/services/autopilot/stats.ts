/**
 * Stage 8 — the honesty statistics.
 *
 * A published P&L with no error bar is a claim, not evidence. Every agent in
 * this category publishes the number alone; the whole point of ours is that a
 * reader can tell whether it means anything yet. This file computes that.
 *
 * The core results are Bailey & López de Prado's:
 *
 *  - The **Probabilistic Sharpe Ratio** (PSR) — the probability that the true
 *    Sharpe exceeds a benchmark, given the observed Sharpe, the sample length,
 *    and the skew and kurtosis of the returns. Memecoin returns are violently
 *    non-normal, and non-normality is exactly what a naked Sharpe hides.
 *  - The **Minimum Track Record Length** (MinTRL) — how many observations are
 *    needed before the observed Sharpe is statistically distinguishable from
 *    the benchmark at a chosen confidence. This is the number a visitor to the
 *    dashboard is actually asking for.
 *  - The **Deflated Sharpe Ratio** (DSR) — PSR against the Sharpe you would
 *    expect from the *best* of N trials by luck alone. It only binds once we
 *    select a configuration out of many; see `deflatedSharpe` for why we do
 *    not currently claim it.
 *
 * Everything here is pure. It takes a return series and returns numbers.
 *
 * Refs: Bailey & López de Prado, "The Sharpe Ratio Efficient Frontier" (2012)
 * and "The Deflated Sharpe Ratio" (2014).
 */

/** Euler–Mascheroni constant, used by the expected-maximum-Sharpe estimate. */
const EULER_GAMMA = 0.5772156649015329

/**
 * Standard normal CDF via Abramowitz & Stegun 7.1.26 (|error| < 1.5e-7).
 * Ample for a probability we render to two decimal places.
 */
export function normalCdf(x: number): number {
	const sign = x < 0 ? -1 : 1
	const z = Math.abs(x) / Math.SQRT2
	const t = 1 / (1 + 0.3275911 * z)
	const y =
		1 -
		((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) *
			t *
			Math.exp(-z * z)
	return 0.5 * (1 + sign * y)
}

/**
 * Inverse standard normal CDF — Acklam's rational approximation, refined by one
 * Halley step against `normalCdf`. Accurate to ~1e-9 in the central region.
 */
export function normalInv(p: number): number {
	if (p <= 0 || p >= 1) return p <= 0 ? Number.NEGATIVE_INFINITY : Number.POSITIVE_INFINITY

	const a = [-3.969683028665376e1, 2.209460984245205e2, -2.759285104469687e2, 1.38357751867269e2,
		-3.066479806614716e1, 2.506628277459239]
	const b = [-5.447609879822406e1, 1.615858368580409e2, -1.556989798598866e2, 6.680131188771972e1,
		-1.328068155288572e1]
	const c = [-7.784894002430293e-3, -3.223964580411365e-1, -2.400758277161838, -2.549732539343734,
		4.374664141464968, 2.938163982698783]
	const d = [7.784695709041462e-3, 3.224671290700398e-1, 2.445134137142996, 3.754408661907416]

	const pLow = 0.02425
	let x: number
	if (p < pLow) {
		const q = Math.sqrt(-2 * Math.log(p))
		x =
			(((((c[0]! * q + c[1]!) * q + c[2]!) * q + c[3]!) * q + c[4]!) * q + c[5]!) /
			((((d[0]! * q + d[1]!) * q + d[2]!) * q + d[3]!) * q + 1)
	} else if (p <= 1 - pLow) {
		const q = p - 0.5
		const r = q * q
		x =
			((((((a[0]! * r + a[1]!) * r + a[2]!) * r + a[3]!) * r + a[4]!) * r + a[5]!) * q) /
			(((((b[0]! * r + b[1]!) * r + b[2]!) * r + b[3]!) * r + b[4]!) * r + 1)
	} else {
		const q = Math.sqrt(-2 * Math.log(1 - p))
		x =
			-(((((c[0]! * q + c[1]!) * q + c[2]!) * q + c[3]!) * q + c[4]!) * q + c[5]!) /
			((((d[0]! * q + d[1]!) * q + d[2]!) * q + d[3]!) * q + 1)
	}

	// One Halley refinement — cheap, and it removes Acklam's tail error.
	const e = normalCdf(x) - p
	const u = e * Math.sqrt(2 * Math.PI) * Math.exp((x * x) / 2)
	return x - u / (1 + (x * u) / 2)
}

export interface ReturnMoments {
	n: number
	mean: number
	/** Sample standard deviation (n-1 denominator). */
	stdev: number
	/** Standardised third moment. Negative = a fat left tail. */
	skew: number
	/** Standardised fourth moment, NOT excess. A normal distribution gives 3. */
	kurtosis: number
}

/**
 * Moments of a return series. Skew and kurtosis use the same sample stdev as
 * the Sharpe so the three are mutually consistent — mixing population and
 * sample estimators here is a quiet way to get a PSR that does not correspond
 * to the Sharpe printed beside it.
 */
export function moments(returns: number[]): ReturnMoments | null {
	const n = returns.length
	if (n < 2) return null

	const mean = returns.reduce((s, r) => s + r, 0) / n
	const variance = returns.reduce((s, r) => s + (r - mean) ** 2, 0) / (n - 1)
	const stdev = Math.sqrt(variance)
	if (!Number.isFinite(stdev) || stdev === 0) return { n, mean, stdev: 0, skew: 0, kurtosis: 3 }

	const skew = returns.reduce((s, r) => s + ((r - mean) / stdev) ** 3, 0) / n
	const kurtosis = returns.reduce((s, r) => s + ((r - mean) / stdev) ** 4, 0) / n
	return { n, mean, stdev, skew, kurtosis }
}

/** Per-observation Sharpe. Deliberately NOT annualised — see `trackRecord`. */
export function sharpe(m: ReturnMoments, riskFreePerPeriod = 0): number {
	if (m.stdev === 0) return 0
	return (m.mean - riskFreePerPeriod) / m.stdev
}

/**
 * The variance term shared by PSR and MinTRL: the estimation variance of the
 * Sharpe ratio under non-normal returns. This is the whole reason a naked
 * Sharpe misleads on a series like ours — negative skew and fat tails both
 * inflate it, so the same number means less than it appears to.
 */
function sharpeEstimationVariance(sr: number, m: ReturnMoments): number {
	return 1 - m.skew * sr + ((m.kurtosis - 1) / 4) * sr * sr
}

/**
 * Probabilistic Sharpe Ratio: P(true Sharpe > benchmark).
 *
 * Returns null when the series is too short to say anything, which is a
 * meaningfully different answer from "probability 0.5" and must not be
 * flattened into one.
 */
export function probabilisticSharpe(
	returns: number[],
	benchmarkSharpe = 0,
): { psr: number; sharpe: number; moments: ReturnMoments } | null {
	const m = moments(returns)
	if (!m || m.n < 2 || m.stdev === 0) return null

	const sr = sharpe(m)
	const variance = sharpeEstimationVariance(sr, m)
	if (variance <= 0) return null

	const z = ((sr - benchmarkSharpe) * Math.sqrt(m.n - 1)) / Math.sqrt(variance)
	return { psr: normalCdf(z), sharpe: sr, moments: m }
}

/**
 * Minimum Track Record Length: the number of observations needed before the
 * observed Sharpe is distinguishable from the benchmark at `confidence`.
 *
 * Returns null when the observed Sharpe does not beat the benchmark at all —
 * no amount of further data makes a losing record significant, and reporting
 * a finite number there would be nonsense.
 */
export function minTrackRecordLength(
	returns: number[],
	benchmarkSharpe = 0,
	confidence = 0.95,
): number | null {
	const m = moments(returns)
	if (!m || m.n < 2 || m.stdev === 0) return null

	const sr = sharpe(m)
	if (sr <= benchmarkSharpe) return null

	const z = normalInv(confidence)
	const variance = sharpeEstimationVariance(sr, m)
	if (variance <= 0) return null

	return 1 + variance * (z / (sr - benchmarkSharpe)) ** 2
}

/**
 * The Sharpe you would expect from the best of `trials` independent strategy
 * variants by luck alone, given the spread of Sharpes across those variants.
 * This is the benchmark the Deflated Sharpe Ratio deflates against.
 */
export function expectedMaxSharpe(trials: number, sharpeVariance: number): number {
	if (trials <= 1 || sharpeVariance <= 0) return 0
	const sd = Math.sqrt(sharpeVariance)
	return (
		sd *
		((1 - EULER_GAMMA) * normalInv(1 - 1 / trials) +
			EULER_GAMMA * normalInv(1 - 1 / (trials * Math.E)))
	)
}

/**
 * Deflated Sharpe Ratio: PSR against the expected maximum of `trials`.
 *
 * Note what this does and does not cover. DSR corrects for having *selected* a
 * configuration out of many. We run one live configuration and have never swept
 * variants, so `trials` is 1 and DSR collapses to PSR against zero — which is
 * why the dashboard leads with MinTRL instead. The moment we tune rules against
 * the record, this becomes the binding statistic and the trial count must be
 * counted honestly, including the variants we abandoned.
 */
export function deflatedSharpe(
	returns: number[],
	trials: number,
	sharpeVariance: number,
): { dsr: number; benchmark: number } | null {
	const benchmark = expectedMaxSharpe(trials, sharpeVariance)
	const result = probabilisticSharpe(returns, benchmark)
	if (!result) return null
	return { dsr: result.psr, benchmark }
}

export interface TrackRecordVerdict {
	trades: number
	sharpe: number | null
	psr: number | null
	minTrackRecordLength: number | null
	tradesRemaining: number | null
	significant: boolean
	skew: number | null
	kurtosis: number | null
	/** Plain language, written to be readable by someone who knows no statistics. */
	summary: string
}

/**
 * The whole verdict, in the shape the dashboard renders.
 *
 * Written so that the honest answer — "not yet" — is the easy one to render,
 * because for a long time it will be the true one.
 */
export function trackRecord(
	returns: number[],
	options: { benchmarkSharpe?: number; confidence?: number } = {},
): TrackRecordVerdict {
	const benchmarkSharpe = options.benchmarkSharpe ?? 0
	const confidence = options.confidence ?? 0.95
	const trades = returns.length

	const psrResult = probabilisticSharpe(returns, benchmarkSharpe)
	if (!psrResult) {
		return {
			trades,
			sharpe: null,
			psr: null,
			minTrackRecordLength: null,
			tradesRemaining: null,
			significant: false,
			skew: null,
			kurtosis: null,
			summary:
				trades === 0
					? 'No closed trades yet. There is nothing here to evaluate.'
					: `Only ${trades} closed ${trades === 1 ? 'trade' : 'trades'}. Far too few to say anything at all.`,
		}
	}

	const { psr, sharpe: sr, moments: m } = psrResult
	const minLen = minTrackRecordLength(returns, benchmarkSharpe, confidence)
	const pct = Math.round(confidence * 100)

	if (sr <= benchmarkSharpe) {
		return {
			trades,
			sharpe: sr,
			psr,
			minTrackRecordLength: null,
			tradesRemaining: null,
			significant: false,
			skew: m.skew,
			kurtosis: m.kurtosis,
			summary: `Across ${trades} closed trades this record is not profitable on a risk-adjusted basis. No amount of further trading makes a negative edge significant — the strategy would have to change.`,
		}
	}

	const needed = Math.ceil(minLen ?? Number.POSITIVE_INFINITY)
	const significant = Number.isFinite(needed) && trades >= needed
	const remaining = Number.isFinite(needed) ? Math.max(0, needed - trades) : null

	const tail =
		m.kurtosis > 6 || Math.abs(m.skew) > 1
			? ` The returns are strongly non-normal (skew ${m.skew.toFixed(2)}, kurtosis ${m.kurtosis.toFixed(1)}), which is why the bar is this high — fat tails make a given Sharpe much weaker evidence than it looks.`
			: ''

	return {
		trades,
		sharpe: sr,
		psr,
		minTrackRecordLength: needed,
		tradesRemaining: remaining,
		significant,
		skew: m.skew,
		kurtosis: m.kurtosis,
		summary: significant
			? `Across ${trades} closed trades this record is statistically distinguishable from luck at ${pct}% confidence (it needed ${needed}).${tail}`
			: `Across ${trades} closed trades this record is NOT yet distinguishable from luck. It needs about ${needed} closed trades at ${pct}% confidence — roughly ${remaining} more.${tail}`,
	}
}

/* ------------------------------------------------------------------ *
 * Calibration — is the model's stated confidence worth anything?
 * ------------------------------------------------------------------ */

export interface ConfidenceOutcome {
	/** What the model said, 0–1. */
	confidence: number
	/** What actually happened. */
	won: boolean
}

export interface ReliabilityBucket {
	/** Inclusive lower and exclusive upper bound of the bucket, 0–1. */
	from: number
	to: number
	count: number
	/** Mean stated confidence within the bucket. */
	statedConfidence: number
	/** Fraction that actually won. */
	realizedWinRate: number
	/** realized − stated. Negative means overconfident. */
	gap: number
}

export interface CalibrationReport {
	samples: number
	buckets: ReliabilityBucket[]
	/** Mean squared error of the stated probability. Lower is better; 0.25 is a coin flip. */
	brierScore: number | null
	/** Count-weighted mean |realized − stated|. 0 is perfect calibration. */
	expectedCalibrationError: number | null
	/** Count-weighted mean (realized − stated). Negative = systematically overconfident. */
	bias: number | null
	summary: string
}

/**
 * Reliability curve for the model's stated confidence.
 *
 * We size positions as `budget x confidence`, so this scalar is load-bearing
 * and has never been checked against an outcome. The literature says verbalized
 * LLM confidence is systematically inflated; this is how we find out whether
 * ours is, using our own record rather than someone else's paper.
 */
export function calibration(
	outcomes: ConfidenceOutcome[],
	bucketCount = 5,
): CalibrationReport {
	const clean = outcomes.filter(
		(o) => Number.isFinite(o.confidence) && o.confidence >= 0 && o.confidence <= 1,
	)
	const samples = clean.length
	if (samples === 0) {
		return {
			samples: 0,
			buckets: [],
			brierScore: null,
			expectedCalibrationError: null,
			bias: null,
			summary: 'No closed trades with a recorded confidence yet.',
		}
	}

	const width = 1 / bucketCount
	const buckets: ReliabilityBucket[] = []
	for (let i = 0; i < bucketCount; i++) {
		const from = i * width
		const to = (i + 1) * width
		// The last bucket owns 1.0 — otherwise a maximally confident call falls
		// through every bucket and silently vanishes from the curve.
		const inBucket = clean.filter((o) =>
			i === bucketCount - 1 ? o.confidence >= from : o.confidence >= from && o.confidence < to,
		)
		if (inBucket.length === 0) continue

		const stated = inBucket.reduce((s, o) => s + o.confidence, 0) / inBucket.length
		const realized = inBucket.filter((o) => o.won).length / inBucket.length
		buckets.push({
			from,
			to,
			count: inBucket.length,
			statedConfidence: stated,
			realizedWinRate: realized,
			gap: realized - stated,
		})
	}

	const brier = clean.reduce((s, o) => s + (o.confidence - (o.won ? 1 : 0)) ** 2, 0) / samples
	const ece = buckets.reduce((s, b) => s + (b.count / samples) * Math.abs(b.gap), 0)
	const bias = buckets.reduce((s, b) => s + (b.count / samples) * b.gap, 0)

	let summary: string
	if (samples < 20) {
		summary = `Only ${samples} scored ${samples === 1 ? 'trade' : 'trades'} — too few to judge calibration. Read the curve as a sketch, not a result.`
	} else if (bias < -0.1) {
		summary = `Overconfident by ${Math.abs(bias * 100).toFixed(0)} points on average: when it says a number, it wins less often than that. Position size scales with this figure, so the sizing map is currently too aggressive.`
	} else if (bias > 0.1) {
		summary = `Underconfident by ${(bias * 100).toFixed(0)} points on average: it wins more often than it claims, and is therefore sizing too small.`
	} else {
		summary = `Calibrated within ${Math.abs(bias * 100).toFixed(0)} points across ${samples} scored trades.`
	}

	return {
		samples,
		buckets,
		brierScore: brier,
		expectedCalibrationError: ece,
		bias,
		summary,
	}
}

/* ------------------------------------------------------------------ *
 * The benchmark — would doing nothing have beaten us?
 * ------------------------------------------------------------------ */

export interface BenchmarkComparison {
	strategyReturnPct: number
	benchmarkReturnPct: number
	excessReturnPct: number
	beatsBenchmark: boolean
	label: string
	summary: string
}

/**
 * Strategy equity versus simply holding the base asset over the same window.
 *
 * The single most-cited finding in the LLM-trading literature is that most
 * agents fail to beat buy-and-hold, and that publishing an equity curve with no
 * benchmark beside it is how that fact stays hidden. This is that line.
 */
export function benchmarkComparison(params: {
	startingEquityUsd: number
	currentEquityUsd: number
	/** Base-asset price at the start of the window and now. Equal for a stablecoin. */
	baseStartPriceUsd?: number
	baseNowPriceUsd?: number
	baseSymbol?: string
}): BenchmarkComparison | null {
	const { startingEquityUsd, currentEquityUsd } = params
	if (!Number.isFinite(startingEquityUsd) || startingEquityUsd <= 0) return null

	const strategyReturnPct = ((currentEquityUsd - startingEquityUsd) / startingEquityUsd) * 100

	const start = params.baseStartPriceUsd
	const now = params.baseNowPriceUsd
	const benchmarkReturnPct = start && now && start > 0 ? ((now - start) / start) * 100 : 0

	const label = params.baseSymbol ? `hold ${params.baseSymbol}` : 'hold the base asset'
	const excess = strategyReturnPct - benchmarkReturnPct
	const beats = excess > 0

	return {
		strategyReturnPct,
		benchmarkReturnPct,
		excessReturnPct: excess,
		beatsBenchmark: beats,
		label,
		summary: beats
			? `Ahead of ${label} by ${excess.toFixed(2)}%.`
			: `Behind ${label} by ${Math.abs(excess).toFixed(2)}%. On this window, doing nothing would have done better.`,
	}
}
