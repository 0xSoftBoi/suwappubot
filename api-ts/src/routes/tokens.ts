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
