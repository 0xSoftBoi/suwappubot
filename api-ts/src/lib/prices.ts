/**
 * Shared token price fetching with cache.
 * Consolidates duplicate price fetching from agent.ts and tokens.ts.
 */

import { TTLCache } from './cache'

// CoinGecko ID mapping
const COINGECKO_IDS: Record<string, string> = {
	eth: 'ethereum', sol: 'solana', bnb: 'binancecoin', usdc: 'usd-coin',
	usdt: 'tether', btc: 'bitcoin', dai: 'dai', wbtc: 'wrapped-bitcoin',
	arb: 'arbitrum', op: 'optimism', avax: 'avalanche-2', matic: 'matic-network',
	weth: 'weth', bonk: 'bonk', jup: 'jupiter-exchange-solana', ray: 'raydium',
}

export const SUPPORTED_PRICE_SYMBOLS = Object.keys(COINGECKO_IDS).map((s) => s.toUpperCase())

interface PriceEntry {
	usd: number
	change_24h: number | null
}

const priceCache = new TTLCache<PriceEntry>(60_000) // 60s TTL

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
				`https://api.coingecko.com/api/v3/simple/price?ids=${ids}&vs_currencies=usd&include_24hr_change=true`
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
						result[sym.toUpperCase()] = entry
					}
				}
			}
		} catch {
			// CoinGecko unavailable, return what we have from cache
		}
	}

	return result
}

// --- Solana mint pricing (Jupiter Price API) ---
// Used to fill PolicyIntent.valueUsd for Solana swaps, whose quotes carry no USD
// value (see agent.ts /swap policy gate). Short timeout + fail-to-null so a
// pricing hiccup never blocks/delays the swap path itself — callers treat null
// as "unpriced" and, when the agent has no USD-denominated policy rule, fall
// back to $0 with an audit note (fail-open is safe there); when a USD rule DOES
// apply, callers must force require_approval instead of ever gating at a fake
// $0 (see policyGate/agent.ts — this module only fetches the price, callers own
// the fail-open-vs-fail-closed decision).
//
// NOTE: api.jup.ag/price/v2 is DEAD (verified 404, Jul 2026) — Jupiter migrated
// to lite-api.jup.ag/price/v3, whose response shape is a flat
// `{ [mint]: { usdPrice: number } }` map (no nested `.price` string).
const mintPriceCache = new TTLCache<number>(30_000) // 30s TTL

export async function fetchMintPriceUsd(mint: string): Promise<number | null> {
	const cached = mintPriceCache.get(mint)
	if (cached !== null) return cached

	try {
		const res = await fetch(`https://lite-api.jup.ag/price/v3?ids=${encodeURIComponent(mint)}`, {
			signal: AbortSignal.timeout(4000),
		})
		if (!res.ok) return null
		const data = (await res.json()) as Record<string, { usdPrice?: number } | null>
		const price = data?.[mint]?.usdPrice
		if (price == null || !Number.isFinite(price)) return null
		mintPriceCache.set(mint, price)
		return price
	} catch {
		return null
	}
}
