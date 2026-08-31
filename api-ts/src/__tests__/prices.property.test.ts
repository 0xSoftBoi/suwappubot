import { afterEach, describe, expect, it, setSystemTime } from 'bun:test'
import fc from 'fast-check'
import { solanaMintUsdValue } from '../lib/prices'

// Property test for the pure decimals math inside solanaMintUsdValue
// (api-ts/src/lib/prices.ts), per Phase 2 of docs/plans/oss-parity.md.
//
// solanaMintUsdValue itself is NOT pure -- it calls fetchTokenPrices(), which
// does a real network fetch (with a live-price cache + 24h stale fallback)
// and there's no separately-exported pure function to import the decimals
// math from directly. So this reuses the exact fetch-mocking pattern already
// established in solanaMintUsdValue.test.ts: mock `global.fetch` to return a
// fixed USD price, then fuzz `rawAmount` and assert the two properties that
// ARE pure given a fixed price -- linear scaling and non-negativity. This is
// the same "mock fetch, not more" boundary the existing test file draws; no
// additional network mocking is introduced.
//
// Uses the RAY mint specifically because it is NOT touched by
// solanaMintUsdValue.test.ts (SOL/WSOL, USDC, JUP, WIF, PYTH, MNDE are) --
// lib/prices.ts's live-price and stale-fallback caches are module-level
// singletons keyed by symbol, shared across every test file in the same
// `bun test` process, so reusing an already-exercised mint could silently
// serve a stale cached price from a different file instead of this file's
// mock.
const RAY_MINT = '4k3Dyjzvzp8eMZWUXbBCjEvwSkkk59S5iCNLY3QrkX6R'
const RAY_DECIMALS = 6
const RAY_USD_PRICE = 1.75

const originalFetch = global.fetch

function mockRayPriceFetch() {
	// @ts-expect-error - test stub
	global.fetch = async () =>
		new Response(JSON.stringify({ raydium: { usd: RAY_USD_PRICE } }), {
			status: 200,
			headers: { 'content-type': 'application/json' },
		})
}

afterEach(() => {
	global.fetch = originalFetch
	setSystemTime()
})

describe('solanaMintUsdValue: pure decimals math (property)', () => {
	it('never produces a negative valueUsd for any positive raw amount', () => {
		mockRayPriceFetch()
		fc.assert(
			fc.asyncProperty(
				// Raw on-chain integer amount (token's smallest unit), bounded well
				// below Number.MAX_SAFE_INTEGER so `/ 10 ** decimals` stays exact
				// enough for the property, not testing float-precision edges.
				fc.integer({ min: 1, max: 10 ** 15 }),
				async (rawUnits) => {
					const result = await solanaMintUsdValue(RAY_MINT, String(rawUnits))
					expect(result.priced).toBe(true)
					if (result.priced) {
						expect(result.valueUsd).toBeGreaterThanOrEqual(0)
					}
				},
			),
			{ numRuns: 50 },
		)
	})

	it('scales linearly with amount: valueUsd(k * amount) === k * valueUsd(amount) for integer k', async () => {
		mockRayPriceFetch()
		await fc.assert(
			fc.asyncProperty(
				fc.integer({ min: 1, max: 10 ** 12 }),
				fc.integer({ min: 1, max: 50 }),
				async (baseUnits, k) => {
					const base = await solanaMintUsdValue(RAY_MINT, String(baseUnits))
					const scaled = await solanaMintUsdValue(RAY_MINT, String(baseUnits * k))
					expect(base.priced).toBe(true)
					expect(scaled.priced).toBe(true)
					if (base.priced && scaled.priced) {
						// Floating-point scaling -- assert closeness, not bit-exact
						// equality (both sides go through the same `amount / 10**decimals
						// * price` formula, so this is checking the SAME rounding
						// behavior is applied consistently, not re-deriving the formula).
						expect(scaled.valueUsd).toBeCloseTo(base.valueUsd * k, 6)
					}
				},
			),
			{ numRuns: 50 },
		)
	})

	it('valueUsd matches the closed-form (rawAmount / 10**decimals) * price for every fuzzed amount', () => {
		mockRayPriceFetch()
		fc.assert(
			fc.asyncProperty(fc.integer({ min: 1, max: 10 ** 15 }), async (rawUnits) => {
				const result = await solanaMintUsdValue(RAY_MINT, String(rawUnits))
				expect(result.priced).toBe(true)
				if (result.priced) {
					const expected = (rawUnits / 10 ** RAY_DECIMALS) * RAY_USD_PRICE
					expect(result.valueUsd).toBeCloseTo(expected, 6)
				}
			}),
			{ numRuns: 50 },
		)
	})
})
