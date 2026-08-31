import { afterAll, afterEach, describe, expect, it, setSystemTime } from 'bun:test'
import { solanaMintUsdValue } from '../lib/prices'

// Guards the Solana USD-valuation fix for the MCP/agent spend-cap gate
// (docs/security/mcp-authorization-checklist.md §1 — previously hard-coded
// `valueUsd: 0` in enforcePolicyGateForFreshQuote's Solana branch, agent.ts).
// `solanaMintUsdValue` must return a REAL priced result for registry tokens
// with CoinGecko coverage, and a discriminated `{ priced: false, reason }`
// (never a silent 0) for anything it can't price — callers are required to
// fail closed on `priced: false`, distinguishing 'unknown_mint' (not in the
// registry at all) from 'price_unavailable' (a known token the feed just
// couldn't price right now).

const SOL_MINT = 'So11111111111111111111111111111111111111112'
const USDC_MINT = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v'
// Distinct mints per test below so the shared 60s live-price cache and 24h
// stale-fallback cache in lib/prices.ts (both keyed by symbol) can't leak a
// previously-cached price into a later test and mask a regression.
const JUP_MINT = 'JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN'
const WIF_MINT = 'EKpQGSJtjMFqKZ9KQanSqYXRcF8fBopzLHYxdM65zcjm'
const PYTH_MINT = 'HZ1JovNiVvGrGNiiYvEozEVgZ58xaU3RKwX8eACQBCt3'
const MNDE_MINT = 'MNDEFzGvMt87ueuHvVU9VcTqsAP5b3fTGPsHuuPA5ey'

const originalFetch = global.fetch

function mockPriceFetch(prices: Record<string, { usd: number; usd_24h_change?: number }>) {
	// @ts-expect-error - test stub
	global.fetch = async () =>
		new Response(JSON.stringify(prices), { status: 200, headers: { 'content-type': 'application/json' } })
}

afterEach(() => {
	global.fetch = originalFetch
	setSystemTime() // restore real time after any test that fast-forwarded it
})

afterAll(() => {
	global.fetch = originalFetch
	setSystemTime()
})

describe('solanaMintUsdValue (lib/prices.ts)', () => {
	it('prices a known mint (SOL) using its registry decimals and a live-fetched USD price', async () => {
		mockPriceFetch({ solana: { usd: 150 } })
		// 2 SOL, 9 decimals
		const result = await solanaMintUsdValue(SOL_MINT, String(2 * 10 ** 9))
		expect(result).toEqual({ priced: true, valueUsd: 300 })
	})

	it('prices a 6-decimal stablecoin mint (USDC) correctly', async () => {
		mockPriceFetch({ 'usd-coin': { usd: 1 } })
		const result = await solanaMintUsdValue(USDC_MINT, String(50 * 10 ** 6))
		expect(result).toEqual({ priced: true, valueUsd: 50 })
	})

	it('resolves the SOL/WSOL shared mint to the priced "sol" CoinGecko id, never a bare "wsol" alias', async () => {
		// SOL and WSOL share one mint address in SOLANA_TOKENS (native SOL has no
		// separate wrapped mint on Solana) — only 'sol' has CoinGecko coverage,
		// so the lookup must prefer it over the first-declared registry entry.
		// Advance past the 60s live-price TTL first so the earlier SOL-pricing
		// test above can't serve this from cache and skip the live fetch this
		// test is actually asserting against.
		setSystemTime(Date.now() + 65_000)
		const captured: { ids: string | null } = { ids: null }
		// @ts-expect-error - test stub
		global.fetch = async (input: any) => {
			captured.ids = new URL(String(input)).searchParams.get('ids')
			return new Response(JSON.stringify({ solana: { usd: 200 } }), { status: 200 })
		}
		const result = await solanaMintUsdValue(SOL_MINT, String(1 * 10 ** 9))
		expect(result).toEqual({ priced: true, valueUsd: 200 })
		expect(captured.ids).toBe('solana')
	})

	it('returns unknown_mint for a mint not in the SOLANA_TOKENS registry at all', async () => {
		mockPriceFetch({ solana: { usd: 150 } })
		const result = await solanaMintUsdValue('SomeUnknownMintAddressNotInRegistry1111111', '1000000')
		expect(result).toEqual({ priced: false, reason: 'unknown_mint' })
	})

	it('returns price_unavailable (not unknown_mint) for a registered mint the feed fails to price, with no stale fallback yet', async () => {
		// @ts-expect-error - test stub
		global.fetch = async () => new Response('', { status: 500 })
		const result = await solanaMintUsdValue(WIF_MINT, String(10 ** 6))
		expect(result).toEqual({ priced: false, reason: 'price_unavailable' })
	})

	it('returns price_unavailable rather than 0 when the price feed times out/errors with no stale fallback', async () => {
		// @ts-expect-error - test stub
		global.fetch = async () => new Response('', { status: 500 })
		const result = await solanaMintUsdValue(JUP_MINT, String(1 * 10 ** 6))
		expect(result).toEqual({ priced: false, reason: 'price_unavailable' })
	})

	it('serves a last-known-good (stale, past the 60s live TTL) price when the live feed later fails, instead of failing to price', async () => {
		mockPriceFetch({ marinade: { usd: 0.02 } })
		const first = await solanaMintUsdValue(MNDE_MINT, String(5 * 10 ** 9))
		expect(first).toEqual({ priced: true, valueUsd: 0.1 })

		// Advance past the 60s live-price cache TTL so the live-cache short
		// circuit at the top of fetchTokenPrices() can no longer serve this...
		setSystemTime(Date.now() + 65_000)
		// ...and simulate CoinGecko being down.
		// @ts-expect-error - test stub
		global.fetch = async () => {
			throw new Error('network down')
		}

		const second = await solanaMintUsdValue(MNDE_MINT, String(5 * 10 ** 9))
		// Still priced — served from the 24h stale-fallback cache populated by
		// the first call, not a failure. This is what bounds the blast radius
		// of a CoinGecko outage on the Solana spend-cap policy gate.
		expect(second).toEqual({ priced: true, valueUsd: 0.1 })
	})

	it('returns unknown_mint for a missing mint, and price_unavailable for a missing amount on an otherwise priceable mint', async () => {
		expect(await solanaMintUsdValue(undefined, '1000')).toEqual({ priced: false, reason: 'unknown_mint' })
		expect(await solanaMintUsdValue(null, null)).toEqual({ priced: false, reason: 'unknown_mint' })
		mockPriceFetch({ pyth: { usd: 0.5 } })
		expect(await solanaMintUsdValue(PYTH_MINT, undefined)).toEqual({ priced: false, reason: 'price_unavailable' })
	})
})
