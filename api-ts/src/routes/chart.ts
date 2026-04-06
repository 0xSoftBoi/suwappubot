/**
 * Chart and token detail endpoints for the webapp.
 *
 * Consumed by:
 * - Webapp: PriceChart component (GET /webapp/chart/:symbol)
 * - Webapp: TokenDetail page (GET /webapp/token/:symbol)
 */

import { Hono } from 'hono'

const chartRoutes = new Hono()

// ── Cache ────────────────────────────────────────────────────

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

const SYMBOL_TO_ID: Record<string, string> = {
	ETH: 'ethereum', SOL: 'solana', MATIC: 'matic-network', BNB: 'binancecoin',
	USDC: 'usd-coin', USDT: 'tether', DAI: 'dai', WBTC: 'wrapped-bitcoin',
	LINK: 'chainlink', UNI: 'uniswap', AAVE: 'aave', AVAX: 'avalanche-2',
	BONK: 'bonk', WIF: 'dogwifcoin', JTO: 'jito-governance-token',
	PYTH: 'pyth-network', PEPE: 'pepe', SHIB: 'shiba-inu', ARB: 'arbitrum',
	OP: 'optimism', DEGEN: 'degen-base', BRETT: 'brett', GMX: 'gmx',
	JUP: 'jupiter-exchange-solana', RAY: 'raydium', DOGE: 'dogecoin',
	BTC: 'bitcoin', ADA: 'cardano', DOT: 'polkadot', ATOM: 'cosmos',
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

function resolveSymbolToId(symbol: string): string {
	const upper = symbol.toUpperCase()
	return SYMBOL_TO_ID[upper] || symbol.toLowerCase()
}

// ── Chart Interval → CoinGecko days mapping ─────────────────

const INTERVAL_TO_DAYS: Record<string, number> = {
	'5s': 1, '1m': 1, '5m': 1, '15m': 1,
	'1h': 2, '4h': 14, '1d': 90,
}

/**
 * GET /webapp/chart/:symbol?chain=solana&interval=1h
 * Returns OHLCV candle data for PriceChart component.
 *
 * Response: { candles: [{ time, open, high, low, close }] }
 */
chartRoutes.get('/chart/:symbol', async (c) => {
	const symbol = c.req.param('symbol')
	const chain = c.req.query('chain') || 'solana'
	const interval = c.req.query('interval') || '1h'

	const coinId = resolveSymbolToId(symbol)
	const days = INTERVAL_TO_DAYS[interval] || 2
	const cacheKey = `chart:${coinId}:${chain}:${interval}`

	const cached = getCached<any>(cacheKey)
	if (cached) return c.json(cached)

	try {
		const data = await geckoFetch(
			`/coins/${coinId}/market_chart?vs_currency=usd&days=${days}`
		)

		const prices: Array<[number, number]> = data.prices || []

		// Convert price points to OHLCV candles
		const candles = pricesToCandles(prices, interval)

		const result = { candles }
		const ttl = interval === '5s' || interval === '1m' ? 15_000 : 60_000
		setCache(cacheKey, result, ttl)

		return c.json(result)
	} catch (error) {
		console.error('[Chart] Error:', error)
		return c.json({ candles: [] })
	}
})

/**
 * GET /webapp/token/:symbol
 * Returns aggregated token info for TokenDetail page.
 *
 * Response: { symbol, name, price, change24h, marketCap, volume24h,
 *             chain, address, safetyScore, safetyLevel, warnings }
 */
chartRoutes.get('/token/:symbol', async (c) => {
	const symbol = c.req.param('symbol')
	const coinId = resolveSymbolToId(symbol)
	const cacheKey = `token:${coinId}`

	const cached = getCached<any>(cacheKey)
	if (cached) return c.json(cached)

	try {
		const data = await geckoFetch(
			`/coins/${coinId}?localization=false&tickers=false&community_data=false&developer_data=false`
		)

		const md = data.market_data || {}

		// Determine primary chain from platforms
		const platforms = data.platforms || {}
		const chainKeys = Object.keys(platforms).filter(k => k)
		const primaryChain = chainKeys[0] || 'ethereum'
		const primaryAddress = platforms[primaryChain] || ''

		const result = {
			symbol: (data.symbol || symbol).toUpperCase(),
			name: data.name || symbol,
			price: md.current_price?.usd ?? 0,
			change24h: md.price_change_percentage_24h ?? 0,
			marketCap: md.market_cap?.usd ?? 0,
			volume24h: md.total_volume?.usd ?? 0,
			chain: primaryChain,
			address: primaryAddress,
			// Safety scoring - null when not available from this data source
			// GoPlus integration can be added here for on-chain safety analysis
			safetyScore: null,
			safetyLevel: null,
			warnings: [] as string[],
		}

		setCache(cacheKey, result, 60_000)
		return c.json(result)
	} catch (error) {
		console.error('[Token] Error:', error)
		return c.json({
			symbol: symbol.toUpperCase(),
			name: symbol,
			price: 0,
			change24h: 0,
			marketCap: 0,
			volume24h: 0,
			chain: 'unknown',
			address: '',
			safetyScore: null,
			safetyLevel: null,
			warnings: ['Token data unavailable'],
		})
	}
})

// ── Helpers ──────────────────────────────────────────────────

/**
 * Convert a series of [timestamp_ms, price] pairs into OHLCV candles
 * at the given interval granularity.
 */
function pricesToCandles(
	prices: Array<[number, number]>,
	interval: string,
): Array<{ time: number; open: number; high: number; low: number; close: number }> {
	if (prices.length === 0) return []

	// Interval duration in ms
	const intervalMs: Record<string, number> = {
		'5s': 5_000, '1m': 60_000, '5m': 300_000, '15m': 900_000,
		'1h': 3_600_000, '4h': 14_400_000, '1d': 86_400_000,
	}
	const bucketSize = intervalMs[interval] || 3_600_000

	const candles: Array<{ time: number; open: number; high: number; low: number; close: number }> = []
	let bucketStart = Math.floor(prices[0][0] / bucketSize) * bucketSize
	let open = prices[0][1]
	let high = prices[0][1]
	let low = prices[0][1]
	let close = prices[0][1]

	for (const [ts, price] of prices) {
		if (ts >= bucketStart + bucketSize) {
			// Finish current candle
			candles.push({
				time: Math.floor(bucketStart / 1000), // lightweight-charts expects seconds
				open, high, low, close,
			})

			// Start new bucket
			bucketStart = Math.floor(ts / bucketSize) * bucketSize
			open = price
			high = price
			low = price
			close = price
		} else {
			high = Math.max(high, price)
			low = Math.min(low, price)
			close = price
		}
	}

	// Last candle
	candles.push({
		time: Math.floor(bucketStart / 1000),
		open, high, low, close,
	})

	return candles
}

export { chartRoutes }
