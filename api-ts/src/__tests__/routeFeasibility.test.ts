import { describe, expect, test } from 'bun:test'
import {
	decideInstitutionalRoute,
	evaluateRouteFeasibility,
	INSTITUTIONAL_SHADOW_POLICY_V1,
	type ControlledRouteCandidate,
	type InstitutionalExecutionPolicy,
} from '../lib/routeFeasibility'

const NOW_MS = 1_800_000_000_000

function candidate(overrides: Partial<ControlledRouteCandidate> = {}): ControlledRouteCandidate {
	return {
		id: 'route-a',
		rank: 0,
		fromChain: '1',
		toChain: '8453',
		provider: 'test',
		tool: 'Circle CCTP',
		quotedToAmountUsd: 100,
		quotedGasUsd: 0.2,
		quotedFeeUsd: 0.1,
		quotedDurationS: 30,
		complianceScore: 100,
		quoteTimestampMs: NOW_MS - 1_000,
		expiresAtMs: NOW_MS + 30_000,
		capacityUsd: 1_000_000,
		recoveryAvailable: true,
		authorizationSatisfied: true,
		venueStatus: 'healthy',
		eligibilityStatus: 'allowed',
		dataConfidence: 0.99,
		...overrides,
	}
}

function policy(overrides: Partial<InstitutionalExecutionPolicy> = {}): InstitutionalExecutionPolicy {
	return {
		...INSTITUTIONAL_SHADOW_POLICY_V1,
		...overrides,
	}
}

const context = { nowMs: NOW_MS, orderNotionalUsd: 100_000 }

describe('institutional route feasibility', () => {
	test('allows a fully-known issuer-native route', () => {
		const result = evaluateRouteFeasibility(candidate(), policy(), context)

		expect(result.eligible).toBe(true)
		expect(result.reasonCodes).toEqual([])
		expect(result.settlementType).toBe('issuer_native')
	})

	test('uses authoritative eligibility instead of a synthetic compliance score', () => {
		const allowedWithNoScore = evaluateRouteFeasibility(
			candidate({ complianceScore: null, eligibilityStatus: 'allowed' }),
			policy(),
			context,
		)
		const blockedWithPerfectScore = evaluateRouteFeasibility(
			candidate({ complianceScore: 100, eligibilityStatus: 'blocked' }),
			policy(),
			context,
		)

		expect(allowedWithNoScore.eligible).toBe(true)
		expect(blockedWithPerfectScore.eligible).toBe(false)
		expect(blockedWithPerfectScore.reasonCodes).toContain('eligibility_blocked')
	})

	test('fails closed for review and unknown eligibility states', () => {
		const review = evaluateRouteFeasibility(
			candidate({ eligibilityStatus: 'review' }),
			policy(),
			context,
		)
		const unknown = evaluateRouteFeasibility(
			candidate({ eligibilityStatus: 'unknown' }),
			policy(),
			context,
		)

		expect(review.reasonCodes).toContain('eligibility_review_required')
		expect(unknown.reasonCodes).toContain('eligibility_unknown')
	})

	test('rejects stale quotes even when their economics are best', () => {
		const stale = candidate({
			id: 'stale-best',
			quotedToAmountUsd: 110,
			quoteTimestampMs: NOW_MS - 60_000,
		})
		const fresh = candidate({ id: 'fresh', rank: 1, quotedToAmountUsd: 100 })
		const decision = decideInstitutionalRoute([stale, fresh], policy(), context)

		expect(decision.winner?.candidate.id).toBe('fresh')
		expect(decision.rejected).toEqual([
			{
				candidateId: 'stale-best',
				settlementType: 'issuer_native',
				reasonCodes: ['quote_expired'],
			},
		])
	})

	test('rejects insufficient capacity before ranking', () => {
		const result = evaluateRouteFeasibility(
			candidate({ capacityUsd: 50_000 }),
			policy(),
			context,
		)

		expect(result.eligible).toBe(false)
		expect(result.reasonCodes).toContain('capacity_insufficient')
	})

	test('separates unknown order notional from unknown route capacity', () => {
		const result = evaluateRouteFeasibility(
			candidate(),
			policy(),
			{ nowMs: NOW_MS, orderNotionalUsd: null },
		)

		expect(result.eligible).toBe(false)
		expect(result.reasonCodes).toContain('order_notional_unknown')
		expect(result.reasonCodes).not.toContain('capacity_unknown')
	})

	test('enforces an explicit mandate notional ceiling before ranking', () => {
		const result = evaluateRouteFeasibility(
			candidate({ capacityUsd: 1_000_000 }),
			policy({ maxOrderNotionalUsd: 50_000 }),
			context,
		)

		expect(result.eligible).toBe(false)
		expect(result.reasonCodes).toContain('order_notional_exceeds_limit')
	})

	test('rejects settlement classes outside the explicit allowlist', () => {
		const result = evaluateRouteFeasibility(
			candidate({ settlementType: 'wrapped_bridge' }),
			policy(),
			context,
		)

		expect(result.eligible).toBe(false)
		expect(result.reasonCodes).toContain('settlement_not_allowed')
	})

	test('fails closed on missing recovery, authorization, venue health, and confidence', () => {
		const result = evaluateRouteFeasibility(
			candidate({
				recoveryAvailable: null,
				authorizationSatisfied: null,
				venueStatus: 'unknown',
				dataConfidence: null,
			}),
			policy(),
			context,
		)

		expect(result.eligible).toBe(false)
		expect(result.reasonCodes).toEqual([
			'authorization_unconfirmed',
			'data_confidence_unknown',
			'recovery_unknown',
			'venue_status_unknown',
		])
	})

	test('rejects malformed policy artifacts before evaluating candidates', () => {
		expect(() =>
			evaluateRouteFeasibility(
				candidate(),
				policy({ maxQuoteAgeMs: Number.NaN, minDataConfidence: 2 }),
				context,
			),
		).toThrow('Invalid institutional execution policy')
	})

	test('rejects duplicate settlement types in a policy bundle', () => {
		expect(() =>
			evaluateRouteFeasibility(
				candidate(),
				policy({ allowedSettlementTypes: ['issuer_native', 'issuer_native'] }),
				context,
			),
		).toThrow('allowedSettlementTypes must not contain duplicates')
	})

	test('rejects a non-finite evaluation clock instead of failing open freshness checks', () => {
		expect(() =>
			evaluateRouteFeasibility(candidate(), policy(), {
				nowMs: Number.NaN,
				orderNotionalUsd: 100_000,
			}),
		).toThrow('nowMs must be finite')
	})

	test('persists a versioned decision envelope and deterministic rejection order', () => {
		const decision = decideInstitutionalRoute(
			[
				candidate({ id: 'z-route', eligibilityStatus: 'blocked' }),
				candidate({ id: 'good-route', rank: 2 }),
				candidate({ id: 'a-route', venueStatus: 'degraded' }),
			],
			policy({ version: 'institutional-shadow-v1.1' }),
			context,
		)

		expect(decision.policyVersion).toBe('institutional-shadow-v1.1')
		expect(decision.evaluatedAtMs).toBe(NOW_MS)
		expect(decision.winner?.candidate.id).toBe('good-route')
		expect(decision.rejected.map((row) => row.candidateId)).toEqual(['a-route', 'z-route'])
	})
})