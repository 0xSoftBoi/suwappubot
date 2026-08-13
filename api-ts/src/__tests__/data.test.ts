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
// Also supports the grouped-aggregation chains used by /metadata
// (select({candleCount,...}).from().where().groupBy()) and /status
// (select({latestTs,cnt,...}).from().groupBy()), dispatched by inspecting
// the projection object's keys so the original ohlcv chain (select() with
// no args) is completely untouched.
let capturedLimit: number | null = null
let mockCandleRows: any[] = []
let mockMetadataRows: any[] = []
let mockStatusRows: any[] = []

const fakeDb = {
	select: (selection?: Record<string, unknown>) => {
		const keys = selection ? Object.keys(selection) : []

		if (keys.includes('candleCount')) {
			// /v1/data/metadata — grouped aggregation with an optional filter
			return {
				from: () => ({
					where: () => ({
						groupBy: () => Promise.resolve(mockMetadataRows),
					}),
				}),
			}
		}

		if (keys.includes('latestTs') && keys.includes('cnt')) {
			// /v1/data/status — grouped aggregation, no filter
			return {
				from: () => ({
					groupBy: () => Promise.resolve(mockStatusRows),
				}),
			}
		}

		return {
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
		}
	},
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

	it('returns 400 when symbol, symbols, and address are all missing', async () => {
		const res = await dataRoutes.request('/reference/resolve?chain=base', {
			headers: AUTH_HEADERS,
		})
		expect(res.status).toBe(400)
		const body = (await res.json()) as any
		expect(body.error_code).toBe('VALIDATION_ERROR')
	})

	it('a symbol with no chain now resolves across every known chain (Round 2)', async () => {
		const res = await dataRoutes.request('/reference/resolve?symbol=USDC', {
			headers: AUTH_HEADERS,
		})
		expect(res.status).toBe(200)
		const body = (await res.json()) as any
		expect(body.success).toBe(true)
		expect(body.symbol).toBe('USDC')
		expect(Array.isArray(body.chains)).toBe(true)
		expect(body.chains.length).toBeGreaterThan(0)
	})
})

describe('GET /v1/data/reference/resolve — batch (symbols=)', () => {
	it('resolves multiple symbols grouped by symbol', async () => {
		const res = await dataRoutes.request('/reference/resolve?symbols=USDC,NOTAREALTOKEN&chain=base', {
			headers: AUTH_HEADERS,
		})
		expect(res.status).toBe(200)
		const body = (await res.json()) as any
		expect(body.success).toBe(true)
		expect(body.symbols).toEqual(['USDC', 'NOTAREALTOKEN'])
		expect(Array.isArray(body.results.USDC)).toBe(true)
		expect(body.results.USDC.length).toBe(1)
		expect(body.results.NOTAREALTOKEN).toEqual([])
	})
})

describe('GET /v1/data/reference/resolve — reverse (address=)', () => {
	it('requires chain alongside address', async () => {
		const res = await dataRoutes.request('/reference/resolve?address=0x1234', {
			headers: AUTH_HEADERS,
		})
		expect(res.status).toBe(400)
	})

	it('resolves a known USDC address back to its symbol on base', async () => {
		const known = await dataRoutes.request('/reference/resolve?symbol=USDC&chain=base', {
			headers: AUTH_HEADERS,
		})
		const knownBody = (await known.json()) as any

		const res = await dataRoutes.request(`/reference/resolve?address=${knownBody.address}&chain=base`, {
			headers: AUTH_HEADERS,
		})
		expect(res.status).toBe(200)
		const body = (await res.json()) as any
		expect(body.symbol).toBe('USDC')
		expect(body.chain).toBe('base')
	})

	it('returns 404 for an unknown address', async () => {
		const res = await dataRoutes.request('/reference/resolve?address=0xnotarealaddress&chain=base', {
			headers: AUTH_HEADERS,
		})
		expect(res.status).toBe(404)
		const body = (await res.json()) as any
		expect(body.error_code).toBe('TOKEN_UNKNOWN')
	})
})

describe('GET /v1/data/history/ohlcv — multi-symbol (symbols=)', () => {
	it('returns a grouped response keyed by symbol', async () => {
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
		const res = await dataRoutes.request('/history/ohlcv?symbols=ETH,SOL&chain=base&timeframe=1h', {
			headers: AUTH_HEADERS,
		})
		expect(res.status).toBe(200)
		const body = (await res.json()) as any
		expect(body.success).toBe(true)
		expect(body.symbols.ETH.source).toBe('db')
		expect(body.symbols.ETH.candles).toHaveLength(1)
		expect(body.symbols.SOL.source).toBe('db')
	})
})

describe('GET /v1/data/history/ohlcv — format=csv', () => {
	it('returns a CSV body with the documented header row', async () => {
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
		const res = await dataRoutes.request('/history/ohlcv?symbol=ETH&chain=base&timeframe=1h&format=csv', {
			headers: AUTH_HEADERS,
		})
		expect(res.status).toBe(200)
		expect(res.headers.get('content-type')).toContain('text/csv')
		const text = await res.text()
		const lines = text.trim().split('\n')
		expect(lines[0]).toBe('symbol,chain,timeframe,ts,open,high,low,close,volume,source')
		expect(lines[1]).toContain('ETH,base,1h,')
	})

	it('rejects an unknown format', async () => {
		const res = await dataRoutes.request('/history/ohlcv?symbol=ETH&chain=base&format=xml', {
			headers: AUTH_HEADERS,
		})
		expect(res.status).toBe(400)
		const body = (await res.json()) as any
		expect(body.error_code).toBe('VALIDATION_ERROR')
	})
})

describe('GET /v1/data/metadata', () => {
	it('returns 401 with no Authorization header', async () => {
		const res = await dataRoutes.request('/metadata')
		expect(res.status).toBe(401)
	})

	it('returns the grouped dataset shape from mocked rows', async () => {
		mockMetadataRows = [
			{
				symbol: 'ETH',
				chain: 'base',
				timeframe: '1h',
				candleCount: 42,
				startTs: new Date('2026-01-01T00:00:00Z'),
				endTs: new Date('2026-01-02T00:00:00Z'),
			},
			{
				symbol: 'ETH',
				chain: 'base',
				timeframe: '1d',
				candleCount: 3,
				startTs: new Date('2026-01-01T00:00:00Z'),
				endTs: new Date('2026-01-03T00:00:00Z'),
			},
			{
				symbol: 'SOL',
				chain: 'solana',
				timeframe: '1h',
				candleCount: 10,
				startTs: new Date('2026-01-01T00:00:00Z'),
				endTs: new Date('2026-01-01T10:00:00Z'),
			},
		]

		const res = await dataRoutes.request('/metadata', { headers: AUTH_HEADERS })
		expect(res.status).toBe(200)
		const body = (await res.json()) as any
		expect(body.success).toBe(true)
		expect(body.total_candles).toBe(55)
		expect(body.datasets).toHaveLength(2)

		const ethDataset = body.datasets.find((d: any) => d.symbol === 'ETH' && d.chain === 'base')
		expect(ethDataset).toBeDefined()
		expect(ethDataset.timeframes['1h'].candles).toBe(42)
		expect(ethDataset.timeframes['1h'].start).toBe('2026-01-01T00:00:00.000Z')
		expect(ethDataset.timeframes['1h'].end).toBe('2026-01-02T00:00:00.000Z')
		expect(ethDataset.timeframes['1d'].candles).toBe(3)

		const solDataset = body.datasets.find((d: any) => d.symbol === 'SOL')
		expect(solDataset.timeframes['1h'].candles).toBe(10)
		expect(body.truncated).toBeUndefined()
	})

	it('accepts symbol and chain filters without erroring', async () => {
		mockMetadataRows = []
		const res = await dataRoutes.request('/metadata?symbol=ETH&chain=base', { headers: AUTH_HEADERS })
		expect(res.status).toBe(200)
		const body = (await res.json()) as any
		expect(body.success).toBe(true)
		expect(body.datasets).toEqual([])
		expect(body.total_candles).toBe(0)
	})
})

describe('GET /v1/data/status', () => {
	it('returns 401 with no Authorization header', async () => {
		const res = await dataRoutes.request('/status')
		expect(res.status).toBe(401)
	})

	it('reports fresh 1m data as healthy with per-source counts', async () => {
		const now = new Date()
		mockStatusRows = [
			{ timeframe: '1m', source: 'coingecko', latestTs: now, cnt: 100 },
			{ timeframe: '1m', source: 'geckoterminal', latestTs: new Date(now.getTime() - 60_000), cnt: 20 },
			{ timeframe: '1h', source: 'coingecko', latestTs: new Date(now.getTime() - 3_600_000), cnt: 5 },
		]

		const res = await dataRoutes.request('/status', { headers: AUTH_HEADERS })
		expect(res.status).toBe(200)
		const body = (await res.json()) as any
		expect(body.success).toBe(true)
		expect(body.healthy).toBe(true)
		expect(body.timeframes['1m'].age_seconds).toBeLessThan(300)
		expect(body.timeframes['1m'].latest_ts).toBe(now.toISOString())
		expect(body.sources.coingecko).toBe(105)
		expect(body.sources.geckoterminal).toBe(20)
		expect(body.timeframes['5m'].latest_ts).toBeNull()
		expect(body.timeframes['5m'].age_seconds).toBeNull()
	})

	it('is null-safe and unhealthy when the table is empty', async () => {
		mockStatusRows = []
		const res = await dataRoutes.request('/status', { headers: AUTH_HEADERS })
		expect(res.status).toBe(200)
		const body = (await res.json()) as any
		expect(body.success).toBe(true)
		expect(body.healthy).toBe(false)
		for (const tf of ['1m', '5m', '1h', '1d']) {
			expect(body.timeframes[tf].latest_ts).toBeNull()
			expect(body.timeframes[tf].age_seconds).toBeNull()
		}
		expect(body.sources).toEqual({})
	})

	it('reports unhealthy when 1m data is stale (>5 minutes old)', async () => {
		const staleTs = new Date(Date.now() - 10 * 60_000)
		mockStatusRows = [{ timeframe: '1m', source: 'coingecko', latestTs: staleTs, cnt: 1 }]

		const res = await dataRoutes.request('/status', { headers: AUTH_HEADERS })
		expect(res.status).toBe(200)
		const body = (await res.json()) as any
		expect(body.healthy).toBe(false)
		expect(body.timeframes['1m'].age_seconds).toBeGreaterThanOrEqual(590)
	})
})

describe('GET /v1/data/* metering — bounded route cardinality (Opus review bug #1)', () => {
	it('returns 404 for an unmatched /v1/data/* path (no route registered)', async () => {
		const res = await dataRoutes.request('/totally/not/a/real/route/xyz123', {
			headers: AUTH_HEADERS,
		})
		expect(res.status).toBe(404)
	})

	it('buckets unmatched junk paths into "other" instead of minting a new metering key per distinct path', async () => {
		await dataRoutes.request('/junk-path-a', { headers: AUTH_HEADERS })
		await dataRoutes.request('/junk-path-b/also/junk?x=1', { headers: AUTH_HEADERS })
		await dataRoutes.request('/reference/junk-under-a-real-prefix', { headers: AUTH_HEADERS })

		const res = await dataRoutes.request('/usage', { headers: AUTH_HEADERS })
		expect(res.status).toBe(200)
		const body = (await res.json()) as any
		expect(body.by_endpoint.other).toBeGreaterThanOrEqual(3)
		// The raw junk paths must never appear as their own metering keys —
		// that unbounded cardinality is exactly what bug #1 fixed.
		expect(body.by_endpoint['/junk-path-a']).toBeUndefined()
		expect(body.by_endpoint['/junk-path-b/also/junk']).toBeUndefined()
		expect(body.by_endpoint['/reference/junk-under-a-real-prefix']).toBeUndefined()
	})

	it('still meters a request that resolves to a 400 validation error (try/finally around next())', async () => {
		const before = await dataRoutes.request('/usage', { headers: AUTH_HEADERS })
		const beforeBody = (await before.json()) as any
		const beforeCount = beforeBody.by_endpoint['/history/ohlcv'] ?? 0

		const res = await dataRoutes.request('/history/ohlcv?symbol=ETH&chain=base&timeframe=bogus', {
			headers: AUTH_HEADERS,
		})
		expect(res.status).toBe(400)

		const after = await dataRoutes.request('/usage', { headers: AUTH_HEADERS })
		const afterBody = (await after.json()) as any
		expect(afterBody.by_endpoint['/history/ohlcv']).toBe(beforeCount + 1)
	})
})

describe('GET /v1/data/history/ohlcv — cursor pagination', () => {
	it('rejects a malformed cursor', async () => {
		const res = await dataRoutes.request('/history/ohlcv?symbol=ETH&chain=base&cursor=not-valid-base64!!', {
			headers: AUTH_HEADERS,
		})
		expect(res.status).toBe(400)
		const body = (await res.json()) as any
		expect(body.error_code).toBe('VALIDATION_ERROR')
	})

	it('includes next_cursor when the page is exactly full (more rows may exist)', async () => {
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
		const res = await dataRoutes.request('/history/ohlcv?symbol=ETH&chain=base&timeframe=1h&limit=1', {
			headers: AUTH_HEADERS,
		})
		expect(res.status).toBe(200)
		const body = (await res.json()) as any
		expect(typeof body.next_cursor).toBe('string')

		const decoded = Buffer.from(body.next_cursor, 'base64').toString('utf8')
		expect(new Date(decoded).toISOString()).toBe(decoded)
	})
})
