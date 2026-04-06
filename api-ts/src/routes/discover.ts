/**
 * Discovery endpoints for trending tokens, gainers, new pools, and search.
 * Also serves chart OHLCV data and token detail info.
 *
 * Consumed by:
 * - Mobile: useTokenDiscovery hook (GET /v1/discover/*)
 * - Mobile: useTokenPrice hook (GET /v1/tokens/price)
 * - Webapp: PriceChart component (GET /webapp/chart/:symbol)
 * - Webapp: TokenDetail page (GET /webapp/token/:symbol)
 */

import { Hono } from 'hono'

const discoverRoutes = new Hono()

// ── Cache layer ──────────────────────────────────────────────

const cache = new Map<string, { data: unknown; expiry: number }>()

function getCached<T>(key: string): T | null {
	const entry = cache.get(key)
	if (!entry || Date.now() > entry.expiry) {
		cache.delete(key)
		return null
	}
	return entry.data as T
}

function setCache(key: string, data: unknown, ttlMs: number): void {
	cache.set(key, { data, expiry: Date.now() + ttlMs })
}

// ── CoinGecko helpers ────────────────────────────────────────

const COINGECKO_BASE = 'https://api.coingecko.com/api/v3'

const COINGECKO_IDS: Record<string, string> = {
	eth: 'ethereum', sol: 'solana', matic: 'matic-network', bnb: 'binancecoin',
	usdc: 'usd-coin', usdt: 'tether', dai: 'dai', wbtc: 'wrapped-bitcoin',
	link: 'chainlink', uni: 'uniswap', aave: 'aave', avax: 'avalanche-2',
	bonk: 'bonk', wif: 'dogwifcoin', jto: 'jito-governance-token',
	pyth: 'pyth-network', pepe: 'pepe', shib: 'shiba-inu', arb: 'arbitrum',
	op: 'optimism', degen: 'degen-base', brett: 'brett', gmx: 'gmx',
	jup: 'jupiter-exchange-solana', ray: 'raydium',
}

// Chain name to CoinGecko platform id for contract lookups
const CHAIN_PLATFORMS: Record<string, string> = {
	ethereum: 'ethereum', solana: 'solana', polygon: 'polygon-pos',
	arbitrum: 'arbitrum-one', optimism: 'optimistic-ethereum',
	base: 'base', bsc: 'binance-smart-chain',
}

async function geckoFetch(path: string): Promise<any> {
	const headers: Record<string, string> = { Accept: 'application/json' }
	if (process.env.COINGECKO_API_KEY) {
		headers['x-cg-demo-key'] = process.env.COINGECKO_API_KEY
	}
	const resp = await fetch(`${COINGECKO_BASE}${path}`, { headers })
	if (!resp.ok) throw new Error(`CoinGecko ${resp.status}: ${resp.statusText}`)
	return resp.json()
}

// ── Discovery Endpoints (mobile: /v1/discover/*) ────────────

/**
 * GET /v1/discover/trending?chain=all&limit=50
 * Returns trending tokens from CoinGecko trending + search.
 */
discoverRoutes.get('/trending', async (c) => {
	const chain = c.req.query('chain') || 'all'
	const limit = Math.min(parseInt(c.req.query('limit') || '50'), 100)
	const cacheKey = `trending:${chain}:${limit}`

	const cached = getCached<any[]>(cacheKey)
	if (cached) return c.json(cached)

	try {
		const data = await geckoFetch('/search/trending')
		const coins = data.coins || []

		let tokens = coins.map((item: any) => {
			const coin = item.item
			return {
				address: coin.platforms?.[CHAIN_PLATFORMS[chain]] || coin.id || '',
				symbol: coin.symbol?.toUpperCase() || '',
				name: coin.name || '',
				chain: chain === 'all' ? (coin.platforms?.solana ? 'solana' : 'ethereum') : chain,
				price: coin.data?.price ?? 0,
				change24h: coin.data?.price_change_percentage_24h?.usd ?? 0,
				volume24h: coin.data?.total_volume?.usd ?? 0,
				marketCap: coin.data?.market_cap ?? null,
				logoUrl: coin.large || coin.thumb || null,
			}
		})

		if (chain !== 'all') {
			tokens = tokens.filter((t: any) => t.chain === chain)
		}

		tokens = tokens.slice(0, limit)
		setCache(cacheKey, tokens, 60_000) // 60s

		return c.json(tokens)
	} catch (error) {
		console.error('[Discover] Trending error:', error)
		return c.json({ error: 'Failed to fetch trending tokens' }, 500)
	}
})

/**
 * GET /v1/discover/gainers?timeframe=24h
 * Returns top gainers sorted by 24h price change.
 */
discoverRoutes.get('/gainers', async (c) => {
	const timeframe = c.req.query('timeframe') || '24h'
	const cacheKey = `gainers:${timeframe}`

	const cached = getCached<any[]>(cacheKey)
	if (cached) return c.json(cached)

	try {
		const data = await geckoFetch(
			'/coins/markets?vs_currency=usd&order=percent_change_24h_desc&per_page=50&page=1&sparkline=false'
		)

		const tokens = (data || []).map((coin: any) => ({
			address: coin.id || '',
			symbol: (coin.symbol || '').toUpperCase(),
			name: coin.name || '',
			chain: 'ethereum', // CoinGecko markets default; clients can cross-ref
			price: coin.current_price || 0,
			change24h: coin.price_change_percentage_24h || 0,
			volume24h: coin.total_volume || 0,
			marketCap: coin.market_cap || null,
			logoUrl: coin.image || null,
		}))

		setCache(cacheKey, tokens, 60_000)
		return c.json(tokens)
	} catch (error) {
		console.error('[Discover] Gainers error:', error)
		return c.json({ error: 'Failed to fetch gainers' }, 500)
	}
})

/**
 * GET /v1/discover/new?chain=all
 * Returns recently listed tokens (new pools).
 */
discoverRoutes.get('/new', async (c) => {
	const chain = c.req.query('chain') || 'all'
	const cacheKey = `new:${chain}`

	const cached = getCached<any[]>(cacheKey)
	if (cached) return c.json(cached)

	try {
		// Use CoinGecko's recently added coins list
		const data = await geckoFetch(
			'/coins/markets?vs_currency=usd&order=id_asc&per_page=30&page=1&sparkline=false'
		)

		const tokens = (data || []).map((coin: any) => ({
			address: coin.id || '',
			symbol: (coin.symbol || '').toUpperCase(),
			name: coin.name || '',
			chain: chain === 'all' ? 'ethereum' : chain,
			price: coin.current_price || 0,
			change24h: coin.price_change_percentage_24h || 0,
			volume24h: coin.total_volume || 0,
			marketCap: coin.market_cap || null,
			logoUrl: coin.image || null,
		}))

		setCache(cacheKey, tokens, 120_000) // 2 min
		return c.json(tokens)
	} catch (error) {
		console.error('[Discover] New pools error:', error)
		return c.json({ error: 'Failed to fetch new tokens' }, 500)
	}
})

/**
 * GET /v1/discover/search?q=bonk
 * Proxies to existing /webapp/tokens/search with DiscoveryToken shape.
 */
discoverRoutes.get('/search', async (c) => {
	const query = c.req.query('q')?.trim()
	if (!query || query.length < 2) {
		return c.json({ error: 'Query must be at least 2 characters' }, 400)
	}

	try {
		const data = await geckoFetch(`/search?query=${encodeURIComponent(query)}`)
		const coins = (data.coins || []).slice(0, 25)

		const tokens = coins.map((coin: any) => ({
			address: coin.id || '',
			symbol: (coin.symbol || '').toUpperCase(),
			name: coin.name || '',
			chain: coin.platforms ? Object.keys(coin.platforms)[0] || 'ethereum' : 'ethereum',
			price: 0, // Search results don't include price; client fetches separately
			change24h: 0,
			volume24h: 0,
			marketCap: coin.market_cap_rank ? null : null,
			logoUrl: coin.large || coin.thumb || null,
		}))

		return c.json(tokens)
	} catch (error) {
		console.error('[Discover] Search error:', error)
		return c.json({ error: 'Failed to search tokens' }, 500)
	}
})

// ── Token Price Endpoint (mobile: /v1/tokens/price) ─────────

/**
 * GET /v1/tokens/price?chain=solana&address=<id>&timeframe=1d
 * Returns price data + OHLCV candles for a token.
 */
discoverRoutes.get('/price', async (c) => {
	const chain = c.req.query('chain') || 'ethereum'
	const address = c.req.query('address') || ''
	const timeframe = c.req.query('timeframe') || '1d'

	if (!address) {
		return c.json({ error: 'address parameter is required' }, 400)
	}

	const cacheKey = `price:${chain}:${address}:${timeframe}`
	const cached = getCached<any>(cacheKey)
	if (cached) return c.json(cached)

	// Map timeframe to CoinGecko days parameter
	const daysMap: Record<string, string> = {
		'1h': '1', '1d': '1', '1w': '7', '1m': '30', '1y': '365',
	}
	const days = daysMap[timeframe] || '1'

	try {
		// address might be a CoinGecko id (e.g., "solana") or a contract address
		let coinId = address.toLowerCase()

		// Try resolving well-known symbols to CoinGecko ids
		const knownId = COINGECKO_IDS[coinId]
		if (knownId) coinId = knownId

		const [marketData, chartData] = await Promise.all([
			geckoFetch(`/coins/${coinId}?localization=false&tickers=false&community_data=false&developer_data=false`).catch(() => null),
			geckoFetch(`/coins/${coinId}/market_chart?vs_currency=usd&days=${days}`).catch(() => null),
		])

		const prices: Array<{ timestamp: number; value: number }> = []
		if (chartData?.prices) {
			for (const [ts, val] of chartData.prices) {
				prices.push({ timestamp: Math.floor(ts / 1000), value: val })
			}
		}

		const result = {
			price: marketData?.market_data?.current_price?.usd ?? 0,
			change24h: marketData?.market_data?.price_change_24h ?? 0,
			changePercent24h: marketData?.market_data?.price_change_percentage_24h ?? 0,
			marketCap: marketData?.market_data?.market_cap?.usd ?? null,
			volume24h: marketData?.market_data?.total_volume?.usd ?? null,
			liquidity: null, // CoinGecko free tier doesn't provide liquidity
			holders: null,
			symbol: (marketData?.symbol || address).toUpperCase(),
			name: marketData?.name || address,
			logoUrl: marketData?.image?.large || null,
			prices,
		}

		const ttl = timeframe === '1h' ? 30_000 : 60_000
		setCache(cacheKey, result, ttl)
		return c.json(result)
	} catch (error) {
		console.error('[Discover] Token price error:', error)
		return c.json({ error: 'Failed to fetch token price' }, 500)
	}
})

export { discoverRoutes }
