import { afterAll, beforeAll, describe, expect, it, mock } from 'bun:test'
import { Effect, Either, Layer, Option } from 'effect'
import { DrizzleService } from '../db/DrizzleService'

// ROUTE-LEVEL tests for /v1/data/* (docs/plans/market-data-parity.md Phase 3).
//
// Same mocking pattern as publicSwapExecute.test.ts / perpsRouteAuth.test.ts:
// only '../runtime' is mocked so `requireDb`/AgentService resolve against a
// fake in-memory Layer instead of a live Postgres connection. Auth itself is
// NOT mocked — agentFlexAuth()/agentBearerAuth() run for real, so the 401
// (missing Authorization header) case is a genuine assertion, and the
// "authenticated" cases prove a valid suwappu_sk_ bearer token actually flows
// through the real auth code path (AgentService lookup) before reaching the
// route handler.

const TEST_AGENT = {
	id: 4242,
	uuid: 'test-agent-uuid',
	name: 'test-agent',
	isActive: true,
	rateLimitTier: 'free',
	subscriptionTier: null,
	subscriptionExpiresAt: null,
	metadata: {},
} as any

const VALID_KEY = 'suwappu_sk_test_00000000000000000000000000'

// --- Fake Drizzle chain: select().from().where().orderBy().limit() -------
let capturedLimit: number | null = null
let mockCandleRows: any[] = []

const fakeDb = {
	select: () => ({
		from: () => ({
			where: () => ({
				orderBy: () => ({
					limit: (n: number) => {
						capturedLimit = n
						return Promise.resolve(mockCandleRows)
					},
				}),
			}),
		}),
	}),
} as any

const testLayer = Layer.mergeAll(
	Layer.succeed(DrizzleService, Option.some(fakeDb)),
	Layer.succeed(
		// AgentService is re-exported from '../services'; import lazily below to
		// avoid pulling in the whole services barrel before mocks are set up.
		// eslint-disable-next-line @typescript-eslint/no-var-requires
		(await import('../services')).AgentService,
		{
			getAgentByApiKey: (apiKey: string) =>
				Effect.succeed(apiKey === VALID_KEY ? Option.some(TEST_AGENT) : Option.none()),
		} as any,
	),
)

const runTestEffect = (effect: any) => Effect.runPromise(effect.pipe(Effect.provide(testLayer)))

const REAL_RUNTIME = { ...(await import('../runtime')) }

mock.module('../runtime', () => ({
	runEffect: runTestEffect,
	runEffectEither: (effect: any) => runTestEffect(Effect.either(effect)),
	shutdownRuntime: async () => {},
}))

afterAll(() => {
	mock.module('../runtime', () => REAL_RUNTIME)
})

let dataRoutes: any

beforeAll(async () => {
	;({ dataRoutes } = await import('../routes/data'))
})

const AUTH_HEADERS = { Authorization: `Bearer ${VALID_KEY}` }

describe('GET /v1/data/* auth', () => {
	it('returns 401 with no Authorization header', async () => {
		const res = await dataRoutes.request('/history/ohlcv?symbol=ETH&chain=base')
		expect(res.status).toBe(401)
	})

	it('returns 401 for an invalid bearer token', async () => {
		const res = await dataRoutes.request('/history/ohlcv?symbol=ETH&chain=base', {
			headers: { Authorization: 'Bearer suwappu_sk_not_a_real_agent_00000000000' },
		})
		expect(res.status).toBe(401)
	})
})

describe('GET /v1/data/history/ohlcv — timeframe validation', () => {
	it('rejects an invalid timeframe', async () => {
		const res = await dataRoutes.request(
			'/history/ohlcv?symbol=ETH&chain=base&timeframe=3m',
			{ headers: AUTH_HEADERS },
		)
		expect(res.status).toBe(400)
		const body = (await res.json()) as any
		expect(body.success).toBe(false)
		expect(body.error_code).toBe('VALIDATION_ERROR')
	})

	it('rejects a missing symbol or chain', async () => {
		const res = await dataRoutes.request('/history/ohlcv?symbol=ETH', {
			headers: AUTH_HEADERS,
		})
		expect(res.status).toBe(400)
		const body = (await res.json()) as any
		expect(body.error_code).toBe('VALIDATION_ERROR')
	})

	it('accepts every documented timeframe', async () => {
		// Non-empty rows so the route serves from the (mocked) DB and never
		// falls through to the real-network external fallback fetch.
		mockCandleRows = [
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
		]
		for (const tf of ['1m', '5m', '1h', '1d']) {
			const res = await dataRoutes.request(
				`/history/ohlcv?symbol=ETH&chain=base&timeframe=${tf}`,
				{ headers: AUTH_HEADERS },
			)
			expect(res.status).toBe(200)
		}
	})
})

describe('GET /v1/data/history/ohlcv — limit capping', () => {
	it('caps an over-max limit at 1000 before querying the DB', async () => {
		capturedLimit = null
		mockCandleRows = [
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
		]

		const res = await dataRoutes.request(
			'/history/ohlcv?symbol=ETH&chain=base&timeframe=1h&limit=5000',
			{ headers: AUTH_HEADERS },
		)

		expect(res.status).toBe(200)
		expect(capturedLimit as number | null).toBe(1000)
		const body = (await res.json()) as any
		expect(body.source).toBe('db')
		expect(body.candles).toHaveLength(1)
	})

	it('rejects a non-numeric limit', async () => {
		const res = await dataRoutes.request(
			'/history/ohlcv?symbol=ETH&chain=base&timeframe=1h&limit=notanumber',
			{ headers: AUTH_HEADERS },
		)
		expect(res.status).toBe(400)
		const body = (await res.json()) as any
		expect(body.error_code).toBe('VALIDATION_ERROR')
	})

	it('passes a within-range limit through unchanged', async () => {
		capturedLimit = null
		mockCandleRows = [
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
		]
		const res = await dataRoutes.request(
			'/history/ohlcv?symbol=ETH&chain=base&timeframe=1h&limit=50',
			{ headers: AUTH_HEADERS },
		)
		expect(res.status).toBe(200)
		expect(capturedLimit as number | null).toBe(50)
	})
})

describe('GET /v1/data/reference/resolve — known token', () => {
	it('resolves a known symbol/chain pair', async () => {
		const res = await dataRoutes.request('/reference/resolve?symbol=USDC&chain=base', {
			headers: AUTH_HEADERS,
		})
		expect(res.status).toBe(200)
		const body = (await res.json()) as any
		expect(body.success).toBe(true)
		expect(body.symbol).toBe('USDC')
		expect(body.chain).toBe('base')
		expect(typeof body.address).toBe('string')
		expect(body.address.length).toBeGreaterThan(0)
	})

	it('returns 404 for an unknown token on a known chain', async () => {
		const res = await dataRoutes.request(
			'/reference/resolve?symbol=NOTAREALTOKEN&chain=base',
			{ headers: AUTH_HEADERS },
		)
		expect(res.status).toBe(404)
		const body = (await res.json()) as any
		expect(body.error_code).toBe('TOKEN_UNKNOWN')
	})

	it('returns 400 when symbol or chain query params are missing', async () => {
		const res = await dataRoutes.request('/reference/resolve?symbol=USDC', {
			headers: AUTH_HEADERS,
		})
		expect(res.status).toBe(400)
		const body = (await res.json()) as any
		expect(body.error_code).toBe('VALIDATION_ERROR')
	})
})
