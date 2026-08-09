import { describe, expect, it, mock } from 'bun:test'
import { Effect } from 'effect'
import { MorphoService, MorphoServiceLive } from '../services/MorphoService'

const MARKET = {
	marketId: '0xmarket',
	listed: true,
	loanAsset: { symbol: 'USDC' },
	collateralAsset: { symbol: 'WETH' },
	lltv: '860000000000000000',
	warnings: [{ type: 'oracle_price_derivation', level: 'RED' }],
	state: {
		supplyApy: 0.042,
		borrowApy: 0.058,
		supplyAssetsUsd: 12_500_000,
		borrowAssetsUsd: 8_900_000,
		liquidityAssetsUsd: 3_600_000,
		utilization: 0.712,
	},
}

function withMockFetch(
	handler: (url: string, body: Record<string, unknown>) => unknown,
	fn: () => Promise<void>,
) {
	const originalFetch = globalThis.fetch
	globalThis.fetch = Object.assign(
		mock((input: string | URL | Request, init?: RequestInit) => {
			const body = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>
			return Promise.resolve(
				new Response(JSON.stringify(handler(String(input), body)), {
					headers: { 'content-type': 'application/json' },
				}),
			)
		}),
		{ preconnect: originalFetch.preconnect },
	) as typeof fetch

	return fn().finally(() => {
		globalThis.fetch = originalFetch
	})
}

function withService<A>(run: (service: typeof MorphoService.Service) => Effect.Effect<A, Error>) {
	return Effect.runPromise(
		Effect.gen(function* () {
			const service = yield* MorphoService
			return yield* run(service)
		}).pipe(Effect.provide(MorphoServiceLive)),
	)
}

describe('lending current Morpho API contract', () => {
	it('uses the current endpoint and exposes explicit USD liquidity plus warning context', async () => {
		await withMockFetch(
			(url, body) => {
				expect(url).toBe('https://api.morpho.org/graphql')
				expect(body.variables).toEqual({ chainId: 8453 })
				expect(String(body.query)).toContain('liquidityAssetsUsd')
				expect(String(body.query)).toContain('warnings { type level }')
				return { data: { markets: { items: [MARKET] } } }
			},
			async () => {
				const markets = await withService((service) => service.getMarkets(8453))
				expect(markets[0]).toMatchObject({
					id: '0xmarket',
					loanToken: 'USDC',
					collateralToken: 'WETH',
					lltv: 0.86,
					totalSupply: 12_500_000,
					totalBorrow: 8_900_000,
					totalSupplyUsd: 12_500_000,
					totalBorrowUsd: 8_900_000,
					availableLiquidityUsd: 3_600_000,
					utilization: 71.2,
					chainId: 8453,
					listed: true,
					warnings: [{ type: 'oracle_price_derivation', level: 'RED' }],
				})
				expect(markets[0]?.supplyApy).toBeCloseTo(4.2)
				expect(markets[0]?.borrowApy).toBeCloseTo(5.8)
			},
		)
	})

	it('uses marketById with an explicit chain instead of the removed uniqueKey filter', async () => {
		await withMockFetch(
			(_url, body) => {
				expect(String(body.query)).toContain('marketById')
				expect(String(body.query)).not.toContain('uniqueKey')
				expect(body.variables).toEqual({ marketId: '0xmarket', chainId: 1 })
				return {
					data: {
						marketById: {
							...MARKET,
							chain: { id: 1 },
							oracle: { address: '0xoracle' },
							irmAddress: '0xirm',
							creationTimestamp: '1767225600',
						},
					},
				}
			},
			async () => {
				const market = await withService((service) => service.getMarket('0xmarket', 1))
				expect(market.chainId).toBe(1)
				expect(market.oracle).toBe('0xoracle')
				expect(market.createdAt).toBe('2026-01-01T00:00:00.000Z')
			},
		)
	})

	it('surfaces GraphQL errors instead of silently returning an empty result', async () => {
		await withMockFetch(
			() => ({ errors: [{ message: 'schema drift' }] }),
			async () => {
				await expect(withService((service) => service.getMarkets())).rejects.toThrow(
					'Morpho API GraphQL error: schema drift',
				)
			},
		)
	})
})
