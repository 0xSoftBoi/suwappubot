import { Hono } from 'hono'
import { logger } from '../lib/logger'

const tokenRoutes = new Hono()

// In-memory cache for token search results
const tokenSearchCache = new Map<string, { data: unknown; expiry: number }>()
const SEARCH_CACHE_TTL = 5 * 60 * 1000 // 5 minutes

// In-memory cache for prices
const pricesCache = new Map<string, { data: Record<string, number>; expiry: number }>()
const PRICE_CACHE_TTL = 60 * 1000 // 1 minute

// Terminal uses human chain keys while Li.Fi's token endpoint is most reliable
// with canonical chain IDs. Keep the mapping here so popular/search/lookup never
// drift into subtly different behavior.
const CHAIN_ALIASES: Record<string, string> = {
	eth: '1',
	ethereum: '1',
	polygon: '137',
	matic: '137',
	arbitrum: '42161',
	arb: '42161',
	base: '8453',
	optimism: '10',
	op: '10',
	bsc: '56',
	bnb: '56',
	avalanche: '43114',
	avax: '43114',
	linea: '59144',
	zksync: '324',
	solana: '1151111081099710',
	sol: '1151111081099710',
}

const resolveChainId = (chain: string) => CHAIN_ALIASES[chain.trim().toLowerCase()] ?? chain.trim()

type LifiToken = {
	address: string
	symbol: string
	decimals: number
	name: string
	chainId: number
	logoURI?: string
	priceUSD?: string
	// Li.Fi contract-safety verdict ('verified' | 'flagged'). Safety, not
	// identity: a look-alike can be 'verified' and still be the wrong token.
	verificationStatus?: string
}

const toTerminalToken = (token: LifiToken, requestedChain?: string) => ({
	symbol: token.symbol,
	name: token.name,
	address: token.address,
	chain: requestedChain?.trim().toLowerCase() || String(token.chainId),
	decimals: token.decimals,
	logoUrl: token.logoURI,
})

type TerminalToken = ReturnType<typeof toTerminalToken>

const CURATED_SEARCH_TIMEOUT_MS = 3_000

/**
 * Curated tokens from python-api's token registry (bot/config/tokens.py).
 *
 * Li.Fi's list is a superset for long-tail trading, but it is not an identity
 * oracle: on Ethereum it carries "Pepe Community" under the symbol PEPE and
 * does not carry the canonical PEPE at all, so a symbol-only search handed the
 * Terminal's command palette the wrong contract as its top hit. The curated
 * registry is what the Python quote/execute path already treats as canonical,
 * so it ranks first and Li.Fi fills in behind it. Best-effort: any failure or
 * a missing INTERNAL_API_URL just yields the Li.Fi-only result.
 */
async function fetchCuratedTerminalTokens(query: string, chain: string): Promise<TerminalToken[]> {
	const base = process.env.INTERNAL_API_URL
	if (!base) return []
	try {
		const url = `${base.replace(/\/$/, '')}/webapp/tokens/search?q=${encodeURIComponent(query)}&chain=${encodeURIComponent(chain)}`
		const response = await fetch(url, {
			headers: { Accept: 'application/json' },
			signal: AbortSignal.timeout(CURATED_SEARCH_TIMEOUT_MS),
		})
		if (!response.ok) return []
		const rows = (await response.json()) as unknown
		if (!Array.isArray(rows)) return []
		return rows
			.filter(
				(row): row is Record<string, unknown> =>
					!!row &&
					typeof row === 'object' &&
					typeof (row as Record<string, unknown>).address === 'string' &&
					typeof (row as Record<string, unknown>).symbol === 'string',
			)
			.map((row) => ({
				symbol: row.symbol as string,
				name: typeof row.name === 'string' ? row.name : (row.symbol as string),
				address: row.address as string,
				chain: chain.trim().toLowerCase(),
				decimals: Number.isFinite(Number(row.decimals)) ? Number(row.decimals) : 18,
				logoUrl: typeof row.logoUrl === 'string' ? row.logoUrl : undefined,
			}))
	} catch (error) {
		logger.warn({ err: error, query, chain }, '[TokenRoutes] Curated token search unavailable')
		return []
	}
}

async function fetchLifiTokens(chainIds: string[]) {
	const response = await fetch(`https://li.quest/v1/tokens?chains=${chainIds.map(encodeURIComponent).join(',')}`, {
		headers: {
			Accept: 'application/json',
			...(process.env.LIFI_API_KEY && { 'x-lifi-api-key': process.env.LIFI_API_KEY }),
		},
		signal: AbortSignal.timeout(10_000),
	})

	if (!response.ok) throw new Error(`Li.Fi API error: ${response.status} ${response.statusText}`)

	return (await response.json()) as { tokens: Record<string, LifiToken[]> }
}

/**
 * GET /webapp/tokens/search?q=USDC&chains=1,137
 * GET /webapp/tokens/search?q=USDC&chain=ethereum  (Terminal compatibility)
 *
 * The Mini App historically consumes an envelope. The standalone Terminal
 * historically consumes a bare SwapToken[]. Support both contracts explicitly
 * instead of making one frontend depend on the other's response shape.
 */
tokenRoutes.get('/search', async (c) => {
	const query = c.req.query('q')?.trim()
	const terminalChain = c.req.query('chain')?.trim()
	const chainsParam = c.req.query('chains')
	const terminalMode = Boolean(terminalChain)
	const minLength = terminalMode ? 1 : 2

	if (!query || query.length < minLength) {
		return c.json({ error: `Query must be at least ${minLength} character${minLength === 1 ? '' : 's'}` }, 400)
	}

	const chains = terminalChain
		? [resolveChainId(terminalChain)]
		: chainsParam
			? chainsParam.split(',').map((s) => resolveChainId(s))
			: ['1', '137', '42161', '8453', '10']
	const cacheKey = `${terminalMode ? 'terminal' : 'webapp'}:${query.toLowerCase()}:${[...chains].sort().join(',')}`

	const cached = tokenSearchCache.get(cacheKey)
	if (cached && Date.now() < cached.expiry) return c.json(cached.data)

	try {
		const [data, curated] = await Promise.all([
			fetchLifiTokens(chains),
			terminalMode ? fetchCuratedTerminalTokens(query, terminalChain!) : Promise.resolve([] as TerminalToken[]),
		])
		const q = query.toLowerCase()
		const results: LifiToken[] = []

		for (const tokens of Object.values(data.tokens)) {
			for (const token of tokens) {
				if (token.symbol.toLowerCase().includes(q) || token.name.toLowerCase().includes(q)) {
					results.push(token)
				}
			}
		}

		results.sort((a, b) => {
			// Li.Fi-flagged contracts sink below everything else.
			const aFlagged = a.verificationStatus === 'flagged' ? 1 : 0
			const bFlagged = b.verificationStatus === 'flagged' ? 1 : 0
			if (aFlagged !== bFlagged) return aFlagged - bFlagged
			const aExact = a.symbol.toLowerCase() === q ? 0 : 1
			const bExact = b.symbol.toLowerCase() === q ? 0 : 1
			if (aExact !== bExact) return aExact - bExact
			return a.symbol.length - b.symbol.length
		})

		let responseData: unknown
		if (terminalMode) {
			// Curated registry first, then Li.Fi, deduped by address.
			const seen = new Set<string>()
			const merged: TerminalToken[] = []
			for (const token of [...curated, ...results.map((token) => toTerminalToken(token, terminalChain))]) {
				const key = token.address.toLowerCase()
				if (seen.has(key)) continue
				seen.add(key)
				merged.push(token)
				if (merged.length >= 25) break
			}
			responseData = merged
		} else {
			responseData = { tokens: results.slice(0, 25), query, chains }
		}

		tokenSearchCache.set(cacheKey, { data: responseData, expiry: Date.now() + SEARCH_CACHE_TTL })
		return c.json(responseData)
	} catch (error) {
		logger.error({ err: error, query, terminalChain, chains }, '[TokenRoutes] Search error')
		return c.json({ error: 'Failed to search tokens' }, 500)
	}
})

/**
 * GET /webapp/tokens/popular?chain=ethereum
 * Compatibility endpoint for the standalone Terminal token selector.
 */
tokenRoutes.get('/popular', async (c) => {
	const chain = c.req.query('chain')?.trim().toLowerCase() || 'ethereum'
	const chainId = resolveChainId(chain)

	try {
		const data = await fetchLifiTokens([chainId])
		const tokens = data.tokens[chainId] || []
		return c.json(tokens.slice(0, 50).map((token) => toTerminalToken(token, chain)))
	} catch (error) {
		logger.error({ err: error, chain, chainId }, '[TokenRoutes] Popular tokens error')
		return c.json({ error: 'Failed to fetch popular tokens' }, 500)
	}
})

// In-memory cache for single-token lookups by chain+address
const tokenLookupCache = new Map<string, { data: unknown; expiry: number }>()
const LOOKUP_CACHE_TTL = 5 * 60 * 1000 // 5 minutes

/**
 * GET /webapp/tokens/lookup?address=0x...&chain=1
 */
tokenRoutes.get('/lookup', async (c) => {
	const address = c.req.query('address')?.trim()
	const chainParam = c.req.query('chain')?.trim().toLowerCase()

	if (!address) return c.json({ error: 'address parameter is required' }, 400)

	const chainId = chainParam ? resolveChainId(chainParam) : '1'
	const cacheKey = `${chainId}:${address.toLowerCase()}`
	const cached = tokenLookupCache.get(cacheKey)
	if (cached && Date.now() < cached.expiry) return c.json(cached.data)

	try {
		const response = await fetch(
			`https://li.quest/v1/token?chain=${encodeURIComponent(chainId)}&token=${encodeURIComponent(address)}`,
			{
				headers: {
					Accept: 'application/json',
					...(process.env.LIFI_API_KEY && { 'x-lifi-api-key': process.env.LIFI_API_KEY }),
				},
				signal: AbortSignal.timeout(10_000),
			},
		)

		if (response.status === 404) return c.json({ error: 'Token not found' }, 404)
		if (!response.ok) throw new Error(`Li.Fi API error: ${response.statusText}`)

		const token = (await response.json()) as LifiToken
		if (!token?.address) return c.json({ error: 'Token not found' }, 404)

		const result = {
			name: token.name,
			symbol: token.symbol,
			price: token.priceUSD ? Number(token.priceUSD) : null,
			safetyScore: null,
			chain: chainParam || chainId,
			address: token.address,
			logoUrl: token.logoURI,
		}

		tokenLookupCache.set(cacheKey, { data: result, expiry: Date.now() + LOOKUP_CACHE_TTL })
		return c.json(result)
	} catch (error) {
		logger.error({ err: error }, '[TokenRoutes] Lookup error')
		return c.json({ error: 'Failed to look up token' }, 500)
	}
})

/**
 * GET /webapp/tokens/prices?tokens=ETH,USDC,SOL
 * Batch price lookup via CoinGecko
 */
tokenRoutes.get('/prices', async (c) => {
	const tokensParam = c.req.query('tokens')
	if (!tokensParam) return c.json({ error: 'tokens parameter is required' }, 400)

	const symbols = tokensParam.split(',').map((s) => s.trim().toLowerCase())
	const cacheKey = [...symbols].sort().join(',')
	const cached = pricesCache.get(cacheKey)
	if (cached && Date.now() < cached.expiry) return c.json({ prices: cached.data })

	const coinGeckoIds: Record<string, string> = {
		eth: 'ethereum', sol: 'solana', matic: 'matic-network', bnb: 'binancecoin',
		usdc: 'usd-coin', usdt: 'tether', dai: 'dai', wbtc: 'wrapped-bitcoin',
		link: 'chainlink', uni: 'uniswap', aave: 'aave', avax: 'avalanche-2',
	}

	const ids = symbols.map((s) => coinGeckoIds[s]).filter(Boolean)
	if (ids.length === 0) return c.json({ prices: {} })

	try {
		const response = await fetch(
			`https://api.coingecko.com/api/v3/simple/price?ids=${ids.join(',')}&vs_currencies=usd`,
			{ signal: AbortSignal.timeout(10_000) },
		)
		if (!response.ok) throw new Error(`CoinGecko API error: ${response.status}`)
		const data = (await response.json()) as Record<string, { usd?: number }>

		const prices: Record<string, number> = {}
		for (const symbol of symbols) {
			const id = coinGeckoIds[symbol]
			if (id && data[id]?.usd != null) prices[symbol] = data[id].usd!
		}

		pricesCache.set(cacheKey, { data: prices, expiry: Date.now() + PRICE_CACHE_TTL })
		return c.json({ prices })
	} catch (error) {
		logger.error({ err: error }, '[TokenRoutes] Price fetch error')
		return c.json({ error: 'Failed to fetch prices' }, 500)
	}
})

export { tokenRoutes }
