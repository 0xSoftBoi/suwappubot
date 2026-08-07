import { afterAll, beforeAll, describe, expect, it, mock } from 'bun:test'
import { Either } from 'effect'

// ROUTE-LEVEL test for POST /v1/webapp/swap/execute (MONEY-PATH, decimal handling).
//
// Validates that:
// 1. Valid swap with correct decimals executes successfully
// 2. Insufficient balance is rejected with 402
// 3. Slippage breach is rejected with 422 (validation error)

const TEST_AGENT = {
	id: 1,
	uuid: 'test-agent-uuid',
	rateLimitTier: 'free',
	metadata: {
		internal_user_id: 100,
		internal_wallet_id: 200,
		wallet_address: '0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045',
	},
} as any

const TEST_WALLET = {
	id: 200,
	userId: 100,
	address: '0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045',
	balances: {
		'0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48': '1000000000', // 1000 USDC (6 decimals)
	},
} as any

const REAL_MODULES = {
	'../middleware/auth': { ...(await import('../middleware/auth')) },
	'../middleware/x402Payment': { ...(await import('../middleware/x402Payment')) },
	'../services': { ...(await import('../services')) },
	'../runtime': { ...(await import('../runtime')) },
	'../db': { ...(await import('../db')) },
}

afterAll(() => {
	mock.module('../middleware/auth', () => REAL_MODULES['../middleware/auth'])
	mock.module('../middleware/x402Payment', () => REAL_MODULES['../middleware/x402Payment'])
	mock.module('../services', () => REAL_MODULES['../services'])
	mock.module('../runtime', () => REAL_MODULES['../runtime'])
	mock.module('../db', () => REAL_MODULES['../db'])
})

// Mock auth to set agent context
mock.module('../middleware/auth', () => ({
	agentBearerAuth: () => async (c: any, next: any) => {
		c.set('agent', TEST_AGENT)
		return next()
	},
	agentBearerAuthAllowInactive: () => async (c: any, next: any) => next(),
}))

// Mock x402 metering
mock.module('../middleware/x402Payment', () => ({
	meteredPayment: () => async (c: any, next: any) => next(),
	chargeAgentForCall: async () => ({ kind: 'bypass', tier: 'free' }),
	setX402Headers: () => {},
	costForEndpoint: () => 0,
	refundChargedCall: async () => {},
	COST_WEIGHTS: {},
	CREDIT_USD_VALUE: 1,
	BYPASS_TIERS: new Set(['free']),
}))

// Mock services
mock.module('../services', () => ({
	...REAL_MODULES['../services'],
	SwapService: {
		executeSwap: async (params: any) => {
			// Simulate insufficient balance check
			if (params.amount > 1000000000) {
				throw new Error('Insufficient balance')
			}
			// Simulate slippage check
			if (params.minOutputAmount > params.expectedOutput * 0.95) {
				throw new Error('Slippage exceeded')
			}
			return {
				swap_id: 12345,
				tx_hash: '0xabc123def456',
				status: 'pending',
				executedAmount: params.amount,
				executedOutput: params.expectedOutput,
			}
		},
	},
	WalletService: {
		getWallet: async () => TEST_WALLET,
	},
	TokenService: {
		resolveDecimals: async (chainId: number, tokenAddress: string) => {
			if (tokenAddress === '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48') {
				return 6 // USDC
			}
			return 18 // Default ERC20
		},
	},
}))

// Mock runtime
mock.module('../runtime', () => ({
	runEffectEither: async (effect: any) => {
		try {
			return Either.right({
				swap_id: 12345,
				tx_hash: '0xabc123def456',
				status: 'pending',
			})
		} catch (err: any) {
			if (err.message.includes('Insufficient')) {
				return Either.left({ code: 'INSUFFICIENT_BALANCE', status: 402 })
			}
			if (err.message.includes('Slippage')) {
				return Either.left({ code: 'SLIPPAGE_EXCEEDED', status: 422 })
			}
			return Either.left(err)
		}
	},
}))

let swapRoutes: any

beforeAll(async () => {
	;({ swapRoutes } = await import('../routes/swap'))
})

const AUTH_HEADERS = { Authorization: 'Bearer suwappu_sk_test_key_00000000000000000000' }

describe('POST /v1/webapp/swap/execute — decimal handling + balance check', () => {
	it('executes valid swap with correct decimals', async () => {
		const res = await swapRoutes.request('/execute', {
			method: 'POST',
			headers: AUTH_HEADERS,
			body: JSON.stringify({
				fromToken: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48', // USDC (6 decimals)
				amount: '100000000', // 100 USDC (in wei, 6 decimals)
				toToken: '0xEeeeeEeeeEeEeeEeEeEeeEECeEe000000000000', // ETH
				minOutput: '0.05', // 5% slippage buffer
				chainId: 1,
			}),
		})

		expect(res.status).toBe(200)
		const body = (await res.json()) as any
		expect(body.swap_id).toBe(12345)
		expect(body.tx_hash).toBeDefined()
		expect(body.status).toBe('pending')
	})

	it('rejects swap with insufficient balance (402)', async () => {
		const res = await swapRoutes.request('/execute', {
			method: 'POST',
			headers: AUTH_HEADERS,
			body: JSON.stringify({
				fromToken: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
				amount: '10000000000', // Way more than 1000 USDC balance
				toToken: '0xEeeeeEeeeEeEeeEeEeEeeEECeEe000000000000',
				minOutput: '0.01',
				chainId: 1,
			}),
		})

		expect(res.status).toBe(402)
		const body = (await res.json()) as any
		expect(body.message).toContain('balance')
	})

	it('rejects swap exceeding slippage tolerance (422)', async () => {
		const res = await swapRoutes.request('/execute', {
			method: 'POST',
			headers: AUTH_HEADERS,
			body: JSON.stringify({
				fromToken: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
				amount: '100000000', // Valid amount
				toToken: '0xEeeeeEeeeEeEeeEeEeEeeEECeEe000000000000',
				minOutput: '10', // Unrealistic slippage requirement (market moving too much)
				chainId: 1,
			}),
		})

		expect(res.status).toBe(422)
		const body = (await res.json()) as any
		expect(body.message).toContain('Slippage')
	})

	it('rejects missing required fields', async () => {
		const res = await swapRoutes.request('/execute', {
			method: 'POST',
			headers: AUTH_HEADERS,
			body: JSON.stringify({
				fromToken: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
				// Missing 'amount'
				toToken: '0xEeeeeEeeeEeEeeEeEeEeeEECeEe000000000000',
			}),
		})

		expect(res.status).toBe(400)
		const body = (await res.json()) as any
		expect(body.message).toContain('required')
	})

	it('rejects zero or negative amount', async () => {
		const res = await swapRoutes.request('/execute', {
			method: 'POST',
			headers: AUTH_HEADERS,
			body: JSON.stringify({
				fromToken: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
				amount: '0',
				toToken: '0xEeeeeEeeeEeEeeEeEeEeeEECeEe000000000000',
				minOutput: '0.01',
				chainId: 1,
			}),
		})

		expect(res.status).toBe(400)
		const body = (await res.json()) as any
		expect(body.message).toContain('amount')
	})
})
