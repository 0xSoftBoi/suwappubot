import { describe, expect, test } from 'bun:test'
import {
	buildInstitutionalDecisionAuditRecord,
	canonicalAuditJson,
} from '../lib/routeDecisionAudit'
import {
	decideInstitutionalRoute,
	INSTITUTIONAL_SHADOW_POLICY_V1,
	type ControlledRouteCandidate,
} from '../lib/routeFeasibility'

const NOW_MS = 1_800_000_000_000

function candidate(id: string, rank: number, overrides: Partial<ControlledRouteCandidate> = {}): ControlledRouteCandidate {
	return {
		id,
		rank,
		fromChain: '1',
		toChain: '8453',
		provider: 'test',
		tool: 'Circle CCTP',
		quotedToAmountUsd: 100 - rank,
		quotedGasUsd: 0.2,
		quotedFeeUsd: 0.1,
		quotedDurationS: 30,
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

function record(candidates: ControlledRouteCandidate[]) {
	const decision = decideInstitutionalRoute(candidates, INSTITUTIONAL_SHADOW_POLICY_V1, {
		nowMs: NOW_MS,
		orderNotionalUsd: 100_000,
	})

	return buildInstitutionalDecisionAuditRecord(candidates, decision, {
		optimizerVersion: 'route-score-v1',
		policyDigest: 'policy-sha256-example',
		buildVersion: 'git:deadbeef',
	})
}

describe('institutional decision audit record', () => {
	test('candidate input order does not change the canonical digest', () => {
		const a = candidate('a', 0)
		const b = candidate('b', 1)

		const first = record([a, b])
		const second = record([b, a])

		expect(first.digest).toBe(second.digest)
		expect(first.snapshot.candidates.map((row) => row.id)).toEqual(['a', 'b'])
	})

	test('changing a control-plane input changes the digest', () => {
		const baseline = record([candidate('a', 0)])
		const changed = record([candidate('a', 0, { capacityUsd: 900_000 })])

		expect(changed.digest).not.toBe(baseline.digest)
	})

	test('optimizer version is part of the auditable decision identity', () => {
		const candidates = [candidate('a', 0)]
		const decision = decideInstitutionalRoute(candidates, INSTITUTIONAL_SHADOW_POLICY_V1, {
			nowMs: NOW_MS,
			orderNotionalUsd: 100_000,
		})

		const v1 = buildInstitutionalDecisionAuditRecord(candidates, decision, {
			optimizerVersion: 'v1',
		})
		const v2 = buildInstitutionalDecisionAuditRecord(candidates, decision, {
			optimizerVersion: 'v2',
		})

		expect(v1.digest).not.toBe(v2.digest)
	})

	test('duplicate candidate IDs are rejected instead of producing an ambiguous record', () => {
		const candidates = [candidate('dup', 0), candidate('dup', 1)]
		const decision = decideInstitutionalRoute(candidates, INSTITUTIONAL_SHADOW_POLICY_V1, {
			nowMs: NOW_MS,
			orderNotionalUsd: 100_000,
		})

		expect(() =>
			buildInstitutionalDecisionAuditRecord(candidates, decision, { optimizerVersion: 'v1' }),
		).toThrow('Duplicate candidate id: dup')
	})

	test('non-finite values cannot silently collapse into canonical JSON', () => {
		expect(() => canonicalAuditJson({ score: Number.POSITIVE_INFINITY })).toThrow(
			'Cannot canonicalize non-finite number',
		)
	})

	test('canonical JSON is stable across object key insertion order', () => {
		expect(canonicalAuditJson({ b: 2, a: 1 })).toBe(canonicalAuditJson({ a: 1, b: 2 }))
	})
})