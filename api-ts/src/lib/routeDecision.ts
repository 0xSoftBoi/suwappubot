export type RouteProfile = 'retail' | 'treasury' | 'institutional'

export type SettlementType =
	| 'issuer_native'
	| 'solver_intent'
	| 'liquidity_bridge'
	| 'wrapped_bridge'
	| 'same_chain_swap'
	| 'unknown'

export interface RouteDecisionCandidate {
	id: string
	provider?: string | null
	tool?: string | null
	fromChain: string
	toChain: string
	quotedToAmountUsd?: number | null
	quotedGasUsd?: number | null
	quotedFeeUsd?: number | null
	quotedDurationS?: number | null
	rank: number
	settlementType?: SettlementType
	/** 0-100. Null/undefined means policy has not supplied a jurisdiction score yet. */
	complianceScore?: number | null
}

export interface RouteScoreComponents {
	economics: number
	latency: number
	settlement: number
	recoverability: number
	compliance: number
}

export interface RankedRoute {
	candidate: RouteDecisionCandidate
	settlementType: SettlementType
	score: number
	components: RouteScoreComponents
	missingSignals: string[]
}

const PROFILE_WEIGHTS: Record<RouteProfile, RouteScoreComponents> = {
	retail: {
		economics: 0.5,
		latency: 0.2,
		settlement: 0.2,
		recoverability: 0.05,
		compliance: 0.05,
	},
	treasury: {
		economics: 0.25,
		latency: 0.1,
		settlement: 0.4,
		recoverability: 0.15,
		compliance: 0.1,
	},
	institutional: {
		economics: 0.2,
		latency: 0.1,
		settlement: 0.35,
		recoverability: 0.15,
		compliance: 0.2,
	},
}

const SETTLEMENT_SCORE: Record<SettlementType, number> = {
	same_chain_swap: 95,
	issuer_native: 100,
	solver_intent: 82,
	liquidity_bridge: 65,
	wrapped_bridge: 40,
	unknown: 50,
}

const RECOVERABILITY_SCORE: Record<SettlementType, number> = {
	same_chain_swap: 95,
	issuer_native: 90,
	solver_intent: 75,
	liquidity_bridge: 60,
	wrapped_bridge: 45,
	unknown: 50,
}

function clamp(value: number, min = 0, max = 100): number {
	return Math.min(max, Math.max(min, value))
}

function finite(value: number | null | undefined): value is number {
	return typeof value === 'number' && Number.isFinite(value)
}

/**
 * Conservative route classification. This is deliberately explicit: unknown
 * tools stay unknown rather than receiving an invented security assumption.
 * Callers may pass settlementType when an adapter has stronger metadata.
 */
export function inferSettlementType(input: {
	fromChain: string
	toChain: string
	tool?: string | null
}): SettlementType {
	if (input.fromChain === input.toChain) return 'same_chain_swap'

	const tool = (input.tool ?? '').trim().toLowerCase()
	if (!tool) return 'unknown'

	// LI.FI exposes CCTP variants under keys containing CCTP; Mayan's MCTP
	// variants are also CCTP-backed native USDC transfers.
	if (tool.includes('cctp') || tool.includes('mctp')) return 'issuer_native'

	if (
		tool.includes('intent') ||
		tool.includes('solver') ||
		tool.includes('rfq') ||
		tool === 'across' ||
		tool.includes('debridge') ||
		tool === 'dln' ||
		tool.includes('relay')
	) {
		return 'solver_intent'
	}

	if (
		tool.includes('stargate') ||
		tool === 'hop' ||
		tool.includes('celer') ||
		tool.includes('synapse')
	) {
		return 'liquidity_bridge'
	}

	if (tool.includes('wrapped') || tool.includes('token bridge')) return 'wrapped_bridge'

	return 'unknown'
}

function netOutputUsd(candidate: RouteDecisionCandidate): number | null {
	if (!finite(candidate.quotedToAmountUsd)) return null
	const gas = finite(candidate.quotedGasUsd) ? candidate.quotedGasUsd : 0
	// Provider toAmountUSD is already the post-route output. Protocol/bridge
	// fees included in that output must not be subtracted a second time here.
	// Gas remains external to the received asset, matching LI.FI's CHEAPEST
	// comparison semantics and Suwappu's existing route-race telemetry.
	return candidate.quotedToAmountUsd - gas
}

/**
 * Score net execution economics relative to the best observed route.
 * 5 bps of disadvantage costs one score point. That keeps tiny quote noise
 * from overwhelming settlement quality while still making material price
 * differences decisive for the retail profile.
 */
function economicsScore(netUsd: number | null, bestNetUsd: number | null): number {
	if (netUsd === null || bestNetUsd === null || bestNetUsd <= 0) return 50
	const deltaBps = ((bestNetUsd - netUsd) / bestNetUsd) * 10_000
	return clamp(100 - Math.max(0, deltaBps) / 5)
}

function latencyScore(durationS: number | null | undefined): number {
	if (!finite(durationS) || durationS < 0) return 50
	// 0s => 100, 60s => 90, 300s => 50, >=600s => 0.
	return clamp(100 - durationS / 6)
}

function round2(value: number): number {
	return Math.round(value * 100) / 100
}

/**
 * Rank candidate routes without changing execution. The function is pure and
 * deterministic so it can run in telemetry first, then later become an input
 * to CandidatePlan selection after MONEY-PATH review.
 */
export function rankRouteCandidates(
	candidates: RouteDecisionCandidate[],
	profile: RouteProfile,
): RankedRoute[] {
	if (candidates.length === 0) return []

	const nets = candidates.map(netOutputUsd).filter((value): value is number => value !== null)
	const bestNetUsd = nets.length > 0 ? Math.max(...nets) : null
	const weights = PROFILE_WEIGHTS[profile]

	return candidates
		.map((candidate): RankedRoute => {
			const settlementType =
				candidate.settlementType ??
				inferSettlementType({
					fromChain: candidate.fromChain,
					toChain: candidate.toChain,
					tool: candidate.tool,
				})
			const netUsd = netOutputUsd(candidate)
			const compliance = finite(candidate.complianceScore)
				? clamp(candidate.complianceScore)
				: 50
			const components: RouteScoreComponents = {
				economics: economicsScore(netUsd, bestNetUsd),
				latency: latencyScore(candidate.quotedDurationS),
				settlement: SETTLEMENT_SCORE[settlementType],
				recoverability: RECOVERABILITY_SCORE[settlementType],
				compliance,
			}

			const missingSignals: string[] = []
			if (netUsd === null) missingSignals.push('economics')
			if (!finite(candidate.quotedDurationS)) missingSignals.push('latency')
			if (settlementType === 'unknown') missingSignals.push('settlement_type')
			if (!finite(candidate.complianceScore)) missingSignals.push('compliance')

			const score =
				components.economics * weights.economics +
				components.latency * weights.latency +
				components.settlement * weights.settlement +
				components.recoverability * weights.recoverability +
				components.compliance * weights.compliance

			return {
				candidate,
				settlementType,
				score: round2(score),
				components: {
					economics: round2(components.economics),
					latency: round2(components.latency),
					settlement: round2(components.settlement),
					recoverability: round2(components.recoverability),
					compliance: round2(components.compliance),
				},
				missingSignals,
			}
		})
		.sort((a, b) => {
			if (b.score !== a.score) return b.score - a.score
			if (a.candidate.rank !== b.candidate.rank) return a.candidate.rank - b.candidate.rank
			return a.candidate.id.localeCompare(b.candidate.id)
		})
}
