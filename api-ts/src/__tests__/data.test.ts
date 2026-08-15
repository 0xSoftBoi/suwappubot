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

// Round 5 (perps/predictions/lend) mock row sets.
let mockPerpHistoryRows: any[] = []
let mockPredictionHistoryRows: any[] = []
let mockLendHistoryRows: any[] = []
let mockPerpMarketRows: any[] = []
let mockPredictionMarketRows: any[] = []
let mockLendMarketRows: any[] = []
// venue_datasets aggregate — one row each for perp_metrics/prediction_snapshots/lend_metrics.
let mockPerpDatasetRows: any[] = [{ perpCount: 0, perpStart: null, perpEnd: null }]
let mockPredictionDatasetRows: any[] = [{ predictionCount: 0, predictionStart: null, predictionEnd: null }]
let mockLendDatasetRows: any[] = [{ lendCount: 0, lendStart: null, lendEnd: null }]

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

		if (keys.includes('perpCount')) {
			// venue_datasets aggregate — perp_metrics whole-table count/min/max
			return { from: () => Promise.resolve(mockPerpDatasetRows) }
		}
		if (keys.includes('predictionCount')) {
			return { from: () => Promise.resolve(mockPredictionDatasetRows) }
		}
		if (keys.includes('lendCount')) {
			return { from: () => Promise.resolve(mockLendDatasetRows) }
		}

		if (keys.includes('fundingRate')) {
			// /v1/data/perps/history — flat time series
			return {
				from: () => ({
					where: () => ({
						orderBy: () => ({
							limit: (n: number) => {
								capturedLimit = n
								return Promise.resolve(mockPerpHistoryRows)
							},
						}),
					}),
				}),
			}
		}

		if (keys.includes('supplyApy')) {
			// /v1/data/lend/history — flat time series
			return {
				from: () => ({
					where: () => ({
						orderBy: () => ({
							limit: (n: number) => {
								capturedLimit = n
								return Promise.resolve(mockLendHistoryRows)
							},
						}),
					}),
				}),
			}
		}

		if (keys.includes('price')) {
			// /v1/data/predictions/history — flat time series (grouped by outcome in JS)
			return {
				from: () => ({
					where: () => ({
						orderBy: () => ({
							limit: (n: number) => {
								capturedLimit = n
								return Promise.resolve(mockPredictionHistoryRows)
							},
						}),
					}),
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
	selectDistinctOn: (_on: unknown[], fields?: Record<string, unknown>) => {
		const keys = fields ? Object.keys(fields) : []

		if (keys.includes('fundingRate')) {
			// /v1/data/perps/markets
			return {
				from: () => ({
					where: () => ({
						orderBy: () => Promise.resolve(mockPerpMarketRows),
					}),
				}),
			}
		}
		if (keys.includes('supplyApy')) {
			// /v1/data/lend/markets
			return {
				from: () => ({
					where: () => ({
						orderBy: () => Promise.resolve(mockLendMarketRows),
					}),
				}),
			}
		}
		if (keys.includes('price')) {
			// /v1/data/predictions/markets
			return {
				from: () => ({
					where: () => ({
						orderBy: () => Promise.resolve(mockPredictionMarketRows),
					}),
				}),
			}
		}
		throw new Error(`fakeDb.selectDistinctOn: unrecognized field selection ${JSON.stringify(keys)}`)
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

// ===========================================
// ROUND 5 — perps / predictions / lend
// ===========================================

describe('GET /v1/data/perps/markets', () => {
	it('returns 401 with no Authorization header', async () => {
		const res = await dataRoutes.request('/perps/markets')
		expect(res.status).toBe(401)
	})

	it('returns latest-per-symbol rows shaped as documented', async () => {
		mockPerpMarketRows = [
			{
				venue: 'hyperliquid',
				symbol: 'BTC',
				ts: new Date('2026-01-01T00:00:00Z'),
				fundingRate: '0.0001',
				openInterest: '1000000',
				markPrice: '95000',
				indexPrice: '94990',
				volume24h: '500000000',
			},
		]
		const res = await dataRoutes.request('/perps/markets', { headers: AUTH_HEADERS })
		expect(res.status).toBe(200)
		const body = (await res.json()) as any
		expect(body.success).toBe(true)
		expect(body.venues).toEqual(['hyperliquid'])
		expect(body.markets).toHaveLength(1)
		expect(body.markets[0]).toMatchObject({
			venue: 'hyperliquid',
			symbol: 'BTC',
			funding_rate: '0.0001',
			open_interest: '1000000',
			mark_price: '95000',
			index_price: '94990',
			volume_24h: '500000000',
		})
	})
})

describe('GET /v1/data/perps/history', () => {
	it('rejects a missing symbol', async () => {
		const res = await dataRoutes.request('/perps/history', { headers: AUTH_HEADERS })
		expect(res.status).toBe(400)
		const body = (await res.json()) as any
		expect(body.error_code).toBe('VALIDATION_ERROR')
	})

	it('defaults venue to hyperliquid and returns a metrics time series', async () => {
		mockPerpHistoryRows = [
			{
				ts: new Date('2026-01-01T00:00:00Z'),
				fundingRate: '0.0001',
				openInterest: '1000000',
				markPrice: '95000',
				indexPrice: '94990',
				volume24h: '500000000',
			},
		]
		const res = await dataRoutes.request('/perps/history?symbol=BTC', { headers: AUTH_HEADERS })
		expect(res.status).toBe(200)
		const body = (await res.json()) as any
		expect(body.success).toBe(true)
		expect(body.symbol).toBe('BTC')
		expect(body.venue).toBe('hyperliquid')
		expect(body.metrics).toHaveLength(1)
		expect(body.metrics[0].funding_rate).toBe('0.0001')
	})
})

describe('GET /v1/data/predictions/markets', () => {
	it('sorts by volume desc and caps at the requested limit', async () => {
		mockPredictionMarketRows = [
			{
				venue: 'polymarket',
				marketId: 'm1',
				conditionId: 'c1',
				question: 'Will it happen?',
				outcome: 'YES',
				ts: new Date('2026-01-01T00:00:00Z'),
				price: '0.6',
				volume: '1000',
				liquidity: '500',
				endDate: new Date('2026-06-01T00:00:00Z'),
			},
			{
				venue: 'polymarket',
				marketId: 'm2',
				conditionId: 'c2',
				question: 'Something else?',
				outcome: 'NO',
				ts: new Date('2026-01-01T00:00:00Z'),
				price: '0.4',
				volume: '5000',
				liquidity: '200',
				endDate: null,
			},
		]
		const res = await dataRoutes.request('/predictions/markets?limit=1', { headers: AUTH_HEADERS })
		expect(res.status).toBe(200)
		const body = (await res.json()) as any
		expect(body.success).toBe(true)
		expect(body.markets).toHaveLength(1)
		expect(body.markets[0].market_id).toBe('m2')
		expect(body.markets[0].volume).toBe('5000')
		expect(body.markets[0].end_date).toBeNull()
	})

	it('rejects an invalid limit', async () => {
		const res = await dataRoutes.request('/predictions/markets?limit=notanumber', { headers: AUTH_HEADERS })
		expect(res.status).toBe(400)
		const body = (await res.json()) as any
		expect(body.error_code).toBe('VALIDATION_ERROR')
	})
})

describe('GET /v1/data/predictions/history', () => {
	it('rejects a missing market_id', async () => {
		const res = await dataRoutes.request('/predictions/history', { headers: AUTH_HEADERS })
		expect(res.status).toBe(400)
		const body = (await res.json()) as any
		expect(body.error_code).toBe('VALIDATION_ERROR')
	})

	it('returns a flat history array when outcome is given', async () => {
		mockPredictionHistoryRows = [
			{ outcome: 'YES', ts: new Date('2026-01-01T00:00:00Z'), price: '0.6', volume: '1000', liquidity: '500' },
		]
		const res = await dataRoutes.request('/predictions/history?market_id=m1&outcome=YES', {
			headers: AUTH_HEADERS,
		})
		expect(res.status).toBe(200)
		const body = (await res.json()) as any
		expect(body.success).toBe(true)
		expect(body.market_id).toBe('m1')
		expect(body.outcome).toBe('YES')
		expect(body.history).toHaveLength(1)
		expect(body.history[0].price).toBe('0.6')
	})

	it('groups by outcome when outcome is omitted', async () => {
		mockPredictionHistoryRows = [
			{ outcome: 'YES', ts: new Date('2026-01-01T00:00:00Z'), price: '0.6', volume: '1000', liquidity: '500' },
			{ outcome: 'NO', ts: new Date('2026-01-01T00:00:00Z'), price: '0.4', volume: '900', liquidity: '400' },
		]
		const res = await dataRoutes.request('/predictions/history?market_id=m1', { headers: AUTH_HEADERS })
		expect(res.status).toBe(200)
		const body = (await res.json()) as any
		expect(body.success).toBe(true)
		expect(body.outcomes.YES).toHaveLength(1)
		expect(body.outcomes.NO).toHaveLength(1)
		expect(body.outcomes.YES[0].price).toBe('0.6')
	})
})

describe('GET /v1/data/lend/markets', () => {
	it('returns latest-per-market rows shaped as documented', async () => {
		mockLendMarketRows = [
			{
				venue: 'morpho',
				marketId: 'mk1',
				chainId: 8453,
				loanSymbol: 'USDC',
				collateralSymbol: 'WETH',
				ts: new Date('2026-01-01T00:00:00Z'),
				supplyApy: '0.05',
				borrowApy: '0.08',
				tvl: '10000000',
				utilization: '0.6',
			},
		]
		const res = await dataRoutes.request('/lend/markets', { headers: AUTH_HEADERS })
		expect(res.status).toBe(200)
		const body = (await res.json()) as any
		expect(body.success).toBe(true)
		expect(body.markets).toHaveLength(1)
		expect(body.markets[0]).toMatchObject({
			venue: 'morpho',
			market_id: 'mk1',
			chain_id: 8453,
			loan_symbol: 'USDC',
			collateral_symbol: 'WETH',
			supply_apy: '0.05',
			borrow_apy: '0.08',
			tvl: '10000000',
			utilization: '0.6',
		})
	})

	it('rejects a non-numeric chain_id', async () => {
		const res = await dataRoutes.request('/lend/markets?chain_id=notanumber', { headers: AUTH_HEADERS })
		expect(res.status).toBe(400)
		const body = (await res.json()) as any
		expect(body.error_code).toBe('VALIDATION_ERROR')
	})
})

describe('GET /v1/data/lend/history', () => {
	it('rejects a missing market_id', async () => {
		const res = await dataRoutes.request('/lend/history', { headers: AUTH_HEADERS })
		expect(res.status).toBe(400)
		const body = (await res.json()) as any
		expect(body.error_code).toBe('VALIDATION_ERROR')
	})

	it('returns a metrics time series', async () => {
		mockLendHistoryRows = [
			{
				ts: new Date('2026-01-01T00:00:00Z'),
				supplyApy: '0.05',
				borrowApy: '0.08',
				tvl: '10000000',
				utilization: '0.6',
			},
		]
		const res = await dataRoutes.request('/lend/history?market_id=mk1', { headers: AUTH_HEADERS })
		expect(res.status).toBe(200)
		const body = (await res.json()) as any
		expect(body.success).toBe(true)
		expect(body.market_id).toBe('mk1')
		expect(body.metrics).toHaveLength(1)
		expect(body.metrics[0].supply_apy).toBe('0.05')
	})
})

describe('GET /v1/data/metadata and /status — venue_datasets (Round 5)', () => {
	it('metadata reports per-dataset counts/ranges for perps/predictions/lend', async () => {
		mockMetadataRows = []
		mockPerpDatasetRows = [
			{ perpCount: 10, perpStart: new Date('2026-01-01T00:00:00Z'), perpEnd: new Date('2026-01-02T00:00:00Z') },
		]
		mockPredictionDatasetRows = [{ predictionCount: 0, predictionStart: null, predictionEnd: null }]
		mockLendDatasetRows = [
			{ lendCount: 3, lendStart: new Date('2026-01-01T00:00:00Z'), lendEnd: new Date('2026-01-01T05:00:00Z') },
		]

		const res = await dataRoutes.request('/metadata', { headers: AUTH_HEADERS })
		expect(res.status).toBe(200)
		const body = (await res.json()) as any
		expect(body.venue_datasets.perps.count).toBe(10)
		expect(body.venue_datasets.perps.start).toBe('2026-01-01T00:00:00.000Z')
		expect(body.venue_datasets.predictions.count).toBe(0)
		expect(body.venue_datasets.predictions.start).toBeNull()
		expect(body.venue_datasets.lend.count).toBe(3)
	})

	it('status reports freshness per dataset, healthy=true when a dataset is empty', async () => {
		mockStatusRows = []
		mockPerpDatasetRows = [{ perpCount: 0, perpStart: null, perpEnd: null }]
		mockPredictionDatasetRows = [{ predictionCount: 0, predictionStart: null, predictionEnd: null }]
		mockLendDatasetRows = [{ lendCount: 0, lendStart: null, lendEnd: null }]

		const res = await dataRoutes.request('/status', { headers: AUTH_HEADERS })
		expect(res.status).toBe(200)
		const body = (await res.json()) as any
		expect(body.venue_datasets.perps).toEqual({ count: 0, latest_ts: null, age_seconds: null, healthy: true })
		expect(body.venue_datasets.predictions.healthy).toBe(true)
		expect(body.venue_datasets.lend.healthy).toBe(true)
	})

	it('status marks a stale perp dataset unhealthy and drags down overall healthy', async () => {
		mockStatusRows = [{ timeframe: '1m', source: 'coingecko', latestTs: new Date(), cnt: 1 }]
		mockPerpDatasetRows = [
			{ perpCount: 5, perpStart: new Date(Date.now() - 3_600_000), perpEnd: new Date(Date.now() - 3_600_000) },
		]
		mockPredictionDatasetRows = [{ predictionCount: 0, predictionStart: null, predictionEnd: null }]
		mockLendDatasetRows = [{ lendCount: 0, lendStart: null, lendEnd: null }]

		const res = await dataRoutes.request('/status', { headers: AUTH_HEADERS })
		expect(res.status).toBe(200)
		const body = (await res.json()) as any
		expect(body.venue_datasets.perps.healthy).toBe(false)
		expect(body.healthy).toBe(false)
	})
})

// A chart asking for "the last N bars" sends no cursor and no start. That used
// to read `ORDER BY ts ASC LIMIT n` — the OLDEST n — so with 53k one-minute
// candles stored, a limit=200 request rendered candles a day and a half old
// while the newest was a minute old. Unanchored reads now come back newest-first
// from the DB and are reversed into chronological order for charting.
describe('GET /v1/data/history/ohlcv — unanchored requests return the LATEST window', () => {
	const rowAt = (iso: string) => ({
		symbol: 'ETH',
		chain: 'base',
		timeframe: '1m',
		ts: new Date(iso),
		open: '100',
		high: '110',
		low: '90',
		close: '105',
		volume: null,
		source: 'coingecko',
	})

	it('emits candles oldest→newest even though the DB returns them newest-first', async () => {
		// What `ORDER BY ts DESC LIMIT n` hands back.
		mockCandleRows = [
			rowAt('2026-08-15T00:43:00Z'),
			rowAt('2026-08-15T00:42:00Z'),
			rowAt('2026-08-15T00:41:00Z'),
		]

		const res = await dataRoutes.request('/history/ohlcv?symbol=ETH&chain=base&timeframe=1m&limit=200', {
			headers: AUTH_HEADERS,
		})
		expect(res.status).toBe(200)
		const body = (await res.json()) as any
		const times = body.candles.map((c: any) => c.ts)
		expect(times).toEqual([
			'2026-08-15T00:41:00.000Z',
			'2026-08-15T00:42:00.000Z',
			'2026-08-15T00:43:00.000Z',
		])
		// Ascending, and the newest row survives the window rather than being cut.
		expect(times[times.length - 1]).toBe('2026-08-15T00:43:00.000Z')
	})

	it('leaves an anchored request (cursor) reading forward in ascending order', async () => {
		// Paging forward must NOT be reversed — it already reads ascending.
		mockCandleRows = [rowAt('2026-08-15T00:41:00Z'), rowAt('2026-08-15T00:42:00Z')]
		const cursor = Buffer.from('2026-08-15T00:40:00.000Z').toString('base64')

		const res = await dataRoutes.request(
			`/history/ohlcv?symbol=ETH&chain=base&timeframe=1m&limit=200&cursor=${encodeURIComponent(cursor)}`,
			{ headers: AUTH_HEADERS },
		)
		expect(res.status).toBe(200)
		const body = (await res.json()) as any
		expect(body.candles.map((c: any) => c.ts)).toEqual([
			'2026-08-15T00:41:00.000Z',
			'2026-08-15T00:42:00.000Z',
		])
	})
})
