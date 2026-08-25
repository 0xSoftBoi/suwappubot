import { decideInstitutionalRoute, INSTITUTIONAL_SHADOW_POLICY_V1, type ControlledRouteCandidate } from '../lib/routeFeasibility'

interface Distribution {
	iterations: number
	candidateCount: number
	p50Us: number
	p95Us: number
	p99Us: number
	maxUs: number
	meanUs: number
}

const NOW_MS = 1_800_000_000_000
const ORDER_NOTIONAL_USD = 100_000
const DEFAULT_ITERATIONS = 10_000
const DEFAULT_CANDIDATE_COUNTS = [8, 32, 128]

function finitePositiveInteger(value: string | undefined, fallback: number): number {
	if (!value) return fallback
	const parsed = Number(value)
	return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback
}

function quantile(sorted: number[], q: number): number {
	if (sorted.length === 0) return 0
	const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * q) - 1))
	return sorted[index] ?? 0
}

function round3(value: number): number {
	return Math.round(value * 1_000) / 1_000
}

function candidate(index: number): ControlledRouteCandidate {
	const issuerNative = index % 3 === 0
	const solver = index % 3 === 1
	const tool = issuerNative ? 'Circle CCTP' : solver ? 'Across' : 'Stargate'
	const eligibilityStatus = index % 17 === 0 ? 'blocked' : 'allowed'
	const venueStatus = index % 29 === 0 ? 'degraded' : 'healthy'

	return {
		id: `route-${index.toString().padStart(4, '0')}`,
		rank: index,
		fromChain: '1',
		toChain: '8453',
		provider: 'benchmark',
		tool,
		quotedToAmountUsd: 100_100 - index * 0.01,
		quotedGasUsd: 0.2 + (index % 5) * 0.01,
		quotedFeeUsd: 0.1 + (index % 7) * 0.01,
		quotedDurationS: 15 + (index % 120),
		quoteTimestampMs: NOW_MS - (index % 4) * 250,
		expiresAtMs: NOW_MS + 30_000,
		capacityUsd: 2_000_000 - index,
		recoveryAvailable: true,
		authorizationSatisfied: true,
		venueStatus,
		eligibilityStatus,
		dataConfidence: 0.99,
	}
}

function measure(candidateCount: number, iterations: number): Distribution {
	const candidates = Array.from({ length: candidateCount }, (_, index) => candidate(index))
	const context = { nowMs: NOW_MS, orderNotionalUsd: ORDER_NOTIONAL_USD }

	// Warm JIT/runtime state before collecting samples.
	for (let i = 0; i < 1_000; i++) {
		decideInstitutionalRoute(candidates, INSTITUTIONAL_SHADOW_POLICY_V1, context)
	}

	const samplesUs = new Array<number>(iterations)
	let totalUs = 0
	for (let i = 0; i < iterations; i++) {
		const startNs = Bun.nanoseconds()
		decideInstitutionalRoute(candidates, INSTITUTIONAL_SHADOW_POLICY_V1, context)
		const elapsedUs = (Bun.nanoseconds() - startNs) / 1_000
		samplesUs[i] = elapsedUs
		totalUs += elapsedUs
	}

	samplesUs.sort((a, b) => a - b)
	return {
		iterations,
		candidateCount,
		p50Us: round3(quantile(samplesUs, 0.5)),
		p95Us: round3(quantile(samplesUs, 0.95)),
		p99Us: round3(quantile(samplesUs, 0.99)),
		maxUs: round3(samplesUs.at(-1) ?? 0),
		meanUs: round3(totalUs / iterations),
	}
}

const iterations = finitePositiveInteger(process.env.ROUTE_BENCH_ITERATIONS, DEFAULT_ITERATIONS)
const candidateCounts = process.env.ROUTE_BENCH_CANDIDATES
	? process.env.ROUTE_BENCH_CANDIDATES.split(',')
			.map((value) => finitePositiveInteger(value.trim(), 0))
			.filter((value) => value > 0)
	: DEFAULT_CANDIDATE_COUNTS

if (candidateCounts.length === 0) {
	throw new Error('ROUTE_BENCH_CANDIDATES must contain at least one positive integer')
}

const result = {
	benchmark: 'institutional-route-decision-hot-path/v1',
	runtime: `bun-${Bun.version}`,
	iterationsPerCase: iterations,
	candidateCounts,
	note: 'CPU-only feasibility + ranking benchmark. No network/provider latency is included. Use distributions as measured baselines; do not treat them as production SLOs.',
	results: candidateCounts.map((count) => measure(count, iterations)),
}

console.log(JSON.stringify(result, null, 2))
