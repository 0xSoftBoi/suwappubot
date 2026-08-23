/**
 * Stage 1 — read. Screening and pricing for the autopilot.
 *
 * Plain async functions rather than Effect services: they are I/O-only and the
 * service wraps them with Effect.tryPromise, matching src/lib/marketDataQueries.ts.
 */
import { logger } from '../../lib/logger'
import type { Candidate, TokenSecurity } from './types'

const DEXSCREENER = 'https://api.dexscreener.com'
const GECKOTERMINAL = 'https://api.geckoterminal.com/api/v2'
const FETCH_TIMEOUT_MS = 8_000
/**
 * Token security gets its own, much larger budget. It is not a price lookup:
 * the Python stack walks the deployer's history, holder distribution and
 * bundle/snipe clustering, and on a cold token that legitimately takes tens of
 * seconds. Observed on dev: every scan hit the 8s market-fetch timeout, so every
 * entry was refused at `security_scan_present` — the gate behaving correctly on
 * a budget that was simply too small for the work.
 */
const SECURITY_TIMEOUT_MS = 30_000

interface DexPair {
	chainId?: string
	pairAddress?: string
	baseToken?: { address?: string; symbol?: string; name?: string }
	priceUsd?: string
	liquidity?: { usd?: number }
	volume?: { h24?: number }
	priceChange?: { m5?: number; h1?: number; h24?: number }
	fdv?: number
	marketCap?: number
	pairCreatedAt?: number
}

async function getJson<T>(url: string): Promise<T | null> {
	try {
		const res = await fetch(url, {
			headers: { Accept: 'application/json' },
			signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
		})
		if (!res.ok) {
			logger.warn({ url, status: res.status }, 'autopilot: market fetch failed')
			return null
		}
		return (await res.json()) as T
	} catch (err) {
		logger.warn({ url, err: String(err) }, 'autopilot: market fetch threw')
		return null
	}
}

/** DexScreener chain ids we can actually execute on, mapped to our chain names. */
const CHAIN_ALIASES: Record<string, string> = {
	base: 'base',
	solana: 'solana',
	arbitrum: 'arbitrum',
	ethereum: 'ethereum',
	bsc: 'bsc',
	polygon: 'polygon',
	optimism: 'optimism',
	avalanche: 'avalanche',
}

export function normalizeChain(dexChainId: string | undefined): string | null {
	if (!dexChainId) return null
	return CHAIN_ALIASES[dexChainId.toLowerCase()] ?? null
}

export function pairToCandidate(pair: DexPair): Candidate | null {
	const chain = normalizeChain(pair.chainId)
	const address = pair.baseToken?.address
	const symbol = pair.baseToken?.symbol
	const priceUsd = Number(pair.priceUsd)
	if (!chain || !address || !symbol || !Number.isFinite(priceUsd) || priceUsd <= 0) return null

	const candidate: Candidate = {
		chain,
		tokenAddress: address,
		symbol,
		priceUsd,
		liquidityUsd: pair.liquidity?.usd ?? 0,
		volume24hUsd: pair.volume?.h24 ?? 0,
	}
	const mcap = pair.marketCap ?? pair.fdv
	if (typeof mcap === 'number') candidate.marketCapUsd = mcap
	if (typeof pair.priceChange?.m5 === 'number') candidate.priceChange5mPct = pair.priceChange.m5
	if (typeof pair.priceChange?.h1 === 'number') candidate.priceChange1hPct = pair.priceChange.h1
	if (typeof pair.priceChange?.h24 === 'number') candidate.priceChange24hPct = pair.priceChange.h24
	if (typeof pair.pairCreatedAt === 'number' && pair.pairCreatedAt > 0) {
		candidate.ageMinutes = Math.max(0, Math.round((Date.now() - pair.pairCreatedAt) / 60_000))
	}
	return candidate
}

/** Keep the deepest pair per token — that is the one we would actually route through. */
export function dedupeByToken(candidates: Candidate[]): Candidate[] {
	const best = new Map<string, Candidate>()
	for (const c of candidates) {
		const key = `${c.chain}:${c.tokenAddress.toLowerCase()}`
		const existing = best.get(key)
		if (!existing || c.liquidityUsd > existing.liquidityUsd) best.set(key, c)
	}
	return [...best.values()]
}

/**
 * GeckoTerminal network ids, keyed by our chain names.
 *
 * This is the per-chain discovery surface. DexScreener has no "top pools on
 * chain X" endpoint — its search ranks globally (a Base screen came back as the
 * quote assets themselves) and token-pairs returns only one token's own pairs.
 * GeckoTerminal ranks pools within a network by 24h volume, which is the
 * question a chain-scoped agent is actually asking.
 */
const GECKO_NETWORKS: Record<string, string> = {
	base: 'base',
	solana: 'solana',
	arbitrum: 'arbitrum',
	ethereum: 'eth',
	bsc: 'bsc',
	polygon: 'polygon_pos',
	optimism: 'optimism',
	avalanche: 'avax',
}

interface GeckoPool {
	attributes?: {
		name?: string
		base_token_price_usd?: string
		reserve_in_usd?: string
		fdv_usd?: string
		market_cap_usd?: string
		pool_created_at?: string
		volume_usd?: { h24?: string }
		price_change_percentage?: { m5?: string; h1?: string; h24?: string }
	}
	relationships?: { base_token?: { data?: { id?: string } } }
}

function num(v: string | undefined): number | undefined {
	if (v === undefined || v === null) return undefined
	const n = Number(v)
	return Number.isFinite(n) ? n : undefined
}

export function geckoPoolToCandidate(pool: GeckoPool, chain: string): Candidate | null {
	const a = pool.attributes
	if (!a) return null

	// "VELVET / USDC 0.01%" — the base token is the half before the slash.
	const symbol = (a.name ?? '').split('/')[0]?.trim()
	// "base_0xabc…" — the network prefix is redundant, we already know the chain.
	const rawId = pool.relationships?.base_token?.data?.id ?? ''
	const address = rawId.includes('_') ? rawId.slice(rawId.indexOf('_') + 1) : rawId
	const priceUsd = num(a.base_token_price_usd)

	if (!symbol || !address || priceUsd === undefined || priceUsd <= 0) return null

	const candidate: Candidate = {
		chain,
		tokenAddress: address,
		symbol,
		priceUsd,
		liquidityUsd: num(a.reserve_in_usd) ?? 0,
		volume24hUsd: num(a.volume_usd?.h24) ?? 0,
	}
	const mcap = num(a.market_cap_usd) ?? num(a.fdv_usd)
	if (mcap !== undefined) candidate.marketCapUsd = mcap
	const m5 = num(a.price_change_percentage?.m5)
	if (m5 !== undefined) candidate.priceChange5mPct = m5
	const h1 = num(a.price_change_percentage?.h1)
	if (h1 !== undefined) candidate.priceChange1hPct = h1
	const h24 = num(a.price_change_percentage?.h24)
	if (h24 !== undefined) candidate.priceChange24hPct = h24
	if (a.pool_created_at) {
		const created = Date.parse(a.pool_created_at)
		if (Number.isFinite(created)) {
			candidate.ageMinutes = Math.max(0, Math.round((Date.now() - created) / 60_000))
		}
	}
	return candidate
}

/** Top pools on one chain, ranked by 24h volume. */
async function fetchChainPools(chain: string): Promise<Candidate[]> {
	const network = GECKO_NETWORKS[chain]
	if (!network) return []
	const data = await getJson<{ data?: GeckoPool[] }>(
		`${GECKOTERMINAL}/networks/${network}/pools?page=1`,
	)
	return (data?.data ?? [])
		.map((pool) => geckoPoolToCandidate(pool, chain))
		.filter((c): c is Candidate => c !== null)
}

export interface ScreenParams {
	chains: string[]
	minLiquidityUsd: number
	minVolume24hUsd?: number
	limit?: number
	/** Token addresses the agent must never be offered — chiefly its own quote asset. */
	excludeTokens?: string[]
}

/**
 * Quote assets are never candidates.
 *
 * Searching DexScreener for "WETH" returns pairs whose BASE token is WETH, so
 * the search surface hands back the very assets it was asked to quote against.
 * Observed live: a Base agent's first screen returned exactly [USDC, WETH] —
 * an agent proposing to buy the currency it already holds.
 */
export const QUOTE_SYMBOLS = new Set(
	['WETH', 'ETH', 'USDC', 'USDT', 'DAI', 'SOL', 'WSOL', 'WBNB', 'BNB', 'WMATIC', 'WAVAX'].map((s) =>
		s.toLowerCase(),
	),
)

/** True for the assets an agent quotes against, which are never candidates. */
export function isQuoteAsset(symbol: string): boolean {
	return QUOTE_SYMBOLS.has(symbol.trim().toLowerCase())
}

/**
 * Screen the market for tradeable candidates from two surfaces: DexScreener's
 * boosted feed (re-read as real pair data, never promo metadata) and a search
 * over each chain's quote assets, which surfaces deep pairs nobody paid to
 * promote. Both are merged and deduped to the deepest pair per token.
 */
export async function screenCandidates(params: ScreenParams): Promise<Candidate[]> {
	const chains = new Set(params.chains.map((c) => c.toLowerCase()))
	const boosts = await getJson<Array<{ chainId?: string; tokenAddress?: string }>>(
		`${DEXSCREENER}/token-boosts/top/v1`,
	)

	const byChain = new Map<string, string[]>()
	for (const b of Array.isArray(boosts) ? boosts : []) {
		const chain = normalizeChain(b.chainId)
		if (!chain || !chains.has(chain) || !b.tokenAddress) continue
		const list = byChain.get(b.chainId as string) ?? []
		if (list.length < 30 && !list.includes(b.tokenAddress)) list.push(b.tokenAddress)
		byChain.set(b.chainId as string, list)
	}

	const batches = await Promise.all(
		[...byChain.entries()].map(([dexChainId, addresses]) =>
			getJson<{ pairs?: DexPair[] } | DexPair[]>(
				`${DEXSCREENER}/tokens/v1/${dexChainId}/${addresses.join(',')}`,
			),
		),
	)

	// Primary surface: what is actually trading on each requested chain.
	const chainPools = (await Promise.all([...chains].map(fetchChainPools))).flat()

	const excluded = new Set((params.excludeTokens ?? []).map((t) => t.trim().toLowerCase()))

	return dedupeByToken([
		...batches
			.flatMap((b) => (Array.isArray(b) ? b : (b?.pairs ?? [])))
			.map(pairToCandidate)
			.filter((c): c is Candidate => c !== null),
		...chainPools,
	])
		.filter((c) => chains.has(c.chain))
		.filter((c) => !isQuoteAsset(c.symbol))
		.filter((c) => !excluded.has(c.tokenAddress.toLowerCase()))
		.filter((c) => c.liquidityUsd >= params.minLiquidityUsd)
		.filter((c) => c.volume24hUsd >= (params.minVolume24hUsd ?? 0))
		.sort((a, b) => b.volume24hUsd - a.volume24hUsd)
		.slice(0, params.limit ?? 25)
}

/** Current USD price for a token we already hold — used for mark-to-market and exit checks. */
export async function getTokenPriceUsd(
	chain: string,
	tokenAddress: string,
): Promise<number | null> {
	const data = await getJson<{ pairs?: DexPair[] } | DexPair[]>(
		`${DEXSCREENER}/tokens/v1/${chain}/${tokenAddress}`,
	)
	const pairs = Array.isArray(data) ? data : (data?.pairs ?? [])
	const best = pairs
		.map(pairToCandidate)
		.filter((c): c is Candidate => c !== null)
		.sort((a, b) => b.liquidityUsd - a.liquidityUsd)[0]
	return best?.priceUsd ?? null
}

/**
 * Token-security verdict from the Python token_security stack (honeypot
 * detector, authority checker, holder distribution).
 *
 * Fail-closed by design: when the scan is unavailable this returns undefined,
 * and the `security_scan_present` gate then refuses the entry. An agent that
 * buys because the safety check timed out is worse than one that sits still.
 */
export async function fetchTokenSecurity(
	internalApiUrl: string,
	internalApiKey: string,
	chain: string,
	tokenAddress: string,
): Promise<TokenSecurity | undefined> {
	if (!internalApiUrl || !internalApiKey) return undefined
	try {
		const res = await fetch(`${internalApiUrl}/internal/token-security`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json', 'X-Internal-Key': internalApiKey },
			body: JSON.stringify({ chain, token_address: tokenAddress }),
			signal: AbortSignal.timeout(SECURITY_TIMEOUT_MS),
		})
		if (!res.ok) {
			// A refused entry should be traceable to *why* the scan was missing —
			// a 401 is a misconfiguration, a 404 is a service without the endpoint,
			// and both look identical in the journal without this.
			logger.warn(
				{ chain, tokenAddress, status: res.status },
				'autopilot: security scan rejected the request',
			)
			return undefined
		}
		const data = (await res.json()) as {
			is_honeypot?: boolean
			buy_tax_bps?: number
			sell_tax_bps?: number
			top_holder_pct?: number
			lp_locked?: boolean
			mintable?: boolean
			freezable?: boolean
			verified?: boolean
		}
		const out: TokenSecurity = {}
		if (typeof data.is_honeypot === 'boolean') out.isHoneypot = data.is_honeypot
		if (typeof data.buy_tax_bps === 'number') out.buyTaxBps = data.buy_tax_bps
		if (typeof data.sell_tax_bps === 'number') out.sellTaxBps = data.sell_tax_bps
		if (typeof data.top_holder_pct === 'number') out.topHolderPct = data.top_holder_pct
		if (typeof data.lp_locked === 'boolean') out.lpLocked = data.lp_locked
		if (typeof data.mintable === 'boolean') out.mintable = data.mintable
		if (typeof data.freezable === 'boolean') out.freezable = data.freezable
		if (typeof data.verified === 'boolean') out.verified = data.verified
		return out
	} catch (err) {
		logger.warn(
			{ chain, tokenAddress, err: String(err), timeoutMs: SECURITY_TIMEOUT_MS },
			'autopilot: security scan failed',
		)
		return undefined
	}
}
