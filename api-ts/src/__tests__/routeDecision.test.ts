import { describe, expect, test } from 'bun:test'
import {
	inferSettlementType,
	rankRouteCandidates,
	type RouteDecisionCandidate,
} from '../lib/routeDecision'

function candidate(
	overrides: Partial<RouteDecisionCandidate> & Pick<RouteDecisionCandidate, 'id' | 'rank'>,
): RouteDecisionCandidate {
	const { id, rank, ...rest } = overrides

	return {
		id,
		rank,
		fromChain: '1',
		toChain: '8453',
		provider: 'lifi',
		tool: 'unknown-bridge',
		quotedToAmountUsd: 100,
		quotedGasUsd: 0,
		quotedFeeUsd: 0,
		quotedDurationS: 60,
		...rest,
	}
}

describe('settlement classification', () => {
	test('same-chain routes are classified before tool heuristics', () => {
		expect(
			inferSettlementType({ fromChain: '8453', toChain: '8453', tool: 'Across' }),
		).toBe('same_chain_swap')
	})

	test('recognizes issuer-native CCTP routes', () => {
		expect(inferSettlementType({ fromChain: '1', toChain: '8453', tool: 'Circle CCTP' })).toBe(
			'issuer_native',
		)
	})

	test('recognizes explicit solver/intent and liquidity bridge routes', () => {
		expect(inferSettlementType({ fromChain: '1', toChain: '10', tool: 'Across' })).toBe(
			'solver_intent',
		)
		expect(inferSettlementType({ fromChain: '1', toChain: '10', tool: 'Stargate' })).toBe(
			'liquidity_bridge',
		)
	})

	test('leaves unrecognized tools unknown instead of inventing a safety model', () => {
		expect(inferSettlementType({ fromChain: '1', toChain: '10', tool: 'FutureBridgeX' })).toBe(
			'unknown',
		)
	})
})

describe('profile-aware ranking', () => {
	test('retail can prefer materially better economics while treasury prefers safer settlement', () => {
		const routes = [
			candidate({
				id: 'issuer',
				rank: 1,
				tool: 'Circle CCTP',
				quotedToAmountUsd: 97,
				quotedDurationS: 60,
			}),
			candidate({
				id: 'cheaper',
				rank: 0,
				tool: 'FutureBridgeX',
				quotedToAmountUsd: 100,
				quotedDurationS: 60,
			}),
		]

		expect(rankRouteCandidates(routes, 'retail')[0]?.candidate.id).toBe('cheaper')
		expect(rankRouteCandidates(routes, 'treasury')[0]?.candidate.id).toBe('issuer')
		expect(rankRouteCandidates(routes, 'institutional')[0]?.candidate.id).toBe('issuer')
	})

	test('small price differences do not swamp settlement quality for treasury', () => {
		const routes = [
			candidate({
				id: 'issuer',
				rank: 1,
				tool: 'CCTP',
				quotedToAmountUsd: 99.5,
			}),
			candidate({
				id: 'unknown',
				rank: 0,
				quotedToAmountUsd: 100,
			}),
		]

		const treasury = rankRouteCandidates(routes, 'treasury')
		expect(treasury[0]?.candidate.id).toBe('issuer')
		expect(treasury[0]?.components.settlement).toBe(100)
	})

	test('missing signals stay neutral and are surfaced explicitly', () => {
		const ranked = rankRouteCandidates(
			[
				candidate({
					id: 'sparse',
					rank: 0,
					quotedToAmountUsd: null,
					quotedGasUsd: null,
					quotedFeeUsd: null,
					quotedDurationS: null,
					complianceScore: null,
				}),
			],
			'institutional',
		)

		expect(Number.isFinite(ranked[0]?.score)).toBe(true)
		expect(ranked[0]?.missingSignals).toEqual([
			'economics',
			'latency',
			'settlement_type',
			'compliance',
		])
	})

	test('ties are deterministic by provider rank and then route id', () => {
		const routes = [
			candidate({ id: 'z', rank: 2, tool: 'CCTP' }),
			candidate({ id: 'b', rank: 1, tool: 'CCTP' }),
			candidate({ id: 'a', rank: 1, tool: 'CCTP' }),
		]

		expect(rankRouteCandidates(routes, 'retail').map((r) => r.candidate.id)).toEqual([
			'a',
			'b',
			'z',
		])
	})
})