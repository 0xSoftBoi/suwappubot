/**
 * Stage 1 — read. Screening and pricing for the autopilot.
 *
 * Plain async functions rather than Effect services: they are I/O-only and the
 * service wraps them with Effect.tryPromise, matching src/lib/marketDataQueries.ts.
 */
import { logger } from '../../lib/logger'
import type { Candidate, TokenSecurity } from './types'

const DEXSCREENER = 'https://api.dexscreener.com'
const FETCH_TIMEOUT_MS = 8_000

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

export interface ScreenParams {
	chains: string[]
	minLiquidityUsd: number
	minVolume24hUsd?: number
	limit?: number
}

/**
 * Screen the market for tradeable candidates. Uses DexScreener's boosted-token
 * feed as the discovery surface, then re-reads each token's real pairs so the
 * numbers we score on are pair data, not promo metadata.
 */
export async function screenCandidates(params: ScreenParams): Promise<Candidate[]> {
	const chains = new Set(params.chains.map((c) => c.toLowerCase()))
	const boosts = await getJson<Array<{ chainId?: string; tokenAddress?: string }>>(
		`${DEXSCREENER}/token-boosts/top/v1`,
	)
	if (!boosts || !Array.isArray(boosts)) return []

	const byChain = new Map<string, string[]>()
	for (const b of boosts) {
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

	return dedupeByToken(
		batches
			.flatMap((b) => (Array.isArray(b) ? b : (b?.pairs ?? [])))
			.map(pairToCandidate)
			.filter((c): c is Candidate => c !== null),
	)
		.filter((c) => chains.has(c.chain))
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
			signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
		})
		if (!res.ok) return undefined
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
		logger.warn({ chain, tokenAddress, err: String(err) }, 'autopilot: security scan failed')
		return undefined
	}
}
