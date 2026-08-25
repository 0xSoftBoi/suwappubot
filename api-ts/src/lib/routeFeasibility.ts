import {
	inferSettlementType,
	rankRouteCandidates,
	type RankedRoute,
	type RouteDecisionCandidate,
	type RouteProfile,
	type SettlementType,
} from './routeDecision'

/**
 * Hard rejection codes for institutional routing.
 *
 * These are deliberately machine-readable and stable: an operator, audit log,
 * post-trade review, or client report should be able to explain why a route
 * was never eligible without reverse-engineering a weighted score.
 */
export type FeasibilityReasonCode =
	| 'authorization_unconfirmed'
	| 'capacity_insufficient'
	| 'capacity_unknown'
	| 'compliance_below_minimum'
	| 'compliance_unknown'
	| 'data_confidence_below_minimum'
	| 'data_confidence_unknown'
	| 'duration_exceeds_limit'
	| 'duration_unknown'
	| 'economics_invalid'
	| 'economics_unknown'
	| 'eligibility_blocked'
	| 'eligibility_review_required'
	| 'eligibility_unknown'
	| 'order_notional_exceeds_limit'
	| 'order_notional_invalid'
	| 'order_notional_unknown'
	| 'quote_expired'
	| 'quote_timestamp_invalid'
	| 'quote_timestamp_unknown'
	| 'recovery_unavailable'
	| 'recovery_unknown'
	| 'settlement_not_allowed'
	| 'settlement_unknown'
	| 'venue_degraded'
	| 'venue_unavailable'
	| 'venue_status_unknown'

export type VenueStatus = 'healthy' | 'degraded' | 'unavailable' | 'unknown'
export type RouteEligibilityStatus = 'allowed' | 'blocked' | 'review' | 'unknown'

/**
 * Signals required by a production-grade feasibility gate but not guaranteed
 * by every quote adapter yet. Unknown stays unknown and can fail closed under
 * the selected policy.
 */
export interface ControlledRouteCandidate extends RouteDecisionCandidate {
	quoteTimestampMs?: number | null
	expiresAtMs?: number | null
	capacityUsd?: number | null
	recoveryAvailable?: boolean | null
	authorizationSatisfied?: boolean | null
	venueStatus?: VenueStatus | null
	/** Authoritative policy result from #939; never inferred from a weighted score. */
	eligibilityStatus?: RouteEligibilityStatus | null
	/** 0..1 confidence in the market/route data snapshot used by the adapter. */
	dataConfidence?: number | null
}

export interface InstitutionalExecutionPolicy {
	/** Immutable identifier persisted with every decision. */
	version: string
	/** Ranking profile used only after hard feasibility passes. */
	profile: RouteProfile
	maxQuoteAgeMs: number
	maxDurationS: number
	/** Optional policy cap; production policies should set explicit mandate limits. */
	maxOrderNotionalUsd: number | null
	/** Shadow-only quality score gate. Live legal/mandate eligibility uses eligibilityStatus. */
	minComplianceScore: number
	minDataConfidence: number
	allowedSettlementTypes: readonly SettlementType[]
	requireKnownEconomics: boolean
	requireKnownDuration: boolean
	requireKnownCapacity: boolean
	requireKnownOrderNotional: boolean
	requireAllowedEligibility: boolean
	requireComplianceScore: boolean
	requireRecovery: boolean
	requireAuthorization: boolean
	requireHealthyVenue: boolean
}

export interface FeasibilityContext {
	/** Injected clock keeps decisions replayable in tests and post-trade review. */
	nowMs: number
	/** Null means the caller has not supplied an order notional. */
	orderNotionalUsd: number | null
}

export interface RouteFeasibilityResult {
	candidate: ControlledRouteCandidate
	settlementType: SettlementType
	eligible: boolean
	reasonCodes: FeasibilityReasonCode[]
}

export interface InstitutionalRouteDecision {
	policyVersion: string
	evaluatedAtMs: number
	winner: RankedRoute | null
	alternatives: RankedRoute[]
	rejected: Array<{
		candidateId: string
		settlementType: SettlementType
		reasonCodes: FeasibilityReasonCode[]
	}>
}

const DEFAULT_ALLOWED_SETTLEMENT_TYPES: readonly SettlementType[] = [
	'same_chain_swap',
	'issuer_native',
	'solver_intent',
]

/**
 * Conservative institutional baseline for shadow/pre-production evaluation.
 *
 * This is intentionally fail-closed. Live MONEY-PATH promotion must still use
 * a separately reviewed, versioned policy calibrated to the actual client,
 * jurisdiction, venue set, asset, order type and approved notional limits.
 *
 * No arbitrary notional ceiling is embedded here: this shadow policy requires
 * the notional to be known, while a production mandate must supply its reviewed
 * maximum explicitly.
 */
export const INSTITUTIONAL_SHADOW_POLICY_V1: InstitutionalExecutionPolicy = {
	version: 'institutional-shadow-v1',
	profile: 'institutional',
	maxQuoteAgeMs: 5_000,
	maxDurationS: 300,
	maxOrderNotionalUsd: null,
	minComplianceScore: 90,
	minDataConfidence: 0.95,
	allowedSettlementTypes: DEFAULT_ALLOWED_SETTLEMENT_TYPES,
	requireKnownEconomics: true,
	requireKnownDuration: true,
	requireKnownCapacity: true,
	requireKnownOrderNotional: true,
	requireAllowedEligibility: true,
	// The numeric compliance score remains shadow analytics. #939 owns live eligibility.
	requireComplianceScore: false,
	requireRecovery: true,
	requireAuthorization: true,
	requireHealthyVenue: true,
}

function finite(value: number | null | undefined): value is number {
	return typeof value === 'number' && Number.isFinite(value)
}

function resolvedSettlementType(candidate: ControlledRouteCandidate): SettlementType {
	return (
		candidate.settlementType ??
		inferSettlementType({
			fromChain: candidate.fromChain,
			toChain: candidate.toChain,
			tool: candidate.tool,
		})
	)
}

function push(reasons: FeasibilityReasonCode[], reason: FeasibilityReasonCode): void {
	if (!reasons.includes(reason)) reasons.push(reason)
}

function evaluateEligibility(
	candidate: ControlledRouteCandidate,
	policy: InstitutionalExecutionPolicy,
	reasons: FeasibilityReasonCode[],
): void {
	if (!policy.requireAllowedEligibility) return

	switch (candidate.eligibilityStatus) {
		case 'allowed':
			return
		case 'blocked':
			push(reasons, 'eligibility_blocked')
			return
		case 'review':
			push(reasons, 'eligibility_review_required')
			return
		case 'unknown':
		case null:
		case undefined:
			push(reasons, 'eligibility_unknown')
			return
	}
}

/**
 * Stage 1 of #899: hard feasibility only. No weighted penalty can rescue a
 * route that violates policy, mandate, capacity, freshness, recovery, venue,
 * notional, settlement, or authorization constraints.
 */
export function evaluateRouteFeasibility(
	candidate: ControlledRouteCandidate,
	policy: InstitutionalExecutionPolicy,
	context: FeasibilityContext,
): RouteFeasibilityResult {
	const reasons: FeasibilityReasonCode[] = []
	const settlementType = resolvedSettlementType(candidate)

	if (policy.requireAuthorization && candidate.authorizationSatisfied !== true) {
		push(reasons, 'authorization_unconfirmed')
	}

	evaluateEligibility(candidate, policy, reasons)

	if (!finite(candidate.quoteTimestampMs)) {
		push(reasons, 'quote_timestamp_unknown')
	} else {
		const ageMs = context.nowMs - candidate.quoteTimestampMs
		if (ageMs < 0) push(reasons, 'quote_timestamp_invalid')
		else if (ageMs > policy.maxQuoteAgeMs) push(reasons, 'quote_expired')
	}

	if (finite(candidate.expiresAtMs) && candidate.expiresAtMs <= context.nowMs) {
		push(reasons, 'quote_expired')
	}

	if (policy.requireKnownEconomics) {
		if (!finite(candidate.quotedToAmountUsd) || !finite(candidate.quotedGasUsd)) {
			push(reasons, 'economics_unknown')
		} else if (candidate.quotedToAmountUsd <= 0 || candidate.quotedGasUsd < 0) {
			push(reasons, 'economics_invalid')
		}
	}

	if (settlementType === 'unknown') push(reasons, 'settlement_unknown')
	if (!policy.allowedSettlementTypes.includes(settlementType)) {
		push(reasons, 'settlement_not_allowed')
	}

	if (policy.requireComplianceScore) {
		if (!finite(candidate.complianceScore)) {
			push(reasons, 'compliance_unknown')
		} else if (candidate.complianceScore < policy.minComplianceScore) {
			push(reasons, 'compliance_below_minimum')
		}
	}

	if (!finite(candidate.quotedDurationS)) {
		if (policy.requireKnownDuration) push(reasons, 'duration_unknown')
	} else if (candidate.quotedDurationS < 0 || candidate.quotedDurationS > policy.maxDurationS) {
		push(reasons, 'duration_exceeds_limit')
	}

	let validOrderNotional = false
	if (!finite(context.orderNotionalUsd)) {
		if (policy.requireKnownOrderNotional) push(reasons, 'order_notional_unknown')
	} else if (context.orderNotionalUsd <= 0) {
		push(reasons, 'order_notional_invalid')
	} else {
		validOrderNotional = true
		if (
			finite(policy.maxOrderNotionalUsd) &&
			context.orderNotionalUsd > policy.maxOrderNotionalUsd
		) {
			push(reasons, 'order_notional_exceeds_limit')
		}
	}

	if (validOrderNotional) {
		if (!finite(candidate.capacityUsd)) {
			if (policy.requireKnownCapacity) push(reasons, 'capacity_unknown')
		} else if (candidate.capacityUsd < (context.orderNotionalUsd as number)) {
			push(reasons, 'capacity_insufficient')
		}
	} else if (policy.requireKnownCapacity && !reasons.includes('order_notional_unknown')) {
		// Capacity cannot be validated against an invalid notional. Keep the
		// notional error authoritative rather than mislabeling it as capacity.
	}

	if (policy.requireRecovery) {
		if (candidate.recoveryAvailable === null || candidate.recoveryAvailable === undefined) {
			push(reasons, 'recovery_unknown')
		} else if (!candidate.recoveryAvailable) {
			push(reasons, 'recovery_unavailable')
		}
	}

	if (policy.requireHealthyVenue) {
		if (
			candidate.venueStatus === null ||
			candidate.venueStatus === undefined ||
			candidate.venueStatus === 'unknown'
		) {
			push(reasons, 'venue_status_unknown')
		} else if (candidate.venueStatus === 'degraded') {
			push(reasons, 'venue_degraded')
		} else if (candidate.venueStatus === 'unavailable') {
			push(reasons, 'venue_unavailable')
		}
	}

	if (!finite(candidate.dataConfidence)) {
		push(reasons, 'data_confidence_unknown')
	} else if (candidate.dataConfidence < policy.minDataConfidence) {
		push(reasons, 'data_confidence_below_minimum')
	}

	return {
		candidate,
		settlementType,
		eligible: reasons.length === 0,
		reasonCodes: reasons.sort(),
	}
}

/**
 * Stage 2 of #899 for the currently normalized scorer: rank only candidates
 * that survived feasibility and return an audit-friendly rejection ledger.
 */
export function decideInstitutionalRoute(
	candidates: ControlledRouteCandidate[],
	policy: InstitutionalExecutionPolicy,
	context: FeasibilityContext,
): InstitutionalRouteDecision {
	const evaluations = candidates.map((candidate) =>
		evaluateRouteFeasibility(candidate, policy, context),
	)
	const feasible = evaluations.filter((result) => result.eligible).map((result) => result.candidate)
	const ranked = rankRouteCandidates(feasible, policy.profile)

	return {
		policyVersion: policy.version,
		evaluatedAtMs: context.nowMs,
		winner: ranked[0] ?? null,
		alternatives: ranked.slice(1),
		rejected: evaluations
			.filter((result) => !result.eligible)
			.map((result) => ({
				candidateId: result.candidate.id,
				settlementType: result.settlementType,
				reasonCodes: result.reasonCodes,
			}))
			.sort((a, b) => a.candidateId.localeCompare(b.candidateId)),
	}
}
