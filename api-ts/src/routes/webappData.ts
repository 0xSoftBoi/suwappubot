/**
 * /webapp/data/* — read-only market-data platform access for our own
 * front-ends (Telegram Mini App + Terminal dashboard).
 *
 * The org-key/agent-token gated /v1/data/* surface (routes/data.ts) can't be
 * called from a browser — the Mini App only authenticates with
 * X-Telegram-Init-Data and the Terminal dashboard only has its session
 * JWT/cookie. `flexAuth()` (middleware/flexAuth.ts) already accepts BOTH of
 * those credentials (it's the same middleware perps.ts/publicSwap.ts use for
 * exactly this "callable from either front-end" shape), so one route group
 * here serves both callers — no separate Terminal-only mount needed.
 *
 * Every handler delegates to the shared query/serialization helpers in
 * lib/marketDataQueries.ts (the same helpers routes/data.ts calls), so the
 * JSON shapes are byte-identical to their /v1/data equivalents. No metering
 * here — metering is for paying API customers, not our own UI.
 */
import { Either } from 'effect'
import { Hono } from 'hono'
import {
	DEFAULT_LIMIT,
	DEFAULT_PERP_VENUE,
	DEFAULT_PREDICTION_MARKETS_LIMIT,
	MAX_LIMIT,
	MAX_PREDICTION_MARKETS_LIMIT,
	VALID_TIMEFRAMES,
	decodeCursor,
	getLendHistory,
	getLendMarkets,
	getOhlcvForSymbol,
	getPerpHistory,
	getPerpMarkets,
	getPredictionHistory,
	getPredictionMarkets,
	getStatusSummary,
	parseLimitParam,
	type Timeframe,
} from '../lib/marketDataQueries'
import { logger } from '../lib/logger'
import { flexAuth } from '../middleware'

const webappDataRoutes = new Hono()

// Accepts EITHER X-Telegram-Init-Data (Mini App) OR Authorization: Bearer
// <jwt> / suwappu_auth cookie (Terminal dashboard, showcase) — see
// middleware/flexAuth.ts. Applies to every /webapp/data/* route.
webappDataRoutes.use('*', flexAuth())

function badRequest(message: string, extra?: Record<string, unknown>) {
	return { body: { error: message, ...(extra ?? {}) }, status: 400 as const }
}

// GET /webapp/data/status
webappDataRoutes.get('/status', async (c) => {
	const result = await getStatusSummary()
	if (Either.isLeft(result)) {
		logger.error({ err: result.left }, '[webapp/data] status query failed')
		return c.json({ error: 'Failed to load capture status' }, 500)
	}
	return c.json({ success: true, ...result.right })
})

// GET /webapp/data/ohlcv?symbol=&chain=&timeframe=1h&limit=
webappDataRoutes.get('/ohlcv', async (c) => {
	const symbol = c.req.query('symbol')?.trim().toUpperCase()
	const chain = c.req.query('chain')?.trim().toLowerCase()
	const timeframeParam = (c.req.query('timeframe') ?? '1h').trim().toLowerCase()
	const limitParam = c.req.query('limit')

	if (!symbol || !chain) {
		const { body, status } = badRequest('symbol and chain query parameters are required', {
			hint: 'GET /webapp/data/ohlcv?symbol=ETH&chain=base&timeframe=1h',
		})
		return c.json(body, status)
	}

	if (!VALID_TIMEFRAMES.includes(timeframeParam as Timeframe)) {
		const { body, status } = badRequest(`Invalid timeframe: ${timeframeParam}`, { supported: VALID_TIMEFRAMES })
		return c.json(body, status)
	}
	const timeframe = timeframeParam as Timeframe

	const limit = parseLimitParam(limitParam, DEFAULT_LIMIT, MAX_LIMIT)
	if (limit === 'invalid') {
		const { body, status } = badRequest(`Invalid limit: ${limitParam}`)
		return c.json(body, status)
	}

	const data = await getOhlcvForSymbol(symbol, chain, timeframe, limit)
	return c.json({ success: true, ...data })
})

// GET /webapp/data/perps/markets?venue=
webappDataRoutes.get('/perps/markets', async (c) => {
	const venueParam = c.req.query('venue')?.trim().toLowerCase() || undefined

	const result = await getPerpMarkets(venueParam)
	if (Either.isLeft(result)) {
		logger.error({ err: result.left }, '[webapp/data] perps/markets query failed')
		return c.json({ error: 'Failed to load perp markets' }, 500)
	}
	return c.json({ success: true, ...result.right })
})

// GET /webapp/data/perps/history?symbol=&venue=hyperliquid&limit=
webappDataRoutes.get('/perps/history', async (c) => {
	const symbolParam = c.req.query('symbol')?.trim().toUpperCase()
	const venueParam = c.req.query('venue')?.trim().toLowerCase() || DEFAULT_PERP_VENUE
	const limitParam = c.req.query('limit')
	const cursorParam = c.req.query('cursor')

	if (!symbolParam) {
		const { body, status } = badRequest('symbol query parameter is required', {
			hint: 'GET /webapp/data/perps/history?symbol=BTC&venue=hyperliquid',
		})
		return c.json(body, status)
	}

	const limit = parseLimitParam(limitParam, DEFAULT_LIMIT, MAX_LIMIT)
	if (limit === 'invalid') {
		const { body, status } = badRequest(`Invalid limit: ${limitParam}`)
		return c.json(body, status)
	}

	let cursorTs: Date | null = null
	if (cursorParam) {
		cursorTs = decodeCursor(cursorParam)
		if (!cursorTs) {
			const { body, status } = badRequest(`Invalid cursor: ${cursorParam}`)
			return c.json(body, status)
		}
	}

	const result = await getPerpHistory(symbolParam, venueParam, null, null, limit, cursorTs)
	if (Either.isLeft(result)) {
		logger.error({ err: result.left }, '[webapp/data] perps/history query failed')
		return c.json({ error: 'Failed to load perp history' }, 500)
	}

	return c.json({
		success: true,
		symbol: symbolParam,
		venue: venueParam,
		metrics: result.right.metrics,
		...(result.right.nextCursor ? { next_cursor: result.right.nextCursor } : {}),
	})
})

// GET /webapp/data/predictions/markets?q=&limit=
webappDataRoutes.get('/predictions/markets', async (c) => {
	const qParam = c.req.query('q')?.trim() || undefined
	const limitParam = c.req.query('limit')

	const limit = parseLimitParam(limitParam, DEFAULT_PREDICTION_MARKETS_LIMIT, MAX_PREDICTION_MARKETS_LIMIT)
	if (limit === 'invalid') {
		const { body, status } = badRequest(`Invalid limit: ${limitParam}`)
		return c.json(body, status)
	}

	const result = await getPredictionMarkets(qParam, limit)
	if (Either.isLeft(result)) {
		logger.error({ err: result.left }, '[webapp/data] predictions/markets query failed')
		return c.json({ error: 'Failed to load prediction markets' }, 500)
	}
	return c.json({ success: true, markets: result.right.markets })
})

// GET /webapp/data/predictions/history?market_id=&outcome=&limit=
webappDataRoutes.get('/predictions/history', async (c) => {
	const marketIdParam = c.req.query('market_id')?.trim()
	const outcomeParam = c.req.query('outcome')?.trim() || undefined
	const limitParam = c.req.query('limit')
	const cursorParam = c.req.query('cursor')

	if (!marketIdParam) {
		const { body, status } = badRequest('market_id query parameter is required', {
			hint: 'GET /webapp/data/predictions/history?market_id=0x...&outcome=YES',
		})
		return c.json(body, status)
	}

	const limit = parseLimitParam(limitParam, DEFAULT_LIMIT, MAX_LIMIT)
	if (limit === 'invalid') {
		const { body, status } = badRequest(`Invalid limit: ${limitParam}`)
		return c.json(body, status)
	}

	let cursorTs: Date | null = null
	if (cursorParam) {
		cursorTs = decodeCursor(cursorParam)
		if (!cursorTs) {
			const { body, status } = badRequest(`Invalid cursor: ${cursorParam}`)
			return c.json(body, status)
		}
	}

	const result = await getPredictionHistory(marketIdParam, outcomeParam, null, null, limit, cursorTs)
	if (Either.isLeft(result)) {
		logger.error({ err: result.left }, '[webapp/data] predictions/history query failed')
		return c.json({ error: 'Failed to load prediction history' }, 500)
	}

	if (outcomeParam) {
		return c.json({
			success: true,
			market_id: marketIdParam,
			outcome: outcomeParam,
			history: result.right.history ?? [],
			...(result.right.nextCursor ? { next_cursor: result.right.nextCursor } : {}),
		})
	}

	return c.json({
		success: true,
		market_id: marketIdParam,
		outcomes: result.right.outcomes ?? {},
		...(result.right.nextCursor ? { next_cursor: result.right.nextCursor } : {}),
	})
})

// GET /webapp/data/lend/markets?chain_id=
webappDataRoutes.get('/lend/markets', async (c) => {
	const chainIdParam = c.req.query('chain_id')
	let chainId: number | undefined
	if (chainIdParam) {
		const parsed = parseInt(chainIdParam, 10)
		if (!Number.isFinite(parsed)) {
			const { body, status } = badRequest(`Invalid chain_id: ${chainIdParam}`)
			return c.json(body, status)
		}
		chainId = parsed
	}

	const result = await getLendMarkets(chainId)
	if (Either.isLeft(result)) {
		logger.error({ err: result.left }, '[webapp/data] lend/markets query failed')
		return c.json({ error: 'Failed to load lend markets' }, 500)
	}
	return c.json({ success: true, markets: result.right.markets })
})

// GET /webapp/data/lend/history?market_id=&limit=
webappDataRoutes.get('/lend/history', async (c) => {
	const marketIdParam = c.req.query('market_id')?.trim()
	const limitParam = c.req.query('limit')
	const cursorParam = c.req.query('cursor')

	if (!marketIdParam) {
		const { body, status } = badRequest('market_id query parameter is required', {
			hint: 'GET /webapp/data/lend/history?market_id=0x...',
		})
		return c.json(body, status)
	}

	const limit = parseLimitParam(limitParam, DEFAULT_LIMIT, MAX_LIMIT)
	if (limit === 'invalid') {
		const { body, status } = badRequest(`Invalid limit: ${limitParam}`)
		return c.json(body, status)
	}

	let cursorTs: Date | null = null
	if (cursorParam) {
		cursorTs = decodeCursor(cursorParam)
		if (!cursorTs) {
			const { body, status } = badRequest(`Invalid cursor: ${cursorParam}`)
			return c.json(body, status)
		}
	}

	const result = await getLendHistory(marketIdParam, null, null, limit, cursorTs)
	if (Either.isLeft(result)) {
		logger.error({ err: result.left }, '[webapp/data] lend/history query failed')
		return c.json({ error: 'Failed to load lend history' }, 500)
	}

	return c.json({
		success: true,
		market_id: marketIdParam,
		metrics: result.right.metrics,
		...(result.right.nextCursor ? { next_cursor: result.right.nextCursor } : {}),
	})
})

export { webappDataRoutes }
