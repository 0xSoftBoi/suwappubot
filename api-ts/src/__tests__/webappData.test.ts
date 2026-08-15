import { afterAll, beforeAll, describe, expect, it, mock } from 'bun:test'
import { Either } from 'effect'

// ROUTE-LEVEL tests for /webapp/data/* — the read-only market-data mount for
// our own front-ends (Telegram Mini App + Terminal dashboard), sharing
// flexAuth() (accepts EITHER X-Telegram-Init-Data OR Authorization: Bearer
// <jwt> / session cookie).
//
// Same pattern as perpsRouteAuth.test.ts: '../middleware' is mocked with a
// routing-only flexAuth() stub (real credential verification is covered by
// flexAuthJwt.test.ts), and '../runtime' is mocked so the shared
// marketDataQueries helpers never touch a live DB. This proves (a) the route
// wiring calls flexAuth() and rejects when it fails, and (b) an authenticated
// request reaches the handler and gets back the documented response shape.

const REAL_MODULES = {
	'../middleware': { ...(await import('../middleware')) },
	'../runtime': { ...(await import('../runtime')) },
}

afterAll(() => {
	mock.module('../middleware', () => REAL_MODULES['../middleware'])
	mock.module('../runtime', () => REAL_MODULES['../runtime'])
})

const VALID_BEARER = 'Bearer webapp-data-test-session-jwt'
const VALID_INIT_DATA = 'valid-test-init-data'

mock.module('../middleware', () => ({
	flexAuth: () => async (c: any, next: any) => {
		const auth = c.req.header('Authorization')
		const initData = c.req.header('X-Telegram-Init-Data')
		if (auth === VALID_BEARER || initData === VALID_INIT_DATA) return next()
		return c.json({ error: 'Authentication required' }, 401)
	},
}))

// Queue of canned Either results — one per runEffectEither() call, in the
// order the handler makes them. Defaults to Either.right([]) so any handler
// that only needs an empty row array doesn't need an explicit push.
const resultQueue: Array<Either.Either<unknown, Error>> = []

mock.module('../runtime', () => ({
	runEffectEither: async () => resultQueue.shift() ?? Either.right([]),
	runEffect: async () => undefined,
	shutdownRuntime: async () => undefined,
}))

let webappDataRoutes: any

beforeAll(async () => {
	;({ webappDataRoutes } = await import('../routes/webappData'))
})

describe('/webapp/data/* auth', () => {
	it('rejects a request with neither credential', async () => {
		const res = await webappDataRoutes.request('/status')
		expect(res.status).toBe(401)
	})

	it('accepts a Terminal-style Bearer session JWT', async () => {
		const res = await webappDataRoutes.request('/status', {
			headers: { Authorization: VALID_BEARER },
		})
		expect(res.status).toBe(200)
		const body = (await res.json()) as any
		expect(body.success).toBe(true)
	})

	it('accepts a Mini-App-style X-Telegram-Init-Data header', async () => {
		const res = await webappDataRoutes.request('/status', {
			headers: { 'X-Telegram-Init-Data': VALID_INIT_DATA },
		})
		expect(res.status).toBe(200)
		const body = (await res.json()) as any
		expect(body.success).toBe(true)
	})
})

describe('GET /webapp/data/ohlcv', () => {
	it('returns candles for an authenticated caller (db source, no network fallback)', async () => {
		resultQueue.push(
			Either.right([
				{
					symbol: 'ETH',
					chain: 'base',
					timeframe: '1h',
					ts: new Date('2026-01-01T00:00:00Z'),
					open: '100',
					high: '110',
					low: '90',
					close: '105',
					volume: null,
					source: 'coingecko',
				},
			]),
		)
		const res = await webappDataRoutes.request('/ohlcv?symbol=ETH&chain=base&timeframe=1h', {
			headers: { Authorization: VALID_BEARER },
		})
		expect(res.status).toBe(200)
		const body = (await res.json()) as any
		expect(body.success).toBe(true)
		expect(body.symbol).toBe('ETH')
		expect(body.chain).toBe('base')
		expect(body.timeframe).toBe('1h')
		expect(body.source).toBe('db')
		expect(body.candles).toHaveLength(1)
	})

	it('rejects a missing symbol/chain', async () => {
		const res = await webappDataRoutes.request('/ohlcv?symbol=ETH', {
			headers: { Authorization: VALID_BEARER },
		})
		expect(res.status).toBe(400)
	})

	it('rejects an unauthenticated request', async () => {
		const res = await webappDataRoutes.request('/ohlcv?symbol=ETH&chain=base')
		expect(res.status).toBe(401)
	})
})

describe('GET /webapp/data/perps/markets and /perps/history', () => {
	it('returns an empty markets list when authenticated', async () => {
		const res = await webappDataRoutes.request('/perps/markets', {
			headers: { Authorization: VALID_BEARER },
		})
		expect(res.status).toBe(200)
		const body = (await res.json()) as any
		expect(body.success).toBe(true)
		expect(body.markets).toEqual([])
	})

	it('requires a symbol for /perps/history', async () => {
		const res = await webappDataRoutes.request('/perps/history', {
			headers: { Authorization: VALID_BEARER },
		})
		expect(res.status).toBe(400)
	})

	it('returns metrics for /perps/history when authenticated', async () => {
		const res = await webappDataRoutes.request('/perps/history?symbol=BTC', {
			headers: { Authorization: VALID_BEARER },
		})
		expect(res.status).toBe(200)
		const body = (await res.json()) as any
		expect(body.success).toBe(true)
		expect(body.symbol).toBe('BTC')
		expect(body.metrics).toEqual([])
	})

	it('rejects unauthenticated requests', async () => {
		const res = await webappDataRoutes.request('/perps/markets')
		expect(res.status).toBe(401)
	})
})

describe('GET /webapp/data/predictions/markets and /predictions/history', () => {
	it('returns an empty markets list when authenticated', async () => {
		const res = await webappDataRoutes.request('/predictions/markets', {
			headers: { Authorization: VALID_BEARER },
		})
		expect(res.status).toBe(200)
		const body = (await res.json()) as any
		expect(body.success).toBe(true)
		expect(body.markets).toEqual([])
	})

	it('requires market_id for /predictions/history', async () => {
		const res = await webappDataRoutes.request('/predictions/history', {
			headers: { Authorization: VALID_BEARER },
		})
		expect(res.status).toBe(400)
	})

	it('returns outcomes for /predictions/history when authenticated', async () => {
		const res = await webappDataRoutes.request('/predictions/history?market_id=0xabc', {
			headers: { Authorization: VALID_BEARER },
		})
		expect(res.status).toBe(200)
		const body = (await res.json()) as any
		expect(body.success).toBe(true)
		expect(body.market_id).toBe('0xabc')
		expect(body.outcomes).toEqual({})
	})

	it('rejects unauthenticated requests', async () => {
		const res = await webappDataRoutes.request('/predictions/markets')
		expect(res.status).toBe(401)
	})
})

describe('GET /webapp/data/lend/markets and /lend/history', () => {
	it('returns an empty markets list when authenticated', async () => {
		const res = await webappDataRoutes.request('/lend/markets', {
			headers: { Authorization: VALID_BEARER },
		})
		expect(res.status).toBe(200)
		const body = (await res.json()) as any
		expect(body.success).toBe(true)
		expect(body.markets).toEqual([])
	})

	it('requires market_id for /lend/history', async () => {
		const res = await webappDataRoutes.request('/lend/history', {
			headers: { Authorization: VALID_BEARER },
		})
		expect(res.status).toBe(400)
	})

	it('returns metrics for /lend/history when authenticated', async () => {
		const res = await webappDataRoutes.request('/lend/history?market_id=0xdef', {
			headers: { Authorization: VALID_BEARER },
		})
		expect(res.status).toBe(200)
		const body = (await res.json()) as any
		expect(body.success).toBe(true)
		expect(body.market_id).toBe('0xdef')
		expect(body.metrics).toEqual([])
	})

	it('rejects unauthenticated requests', async () => {
		const res = await webappDataRoutes.request('/lend/markets')
		expect(res.status).toBe(401)
	})
})
