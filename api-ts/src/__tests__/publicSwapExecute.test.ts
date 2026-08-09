import { afterAll, beforeAll, beforeEach, describe, expect, it, mock } from 'bun:test'
import { Effect, Layer } from 'effect'
import jwt from 'jsonwebtoken'
import { EnvService } from '../config/EnvService'
import { RedisService, SwapService, WalletService } from '../services'

// ROUTE-LEVEL test for POST /public/swap/execute (MONEY-PATH).
// Auth and the route Effect both run for real; signing/broadcast can never be
// reached because every case below fails closed before credentials are used.

const REAL_RUNTIME = { ...(await import('../runtime')) }

const JWT_SECRET = 'public-swap-route-test-secret'
const TEST_WALLET_ADDRESS = '0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045'
const TEST_WALLET = {
	id: 1,
	userId: 123,
	address: TEST_WALLET_ADDRESS,
	walletProvider: 'turnkey',
	turnkeySubOrgId: 'sub-org-123',
	isActive: true,
} as any

let activeWallets: any[] = [TEST_WALLET]
let cachedQuote: any | null = null

const envLayer = Layer.succeed(EnvService, { JWT_SECRET } as any)
const walletLayer = Layer.succeed(
	WalletService,
	{
		getActiveWallets: () => Effect.succeed(activeWallets),
	} as any,
)
const redisLayer = Layer.succeed(
	RedisService,
	{
		get: () => Effect.succeed(cachedQuote),
		set: () => Effect.void,
		del: () => Effect.void,
		isConnected: () => true,
	} as any,
)
const swapLayer = Layer.succeed(SwapService, {} as any)
const testLayer = Layer.mergeAll(envLayer, walletLayer, redisLayer, swapLayer)

const runTestEffect = (effect: any) => Effect.runPromise(effect.pipe(Effect.provide(testLayer)))

mock.module('../runtime', () => ({
	runEffect: runTestEffect,
	runEffectEither: (effect: any) => runTestEffect(Effect.either(effect)),
	shutdownRuntime: async () => {},
}))

let publicSwapRoutes: any

beforeAll(async () => {
	;({ publicSwapRoutes } = await import('../routes/publicSwap'))
})

beforeEach(() => {
	activeWallets = [TEST_WALLET]
	cachedQuote = null
})

afterAll(() => {
	mock.module('../runtime', () => REAL_RUNTIME)
})

const authToken = jwt.sign(
	{ userId: 123, walletAddress: TEST_WALLET_ADDRESS, src: 'telegram' },
	JWT_SECRET,
)
const AUTH_HEADERS = {
	Authorization: `Bearer ${authToken}`,
	'Content-Type': 'application/json',
}

describe('POST /public/swap/execute — authenticated MONEY-PATH guards', () => {
	it('rejects a missing quoteId before execution', async () => {
		const res = await publicSwapRoutes.request('/execute', {
			method: 'POST',
			headers: AUTH_HEADERS,
			body: JSON.stringify({}),
		})

		expect(res.status).toBe(400)
		const body = (await res.json()) as any
		expect(body.message).toContain('quoteId is required')
	})

	it('rejects an expired or missing cached quote', async () => {
		const res = await publicSwapRoutes.request('/execute', {
			method: 'POST',
			headers: AUTH_HEADERS,
			body: JSON.stringify({ quoteId: 'quote-expired-xyz' }),
		})

		expect(res.status).toBe(400)
		const body = (await res.json()) as any
		expect(body.message).toContain('expired or not found')
	})

	it('rejects a non-Turnkey wallet selected from server state', async () => {
		activeWallets = [{ ...TEST_WALLET, walletProvider: 'external', turnkeySubOrgId: null }]

		const res = await publicSwapRoutes.request('/execute', {
			method: 'POST',
			headers: AUTH_HEADERS,
			body: JSON.stringify({ quoteId: 'quote-valid' }),
		})

		expect(res.status).toBe(400)
		const body = (await res.json()) as any
		expect(body.message).toContain('server-side signing')
	})
})
