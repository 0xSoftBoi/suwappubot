import { describe, expect, it, mock } from 'bun:test'
import { Effect } from 'effect'
import { HyperliquidService, HyperliquidServiceLive } from '../services/HyperliquidService'

const LIVE_CONTEXT = [
	{
		universe: [
			{ name: 'ETH', szDecimals: 4, maxLeverage: 25 },
			{ name: 'BTC', szDecimals: 5, maxLeverage: 40 },
		],
	},
	[
		{ funding: '0.000125', markPx: '3200', midPx: '3199' },
		{ funding: '-0.00005', markPx: '67000', midPx: '66990' },
	],
] as const

function withMockFetch(
	handler: (body: Record<string, unknown>) => unknown,
	fn: () => Promise<void>,
) {
	const originalFetch = globalThis.fetch
	globalThis.fetch = Object.assign(
		mock((_input: string | URL | Request, init?: RequestInit) => {
			const body = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>
			return Promise.resolve(
				new Response(JSON.stringify(handler(body)), {
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

function withService<A>(
	run: (service: typeof HyperliquidService.Service) => Effect.Effect<A, Error>,
) {
	return Effect.runPromise(
		Effect.gen(function* () {
			const service = yield* HyperliquidService
			return yield* run(service)
		}).pipe(Effect.provide(HyperliquidServiceLive)),
	)
}

describe('perps live market-data contract', () => {
	it('surfaces live mark/funding and separates venue leverage from the Suwappu quote cap', async () => {
		await withMockFetch(
			(body) => {
				expect(body.type).toBe('metaAndAssetCtxs')
				return LIVE_CONTEXT
			},
			async () => {
				const markets = await withService((service) => service.getMarkets())
				const eth = markets.find((market) => market.asset === 'ETH')
				expect(eth).toEqual({
					name: 'ETH-USD',
					asset: 'ETH',
					szDecimals: 4,
					maxLeverage: 20,
					venueMaxLeverage: 25,
					markPrice: 3200,
					fundingRate: 0.000125,
				})
			},
		)
	})

	it('quotes from the live midpoint/funding context and enforces the effective market cap', async () => {
		await withMockFetch(
			() => LIVE_CONTEXT,
			async () => {
				const quote = await withService((service) => service.getQuote('ETH-USD', 'long', 1, 20))
				expect(quote.entryPrice).toBe(3199)
				expect(quote.fundingRate).toBe(0.000125)

				await expect(
					withService((service) => service.getQuote('ETH-USD', 'long', 1, 21)),
				).rejects.toThrow('Leverage must be 1-20x for ETH-USD')
			},
		)
	})

	it('attaches the current market funding rate to position reads', async () => {
		await withMockFetch(
			(body) => {
				if (body.type === 'metaAndAssetCtxs') return LIVE_CONTEXT
				if (body.type === 'clearinghouseState') {
					return {
						assetPositions: [
							{
								position: {
									coin: 'ETH',
									szi: '-2',
									entryPx: '3000',
									positionValue: '6400',
									unrealizedPnl: '-100',
									liquidationPx: '3600',
									leverage: { value: '5' },
									marginUsed: '1280',
								},
							},
						],
					}
				}
				throw new Error(`Unexpected Hyperliquid request: ${String(body.type)}`)
			},
			async () => {
				const positions = await withService((service) =>
					service.getPositions('0x1111111111111111111111111111111111111111'),
				)
				expect(positions[0]?.side).toBe('short')
				expect(positions[0]?.markPrice).toBe(3200)
				expect(positions[0]?.fundingRate).toBe(0.000125)
			},
		)
	})

	it('fails closed on malformed funding instead of inventing a zero', async () => {
		const malformed = [
			LIVE_CONTEXT[0],
			[{ ...LIVE_CONTEXT[1][0], funding: 'n/a' }, LIVE_CONTEXT[1][1]],
		]
		await withMockFetch(
			() => malformed,
			async () => {
				await expect(withService((service) => service.getMarkets())).rejects.toThrow(
					'ETH funding rate is invalid',
				)
			},
		)
	})
})
