/**
 * Shared token price fetching with cache.
 * Consolidates duplicate price fetching from agent.ts and tokens.ts.
 */

import { TTLCache } from './cache'

// CoinGecko ID mapping. Exported (not just used internally) so routes/data.ts's
// /v1/data/reference/resolve can surface the coingecko id for a symbol without
// a second copy of this map.
export const COINGECKO_IDS: Record<string, string> = {
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
				// COINGECKO_BASE_URL lets tests/self-hosted deployments point at a
				// mock or pro endpoint without a code change.
				`${process.env.COINGECKO_BASE_URL ?? 'https://api.coingecko.com'}/api/v3/simple/price?ids=${ids}&vs_currencies=usd&include_24hr_change=true`
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
