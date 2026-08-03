import { afterAll, afterEach, beforeAll, describe, expect, it, mock } from 'bun:test'
import { Either } from 'effect'

// ROUTE-LEVEL test for POST /v1/agent/swap/execute (MONEY-PATH decimals gate).
//
// swapExecuteDecimals.test.ts only exercises the pure helper resolveSwapExecuteDecimals()
// and notes the 422 behaviour as "verified structurally". This file proves the actual
// wired route: given a cached Solana quote with NO resolvable from-decimals (the real
// shape a Jupiter quote takes — it never carries decimals), a POST to
// /v1/agent/swap/execute returns 422 QUOTE_NOT_FOUND and the handler returns *before*
// ever calling the internal Python execute-swap endpoint.
//
// Same mocking pattern as mcpPortfolioOwnership.test.ts / agentOrMppAuth.test.ts:
// mock the DB-touching middlewares (bearer auth, x402 metering) so the route can be
// mounted and driven through `app.request()` without a live database, while the
// MONEY-PATH logic under test (resolveSwapExecuteDecimals + the 422 branch) runs for
// real, unmocked.

const TEST_AGENT = {
	id: 4242,
	uuid: 'test-agent-uuid',
	rateLimitTier: 'free',
	metadata: {
		internal_user_id: 1,
		internal_wallet_id: 2,
		wallet_address: '0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045',
	},
} as any

// mock.module() mutates the PROCESS-WIDE module registry and is NOT undone when this
// file finishes — every test file that runs later in the same `bun test` process keeps
// these stubs. That leak is why x402.test.ts (costForTool → 0, COST_WEIGHTS → {}) and
// agentOrMppAuth.test.ts (bearer auth → pass-through, so a malformed key 200s) failed
// in the full run while both passed in isolation. Capture the real implementations
// before mocking and restore them in afterAll — same discipline as global.fetch below.
const REAL_MODULES = {
	'../middleware/auth': { ...(await import('../middleware/auth')) },
	'../middleware/x402Payment': { ...(await import('../middleware/x402Payment')) },
	'../runtime': { ...(await import('../runtime')) },
}

afterAll(() => {
	mock.module('../middleware/auth', () => REAL_MODULES['../middleware/auth'])
	mock.module('../middleware/x402Payment', () => REAL_MODULES['../middleware/x402Payment'])
	mock.module('../runtime', () => REAL_MODULES['../runtime'])
})

// Bypass DB-backed bearer auth: any request in this suite authenticates as TEST_AGENT.
// (agentFlexAuth falls through to agentBearerAuth() for non-org-key bearer tokens.)
mock.module('../middleware/auth', () => ({
	agentBearerAuth: () => async (c: any, next: any) => {
		c.set('agent', TEST_AGENT)
		return next()
	},
	agentBearerAuthAllowInactive: () => async (c: any, next: any) => next(),
	adminKeyAuth: () => async (c: any, next: any) => next(),
}))

// Bypass DB-backed x402 credit metering — this route is not what's under test here.
mock.module('../middleware/x402Payment', () => ({
	meteredPayment: () => async (c: any, next: any) => next(),
	chargeAgentForCall: async () => ({ kind: 'bypass', tier: 'free' }),
	setX402Headers: () => {},
	costForTool: () => 0,
	costForEndpoint: () => 0,
	refundChargedCall: async () => {},
	COST_WEIGHTS: {},
	CREDIT_USD_VALUE: 1,
	BYPASS_TIERS: new Set(['free']),
}))

// The internal Python call happens through runEffectEither(Effect.tryPromise(fetch)).
// Mock the runtime so no real Effect/EnvService/DB layer needs to spin up — this only
// matters for the POSITIVE case (decimals resolve, code proceeds past the gate); the
// negative case never reaches this code at all, which is exactly what we're proving.
//
// enforcePolicyGateForFreshQuote() ALSO now calls runEffectEither (org-less agents are
// policy-gated too, not just org agents — see PolicyService.evaluate()'s org-less
// per-agent-policy path), so this generic runtime mock is invoked twice per request:
// once for the policy evaluate() call, once for the internal Python execute-swap call.
// It must return an 'allow' verdict shape for the FIRST call (so the gate falls through
// exactly like a real no-DB fail-open would) and the canned swap result for the rest.
let fetchCallCount = 0
let runEffectEitherCallCount = 0
mock.module('../runtime', () => ({
	runEffect: async () => ({}),
	runEffectEither: async () => {
		runEffectEitherCallCount++
		if (runEffectEitherCallCount === 1) {
			// Stands in for enforcePolicyGateForFreshQuote's PolicyService.evaluate()
			// call — 'allow' means the gate returns null and the route proceeds.
			return Either.right({ decision: 'allow' })
		}
		fetchCallCount++
		return Either.right({ swap_id: 999, tx_hash: '0xabc', status: 'pending' })
	},
	shutdownRuntime: async () => {},
}))

let agentRoutes: any
let stopAgentCleanup: any
let cacheAgentQuote: any

beforeAll(async () => {
	;({ agentRoutes, stopAgentCleanup } = await import('../routes/agent'))
	;({ cacheAgentQuote } = await import('../lib/quoteCache'))
})

afterAll(() => stopAgentCleanup?.())

// Spy on global fetch to prove the internal Python endpoint is never hit when the
// route rejects with 422 before reaching the fetch call. (runEffectEither is mocked
// above and never calls real fetch either, but we assert at the fetch layer too so
// this test would still catch a regression that bypassed runEffectEither entirely.)
const originalFetch = global.fetch
let fetchCalls: string[] = []

beforeAll(() => {
	// @ts-expect-error - test stub
	global.fetch = async (input: any, ...args: any[]) => {
		fetchCalls.push(String(input))
		return originalFetch(input, ...args)
	}
})

afterEach(() => {
	fetchCalls = []
	fetchCallCount = 0
	runEffectEitherCallCount = 0
})

afterAll(() => {
	global.fetch = originalFetch
})

const AUTH_HEADERS = { Authorization: 'Bearer suwappu_sk_test_key_00000000000000000000' }

describe('POST /v1/agent/swap/execute — decimals gate (route-level, MONEY-PATH)', () => {
	it('returns 422 QUOTE_NOT_FOUND for a Solana quote with no resolvable from-decimals, and never calls the internal Python fetch', async () => {
		const quoteId = `sol-no-decimals-${Date.now()}`
		// A raw Jupiter quote shape — Jupiter never carries decimals, and no
		// fromDecimals/toDecimals were cached (simulates the exact real-world gap).
		cacheAgentQuote(
			quoteId,
			{
				inAmount: '1000000000',
				outAmount: '999000000',
				inputMint: 'So11111111111111111111111111111111111111112',
				outputMint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
				otherAmountThreshold: '990000000',
				priceImpactPct: '0.1',
			},
			TEST_AGENT.id,
			true, // isSolana
			// no fromDecimals/toDecimals passed
		)

		const res = await agentRoutes.request('/swap/execute', {
			method: 'POST',
			headers: { ...AUTH_HEADERS, 'Content-Type': 'application/json' },
			body: JSON.stringify({ quote_id: quoteId }),
		})

		expect(res.status).toBe(422)
		const body = await res.json()
		expect(body.error_code).toBe('QUOTE_NOT_FOUND')

		// The route must reject before ever reaching the internal Python
		// execute-swap call.
		expect(fetchCalls.some((url) => url.includes('/internal/agent/execute-swap'))).toBe(false)
		expect(fetchCallCount).toBe(0)
	})

	it('does NOT 422 for a cached Solana quote WITH fromDecimals/toDecimals populated (decimals gate passes)', async () => {
		const quoteId = `sol-with-decimals-${Date.now()}`
		cacheAgentQuote(
			quoteId,
			{
				inAmount: '1000000000',
				outAmount: '999000000',
				inputMint: 'So11111111111111111111111111111111111111112',
				outputMint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
				otherAmountThreshold: '990000000',
				priceImpactPct: '0.1',
			},
			TEST_AGENT.id,
			true, // isSolana
			{ fromDecimals: 9, toDecimals: 6 },
		)

		const res = await agentRoutes.request('/swap/execute', {
			method: 'POST',
			headers: { ...AUTH_HEADERS, 'Content-Type': 'application/json' },
			body: JSON.stringify({ quote_id: quoteId }),
		})

		expect(res.status).not.toBe(422)
	})
})
