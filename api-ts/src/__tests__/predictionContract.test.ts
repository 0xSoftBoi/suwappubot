import { describe, expect, it, mock } from 'bun:test'
import { Effect } from 'effect'
import { PlaceOrderSchema } from '../routes/validators'
import { PolymarketService, PolymarketServiceLive } from '../services/PolymarketService'

describe('prediction order request contract', () => {
	const valid = {
		tokenId: 'yes-token',
		price: '0.42',
		size: '10',
		side: 'BUY' as const,
	}

	it('accepts the supported GTC request fields', () => {
		expect(PlaceOrderSchema.safeParse(valid).success).toBe(true)
	})

	it('rejects legacy order options instead of silently ignoring them', () => {
		expect(PlaceOrderSchema.safeParse({ ...valid, expiration: 1_800_000_000 }).success).toBe(false)
		expect(PlaceOrderSchema.safeParse({ ...valid, feeRateBps: 25 }).success).toBe(false)
	})
})

describe('prediction order-book response contract', () => {
	it('maps the venue sell side to asks', async () => {
		const originalFetch = globalThis.fetch
		globalThis.fetch = Object.assign(
			mock((input: string | URL | Request) => {
				const url = String(input instanceof Request ? input.url : input)
				if (url.includes('/book?')) {
					return Promise.resolve(new Response(JSON.stringify({
						market: 'market-1',
						asset_id: 'yes-token',
						bids: [{ price: '0.41', size: '10' }],
						asks: [{ price: '0.43', size: '8' }],
						last_trade_price: '0.42',
						tick_size: '0.01',
					}), { headers: { 'content-type': 'application/json' } }))
				}
				return Promise.resolve(new Response(JSON.stringify({ mid: '0.42' }), {
					headers: { 'content-type': 'application/json' },
				}))
			}),
			{ preconnect: originalFetch.preconnect },
		) as typeof fetch

		try {
			const book = await Effect.runPromise(
				Effect.gen(function* () {
					const service = yield* PolymarketService
					return yield* service.getOrderbook('yes-token')
				}).pipe(Effect.provide(PolymarketServiceLive)),
			)

			expect(book.asks).toEqual([{ price: '0.43', size: '8' }])
			expect(book).not.toHaveProperty('tasks')
		} finally {
			globalThis.fetch = originalFetch
		}
	})
})
