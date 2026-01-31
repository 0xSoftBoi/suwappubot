import { Context, Effect, Layer } from 'effect'

// Price data types
export interface TokenPrice {
	id: string
	symbol: string
	name: string
	current_price: number
	price_change_24h: number
	price_change_percentage_24h: number
	market_cap: number
	total_volume: number
	last_updated: string
}

export interface PriceCache {
	prices: Map<string, { data: TokenPrice; timestamp: number }>
	listCache: { data: TokenPrice[]; timestamp: number } | null
}

// Cache TTL in milliseconds
const PRICE_CACHE_TTL = 60 * 1000 // 1 minute
const LIST_CACHE_TTL = 5 * 60 * 1000 // 5 minutes

// CoinGecko API endpoints
const COINGECKO_API = 'https://api.coingecko.com/api/v3'

// Common token ID mappings
const TOKEN_ID_MAP: Record<string, string> = {
	eth: 'ethereum',
	weth: 'weth',
	sol: 'solana',
	matic: 'matic-network',
	bnb: 'binancecoin',
	usdc: 'usd-coin',
	usdt: 'tether',
	dai: 'dai',
	wbtc: 'wrapped-bitcoin',
	btc: 'bitcoin',
	arb: 'arbitrum',
	op: 'optimism',
	avax: 'avalanche-2',
	link: 'chainlink',
	uni: 'uniswap',
	aave: 'aave',
	crv: 'curve-dao-token',
	mkr: 'maker',
	snx: 'havven',
	comp: 'compound-governance-token',
}

// In-memory cache
const cache: PriceCache = {
	prices: new Map(),
	listCache: null,
}

export interface PriceServiceInterface {
	/**
	 * Get price for a single token by symbol or CoinGecko ID
	 */
	readonly getPrice: (tokenId: string) => Effect.Effect<TokenPrice | null, Error>

	/**
	 * Get prices for multiple tokens
	 */
	readonly getPrices: (tokenIds: string[]) => Effect.Effect<TokenPrice[], Error>

	/**
	 * Get top tokens by market cap
	 */
	readonly getTopTokens: (limit?: number) => Effect.Effect<TokenPrice[], Error>

	/**
	 * Search for tokens by name or symbol
	 */
	readonly searchTokens: (query: string) => Effect.Effect<TokenPrice[], Error>
}

export class PriceService extends Context.Tag('PriceService')<
	PriceService,
	PriceServiceInterface
>() {}

// Helper to normalize token ID
function normalizeTokenId(id: string): string {
	const lower = id.toLowerCase()
	return TOKEN_ID_MAP[lower] || lower
}

// Fetch prices from CoinGecko
async function fetchPricesFromCoinGecko(ids: string[]): Promise<TokenPrice[]> {
	const normalizedIds = ids.map(normalizeTokenId)
	const idsParam = normalizedIds.join(',')

	const response = await fetch(
		`${COINGECKO_API}/coins/markets?vs_currency=usd&ids=${idsParam}&order=market_cap_desc&sparkline=false`
	)

	if (!response.ok) {
		if (response.status === 429) {
			throw new Error('Rate limit exceeded. Please try again later.')
		}
		throw new Error(`CoinGecko API error: ${response.status}`)
	}

	const data = (await response.json()) as Array<{
		id: string
		symbol: string
		name: string
		current_price: number
		price_change_24h: number
		price_change_percentage_24h: number
		market_cap: number
		total_volume: number
		last_updated: string
	}>

	return data.map((item) => ({
		id: item.id,
		symbol: item.symbol.toUpperCase(),
		name: item.name,
		current_price: item.current_price,
		price_change_24h: item.price_change_24h || 0,
		price_change_percentage_24h: item.price_change_percentage_24h || 0,
		market_cap: item.market_cap || 0,
		total_volume: item.total_volume || 0,
		last_updated: item.last_updated,
	}))
}

// Fetch top tokens from CoinGecko
async function fetchTopTokens(limit: number): Promise<TokenPrice[]> {
	// Check cache first
	if (cache.listCache && Date.now() - cache.listCache.timestamp < LIST_CACHE_TTL) {
		return cache.listCache.data.slice(0, limit)
	}

	const response = await fetch(
		`${COINGECKO_API}/coins/markets?vs_currency=usd&order=market_cap_desc&per_page=${Math.min(limit, 250)}&sparkline=false`
	)

	if (!response.ok) {
		if (response.status === 429) {
			throw new Error('Rate limit exceeded. Please try again later.')
		}
		throw new Error(`CoinGecko API error: ${response.status}`)
	}

	const data = (await response.json()) as Array<{
		id: string
		symbol: string
		name: string
		current_price: number
		price_change_24h: number
		price_change_percentage_24h: number
		market_cap: number
		total_volume: number
		last_updated: string
	}>

	const prices: TokenPrice[] = data.map((item) => ({
		id: item.id,
		symbol: item.symbol.toUpperCase(),
		name: item.name,
		current_price: item.current_price,
		price_change_24h: item.price_change_24h || 0,
		price_change_percentage_24h: item.price_change_percentage_24h || 0,
		market_cap: item.market_cap || 0,
		total_volume: item.total_volume || 0,
		last_updated: item.last_updated,
	}))

	// Update cache
	cache.listCache = { data: prices, timestamp: Date.now() }

	// Also update individual price cache
	for (const price of prices) {
		cache.prices.set(price.id, { data: price, timestamp: Date.now() })
	}

	return prices
}

// Search tokens by name or symbol
async function searchTokensFromCoinGecko(query: string): Promise<TokenPrice[]> {
	// First, get the list of coins matching the query
	const searchResponse = await fetch(`${COINGECKO_API}/search?query=${encodeURIComponent(query)}`)

	if (!searchResponse.ok) {
		if (searchResponse.status === 429) {
			throw new Error('Rate limit exceeded. Please try again later.')
		}
		throw new Error(`CoinGecko API error: ${searchResponse.status}`)
	}

	const searchData = (await searchResponse.json()) as {
		coins: Array<{ id: string; symbol: string; name: string }>
	}

	if (searchData.coins.length === 0) {
		return []
	}

	// Get prices for top 10 results
	const topIds = searchData.coins.slice(0, 10).map((c) => c.id)
	return fetchPricesFromCoinGecko(topIds)
}

export const PriceServiceLive = Layer.succeed(PriceService, {
	getPrice: (tokenId: string) =>
		Effect.tryPromise({
			try: async () => {
				const normalizedId = normalizeTokenId(tokenId)

				// Check cache
				const cached = cache.prices.get(normalizedId)
				if (cached && Date.now() - cached.timestamp < PRICE_CACHE_TTL) {
					return cached.data
				}

				const prices = await fetchPricesFromCoinGecko([normalizedId])
				if (prices.length === 0) {
					return null
				}

				// Update cache
				cache.prices.set(normalizedId, { data: prices[0], timestamp: Date.now() })

				return prices[0]
			},
			catch: (e) => new Error(`Failed to fetch price: ${e}`),
		}),

	getPrices: (tokenIds: string[]) =>
		Effect.tryPromise({
			try: async () => {
				if (tokenIds.length === 0) {
					return []
				}

				const now = Date.now()
				const toFetch: string[] = []
				const results: TokenPrice[] = []

				// Check cache for each token
				for (const id of tokenIds) {
					const normalizedId = normalizeTokenId(id)
					const cached = cache.prices.get(normalizedId)
					if (cached && now - cached.timestamp < PRICE_CACHE_TTL) {
						results.push(cached.data)
					} else {
						toFetch.push(normalizedId)
					}
				}

				// Fetch missing prices
				if (toFetch.length > 0) {
					const fetched = await fetchPricesFromCoinGecko(toFetch)
					for (const price of fetched) {
						cache.prices.set(price.id, { data: price, timestamp: now })
						results.push(price)
					}
				}

				return results
			},
			catch: (e) => new Error(`Failed to fetch prices: ${e}`),
		}),

	getTopTokens: (limit = 50) =>
		Effect.tryPromise({
			try: () => fetchTopTokens(limit),
			catch: (e) => new Error(`Failed to fetch top tokens: ${e}`),
		}),

	searchTokens: (query: string) =>
		Effect.tryPromise({
			try: async () => {
				if (!query || query.length < 2) {
					return fetchTopTokens(20)
				}
				return searchTokensFromCoinGecko(query)
			},
			catch: (e) => new Error(`Failed to search tokens: ${e}`),
		}),
})
