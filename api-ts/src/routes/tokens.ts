import { Hono } from 'hono'
import { logger } from '../lib/logger'

const tokenRoutes = new Hono()

// In-memory cache for token search results
const tokenSearchCache = new Map<string, { data: unknown; expiry: number }>()
const SEARCH_CACHE_TTL = 5 * 60 * 1000 // 5 minutes

// In-memory cache for prices
const pricesCache = new Map<string, { data: Record<string, number>; expiry: number }>()
const PRICE_CACHE_TTL = 60 * 1000 // 1 minute

/**
 * GET /webapp/tokens/search?q=USDC&chains=1,137
 * Search tokens across chains via Li.Fi
 */
tokenRoutes.get('/search', async (c) => {
	const query = c.req.query('q')?.trim()
	const chainsParam = c.req.query('chains')

	if (!query || query.length < 2) {
		return c.json({ error: 'Query must be at least 2 characters' }, 400)
	}

	const chains = chainsParam ? chainsParam.split(',').map((s) => s.trim()) : ['1', '137', '42161', '8453', '10']
	const cacheKey = `${query.toLowerCase()}:${chains.sort().join(',')}`

	// Check cache
	const cached = tokenSearchCache.get(cacheKey)
	if (cached && Date.now() < cached.expiry) {
		return c.json(cached.data)
	}

	try {
		const response = await fetch(`https://li.quest/v1/tokens?chains=${chains.join(',')}`, {
			headers: {
				Accept: 'application/json',
				...(process.env.LIFI_API_KEY && { 'x-lifi-api-key': process.env.LIFI_API_KEY }),
			},
		})

		if (!response.ok) {
			throw new Error(`Li.Fi API error: ${response.statusText}`)
		}

		const data = (await response.json()) as {
			tokens: Record<string, Array<{ address: string; symbol: string; decimals: number; name: string; chainId: number; logoURI?: string; priceUSD?: string }>>
		}

		const q = query.toLowerCase()
		const results: Array<{ address: string; symbol: string; decimals: number; name: string; chainId: number; logoURI?: string; priceUSD?: string }> = []

		for (const [, tokens] of Object.entries(data.tokens)) {
			for (const token of tokens) {
				if (token.symbol.toLowerCase().includes(q) || token.name.toLowerCase().includes(q)) {
					results.push(token)
				}
			}
		}

		// Sort: exact symbol match first, then by symbol length
		results.sort((a, b) => {
			const aExact = a.symbol.toLowerCase() === q ? 0 : 1
			const bExact = b.symbol.toLowerCase() === q ? 0 : 1
			if (aExact !== bExact) return aExact - bExact
			return a.symbol.length - b.symbol.length
		})

		const responseData = { tokens: results.slice(0, 25), query, chains }
		tokenSearchCache.set(cacheKey, { data: responseData, expiry: Date.now() + SEARCH_CACHE_TTL })

		return c.json(responseData)
	} catch (error) {
		logger.error({ err: error }, '[TokenRoutes] Search error')
		return c.json({ error: 'Failed to search tokens' }, 500)
	}
})

// In-memory cache for single-token lookups by chain+address
const tokenLookupCache = new Map<string, { data: unknown; expiry: number }>()
const LOOKUP_CACHE_TTL = 5 * 60 * 1000 // 5 minutes

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
}

/**
 * GET /webapp/tokens/popular?chain=ethereum
 * Compatibility endpoint for the standalone Terminal token selector.
 * The Terminal expects a bare SwapToken[] rather than the Mini App's
 * { chainId, tokens } envelope returned by /webapp/swap/tokens.
 */
tokenRoutes.get('/popular', async (c) => {
	const chain = c.req.query('chain')?.trim().toLowerCase() || 'ethereum'
	const chainId = CHAIN_ALIASES[chain] ?? chain

	try {
		const response = await fetch(`https://li.quest/v1/tokens?chains=${encodeURIComponent(chainId)}`, {
			headers: {
				Accept: 'application/json',
				...(process.env.LIFI_API_KEY && { 'x-lifi-api-key': process.env.LIFI_API_KEY }),
			},
		})

		if (!response.ok) {
			throw new Error(`Li.Fi API error: ${response.statusText}`)
		}

		const data = (await response.json()) as {
			tokens: Record<string, Array<{
				address: string
				symbol: string
				decimals: number
				name: string
				chainId: number
				logoURI?: string
			}>>
		}

		const tokens = data.tokens[chainId] || []
		return c.json(tokens.slice(0, 50).map((token) => ({
			symbol: token.symbol,
			name: token.name,
			address: token.address,
			chain,
			decimals: token.decimals,
			logoUrl: token.logoURI,
		})))
	} catch (error) {
		logger.error({ err: error, chain, chainId }, '[TokenRoutes] Popular tokens error')
		return c.json({ error: 'Failed to fetch popular tokens' }, 500)
	}
})

/**
 * GET /webapp/tokens/lookup?address=0x...&chain=1
 * Look up a single token by contract address (defaults to Ethereum mainnet
 * if no chain is given). Backs the webapp's paste-address quick-lookup UI
 * (ClipboardLookup.tsx). Returns 404 if the token can't be resolved.
 *
 * NOTE: safetyScore is null — this service has no wired honeypot/rug-risk
 * checker (that logic currently only exists on the Python side). Clients
 * must render it as "unknown", never as a neutral score.
 */
tokenRoutes.get('/lookup', async (c) => {
	const address = c.req.query('address')?.trim()
	const chainParam = c.req.query('chain')?.trim().toLowerCase()

	if (!address) {
		return c.json({ error: 'address parameter is required' }, 400)
	}

	const chainId = chainParam ? CHAIN_ALIASES[chainParam] ?? chainParam : '1'
	const cacheKey = `${chainId}:${address.toLowerCase()}`

	const cached = tokenLookupCache.get(cacheKey)
	if (cached && Date.now() < cached.expiry) {
		return c.json(cached.data)
	}

	try {
		const response = await fetch(
			`https://li.quest/v1/token?chain=${encodeURIComponent(chainId)}&token=${encodeURIComponent(address)}`,
			{
				headers: {
					Accept: 'application/json',
					...(process.env.LIFI_API_KEY && { 'x-lifi-api-key': process.env.LIFI_API_KEY }),
				},
			}
		)

		if (response.status === 404) {
			return c.json({ error: 'Token not found' }, 404)
		}

		if (!response.ok) {
			throw new Error(`Li.Fi API error: ${response.statusText}`)
		}

		const token = (await response.json()) as {
			address: string
			symbol: string
			decimals: number
			name: string
			chainId: number
			logoURI?: string
			priceUSD?: string
		}

		if (!token?.address) {
			return c.json({ error: 'Token not found' }, 404)
		}

		const result = {
			name: token.name,
			symbol: token.symbol,
			price: token.priceUSD ? Number(token.priceUSD) : null,
			safetyScore: null,
			chain: chainId,
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

	if (!tokensParam) {
		return c.json({ error: 'tokens parameter is required' }, 400)
	}

	const symbols = tokensParam.split(',').map((s) => s.trim().toLowerCase())
	const cacheKey = symbols.sort().join(',')

	// Check cache
	const cached = pricesCache.get(cacheKey)
	if (cached && Date.now() < cached.expiry) {
		return c.json({ prices: cached.data })
	}

	const coinGeckoIds: Record<string, string> = {
		eth: 'ethereum',
		sol: 'solana',
		matic: 'matic-network',
		bnb: 'binancecoin',
		usdc: 'usd-coin',
		usdt: 'tether',
		dai: 'dai',
		wbtc: 'wrapped-bitcoin',
		link: 'chainlink',
		uni: 'uniswap',
		aave: 'aave',
		avax: 'avalanche-2',
	}

	const ids = symbols.map((s) => coinGeckoIds[s]).filter(Boolean)

	if (ids.length === 0) {
		return c.json({ prices: {} })
	}

	try {
		const response = await fetch(
			`https://api.coingecko.com/api/v3/simple/price?ids=${ids.join(',')}&vs_currencies=usd`
		)
		const data = (await response.json()) as Record<string, { usd?: number }>

		const prices: Record<string, number> = {}
		for (const symbol of symbols) {
			const id = coinGeckoIds[symbol]
			if (id && data[id]?.usd) {
				prices[symbol] = data[id].usd
			}
		}

		pricesCache.set(cacheKey, { data: prices, expiry: Date.now() + PRICE_CACHE_TTL })
		return c.json({ prices })
	} catch (error) {
		logger.error({ err: error }, '[TokenRoutes] Price fetch error')
		return c.json({ error: 'Failed to fetch prices' }, 500)
	}
})

export { tokenRoutes }
