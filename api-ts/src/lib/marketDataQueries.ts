/**
 * Shared query/serialization logic for the market-data platform.
 *
 * Single source of truth for the DB reads + JSON shaping behind:
 *   - /v1/data/*        (routes/data.ts — org API key / agent token auth, metered)
 *   - /webapp/data/*     (routes/webappData.ts — our own front-ends, unmetered)
 *
 * Every function here returns a plain JS object (or an Effect `Either` of
 * one) with the SAME field names/casing the /v1/data/* responses have always
 * used, so callers can drop the result straight into `c.json({ success:
 * true, ...result })` and stay byte-identical with the existing contract.
 */
import { and, asc, desc, eq, gt, gte, ilike, lte, sql, type SQL } from 'drizzle-orm'
import { Effect, Either } from 'effect'
import { lendMetrics, marketCandles, perpMetrics, predictionSnapshots, requireDb, type MarketCandle } from '../db'
import { logger } from './logger'
import { runEffectEither } from '../runtime'

// ===========================================
// SHARED PARSING HELPERS
// ===========================================

export const VALID_TIMEFRAMES = ['1m', '5m', '1h', '1d'] as const
export type Timeframe = (typeof VALID_TIMEFRAMES)[number]

export const MAX_LIMIT = 1000
export const DEFAULT_LIMIT = 500
export const DEFAULT_PREDICTION_MARKETS_LIMIT = 50
export const MAX_PREDICTION_MARKETS_LIMIT = 200
export const DEFAULT_PERP_VENUE = 'hyperliquid'
export const MAX_METADATA_DATASETS = 500

/** Parse a start/end query param: accepts an ISO 8601 string or unix seconds. */
export function parseTimestamp(raw: string | undefined): Date | null {
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

/** Parse+cap a `limit` query param. Returns the parsed value, or 'invalid' on a non-numeric/non-positive input. */
export function parseLimitParam(raw: string | undefined, def: number, max: number): number | 'invalid' {
	if (!raw) return def
	const parsed = parseInt(raw, 10)
	if (!Number.isFinite(parsed) || parsed <= 0) return 'invalid'
	return Math.min(parsed, max)
}

/** Opaque cursor codec — base64 of the last emitted row's ISO timestamp. */
export function decodeCursor(raw: string | undefined): Date | null {
	if (!raw) return null
	try {
		const decoded = Buffer.from(raw, 'base64').toString('utf8')
		const d = new Date(decoded)
		return Number.isNaN(d.getTime()) ? null : d
	} catch {
		return null
	}
}
export function encodeCursor(ts: Date): string {
	return Buffer.from(ts.toISOString(), 'utf8').toString('base64')
}

export function isoOf(v: string | Date): string {
	return v instanceof Date ? v.toISOString() : new Date(v).toISOString()
}

// ===========================================
// HISTORICAL — OHLCV
// ===========================================

export interface OhlcvCandle {
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
 * (symbol, chain, timeframe) — the Python capture service may not have
 * backfilled this pair yet. Mirrors the DexScreener fetch pattern already
 * used elsewhere: search DexScreener for the symbol, pick the
 * highest-liquidity pair on the requested chain, and synthesize a short
 * candle series from its priceChange buckets (h24/h6/h1/m5).
 */
async function fetchExternalOhlcvFallback(symbol: string, chain: string, limit: number): Promise<OhlcvCandle[]> {
	try {
		const res = await fetch(`https://api.dexscreener.com/latest/dex/search?q=${encodeURIComponent(symbol)}`, {
			headers: { Accept: 'application/json' },
		})
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
		logger.error({ err }, '[marketDataQueries] external OHLCV fallback failed')
		return []
	}
}

export interface SymbolOhlcvResult {
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

/** DB-first OHLCV lookup for one symbol/chain/timeframe, external-fallback when the DB has zero rows. */
export async function resolveSymbolCandles(
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
		logger.error({ err: dbResult.left }, '[marketDataQueries] market_candles query failed')
	}

	if (rows.length > 0) {
		const lastRow = rows[rows.length - 1] as MarketCandle
		const lastTs = lastRow.ts instanceof Date ? lastRow.ts : new Date(lastRow.ts as unknown as string)
		return { candles: rows.map(candleFromRow), source: 'db', hasMore: rows.length === limit, lastTs }
	}

	const fallbackCandles = await fetchExternalOhlcvFallback(symbol, chain, limit)
	return { candles: fallbackCandles, source: 'external_fallback', hasMore: false, lastTs: null }
}

/**
 * Convenience wrapper for the single-symbol JSON shape shared by /v1/data's
 * legacy (no `symbols=`) response and /webapp/data's single-symbol response.
 */
export async function getOhlcvForSymbol(
	symbol: string,
	chain: string,
	timeframe: Timeframe,
	limit: number,
): Promise<{
	symbol: string
	chain: string
	timeframe: Timeframe
	source: 'db' | 'external_fallback'
	candles: OhlcvCandle[]
	note?: string
}> {
	const result = await resolveSymbolCandles(symbol, chain, timeframe, null, null, limit, null)
	return {
		symbol,
		chain,
		timeframe,
		source: result.source,
		candles: result.candles,
		...(result.source === 'external_fallback'
			? {
					note:
						result.candles.length === 0
							? 'No persisted candles and no external fallback match — this pair may not be tracked yet.'
							: 'No persisted candles yet; synthesized from live DexScreener price-change data (not exact historical OHLCV).',
				}
			: {}),
	}
}

// ===========================================
// PERPS — served from perp_metrics
// ===========================================

interface PerpMarketRow {
	venue: string
	symbol: string
	ts: Date | string
	fundingRate: string | null
	openInterest: string | null
	markPrice: string | null
	indexPrice: string | null
	volume24h: string | null
}

export interface PerpMarketOut {
	venue: string
	symbol: string
	ts: string
	funding_rate: string | null
	open_interest: string | null
	mark_price: string | null
	index_price: string | null
	volume_24h: string | null
}

/** Latest perp_metrics row per (venue, symbol), optionally filtered to one venue. */
export async function getPerpMarkets(
	venue: string | undefined,
): Promise<Either.Either<{ venues: string[]; markets: PerpMarketOut[] }, Error>> {
	const result = await runEffectEither(
		Effect.gen(function* () {
			const db = yield* requireDb
			return yield* Effect.tryPromise({
				try: () =>
					db
						.selectDistinctOn(
							[perpMetrics.venue, perpMetrics.symbol],
							{
								venue: perpMetrics.venue,
								symbol: perpMetrics.symbol,
								ts: perpMetrics.ts,
								fundingRate: perpMetrics.fundingRate,
								openInterest: perpMetrics.openInterest,
								markPrice: perpMetrics.markPrice,
								indexPrice: perpMetrics.indexPrice,
								volume24h: perpMetrics.volume24h,
							},
						)
						.from(perpMetrics)
						.where(venue ? eq(perpMetrics.venue, venue) : undefined)
						.orderBy(perpMetrics.venue, perpMetrics.symbol, desc(perpMetrics.ts)),
				catch: (e) => (e instanceof Error ? e : new Error(String(e))),
			})
		}),
	)

	if (Either.isLeft(result)) return Either.left(result.left)

	const rows = result.right as PerpMarketRow[]
	const markets = rows.map((row) => ({
		venue: row.venue,
		symbol: row.symbol,
		ts: isoOf(row.ts),
		funding_rate: row.fundingRate,
		open_interest: row.openInterest,
		mark_price: row.markPrice,
		index_price: row.indexPrice,
		volume_24h: row.volume24h,
	}))
	const venues = [...new Set(markets.map((m) => m.venue))]
	return Either.right({ venues, markets })
}

interface PerpHistoryRow {
	ts: Date | string
	fundingRate: string | null
	openInterest: string | null
	markPrice: string | null
	indexPrice: string | null
	volume24h: string | null
}

export interface PerpHistoryPoint {
	ts: string
	funding_rate: string | null
	open_interest: string | null
	mark_price: string | null
	index_price: string | null
	volume_24h: string | null
}

/** Time series of funding/OI/mark/index price for one symbol on one venue. */
export async function getPerpHistory(
	symbol: string,
	venue: string,
	start: Date | null,
	end: Date | null,
	limit: number,
	cursorTs: Date | null,
): Promise<Either.Either<{ metrics: PerpHistoryPoint[]; nextCursor: string | null }, Error>> {
	const result = await runEffectEither(
		Effect.gen(function* () {
			const db = yield* requireDb
			const conditions = [eq(perpMetrics.symbol, symbol), eq(perpMetrics.venue, venue)]
			if (start) conditions.push(gte(perpMetrics.ts, start))
			if (end) conditions.push(lte(perpMetrics.ts, end))
			if (cursorTs) conditions.push(gt(perpMetrics.ts, cursorTs))

			return yield* Effect.tryPromise({
				try: () =>
					db
						.select({
							ts: perpMetrics.ts,
							fundingRate: perpMetrics.fundingRate,
							openInterest: perpMetrics.openInterest,
							markPrice: perpMetrics.markPrice,
							indexPrice: perpMetrics.indexPrice,
							volume24h: perpMetrics.volume24h,
						})
						.from(perpMetrics)
						.where(and(...conditions))
						.orderBy(asc(perpMetrics.ts))
						.limit(limit),
				catch: (e) => (e instanceof Error ? e : new Error(String(e))),
			})
		}),
	)

	if (Either.isLeft(result)) return Either.left(result.left)

	const rows = result.right as PerpHistoryRow[]
	const metrics = rows.map((row) => ({
		ts: isoOf(row.ts),
		funding_rate: row.fundingRate,
		open_interest: row.openInterest,
		mark_price: row.markPrice,
		index_price: row.indexPrice,
		volume_24h: row.volume24h,
	}))
	const nextCursor =
		rows.length === limit && rows.length > 0 ? encodeCursor(new Date(isoOf((rows[rows.length - 1] as PerpHistoryRow).ts))) : null

	return Either.right({ metrics, nextCursor })
}

// ===========================================
// PREDICTIONS — served from prediction_snapshots
// ===========================================

interface PredictionMarketRow {
	venue: string
	marketId: string
	conditionId: string | null
	question: string | null
	outcome: string
	ts: Date | string
	price: string | null
	volume: string | null
	liquidity: string | null
	endDate: Date | string | null
}

export interface PredictionMarketOut {
	venue: string
	market_id: string
	condition_id: string | null
	question: string | null
	outcome: string
	ts: string
	price: string | null
	volume: string | null
	liquidity: string | null
	end_date: string | null
}

/**
 * Latest prediction_snapshots row per (market_id, outcome), optionally
 * filtered by a `q` question substring, sorted by volume desc and capped.
 */
export async function getPredictionMarkets(
	q: string | undefined,
	limit: number,
): Promise<Either.Either<{ markets: PredictionMarketOut[] }, Error>> {
	const result = await runEffectEither(
		Effect.gen(function* () {
			const db = yield* requireDb
			return yield* Effect.tryPromise({
				try: () =>
					db
						.selectDistinctOn(
							[predictionSnapshots.marketId, predictionSnapshots.outcome],
							{
								venue: predictionSnapshots.venue,
								marketId: predictionSnapshots.marketId,
								conditionId: predictionSnapshots.conditionId,
								question: predictionSnapshots.question,
								outcome: predictionSnapshots.outcome,
								ts: predictionSnapshots.ts,
								price: predictionSnapshots.price,
								volume: predictionSnapshots.volume,
								liquidity: predictionSnapshots.liquidity,
								endDate: predictionSnapshots.endDate,
							},
						)
						.from(predictionSnapshots)
						.where(q ? ilike(predictionSnapshots.question, `%${q}%`) : undefined)
						.orderBy(predictionSnapshots.marketId, predictionSnapshots.outcome, desc(predictionSnapshots.ts)),
				catch: (e) => (e instanceof Error ? e : new Error(String(e))),
			})
		}),
	)

	if (Either.isLeft(result)) return Either.left(result.left)

	const rows = result.right as PredictionMarketRow[]
	const markets = rows
		.map((row) => ({
			venue: row.venue,
			market_id: row.marketId,
			condition_id: row.conditionId,
			question: row.question,
			outcome: row.outcome,
			ts: isoOf(row.ts),
			price: row.price,
			volume: row.volume,
			liquidity: row.liquidity,
			end_date: row.endDate ? isoOf(row.endDate) : null,
		}))
		.sort((a, b) => (Number(b.volume ?? 0) || 0) - (Number(a.volume ?? 0) || 0))
		.slice(0, limit)

	return Either.right({ markets })
}

interface PredictionHistoryRow {
	outcome: string
	ts: Date | string
	price: string | null
	volume: string | null
	liquidity: string | null
}

export interface PredictionHistoryPoint {
	ts: string
	price: string | null
	volume: string | null
	liquidity: string | null
}

/**
 * `outcome` given    — flat `history` time series for that one outcome.
 * `outcome` omitted  — `outcomes` map grouped by outcome (shared limit/cursor
 * across all outcomes of the market).
 */
export async function getPredictionHistory(
	marketId: string,
	outcome: string | undefined,
	start: Date | null,
	end: Date | null,
	limit: number,
	cursorTs: Date | null,
): Promise<
	Either.Either<
		{ history?: PredictionHistoryPoint[]; outcomes?: Record<string, PredictionHistoryPoint[]>; nextCursor: string | null },
		Error
	>
> {
	const result = await runEffectEither(
		Effect.gen(function* () {
			const db = yield* requireDb
			const conditions = [eq(predictionSnapshots.marketId, marketId)]
			if (outcome) conditions.push(eq(predictionSnapshots.outcome, outcome))
			if (start) conditions.push(gte(predictionSnapshots.ts, start))
			if (end) conditions.push(lte(predictionSnapshots.ts, end))
			if (cursorTs) conditions.push(gt(predictionSnapshots.ts, cursorTs))

			return yield* Effect.tryPromise({
				try: () =>
					db
						.select({
							outcome: predictionSnapshots.outcome,
							ts: predictionSnapshots.ts,
							price: predictionSnapshots.price,
							volume: predictionSnapshots.volume,
							liquidity: predictionSnapshots.liquidity,
						})
						.from(predictionSnapshots)
						.where(and(...conditions))
						.orderBy(asc(predictionSnapshots.outcome), asc(predictionSnapshots.ts))
						.limit(limit),
				catch: (e) => (e instanceof Error ? e : new Error(String(e))),
			})
		}),
	)

	if (Either.isLeft(result)) return Either.left(result.left)

	const rows = result.right as PredictionHistoryRow[]
	const toPoint = (row: PredictionHistoryRow): PredictionHistoryPoint => ({
		ts: isoOf(row.ts),
		price: row.price,
		volume: row.volume,
		liquidity: row.liquidity,
	})
	const lastRow = rows.length > 0 ? (rows[rows.length - 1] as PredictionHistoryRow) : null
	const nextCursor = rows.length === limit && lastRow ? encodeCursor(new Date(isoOf(lastRow.ts))) : null

	if (outcome) {
		return Either.right({ history: rows.map(toPoint), nextCursor })
	}

	const outcomes: Record<string, PredictionHistoryPoint[]> = {}
	for (const row of rows) {
		;(outcomes[row.outcome] ??= []).push(toPoint(row))
	}
	return Either.right({ outcomes, nextCursor })
}

// ===========================================
// LEND — served from lend_metrics
// ===========================================

interface LendMarketRow {
	venue: string
	marketId: string
	chainId: number | null
	loanSymbol: string | null
	collateralSymbol: string | null
	ts: Date | string
	supplyApy: string | null
	borrowApy: string | null
	tvl: string | null
	utilization: string | null
}

export interface LendMarketOut {
	venue: string
	market_id: string
	chain_id: number | null
	loan_symbol: string | null
	collateral_symbol: string | null
	ts: string
	supply_apy: string | null
	borrow_apy: string | null
	tvl: string | null
	utilization: string | null
}

/** Latest lend_metrics row per market_id, optionally filtered by chain_id. */
export async function getLendMarkets(chainId: number | undefined): Promise<Either.Either<{ markets: LendMarketOut[] }, Error>> {
	const result = await runEffectEither(
		Effect.gen(function* () {
			const db = yield* requireDb
			return yield* Effect.tryPromise({
				try: () =>
					db
						.selectDistinctOn(
							[lendMetrics.marketId],
							{
								venue: lendMetrics.venue,
								marketId: lendMetrics.marketId,
								chainId: lendMetrics.chainId,
								loanSymbol: lendMetrics.loanSymbol,
								collateralSymbol: lendMetrics.collateralSymbol,
								ts: lendMetrics.ts,
								supplyApy: lendMetrics.supplyApy,
								borrowApy: lendMetrics.borrowApy,
								tvl: lendMetrics.tvl,
								utilization: lendMetrics.utilization,
							},
						)
						.from(lendMetrics)
						.where(chainId !== undefined ? eq(lendMetrics.chainId, chainId) : undefined)
						.orderBy(lendMetrics.marketId, desc(lendMetrics.ts)),
				catch: (e) => (e instanceof Error ? e : new Error(String(e))),
			})
		}),
	)

	if (Either.isLeft(result)) return Either.left(result.left)

	const rows = result.right as LendMarketRow[]
	const markets = rows.map((row) => ({
		venue: row.venue,
		market_id: row.marketId,
		chain_id: row.chainId,
		loan_symbol: row.loanSymbol,
		collateral_symbol: row.collateralSymbol,
		ts: isoOf(row.ts),
		supply_apy: row.supplyApy,
		borrow_apy: row.borrowApy,
		tvl: row.tvl,
		utilization: row.utilization,
	}))

	return Either.right({ markets })
}

interface LendHistoryRow {
	ts: Date | string
	supplyApy: string | null
	borrowApy: string | null
	tvl: string | null
	utilization: string | null
}

export interface LendHistoryPoint {
	ts: string
	supply_apy: string | null
	borrow_apy: string | null
	tvl: string | null
	utilization: string | null
}

/** Time series of supply/borrow APY, TVL, utilization for one lend market. */
export async function getLendHistory(
	marketId: string,
	start: Date | null,
	end: Date | null,
	limit: number,
	cursorTs: Date | null,
): Promise<Either.Either<{ metrics: LendHistoryPoint[]; nextCursor: string | null }, Error>> {
	const result = await runEffectEither(
		Effect.gen(function* () {
			const db = yield* requireDb
			const conditions = [eq(lendMetrics.marketId, marketId)]
			if (start) conditions.push(gte(lendMetrics.ts, start))
			if (end) conditions.push(lte(lendMetrics.ts, end))
			if (cursorTs) conditions.push(gt(lendMetrics.ts, cursorTs))

			return yield* Effect.tryPromise({
				try: () =>
					db
						.select({
							ts: lendMetrics.ts,
							supplyApy: lendMetrics.supplyApy,
							borrowApy: lendMetrics.borrowApy,
							tvl: lendMetrics.tvl,
							utilization: lendMetrics.utilization,
						})
						.from(lendMetrics)
						.where(and(...conditions))
						.orderBy(asc(lendMetrics.ts))
						.limit(limit),
				catch: (e) => (e instanceof Error ? e : new Error(String(e))),
			})
		}),
	)

	if (Either.isLeft(result)) return Either.left(result.left)

	const rows = result.right as LendHistoryRow[]
	const metrics = rows.map((row) => ({
		ts: isoOf(row.ts),
		supply_apy: row.supplyApy,
		borrow_apy: row.borrowApy,
		tvl: row.tvl,
		utilization: row.utilization,
	}))
	const lastRow = rows.length > 0 ? (rows[rows.length - 1] as LendHistoryRow) : null
	const nextCursor = rows.length === limit && lastRow ? encodeCursor(new Date(isoOf(lastRow.ts))) : null

	return Either.right({ metrics, nextCursor })
}

// ===========================================
// METADATA — dataset coverage + capture freshness (Databento parity)
// ===========================================

interface MetadataRow {
	symbol: string
	chain: string
	timeframe: string
	candleCount: number | string
	startTs: string | Date
	endTs: string | Date
}

async function fetchMetadataRows(symbol: string | undefined, chain: string | undefined) {
	return runEffectEither(
		Effect.gen(function* () {
			const db = yield* requireDb
			const conditions: SQL[] = []
			if (symbol) conditions.push(eq(marketCandles.symbol, symbol))
			if (chain) conditions.push(eq(marketCandles.chain, chain))

			return yield* Effect.tryPromise({
				try: () =>
					db
						.select({
							symbol: marketCandles.symbol,
							chain: marketCandles.chain,
							timeframe: marketCandles.timeframe,
							candleCount: sql<number>`cast(count(*) as int)`,
							startTs: sql<string>`min(${marketCandles.ts})`,
							endTs: sql<string>`max(${marketCandles.ts})`,
						})
						.from(marketCandles)
						.where(conditions.length > 0 ? and(...conditions) : undefined)
						.groupBy(marketCandles.symbol, marketCandles.chain, marketCandles.timeframe),
				catch: (e) => (e instanceof Error ? e : new Error(String(e))),
			})
		}),
	)
}

interface VenueDatasetAggRow {
	count: number | string
	start: string | Date | null
	end: string | Date | null
}

async function fetchVenueDatasetStats() {
	return runEffectEither(
		Effect.gen(function* () {
			const db = yield* requireDb
			const [perpRows, predictionRows, lendRows] = yield* Effect.tryPromise({
				try: () =>
					Promise.all([
						db
							.select({
								perpCount: sql<number>`cast(count(*) as int)`,
								perpStart: sql<string | null>`min(${perpMetrics.ts})`,
								perpEnd: sql<string | null>`max(${perpMetrics.ts})`,
							})
							.from(perpMetrics),
						db
							.select({
								predictionCount: sql<number>`cast(count(*) as int)`,
								predictionStart: sql<string | null>`min(${predictionSnapshots.ts})`,
								predictionEnd: sql<string | null>`max(${predictionSnapshots.ts})`,
							})
							.from(predictionSnapshots),
						db
							.select({
								lendCount: sql<number>`cast(count(*) as int)`,
								lendStart: sql<string | null>`min(${lendMetrics.ts})`,
								lendEnd: sql<string | null>`max(${lendMetrics.ts})`,
							})
							.from(lendMetrics),
					]),
				catch: (e) => (e instanceof Error ? e : new Error(String(e))),
			})

			const perpRow = perpRows[0] as
				| { perpCount: number | string; perpStart: string | Date | null; perpEnd: string | Date | null }
				| undefined
			const predictionRow = predictionRows[0] as
				| { predictionCount: number | string; predictionStart: string | Date | null; predictionEnd: string | Date | null }
				| undefined
			const lendRow = lendRows[0] as
				| { lendCount: number | string; lendStart: string | Date | null; lendEnd: string | Date | null }
				| undefined

			return {
				perps: { count: perpRow?.perpCount ?? 0, start: perpRow?.perpStart ?? null, end: perpRow?.perpEnd ?? null },
				predictions: {
					count: predictionRow?.predictionCount ?? 0,
					start: predictionRow?.predictionStart ?? null,
					end: predictionRow?.predictionEnd ?? null,
				},
				lend: { count: lendRow?.lendCount ?? 0, start: lendRow?.lendStart ?? null, end: lendRow?.lendEnd ?? null },
			} satisfies Record<string, VenueDatasetAggRow>
		}),
	)
}

function venueDatasetCountsAndRanges(stats: Record<string, VenueDatasetAggRow>) {
	const out: Record<string, { count: number; start: string | null; end: string | null }> = {}
	for (const [name, row] of Object.entries(stats)) {
		out[name] = {
			count: Number(row.count),
			start: row.start ? isoOf(row.start) : null,
			end: row.end ? isoOf(row.end) : null,
		}
	}
	return out
}

// Freshness thresholds — only factored into overall `healthy` when the
// underlying table has at least one row (an empty, not-yet-capturing
// dataset shouldn't itself flip the whole /status response unhealthy).
const PERP_FRESHNESS_HEALTHY_SECONDS = 300 // 5 min
const PREDICTION_FRESHNESS_HEALTHY_SECONDS = 900 // 15 min
const LEND_FRESHNESS_HEALTHY_SECONDS = 1800 // 30 min
const OHLCV_FRESHNESS_HEALTHY_SECONDS = 300 // 1m data considered healthy under 5 minutes old

function venueDatasetFreshness(stats: Record<string, VenueDatasetAggRow>, thresholds: Record<string, number>) {
	const now = Date.now()
	const out: Record<string, { count: number; latest_ts: string | null; age_seconds: number | null; healthy: boolean }> = {}
	for (const [name, row] of Object.entries(stats)) {
		const count = Number(row.count)
		if (count === 0 || !row.end) {
			out[name] = { count, latest_ts: null, age_seconds: null, healthy: true }
			continue
		}
		const latestMs = (row.end instanceof Date ? row.end : new Date(row.end)).getTime()
		if (Number.isNaN(latestMs)) {
			out[name] = { count, latest_ts: null, age_seconds: null, healthy: true }
			continue
		}
		const ageSeconds = Math.max(0, Math.floor((now - latestMs) / 1000))
		out[name] = {
			count,
			latest_ts: isoOf(row.end),
			age_seconds: ageSeconds,
			healthy: ageSeconds < (thresholds[name] ?? Infinity),
		}
	}
	return out
}

/** Dataset coverage from market_candles, grouped by (symbol, chain, timeframe), plus venue_datasets counts/ranges. */
export async function getMetadataSummary(
	symbol: string | undefined,
	chain: string | undefined,
): Promise<
	Either.Either<
		{
			datasets: Array<{
				symbol: string
				chain: string
				timeframes: Record<string, { candles: number; start: string; end: string }>
			}>
			total_candles: number
			venue_datasets: Record<string, { count: number; start: string | null; end: string | null }>
			truncated?: true
			note?: string
		},
		Error
	>
> {
	const result = await fetchMetadataRows(symbol, chain)
	if (Either.isLeft(result)) return Either.left(result.left)

	const rows = result.right as MetadataRow[]
	const grouped = new Map<
		string,
		{ symbol: string; chain: string; timeframes: Record<string, { candles: number; start: string; end: string }> }
	>()
	let totalCandles = 0

	for (const row of rows) {
		const key = `${row.symbol}::${row.chain}`
		let entry = grouped.get(key)
		if (!entry) {
			entry = { symbol: row.symbol, chain: row.chain, timeframes: {} }
			grouped.set(key, entry)
		}
		const candles = Number(row.candleCount)
		entry.timeframes[row.timeframe] = { candles, start: isoOf(row.startTs), end: isoOf(row.endTs) }
		totalCandles += candles
	}

	const allDatasets = [...grouped.values()]
	const truncated = allDatasets.length > MAX_METADATA_DATASETS
	const datasets = truncated ? allDatasets.slice(0, MAX_METADATA_DATASETS) : allDatasets

	const venueResult = await fetchVenueDatasetStats()
	if (Either.isLeft(venueResult)) {
		logger.error({ err: venueResult.left }, '[marketDataQueries] metadata venue_datasets query failed')
	}
	const venue_datasets = Either.isRight(venueResult)
		? venueDatasetCountsAndRanges(venueResult.right)
		: { perps: { count: 0, start: null, end: null }, predictions: { count: 0, start: null, end: null }, lend: { count: 0, start: null, end: null } }

	return Either.right({
		datasets,
		total_candles: totalCandles,
		venue_datasets,
		...(truncated
			? {
					truncated: true as const,
					note: `Response truncated to ${MAX_METADATA_DATASETS} datasets — refine with ?symbol=&chain= to narrow results.`,
				}
			: {}),
	})
}

interface StatusRow {
	timeframe: string
	source: string
	latestTs: string | Date | null
	cnt: number | string
}

async function fetchStatusRows() {
	return runEffectEither(
		Effect.gen(function* () {
			const db = yield* requireDb
			return yield* Effect.tryPromise({
				try: () =>
					db
						.select({
							timeframe: marketCandles.timeframe,
							source: marketCandles.source,
							latestTs: sql<string | null>`max(${marketCandles.ts})`,
							cnt: sql<number>`cast(count(*) as int)`,
						})
						.from(marketCandles)
						.groupBy(marketCandles.timeframe, marketCandles.source),
				catch: (e) => (e instanceof Error ? e : new Error(String(e))),
			})
		}),
	)
}

/** Capture freshness: newest candle per timeframe + its age, plus per-source candle counts, plus venue freshness. */
export async function getStatusSummary(): Promise<
	Either.Either<
		{
			timeframes: Record<
				string,
				{ count: number; latest_ts: string | null; age_seconds: number | null; healthy: boolean }
			>
			sources: Record<string, number>
			healthy: boolean
			venue_datasets: Record<string, { count: number; latest_ts: string | null; age_seconds: number | null; healthy: boolean }>
		},
		Error
	>
> {
	const result = await fetchStatusRows()
	if (Either.isLeft(result)) return Either.left(result.left)

	const rows = result.right as StatusRow[]

	const sources: Record<string, number> = {}
	const latestByTimeframe = new Map<string, number>()
	const countByTimeframe = new Map<string, number>()

	for (const row of rows) {
		sources[row.source] = (sources[row.source] ?? 0) + Number(row.cnt)
		countByTimeframe.set(row.timeframe, (countByTimeframe.get(row.timeframe) ?? 0) + Number(row.cnt))

		if (!row.latestTs) continue
		const d = row.latestTs instanceof Date ? row.latestTs : new Date(row.latestTs)
		const ms = d.getTime()
		if (Number.isNaN(ms)) continue
		const prev = latestByTimeframe.get(row.timeframe)
		if (prev === undefined || ms > prev) latestByTimeframe.set(row.timeframe, ms)
	}

	const now = Date.now()
	// Staleness budget per timeframe: a 1d candle being an hour old is fine, a
	// 1m candle being an hour old is not.
	const STALE_AFTER_SECONDS: Record<string, number> = { '1m': 300, '5m': 900, '1h': 10_800, '1d': 172_800 }
	const timeframes: Record<
		string,
		{ count: number; latest_ts: string | null; age_seconds: number | null; healthy: boolean }
	> = {}
	for (const tf of VALID_TIMEFRAMES) {
		const ms = latestByTimeframe.get(tf)
		const count = countByTimeframe.get(tf) ?? 0
		if (ms === undefined) {
			// Same convention as venue_datasets: an empty dataset is "healthy"
			// (nothing captured yet), not a failure.
			timeframes[tf] = { count, latest_ts: null, age_seconds: null, healthy: count === 0 }
			continue
		}
		const ageSeconds = Math.max(0, Math.floor((now - ms) / 1000))
		timeframes[tf] = {
			count,
			latest_ts: new Date(ms).toISOString(),
			age_seconds: ageSeconds,
			healthy: count === 0 || ageSeconds <= (STALE_AFTER_SECONDS[tf] ?? 10_800),
		}
	}

	const oneMinAge = timeframes['1m']?.age_seconds ?? null
	const ohlcvHealthy = oneMinAge !== null && oneMinAge < OHLCV_FRESHNESS_HEALTHY_SECONDS

	const venueResult = await fetchVenueDatasetStats()
	if (Either.isLeft(venueResult)) {
		logger.error({ err: venueResult.left }, '[marketDataQueries] status venue_datasets query failed')
	}
	const venue_datasets = Either.isRight(venueResult)
		? venueDatasetFreshness(venueResult.right, {
				perps: PERP_FRESHNESS_HEALTHY_SECONDS,
				predictions: PREDICTION_FRESHNESS_HEALTHY_SECONDS,
				lend: LEND_FRESHNESS_HEALTHY_SECONDS,
			})
		: {
				perps: { count: 0, latest_ts: null, age_seconds: null, healthy: true },
				predictions: { count: 0, latest_ts: null, age_seconds: null, healthy: true },
				lend: { count: 0, latest_ts: null, age_seconds: null, healthy: true },
			}

	const healthy = ohlcvHealthy && venue_datasets.perps.healthy && venue_datasets.predictions.healthy && venue_datasets.lend.healthy

	return Either.right({ timeframes, sources, healthy, venue_datasets })
}
