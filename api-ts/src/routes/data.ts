/**
 * /v1/data/* — Databento-parity distribution layer (Phase 3,
 * docs/plans/market-data-parity.md).
 *
 * Reference: chain/token registries + symbol resolution.
 * Historical: OHLCV candles, served from `market_candles` (populated by the
 *   Python capture service — Phase 2) with an external fallback when the DB
 *   has no rows yet for a (symbol, chain, timeframe).
 * Live: WebSocket price ticks, polling the same cached price fetcher used by
 *   GET /v1/agent/prices (lib/prices.ts) every ~5s per subscribed symbol.
 * Metering: a lightweight per-caller request counter (see lib/dataUsage.ts).
 *
 * Most of this surface is plain Hono (matching routes/tokens.ts,
 * routes/internal.ts) — Effect-TS is used only for the DB read, mirroring how
 * every other Drizzle query in this codebase goes through requireDb/Effect
 * (see db/DrizzleService.ts), even from otherwise-plain route handlers.
 */
import { and, asc, eq, gt, gte, lte } from 'drizzle-orm'
import { Effect, Either } from 'effect'
import { Hono, type Context } from 'hono'
import { upgradeWebSocket } from 'hono/bun'
import type { WSContext } from 'hono/ws'
import { CHAINS } from '../services'
import {
	COMMON_TOKENS,
	ROBINHOOD_TOKEN_DECIMALS,
	SOLANA_TOKENS,
	TEMPO_TOKEN_DECIMALS,
} from '../config/tokenRegistry'
import { marketCandles, requireDb, type MarketCandle } from '../db'
import { agentError } from '../lib/agentError'
import { getDataUsage, recordDataUsage } from '../lib/dataUsage'
import { logger } from '../lib/logger'
import { COINGECKO_IDS, fetchTokenPrices } from '../lib/prices'
import { agentFlexAuth } from '../middleware/agentFlexAuth'
import { runEffectEither } from '../runtime'

type DataContext = { Variables: Record<string, unknown> }

const dataRoutes = new Hono<DataContext>()

// ===========================================
// AUTH + METERING — applies to every /v1/data/* route (incl. the WS upgrade)
// ===========================================
dataRoutes.use('*', agentFlexAuth())

/** Identify the caller for metering: org API key id, else agent uuid/id. */
function callerKeyOf(c: Context): string {
	const apiKeyCtx = c.get('apiKeyAuth') as { keyId: string } | undefined
	if (apiKeyCtx?.keyId) return `apikey:${apiKeyCtx.keyId}`
	const agent = c.get('agent') as { uuid?: string; id?: number } | undefined
	if (agent) return `agent:${agent.uuid ?? agent.id}`
	return 'unknown'
}

dataRoutes.use('*', async (c, next) => {
	await next()
	recordDataUsage(callerKeyOf(c), c.req.path)
})

// ===========================================
// REFERENCE
// ===========================================

// GET /v1/data/reference/chains — chain slugs + names from the existing chain config
dataRoutes.get('/reference/chains', (c) => {
	const evmChains = Object.values(CHAINS)
		.filter((chain, index, self) => index === self.findIndex((ch) => ch.id === chain.id))
		.map((chain) => ({
			slug: chain.key,
			chain_id: chain.id,
			name: chain.name,
			native_token: chain.nativeToken,
			type: 'evm' as const,
		}))

	const chains = [
		...evmChains,
		{ slug: 'solana', chain_id: 'solana' as const, name: 'Solana', native_token: 'SOL', type: 'solana' as const },
		{ slug: 'sui', chain_id: 'sui' as const, name: 'Sui', native_token: 'SUI', type: 'move' as const },
		{ slug: 'ton', chain_id: 'ton' as const, name: 'TON', native_token: 'TON', type: 'ton' as const },
	]

	return c.json({ success: true, chains })
})

function decimalsFor(chainId: number, symbol: string): number {
	if (chainId === 4217 && TEMPO_TOKEN_DECIMALS[symbol] !== undefined) return TEMPO_TOKEN_DECIMALS[symbol]
	if (chainId === 4663 && ROBINHOOD_TOKEN_DECIMALS[symbol] !== undefined) return ROBINHOOD_TOKEN_DECIMALS[symbol]
	return symbol === 'USDC' || symbol === 'USDT' || symbol.includes('USDC') ? 6 : 18
}

// GET /v1/data/reference/tokens?chain= — consolidated COMMON_TOKENS/SOLANA_TOKENS registry
dataRoutes.get('/reference/tokens', (c) => {
	const chainParam = c.req.query('chain')?.toLowerCase().trim()

	if (chainParam === 'solana' || chainParam === 'sol') {
		const tokens = Object.entries(SOLANA_TOKENS).map(([symbol, info]) => ({
			symbol,
			address: info.address,
			decimals: info.decimals,
			name: info.name,
		}))
		return c.json({ success: true, chain: 'solana', tokens })
	}

	if (chainParam) {
		const chainInfo = CHAINS[chainParam]
		if (!chainInfo) {
			return agentError(c, 400, 'CHAIN_UNSUPPORTED', `Unknown chain: ${chainParam}`, {
				supported: [...new Set(Object.values(CHAINS).map((ch) => ch.key))].concat('solana'),
			})
		}
		const chainTokens = COMMON_TOKENS[chainInfo.id] ?? {}
		const tokens = Object.entries(chainTokens).map(([symbol, address]) => ({
			symbol,
			address,
			decimals: decimalsFor(chainInfo.id, symbol),
		}))
		return c.json({ success: true, chain: chainInfo.key, chain_id: chainInfo.id, tokens })
	}

	// No chain given — return every chain's registry
	const chains = Object.entries(COMMON_TOKENS).map(([chainIdStr, tokens]) => {
		const chainId = Number(chainIdStr)
		return {
			chain_id: chainId,
			tokens: Object.entries(tokens).map(([symbol, address]) => ({
				symbol,
				address,
				decimals: decimalsFor(chainId, symbol),
			})),
		}
	})
	chains.push({
		// @ts-expect-error chain_id is numeric elsewhere; solana is the one string exception
		chain_id: 'solana',
		tokens: Object.entries(SOLANA_TOKENS).map(([symbol, info]) => ({
			symbol,
			address: info.address,
			decimals: info.decimals,
		})),
	})

	return c.json({ success: true, chains })
})

// GET /v1/data/reference/resolve?symbol=&chain= — canonical address/decimals/coingecko id
dataRoutes.get('/reference/resolve', (c) => {
	const symbolParam = c.req.query('symbol')?.trim()
	const chainParam = c.req.query('chain')?.toLowerCase().trim()

	if (!symbolParam || !chainParam) {
		return agentError(c, 400, 'VALIDATION_ERROR', 'symbol and chain query parameters are required', {
			hint: 'GET /v1/data/reference/resolve?symbol=ETH&chain=base',
		})
	}

	const symbol = symbolParam.toUpperCase()
	const coingeckoId = COINGECKO_IDS[symbol.toLowerCase()] ?? null

	if (chainParam === 'solana' || chainParam === 'sol') {
		const info = SOLANA_TOKENS[symbol]
		if (!info) {
			return agentError(c, 404, 'TOKEN_UNKNOWN', `Token not found on Solana: ${symbol}`)
		}
		return c.json({
			success: true,
			symbol,
			chain: 'solana',
			address: info.address,
			decimals: info.decimals,
			coingecko_id: coingeckoId,
		})
	}

	const chainInfo = CHAINS[chainParam]
	if (!chainInfo) {
		return agentError(c, 400, 'CHAIN_UNSUPPORTED', `Unknown chain: ${chainParam}`)
	}
	const address = COMMON_TOKENS[chainInfo.id]?.[symbol]
	if (!address) {
		return agentError(c, 404, 'TOKEN_UNKNOWN', `Token not found: ${symbol} on ${chainInfo.name}`)
	}

	return c.json({
		success: true,
		symbol,
		chain: chainInfo.key,
		chain_id: chainInfo.id,
		address,
		decimals: decimalsFor(chainInfo.id, symbol),
		coingecko_id: coingeckoId,
	})
})

// ===========================================
// HISTORICAL — OHLCV
// ===========================================

const VALID_TIMEFRAMES = ['1m', '5m', '1h', '1d'] as const
type Timeframe = (typeof VALID_TIMEFRAMES)[number]

const MAX_LIMIT = 1000
const DEFAULT_LIMIT = 500

/** Parse a start/end query param: accepts an ISO 8601 string or unix seconds. */
function parseTimestamp(raw: string | undefined): Date | null {
	if (!raw) return null
	const asNumber = Number(raw)
	if (Number.isFinite(asNumber) && raw.trim() !== '') {
		// Treat as unix seconds unless it's already millisecond-scale
		const ms = asNumber > 1e12 ? asNumber : asNumber * 1000
		const d = new Date(ms)
		return Number.isNaN(d.getTime()) ? null : d
	}
	const d = new Date(raw)
	return Number.isNaN(d.getTime()) ? null : d
}

interface OhlcvCandle {
	ts: string
	open: string
	high: string
	low: string
	close: string
	volume: string | null
	source: string
}

function candleFromRow(row: MarketCandle): OhlcvCandle {
	return {
		ts: row.ts instanceof Date ? row.ts.toISOString() : new Date(row.ts as unknown as string).toISOString(),
		open: row.open,
		high: row.high,
		low: row.low,
		close: row.close,
		volume: row.volume,
		source: row.source,
	}
}

/**
 * External fallback when market_candles has zero rows for this
 * (symbol, chain, timeframe) — the Python capture service (Phase 2) may not
 * have backfilled this pair yet. Mirrors the DexScreener fetch pattern
 * already used by routes/webapp.ts's `/tokens/:chain/:address/chart` and
 * routes/internal.ts's `/token/price`: search DexScreener for the symbol,
 * pick the highest-liquidity pair on the requested chain, and synthesize a
 * short candle series from its priceChange buckets (h24/h6/h1/m5) — the same
 * synthetic-candle technique webapp.ts already uses when it has no persisted
 * OHLCV to serve.
 */
async function fetchExternalOhlcvFallback(
	symbol: string,
	chain: string,
	limit: number,
): Promise<OhlcvCandle[]> {
	try {
		const res = await fetch(
			`https://api.dexscreener.com/latest/dex/search?q=${encodeURIComponent(symbol)}`,
			{ headers: { Accept: 'application/json' } },
		)
		if (!res.ok) return []

		const data = (await res.json()) as {
			pairs?: Array<{
				chainId?: string
				priceUsd?: string
				liquidity?: { usd?: number }
				priceChange?: { h24?: number; h6?: number; h1?: number; m5?: number }
				baseToken?: { symbol?: string }
			}>
		}

		const candidates = (data.pairs ?? []).filter(
			(p) =>
				p.chainId?.toLowerCase() === chain.toLowerCase() &&
				p.baseToken?.symbol?.toUpperCase() === symbol.toUpperCase() &&
				p.priceUsd,
		)
		if (candidates.length === 0) return []

		const best = candidates.reduce((a, b) => ((b.liquidity?.usd ?? 0) > (a.liquidity?.usd ?? 0) ? b : a))
		const currentPrice = parseFloat(best.priceUsd as string)
		if (!Number.isFinite(currentPrice)) return []

		const now = Date.now()
		const buckets: Array<{ change: number; offsetMs: number }> = [
			{ change: best.priceChange?.h24 ?? 0, offsetMs: 86_400_000 },
			{ change: best.priceChange?.h6 ?? 0, offsetMs: 21_600_000 },
			{ change: best.priceChange?.h1 ?? 0, offsetMs: 3_600_000 },
			{ change: best.priceChange?.m5 ?? 0, offsetMs: 300_000 },
		]

		const candles: OhlcvCandle[] = []
		let price = currentPrice
		for (const bucket of buckets) {
			const prevPrice = price / (1 + bucket.change / 100)
			const high = Math.max(price, prevPrice) * (1 + Math.abs(bucket.change) / 200)
			const low = Math.min(price, prevPrice) * (1 - Math.abs(bucket.change) / 200)
			candles.unshift({
				ts: new Date(now - bucket.offsetMs).toISOString(),
				open: prevPrice.toString(),
				high: high.toString(),
				low: low.toString(),
				close: price.toString(),
				volume: null,
				source: 'external_fallback',
			})
			price = prevPrice
		}

		return candles.slice(-limit)
	} catch (err) {
		logger.error({ err }, '[data] external OHLCV fallback failed')
		return []
	}
}

// GET /v1/data/history/ohlcv?symbol=&chain=&timeframe=1h&start=&end=&limit=
dataRoutes.get('/history/ohlcv', async (c) => {
	const symbol = c.req.query('symbol')?.trim().toUpperCase()
	const chain = c.req.query('chain')?.trim().toLowerCase()
	const timeframeParam = (c.req.query('timeframe') ?? '1h').trim().toLowerCase()
	const startParam = c.req.query('start')
	const endParam = c.req.query('end')
	const limitParam = c.req.query('limit')

	if (!symbol || !chain) {
		return agentError(c, 400, 'VALIDATION_ERROR', 'symbol and chain query parameters are required', {
			hint: 'GET /v1/data/history/ohlcv?symbol=ETH&chain=base&timeframe=1h',
		})
	}

	if (!VALID_TIMEFRAMES.includes(timeframeParam as Timeframe)) {
		return agentError(c, 400, 'VALIDATION_ERROR', `Invalid timeframe: ${timeframeParam}`, {
			supported: VALID_TIMEFRAMES,
		})
	}
	const timeframe = timeframeParam as Timeframe

	const start = parseTimestamp(startParam)
	if (startParam && !start) {
		return agentError(c, 400, 'VALIDATION_ERROR', `Invalid start timestamp: ${startParam}`)
	}
	const end = parseTimestamp(endParam)
	if (endParam && !end) {
		return agentError(c, 400, 'VALIDATION_ERROR', `Invalid end timestamp: ${endParam}`)
	}

	let limit = DEFAULT_LIMIT
	if (limitParam) {
		const parsed = parseInt(limitParam, 10)
		if (!Number.isFinite(parsed) || parsed <= 0) {
			return agentError(c, 400, 'VALIDATION_ERROR', `Invalid limit: ${limitParam}`)
		}
		limit = Math.min(parsed, MAX_LIMIT)
	}

	const dbResult = await runEffectEither(
		Effect.gen(function* () {
			const db = yield* requireDb
			const conditions = [eq(marketCandles.symbol, symbol), eq(marketCandles.chain, chain), eq(marketCandles.timeframe, timeframe)]
			if (start) conditions.push(gte(marketCandles.ts, start))
			if (end) conditions.push(lte(marketCandles.ts, end))

			return yield* Effect.tryPromise({
				try: () =>
					db
						.select()
						.from(marketCandles)
						.where(and(...conditions))
						.orderBy(asc(marketCandles.ts))
						.limit(limit),
				catch: (e) => (e instanceof Error ? e : new Error(String(e))),
			})
		}),
	)

	// DB unavailable/errored — fall through to the external fallback rather
	// than 500ing; DATABASE_URL being unset in a dev environment shouldn't
	// break this read-only surface.
	const rows: MarketCandle[] = Either.isRight(dbResult) ? dbResult.right : []
	if (Either.isLeft(dbResult)) {
		logger.error({ err: dbResult.left }, '[data] market_candles query failed')
	}

	if (rows.length > 0) {
		return c.json({
			success: true,
			symbol,
			chain,
			timeframe,
			source: 'db',
			candles: rows.map(candleFromRow),
		})
	}

	const fallbackCandles = await fetchExternalOhlcvFallback(symbol, chain, limit)
	return c.json({
		success: true,
		symbol,
		chain,
		timeframe,
		source: 'external_fallback',
		candles: fallbackCandles,
		note:
			fallbackCandles.length === 0
				? 'No persisted candles and no external fallback match — this pair may not be tracked yet.'
				: 'No persisted candles yet; synthesized from live DexScreener price-change data (not exact historical OHLCV).',
	})
})

// ===========================================
// LIVE — WebSocket price ticks
// ===========================================

interface LiveConnection {
	ws: WSContext | null
	symbols: Set<string>
}

const liveConnections = new Set<LiveConnection>()
const LIVE_TICK_INTERVAL_MS = 5_000
let liveTicker: ReturnType<typeof setInterval> | null = null

function ensureLiveTicker() {
	if (liveTicker) return
	liveTicker = setInterval(() => {
		void broadcastLiveTicks()
	}, LIVE_TICK_INTERVAL_MS)
}

async function broadcastLiveTicks() {
	if (liveConnections.size === 0) return

	const symbols = new Set<string>()
	for (const conn of liveConnections) {
		for (const s of conn.symbols) symbols.add(s)
	}
	if (symbols.size === 0) return

	const prices = await fetchTokenPrices([...symbols])
	const ts = new Date().toISOString()

	for (const conn of liveConnections) {
		if (!conn.ws) continue
		for (const symbol of conn.symbols) {
			const price = prices[symbol]
			if (!price) continue
			try {
				conn.ws.send(JSON.stringify({ type: 'tick', symbol, price_usd: price.usd, ts }))
			} catch (err) {
				logger.warn({ err, symbol }, '[data] live tick send failed, dropping connection')
				liveConnections.delete(conn)
			}
		}
	}
}

/** Exposed for graceful shutdown (mirrors stopAgentCleanup/stopA2aCleanup in index.ts). */
export function stopDataLiveTicker() {
	if (liveTicker) {
		clearInterval(liveTicker)
		liveTicker = null
	}
	liveConnections.clear()
}

// GET /v1/data/live — WS. Client: {"action":"subscribe"|"unsubscribe","symbols":["ETH","SOL"]}
// Server: {"type":"tick","symbol","price_usd","ts"} pushed ~every 5s per subscribed symbol.
dataRoutes.get(
	'/live',
	upgradeWebSocket(() => {
		const conn: LiveConnection = { ws: null, symbols: new Set() }

		return {
			onOpen(_evt, ws) {
				conn.ws = ws
				liveConnections.add(conn)
				ensureLiveTicker()
				ws.send(JSON.stringify({ type: 'connected', hint: 'Send {"action":"subscribe","symbols":["ETH"]}' }))
			},
			onMessage(evt, ws) {
				let msg: { action?: string; symbols?: unknown }
				try {
					msg = JSON.parse(String(evt.data)) as { action?: string; symbols?: unknown }
				} catch {
					ws.send(JSON.stringify({ type: 'error', message: 'Invalid JSON message' }))
					return
				}

				const symbols = Array.isArray(msg.symbols)
					? msg.symbols.filter((s): s is string => typeof s === 'string').map((s) => s.toUpperCase())
					: []

				if (msg.action === 'subscribe') {
					for (const s of symbols) conn.symbols.add(s)
					ws.send(JSON.stringify({ type: 'subscribed', symbols: [...conn.symbols] }))
				} else if (msg.action === 'unsubscribe') {
					for (const s of symbols) conn.symbols.delete(s)
					ws.send(JSON.stringify({ type: 'unsubscribed', symbols: [...conn.symbols] }))
				} else {
					ws.send(
						JSON.stringify({
							type: 'error',
							message: 'Unknown action — expected "subscribe" or "unsubscribe"',
						}),
					)
				}
			},
			onClose() {
				liveConnections.delete(conn)
			},
			onError() {
				liveConnections.delete(conn)
			},
		}
	}),
)

// ===========================================
// USAGE
// ===========================================

// GET /v1/data/usage — this caller's /v1/data/* request counts (in-memory, per-instance)
dataRoutes.get('/usage', (c) => {
	const key = callerKeyOf(c)
	return c.json({ success: true, ...getDataUsage(key) })
})

export { dataRoutes }
