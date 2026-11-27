/**
 * Shared token price fetching with cache.
 * Consolidates duplicate price fetching from agent.ts and tokens.ts.
 */

import { decodeFunctionResult, encodeFunctionData, parseAbi } from 'viem'
import { RPC_ENDPOINTS } from '../config/chains'
import { TTLCache } from './cache'

// CoinGecko ID mapping. Exported (not just used internally) so routes/data.ts's
// /v1/data/reference/resolve can surface the coingecko id for a symbol without
// a second copy of this map.
export const COINGECKO_IDS: Record<string, string> = {
	eth: 'ethereum', sol: 'solana', bnb: 'binancecoin', usdc: 'usd-coin',
	usdt: 'tether', btc: 'bitcoin', dai: 'dai', wbtc: 'wrapped-bitcoin',
	arb: 'arbitrum', op: 'optimism', avax: 'avalanche-2', matic: 'matic-network',
	weth: 'weth', bonk: 'bonk', jup: 'jupiter-exchange-solana', ray: 'raydium',
	// Bank non-USD stablecoins. Contract addresses in services/bank/assets.ts were checked against CoinGecko's
	// per-chain platform maps for each id (EURC eth/base/sol, BRZ polygon/base, MXNB arbitrum, XSGD eth/polygon).
	eurc: 'euro-coin', brz: 'brz', mxnb: 'mxnb', xsgd: 'xsgd',
}

/**
 * Onchain Chainlink FX feeds for assets CoinGecko does not list at the address we hold. Each feed is verified at read
 * time (description() must match, decimals() is read, answer must be positive) and refused when older than maxAgeSec.
 * JPYC (Ethereum 0xE7C3...3c29, symbol() = "JPYC") is a 1:1 JPY token, so JPY/USD is its rate. Feed address, description
 * ("JPY / USD") and 8 decimals were verified onchain 2026-11-27; Chainlink heartbeat is 24h, hence the 25h limit.
 */
export const CHAINLINK_FX: Record<string, { chain: string; feed: string; description: string; maxAgeSec: number }> = {
	jpyc: { chain: 'ethereum', feed: '0xBcE206caE7f0ec07b545EdDe332A47C2F75bbeb3', description: 'JPY / USD', maxAgeSec: 90_000 },
}
const feedAbi = parseAbi([
	'function description() view returns (string)',
	'function decimals() view returns (uint8)',
	'function latestRoundData() view returns (uint80,int256,uint256,uint256,uint80)',
])
async function feedCall<T>(chain: string, to: string, fn: 'description' | 'decimals' | 'latestRoundData'): Promise<T> {
	const url = RPC_ENDPOINTS[chain]
	if (!url) throw new Error(`No RPC endpoint for ${chain}`)
	const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_call', params: [{ to, data: encodeFunctionData({ abi: feedAbi, functionName: fn } as never) }, 'latest'] }), signal: AbortSignal.timeout(10_000) })
	const j = (await res.json()) as { result?: `0x${string}`; error?: { message: string } }
	if (!j.result || j.result === '0x') throw new Error(j.error?.message ?? 'empty feed result')
	return decodeFunctionResult({ abi: feedAbi, functionName: fn, data: j.result } as never) as T
}
async function chainlinkUsd(sym: string): Promise<PriceEntry | null> {
	const cfg = CHAINLINK_FX[sym]
	if (!cfg) return null
	try {
		const [desc, dec, round] = await Promise.all([
			feedCall<string>(cfg.chain, cfg.feed, 'description'),
			feedCall<number>(cfg.chain, cfg.feed, 'decimals'),
			feedCall<readonly [bigint, bigint, bigint, bigint, bigint]>(cfg.chain, cfg.feed, 'latestRoundData'),
		])
		if (desc !== cfg.description || round[1] <= 0n) return null
		if (Date.now() / 1000 - Number(round[3]) > cfg.maxAgeSec) return null // stale: no rate rather than a wrong one
		return { usd: Number(round[1]) / 10 ** Number(dec), change_24h: null }
	} catch {
		return null
	}
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
		} else if (CHAINLINK_FX[lower]) {
			const e = await chainlinkUsd(lower)
			if (e) {
				priceCache.set(lower, e)
				result[sym.toUpperCase()] = e
			}
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
