import { afterAll, beforeAll, beforeEach, describe, expect, it, mock } from 'bun:test'
import { Effect, Layer, Option } from 'effect'
import { EnvService } from '../config/EnvService'
import { RedisService, SwapService, UserService, WalletService } from '../services'

// ROUTE-LEVEL test for POST /webapp/swap/execute (MONEY-PATH).
//
// The endpoint executes a previously cached quote; it does not accept raw token
// amounts. These tests exercise the current quoteId contract and the guards that
// must fire before any signing or broadcast is possible.

const REAL_RUNTIME = { ...(await import('../runtime')) }
const ORIGINAL_NODE_ENV = process.env.NODE_ENV
const ORIGINAL_DEV_AUTH_ENABLED = process.env.DEV_AUTH_ENABLED

const TEST_TELEGRAM_ID = 123456
const TEST_WALLET = {
	id: 200,
	userId: 100,
	address: '0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045',
	walletProvider: 'turnkey',
	turnkeySubOrgId: 'sub-org-200',
	isActive: true,
} as any
const TEST_USER = { id: 100, telegramId: TEST_TELEGRAM_ID, username: 'devuser' } as any
const TEST_QUOTE = {
	quoteId: 'quote-valid',
	fromChain: 'base',
	toChain: 'base',
	fromToken: {
		address: '0x0000000000000000000000000000000000000000',
		symbol: 'ETH',
		decimals: 18,
	},
	toToken: {
		address: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
		symbol: 'USDC',
		decimals: 6,
	},
	fromAmount: '1000000000000000',
	toAmount: '3000000',
	fromAmountUsd: '3.00',
	toAmountUsd: '2.99',
	slippage: 0.005,
	estimatedGasUsd: '0.02',
	bridgeFeeUsd: '0',
	_rawQuote: { estimate: {}, action: {} },
	transactionRequest: {
		from: TEST_WALLET.address,
		to: '0x1111111111111111111111111111111111111111',
		chainId: 8453,
		value: '0x0',
		data: '0x',
	},
} as any

let currentUser: any | null = TEST_USER
let activeWallets: any[] = [TEST_WALLET]
let cachedQuote: any | null = TEST_QUOTE
let createdSwapRecords = 0
let swapStatusUpdates: Array<{ status: string; errorMessage?: string }> = []

const envLayer = Layer.succeed(EnvService, {} as any)
const redisLayer = Layer.succeed(
	RedisService,
	{
		get: () => Effect.succeed(cachedQuote),
		set: () => Effect.void,
		del: () => Effect.void,
		isConnected: () => true,
	} as any,
)
const userLayer = Layer.succeed(
	UserService,
	{
		getUserByTelegramId: () => Effect.succeed(Option.fromNullable(currentUser)),
	} as any,
)
const walletLayer = Layer.succeed(
	WalletService,
	{
		getActiveWallets: () => Effect.succeed(activeWallets),
	} as any,
)
const swapLayer = Layer.succeed(
	SwapService,
	{
		createSwapRecord: () =>
			Effect.sync(() => {
				createdSwapRecords += 1
				return { id: 12345 } as any
			}),
		updateSwapStatus: (_id: number, status: string, _txHash?: string, errorMessage?: string) =>
			Effect.sync(() => {
				swapStatusUpdates.push({ status, errorMessage })
				return null
			}),
	} as any,
)
const testLayer = Layer.mergeAll(envLayer, redisLayer, userLayer, walletLayer, swapLayer)

const runTestEffect = (effect: any) => Effect.runPromise(effect.pipe(Effect.provide(testLayer)))

mock.module('../runtime', () => ({
	runEffect: runTestEffect,
	runEffectEither: (effect: any) => runTestEffect(Effect.either(effect)),
	shutdownRuntime: async () => {},
}))

let swapRoutes: any

beforeAll(async () => {
	process.env.NODE_ENV = 'development'
	process.env.DEV_AUTH_ENABLED = 'true'
	;({ swapRoutes } = await import('../routes/swap'))
})

beforeEach(() => {
	currentUser = TEST_USER
	activeWallets = [TEST_WALLET]
	cachedQuote = TEST_QUOTE
	createdSwapRecords = 0
	swapStatusUpdates = []
})

afterAll(() => {
	if (ORIGINAL_NODE_ENV === undefined) delete process.env.NODE_ENV
	else process.env.NODE_ENV = ORIGINAL_NODE_ENV
	if (ORIGINAL_DEV_AUTH_ENABLED === undefined) delete process.env.DEV_AUTH_ENABLED
	else process.env.DEV_AUTH_ENABLED = ORIGINAL_DEV_AUTH_ENABLED
	mock.module('../runtime', () => REAL_RUNTIME)
})

const REQUEST_HEADERS = {
	'Content-Type': 'application/json',
	'X-Dev-User-Id': String(TEST_TELEGRAM_ID),
}

describe('POST /webapp/swap/execute — cached-quote execution guards', () => {
	it('rejects a missing quoteId', async () => {
		const res = await swapRoutes.request('/execute', {
			method: 'POST',
			headers: REQUEST_HEADERS,
			body: JSON.stringify({}),
		})

		expect(res.status).toBe(400)
		const body = (await res.json()) as any
		expect(body.message).toContain('quoteId is required')
		expect(createdSwapRecords).toBe(0)
	})

	it('rejects a Telegram identity that has no registered user', async () => {
		currentUser = null

		const res = await swapRoutes.request('/execute', {
			method: 'POST',
			headers: REQUEST_HEADERS,
			body: JSON.stringify({ quoteId: 'quote-valid' }),
		})

		expect(res.status).toBe(404)
		const body = (await res.json()) as any
		expect(body.message).toContain('User not found')
		expect(createdSwapRecords).toBe(0)
	})

	it('rejects a wallet that cannot use server-side signing', async () => {
		activeWallets = [{ ...TEST_WALLET, walletProvider: 'external', turnkeySubOrgId: null }]

		const res = await swapRoutes.request('/execute', {
			method: 'POST',
			headers: REQUEST_HEADERS,
			body: JSON.stringify({ quoteId: 'quote-valid' }),
		})

		expect(res.status).toBe(400)
		const body = (await res.json()) as any
		expect(body.message).toContain('server-side signing')
		expect(createdSwapRecords).toBe(0)
	})

	it('rejects an expired or missing cached quote', async () => {
		cachedQuote = null

		const res = await swapRoutes.request('/execute', {
			method: 'POST',
			headers: REQUEST_HEADERS,
			body: JSON.stringify({ quoteId: 'quote-expired' }),
		})

		expect(res.status).toBe(400)
		const body = (await res.json()) as any
		expect(body.message).toContain('expired or not found')
		expect(createdSwapRecords).toBe(0)
	})

	it('records then fails closed when the signing service is not configured', async () => {
		const res = await swapRoutes.request('/execute', {
			method: 'POST',
			headers: REQUEST_HEADERS,
			body: JSON.stringify({ quoteId: 'quote-valid', idempotencyKey: 'route-test-1' }),
		})

		expect(res.status).toBe(400)
		const body = (await res.json()) as any
		expect(body.message).toContain('Signing service not configured')
		expect(createdSwapRecords).toBe(1)
		expect(swapStatusUpdates).toEqual([
			{ status: 'failed', errorMessage: 'Turnkey not configured' },
		])
	})
})
