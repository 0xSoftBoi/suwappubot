/**
 * Shared token price fetching with cache.
 * Consolidates duplicate price fetching from agent.ts and tokens.ts.
 */

import { TTLCache } from './cache'
import { SOLANA_TOKENS } from '../config/tokenRegistry'

// CoinGecko ID mapping. Exported (not just used internally) so routes/data.ts's
// /v1/data/reference/resolve can surface the coingecko id for a symbol without
// a second copy of this map.
//
// Covers the full SOLANA_TOKENS registry (config/tokenRegistry.ts) so
// solanaMintUsdValue() below can price every registry token, not just the
// original subset. Every id was verified live against
// GET /api/v3/simple/price before being added here (2026-08-31):
// dogwifcoin, pyth-network, jito-governance-token, orca, marinade, msol,
// jito-staked-sol all returned a non-null `usd` price.
export const COINGECKO_IDS: Record<string, string> = {
	eth: 'ethereum', sol: 'solana', bnb: 'binancecoin', usdc: 'usd-coin',
	usdt: 'tether', btc: 'bitcoin', dai: 'dai', wbtc: 'wrapped-bitcoin',
	arb: 'arbitrum', op: 'optimism', avax: 'avalanche-2', matic: 'matic-network',
	weth: 'weth', bonk: 'bonk', jup: 'jupiter-exchange-solana', ray: 'raydium',
	wif: 'dogwifcoin', pyth: 'pyth-network', jto: 'jito-governance-token',
	orca: 'orca', mnde: 'marinade', msol: 'msol', jitosol: 'jito-staked-sol',
}

export const SUPPORTED_PRICE_SYMBOLS = Object.keys(COINGECKO_IDS).map((s) => s.toUpperCase())

interface PriceEntry {
	usd: number
	change_24h: number | null
}

// Live price cache — short TTL, drives normal /prices responses.
const priceCache = new TTLCache<PriceEntry>(60_000) // 60s TTL
// Last-known-good fallback — long TTL, independent of the live cache above.
// Populated on every successful fetch; consulted only when the live call
// below fails or times out, so an outbound CoinGecko outage degrades pricing
// to "up to 24h stale" instead of "nothing" for symbols we've seen recently.
// This directly bounds the blast radius of a CoinGecko outage on the Solana
// spend-cap policy gate (enforcePolicyGateForFreshQuote): the gate would
// otherwise 400-block every USD-capped Solana trade until the feed recovers.
const staleFallbackCache = new TTLCache<PriceEntry>(24 * 60 * 60 * 1000) // 24h TTL

// Outbound call budget. This feeds a money-path policy gate (Solana spend
// caps) in addition to the plain /prices display endpoint — an unbounded or
// slow-to-time-out fetch here would stall every gated Solana swap attempt,
// not just a read-only price lookup.
const COINGECKO_FETCH_TIMEOUT_MS = 2000

export async function fetchTokenPrices(symbols: string[]): Promise<Record<string, PriceEntry>> {
	const result: Record<string, PriceEntry> = {}
	const toFetch: string[] = []

	for (const sym of symbols) {
		const lower = sym.toLowerCase()
		const cached = priceCache.get(lower)
		if (cached) {
			result[sym.toUpperCase()] = cached
		} else if (COINGECKO_IDS[lower]) {
			toFetch.push(lower)
		}
	}

	if (toFetch.length > 0) {
		const ids = toFetch.map((s) => COINGECKO_IDS[s]).join(',')
		try {
			const res = await fetch(
				// COINGECKO_BASE_URL lets tests/self-hosted deployments point at a
				// mock or pro endpoint without a code change.
				`${process.env.COINGECKO_BASE_URL ?? 'https://api.coingecko.com'}/api/v3/simple/price?ids=${ids}&vs_currencies=usd&include_24hr_change=true`,
				{ signal: AbortSignal.timeout(COINGECKO_FETCH_TIMEOUT_MS) },
			)
			if (res.ok) {
				const data = await res.json() as Record<string, { usd?: number; usd_24h_change?: number }>
				for (const sym of toFetch) {
					const cgId = COINGECKO_IDS[sym]
					if (!cgId) continue
					const priceData = data[cgId]
					if (priceData?.usd !== undefined) {
						const entry: PriceEntry = { usd: priceData.usd, change_24h: priceData.usd_24h_change ?? null }
						priceCache.set(sym, entry)
						staleFallbackCache.set(sym, entry)
						result[sym.toUpperCase()] = entry
					}
				}
			}
		} catch {
			// CoinGecko unavailable or timed out (AbortSignal.timeout above) — fall
			// through to the stale-fallback pass below rather than returning nothing.
		}

		// Anything the live call didn't resolve (outage, timeout, or a symbol
		// missing from this response) falls back to the last successful price we
		// have, up to 24h old, instead of being silently omitted.
		for (const sym of toFetch) {
			if (result[sym.toUpperCase()]) continue
			const stale = staleFallbackCache.get(sym)
			if (stale) result[sym.toUpperCase()] = stale
		}
	}

	return result
}

/** Why solanaMintUsdValue couldn't produce a USD value. Callers use this to
 * pick a distinct, honest block reason instead of one generic message. */
export type SolanaPriceUnavailableReason =
	/** The mint address doesn't match anything in the SOLANA_TOKENS registry at all. */
	| 'unknown_mint'
	/** The mint IS a known registry token, but no USD price could be produced for
	 * it (no CoinGecko id configured for it, the feed call failed with no stale
	 * fallback available, or the raw amount was unparseable). */
	| 'price_unavailable'

export type SolanaPriceResult =
	| { priced: true; valueUsd: number }
	| { priced: false; reason: SolanaPriceUnavailableReason }

/**
 * Real USD valuation for a Solana (Jupiter) quote leg, for policy-gate spend
 * caps. Used by `enforcePolicyGateForFreshQuote`'s Solana branch
 * (api-ts/src/routes/agent.ts) so daily/session USD caps are no longer inert
 * for Solana trades (previously hard-coded to `valueUsd: 0`).
 *
 * Resolves the mint address against the known `SOLANA_TOKENS` registry, then
 * prices it via the same CoinGecko-backed `fetchTokenPrices` used for EVM/
 * portfolio USD display elsewhere in this codebase — there is no separate
 * "trustworthy" price oracle to invent here, so this reuses the existing one.
 *
 * A mint can map to more than one registry symbol (SOL and WSOL share the
 * native mint `So111...112`) — prefer whichever symbol actually has
 * CoinGecko coverage rather than the first one found.
 *
 * Returns `{ priced: false, ... }` (never a silent 0) when a value can't be
 * produced — callers MUST treat that as "refuse to gate", to avoid silently
 * bypassing USD-based caps.
 */
export async function solanaMintUsdValue(
	mint: string | undefined | null,
	rawAmount: string | undefined | null,
): Promise<SolanaPriceResult> {
	if (!mint) return { priced: false, reason: 'unknown_mint' }

	let match: { symbol: string; decimals: number } | null = null
	let registryHit = false
	for (const [symbol, meta] of Object.entries(SOLANA_TOKENS)) {
		if (meta.address !== mint) continue
		registryHit = true
		if (COINGECKO_IDS[symbol.toLowerCase()]) {
			match = { symbol, decimals: meta.decimals }
			break
		}
		if (!match) match = { symbol, decimals: meta.decimals }
	}
	if (!registryHit) return { priced: false, reason: 'unknown_mint' }
	if (!match || !COINGECKO_IDS[match.symbol.toLowerCase()]) {
		return { priced: false, reason: 'price_unavailable' }
	}
	if (!rawAmount) return { priced: false, reason: 'price_unavailable' }

	const prices = await fetchTokenPrices([match.symbol])
	const entry = prices[match.symbol.toUpperCase()]
	if (!entry || !Number.isFinite(entry.usd) || entry.usd <= 0) {
		return { priced: false, reason: 'price_unavailable' }
	}

	const amount = Number(rawAmount)
	if (!Number.isFinite(amount) || amount <= 0) return { priced: false, reason: 'price_unavailable' }

	const value = (amount / 10 ** match.decimals) * entry.usd
	if (!Number.isFinite(value) || value <= 0) return { priced: false, reason: 'price_unavailable' }
	return { priced: true, valueUsd: value }
}
