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

interface ResolveEntry {
	symbol: string
	chain: string
	chain_id?: number | 'solana'
	address: string
	decimals: number
	coingecko_id: string | null
}

/** Resolve one symbol on one specific chain slug ('solana'/'sol' included). Null when unknown. */
function resolveSymbolOnChain(symbol: string, chainParam: string): ResolveEntry | null {
	const coingeckoId = COINGECKO_IDS[symbol.toLowerCase()] ?? null

	if (chainParam === 'solana' || chainParam === 'sol') {
		const info = SOLANA_TOKENS[symbol]
		if (!info) return null
		return { symbol, chain: 'solana', chain_id: 'solana', address: info.address, decimals: info.decimals, coingecko_id: coingeckoId }
	}

	const chainInfo = CHAINS[chainParam]
	if (!chainInfo) return null
	const address = COMMON_TOKENS[chainInfo.id]?.[symbol]
	if (!address) return null
	return {
		symbol,
		chain: chainInfo.key,
		chain_id: chainInfo.id,
		address,
		decimals: decimalsFor(chainInfo.id, symbol),
		coingecko_id: coingeckoId,
	}
}

/** Resolve a symbol across every chain we know a registry for (no `chain` param given). */
function resolveSymbolAllChains(symbol: string): ResolveEntry[] {
	const entries: ResolveEntry[] = []
	const seenKeys = new Set<string>()
	for (const chain of Object.values(CHAINS)) {
		if (seenKeys.has(chain.key)) continue
		seenKeys.add(chain.key)
		const entry = resolveSymbolOnChain(symbol, chain.key)
		if (entry) entries.push(entry)
	}
	const solEntry = resolveSymbolOnChain(symbol, 'solana')
	if (solEntry) entries.push(solEntry)
	return entries
}

/** Reverse lookup: canonical address (+ required chain) -> symbol/decimals. */
function resolveAddressOnChain(address: string, chainParam: string): ResolveEntry | null {
	const addrLower = address.toLowerCase()

	if (chainParam === 'solana' || chainParam === 'sol') {
		const found = Object.entries(SOLANA_TOKENS).find(([, info]) => info.address.toLowerCase() === addrLower)
		if (!found) return null
		const [symbol, info] = found
		return {
			symbol,
			chain: 'solana',
			chain_id: 'solana',
			address: info.address,
			decimals: info.decimals,
			coingecko_id: COINGECKO_IDS[symbol.toLowerCase()] ?? null,
		}
	}

	const chainInfo = CHAINS[chainParam]
	if (!chainInfo) return null
	const chainTokens = COMMON_TOKENS[chainInfo.id] ?? {}
	const found = Object.entries(chainTokens).find(([, addr]) => addr.toLowerCase() === addrLower)
	if (!found) return null
	const [symbol, addr] = found
	return {
		symbol,
		chain: chainInfo.key,
		chain_id: chainInfo.id,
		address: addr,
		decimals: decimalsFor(chainInfo.id, symbol),
		coingecko_id: COINGECKO_IDS[symbol.toLowerCase()] ?? null,
	}
}

// GET /v1/data/reference/resolve
//   ?symbol=&chain=       — single symbol, single chain (legacy, unchanged shape)
//   ?symbol=              — single symbol, no chain -> entries across every known chain
//   ?symbols=A,B[&chain=] — batch resolve, grouped by symbol
//   ?address=0x..&chain=  — reverse lookup: address -> symbol/decimals
dataRoutes.get('/reference/resolve', (c) => {
	const addressParam = c.req.query('address')?.trim()
	const chainParam = c.req.query('chain')?.toLowerCase().trim()

	if (addressParam) {
		if (!chainParam) {
			return agentError(c, 400, 'VALIDATION_ERROR', 'chain query parameter is required with address', {
				hint: 'GET /v1/data/reference/resolve?address=0x...&chain=base',
			})
		}
		if (!CHAINS[chainParam] && chainParam !== 'solana' && chainParam !== 'sol') {
			return agentError(c, 400, 'CHAIN_UNSUPPORTED', `Unknown chain: ${chainParam}`)
		}
		const resolved = resolveAddressOnChain(addressParam, chainParam)
		if (!resolved) {
			return agentError(c, 404, 'TOKEN_UNKNOWN', `No token found for address ${addressParam} on ${chainParam}`)
		}
		return c.json({ success: true, ...resolved })
	}

	const symbolParam = c.req.query('symbol')?.trim()
	const symbolsParam = c.req.query('symbols')?.trim()
	const symbols = symbolsParam
		? [...new Set(symbolsParam.split(',').map((s) => s.trim().toUpperCase()).filter(Boolean))]
		: symbolParam
			? [symbolParam.toUpperCase()]
			: []

	if (symbols.length === 0) {
		return agentError(c, 400, 'VALIDATION_ERROR', 'symbol, symbols, or address query parameter is required', {
			hint: 'GET /v1/data/reference/resolve?symbol=ETH&chain=base | ?symbols=ETH,SOL | ?address=0x...&chain=base',
		})
	}

	if (chainParam && !CHAINS[chainParam] && chainParam !== 'solana' && chainParam !== 'sol') {
		return agentError(c, 400, 'CHAIN_UNSUPPORTED', `Unknown chain: ${chainParam}`)
	}

	// Batch mode (`symbols=`) — always a grouped response, one entry per symbol.
	if (symbolsParam) {
		const results: Record<string, ResolveEntry[]> = {}
		for (const symbol of symbols) {
			results[symbol] = chainParam
				? (() => {
						const entry = resolveSymbolOnChain(symbol, chainParam)
						return entry ? [entry] : []
					})()
				: resolveSymbolAllChains(symbol)
		}
		return c.json({ success: true, symbols, results })
	}

	// Single `symbol=` — legacy flat shape when chain is given; array-of-chains when it isn't.
	const symbol = symbols[0] as string
	if (chainParam) {
		const entry = resolveSymbolOnChain(symbol, chainParam)
		if (!entry) {
			return agentError(c, 404, 'TOKEN_UNKNOWN', `Token not found: ${symbol} on ${chainParam}`)
		}
		return c.json({ success: true, ...entry })
	}

	const entries = resolveSymbolAllChains(symbol)
	if (entries.length === 0) {
		return agentError(c, 404, 'TOKEN_UNKNOWN', `Token not found on any known chain: ${symbol}`)
	}
	return c.json({ success: true, symbol, chains: entries })
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

/** Opaque cursor codec — base64 of the last emitted candle's ISO timestamp. */
function decodeCursor(raw: string | undefined): Date | null {
	if (!raw) return null
	try {
		const decoded = Buffer.from(raw, 'base64').toString('utf8')
		const d = new Date(decoded)
		return Number.isNaN(d.getTime()) ? null : d
	} catch {
		return null
	}
}
function encodeCursor(ts: Date): string {
	return Buffer.from(ts.toISOString(), 'utf8').toString('base64')
}

interface SymbolOhlcvResult {
	candles: OhlcvCandle[]
	source: 'db' | 'external_fallback'
	/** True when the DB page came back exactly `limit` rows — a same-cursor heuristic, not a guaranteed count. */
	hasMore: boolean
	lastTs: Date | null
}

async function fetchDbCandles(
	symbol: string,
	chain: string,
	timeframe: Timeframe,
	start: Date | null,
	end: Date | null,
	limit: number,
	cursorTs: Date | null,
) {
	return runEffectEither(
		Effect.gen(function* () {
			const db = yield* requireDb
			const conditions = [eq(marketCandles.symbol, symbol), eq(marketCandles.chain, chain), eq(marketCandles.timeframe, timeframe)]
			if (start) conditions.push(gte(marketCandles.ts, start))
			if (end) conditions.push(lte(marketCandles.ts, end))
			if (cursorTs) conditions.push(gt(marketCandles.ts, cursorTs))

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
}

async function resolveSymbolCandles(
	symbol: string,
	chain: string,
	timeframe: Timeframe,
	start: Date | null,
	end: Date | null,
	limit: number,
	cursorTs: Date | null,
): Promise<SymbolOhlcvResult> {
	const dbResult = await fetchDbCandles(symbol, chain, timeframe, start, end, limit, cursorTs)
	const rows: MarketCandle[] = Either.isRight(dbResult) ? dbResult.right : []
	if (Either.isLeft(dbResult)) {
		logger.error({ err: dbResult.left }, '[data] market_candles query failed')
	}

	if (rows.length > 0) {
		const lastRow = rows[rows.length - 1] as MarketCandle
		const lastTs = lastRow.ts instanceof Date ? lastRow.ts : new Date(lastRow.ts as unknown as string)
		return { candles: rows.map(candleFromRow), source: 'db', hasMore: rows.length === limit, lastTs }
	}

	const fallbackCandles = await fetchExternalOhlcvFallback(symbol, chain, limit)
	return { candles: fallbackCandles, source: 'external_fallback', hasMore: false, lastTs: null }
}

// GET /v1/data/history/ohlcv?symbol=&chain=&timeframe=1h&start=&end=&limit=&format=&cursor=
//   symbol=ETH               — legacy single-symbol response (flat shape, backward compat)
//   symbols=ETH,SOL          — grouped multi-symbol response
//   format=csv               — text/csv instead of JSON (header:
//                               symbol,chain,timeframe,ts,open,high,low,close,volume,source)
//   cursor=<base64 last ts>  — pagination; response includes next_cursor when more rows exist
dataRoutes.get('/history/ohlcv', async (c) => {
	const chain = c.req.query('chain')?.trim().toLowerCase()
	const symbolParam = c.req.query('symbol')?.trim().toUpperCase()
	const symbolsParam = c.req.query('symbols')?.trim()
	const timeframeParam = (c.req.query('timeframe') ?? '1h').trim().toLowerCase()
	const startParam = c.req.query('start')
	const endParam = c.req.query('end')
	const limitParam = c.req.query('limit')
	const formatParam = (c.req.query('format') ?? 'json').trim().toLowerCase()
	const cursorParam = c.req.query('cursor')

	const symbolList = symbolsParam
		? [...new Set(symbolsParam.split(',').map((s) => s.trim().toUpperCase()).filter(Boolean))]
		: symbolParam
			? [symbolParam]
			: []

	if (symbolList.length === 0 || !chain) {
		return agentError(c, 400, 'VALIDATION_ERROR', 'symbol (or symbols) and chain query parameters are required', {
			hint: 'GET /v1/data/history/ohlcv?symbol=ETH&chain=base&timeframe=1h',
		})
	}

	if (!VALID_TIMEFRAMES.includes(timeframeParam as Timeframe)) {
		return agentError(c, 400, 'VALIDATION_ERROR', `Invalid timeframe: ${timeframeParam}`, {
			supported: VALID_TIMEFRAMES,
		})
	}
	const timeframe = timeframeParam as Timeframe

	if (formatParam !== 'json' && formatParam !== 'csv') {
		return agentError(c, 400, 'VALIDATION_ERROR', `Invalid format: ${formatParam}`, { supported: ['json', 'csv'] })
	}

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

	let cursorTs: Date | null = null
	if (cursorParam) {
		cursorTs = decodeCursor(cursorParam)
		if (!cursorTs) {
			return agentError(c, 400, 'VALIDATION_ERROR', `Invalid cursor: ${cursorParam}`)
		}
	}

	const perSymbol = await Promise.all(
		symbolList.map(
			async (symbol) => [symbol, await resolveSymbolCandles(symbol, chain, timeframe, start, end, limit, cursorTs)] as const,
		),
	)

	// Same cursor applied to every symbol's query — next_cursor is the MIN of
	// each overflowing symbol's last-returned ts, so re-requesting with it
	// can't skip a row for any symbol (may re-return a few already-seen rows
	// for symbols that hadn't overflowed yet, which is a safe trade-off for
	// a multi-symbol page boundary).
	const overflowTs = perSymbol.filter(([, r]) => r.hasMore && r.lastTs).map(([, r]) => r.lastTs as Date)
	const nextCursor = overflowTs.length > 0 ? encodeCursor(overflowTs.reduce((a, b) => (a < b ? a : b))) : null

	if (formatParam === 'csv') {
		const lines = ['symbol,chain,timeframe,ts,open,high,low,close,volume,source']
		for (const [symbol, r] of perSymbol) {
			for (const candle of r.candles) {
				lines.push(
					[symbol, chain, timeframe, candle.ts, candle.open, candle.high, candle.low, candle.close, candle.volume ?? '', candle.source].join(','),
				)
			}
		}
		c.header('Content-Type', 'text/csv; charset=utf-8')
		if (nextCursor) c.header('X-Next-Cursor', nextCursor)
		return c.body(lines.join('\n') + '\n')
	}

	if (symbolsParam) {
		const symbols: Record<string, { source: string; candles: OhlcvCandle[] }> = {}
		for (const [symbol, r] of perSymbol) symbols[symbol] = { source: r.source, candles: r.candles }
		return c.json({
			success: true,
			chain,
			timeframe,
			symbols,
			...(nextCursor ? { next_cursor: nextCursor } : {}),
		})
	}

	const first = perSymbol[0] as (typeof perSymbol)[number]
	const only = first[1]
	return c.json({
		success: true,
		symbol: symbolList[0],
		chain,
		timeframe,
		source: only.source,
		candles: only.candles,
		...(nextCursor ? { next_cursor: nextCursor } : {}),
		...(only.source === 'external_fallback'
			? {
					note:
						only.candles.length === 0
							? 'No persisted candles and no external fallback match — this pair may not be tracked yet.'
							: 'No persisted candles yet; synthesized from live DexScreener price-change data (not exact historical OHLCV).',
				}
			: {}),
	})
})

// ===========================================
// LIVE — WebSocket price ticks
// ===========================================

interface LiveConnection {
	ws: WSContext | null
	/** Plain tick channel — unchanged protocol. */
	tickSymbols: Set<string>
	/** ohlcv channel, 1m only for now. */
	candleSymbols: Set<string>
}

const liveConnections = new Set<LiveConnection>()

// One shared poller per process. Short poll interval so a real price change
// (the underlying fetchTokenPrices cache is ~60s TTL) is picked up quickly;
// KEEPALIVE_MS bounds how long a subscriber can go without ANY message so
// dead-air doesn't look like a dropped connection.
const LIVE_POLL_INTERVAL_MS = 2_000
const LIVE_KEEPALIVE_MS = 30_000
let livePoller: ReturnType<typeof setInterval> | null = null

// Shared, symbol-keyed state — not per-connection, so "did the price change"
// is computed once per poll regardless of subscriber count.
const lastPrice = new Map<string, number>()
const lastBroadcastAt = new Map<string, number>()

interface InProgressCandle {
	minuteStart: number
	open: number
	high: number
	low: number
	close: number
}
const candleState = new Map<string, InProgressCandle>()

function ensureLivePoller() {
	if (livePoller) return
	livePoller = setInterval(() => {
		void pollAndBroadcastLive()
	}, LIVE_POLL_INTERVAL_MS)
}

function sendToConn(conn: LiveConnection, payload: unknown) {
	if (!conn.ws) return
	try {
		conn.ws.send(JSON.stringify(payload))
	} catch (err) {
		logger.warn({ err }, '[data] live send failed, dropping connection')
		liveConnections.delete(conn)
	}
}

function broadcastTick(symbol: string, payload: unknown) {
	for (const conn of liveConnections) {
		if (conn.tickSymbols.has(symbol)) sendToConn(conn, payload)
	}
}

function broadcastCandle(symbol: string, payload: unknown) {
	for (const conn of liveConnections) {
		if (conn.candleSymbols.has(symbol)) sendToConn(conn, payload)
	}
}

function candleFrame(symbol: string, state: InProgressCandle, final: boolean) {
	return {
		type: 'candle',
		channel: 'ohlcv',
		timeframe: '1m',
		symbol,
		final,
		ts: new Date(state.minuteStart).toISOString(),
		open: state.open,
		high: state.high,
		low: state.low,
		close: state.close,
	}
}

/** Shared poll: fetch prices once for every symbol any connection cares about, then push-on-change (or 30s keepalive) per channel. */
async function pollAndBroadcastLive() {
	if (liveConnections.size === 0) return

	const tickSymbols = new Set<string>()
	const candleSymbols = new Set<string>()
	for (const conn of liveConnections) {
		for (const s of conn.tickSymbols) tickSymbols.add(s)
		for (const s of conn.candleSymbols) candleSymbols.add(s)
	}
	const allSymbols = new Set([...tickSymbols, ...candleSymbols])
	if (allSymbols.size === 0) return

	const prices = await fetchTokenPrices([...allSymbols])
	const now = Date.now()
	const nowIso = new Date(now).toISOString()
	const minuteStart = Math.floor(now / 60_000) * 60_000

	for (const symbol of allSymbols) {
		const price = prices[symbol]
		if (!price) continue

		const prevPrice = lastPrice.get(symbol)
		const changed = prevPrice === undefined || prevPrice !== price.usd
		const lastSent = lastBroadcastAt.get(symbol) ?? 0
		const dueForKeepalive = now - lastSent >= LIVE_KEEPALIVE_MS
		let broadcastAny = false

		if (tickSymbols.has(symbol) && (changed || dueForKeepalive)) {
			broadcastTick(symbol, { type: 'tick', symbol, price_usd: price.usd, ts: nowIso })
			broadcastAny = true
		}

		if (candleSymbols.has(symbol)) {
			let state = candleState.get(symbol)
			if (!state || state.minuteStart !== minuteStart) {
				if (state) {
					// Minute closed — final frame for the candle that just ended.
					broadcastCandle(symbol, candleFrame(symbol, state, true))
				}
				state = { minuteStart, open: price.usd, high: price.usd, low: price.usd, close: price.usd }
				candleState.set(symbol, state)
				broadcastCandle(symbol, candleFrame(symbol, state, false))
				broadcastAny = true
			} else if (changed) {
				state.high = Math.max(state.high, price.usd)
				state.low = Math.min(state.low, price.usd)
				state.close = price.usd
				broadcastCandle(symbol, candleFrame(symbol, state, false))
				broadcastAny = true
			} else if (dueForKeepalive) {
				broadcastCandle(symbol, candleFrame(symbol, state, false))
				broadcastAny = true
			}
		}

		lastPrice.set(symbol, price.usd)
		if (broadcastAny) lastBroadcastAt.set(symbol, now)
	}
}

/** Exposed for graceful shutdown (mirrors stopAgentCleanup/stopA2aCleanup in index.ts). */
export function stopDataLiveTicker() {
	if (livePoller) {
		clearInterval(livePoller)
		livePoller = null
	}
	liveConnections.clear()
	lastPrice.clear()
	lastBroadcastAt.clear()
	candleState.clear()
}

// GET /v1/data/live — WS.
//
// Tick channel (default, unchanged protocol):
//   Client: {"action":"subscribe"|"unsubscribe","symbols":["ETH","SOL"]}
//   Server: {"type":"tick","symbol","price_usd","ts"} — pushed on price
//     change, or every ~30s as a keepalive if unchanged.
//
// Candle channel (1m OHLCV):
//   Client: {"action":"subscribe"|"unsubscribe","channel":"ohlcv","timeframe":"1m","symbols":[...]}
//   Server: {"type":"candle","channel":"ohlcv","timeframe":"1m","symbol","final","ts","open","high","low","close"}
//     — pushed on price change (final:false, in-progress candle), plus one
//     final:true frame when the minute closes.
dataRoutes.get(
	'/live',
	upgradeWebSocket(() => {
		const conn: LiveConnection = { ws: null, tickSymbols: new Set(), candleSymbols: new Set() }

		return {
			onOpen(_evt, ws) {
				conn.ws = ws
				liveConnections.add(conn)
				ensureLivePoller()
				ws.send(
					JSON.stringify({
						type: 'connected',
						hint: 'Send {"action":"subscribe","symbols":["ETH"]} for ticks, or {"action":"subscribe","channel":"ohlcv","timeframe":"1m","symbols":["ETH"]} for 1m candles',
					}),
				)
			},
			onMessage(evt, ws) {
				let msg: { action?: string; symbols?: unknown; channel?: string; timeframe?: string }
				try {
					msg = JSON.parse(String(evt.data)) as {
						action?: string
						symbols?: unknown
						channel?: string
						timeframe?: string
					}
				} catch {
					ws.send(JSON.stringify({ type: 'error', message: 'Invalid JSON message' }))
					return
				}

				const symbols = Array.isArray(msg.symbols)
					? msg.symbols.filter((s): s is string => typeof s === 'string').map((s) => s.toUpperCase())
					: []

				if (msg.channel === 'ohlcv') {
					if (msg.timeframe !== '1m') {
						ws.send(JSON.stringify({ type: 'error', message: 'Only timeframe "1m" is supported on the ohlcv channel' }))
						return
					}
					if (msg.action === 'subscribe') {
						for (const s of symbols) {
							conn.candleSymbols.add(s)
							const state = candleState.get(s)
							if (state) sendToConn(conn, candleFrame(s, state, false))
						}
						ws.send(JSON.stringify({ type: 'subscribed', channel: 'ohlcv', timeframe: '1m', symbols: [...conn.candleSymbols] }))
					} else if (msg.action === 'unsubscribe') {
						for (const s of symbols) conn.candleSymbols.delete(s)
						ws.send(JSON.stringify({ type: 'unsubscribed', channel: 'ohlcv', timeframe: '1m', symbols: [...conn.candleSymbols] }))
					} else {
						ws.send(JSON.stringify({ type: 'error', message: 'Unknown action — expected "subscribe" or "unsubscribe"' }))
					}
					return
				}

				if (msg.action === 'subscribe') {
					for (const s of symbols) conn.tickSymbols.add(s)
					ws.send(JSON.stringify({ type: 'subscribed', symbols: [...conn.tickSymbols] }))
				} else if (msg.action === 'unsubscribe') {
					for (const s of symbols) conn.tickSymbols.delete(s)
					ws.send(JSON.stringify({ type: 'unsubscribed', symbols: [...conn.tickSymbols] }))
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
dataRoutes.get('/usage', async (c) => {
	const key = callerKeyOf(c)
	const snapshot = await getDataUsage(key)
	return c.json({ success: true, ...snapshot })
})

export { dataRoutes }
