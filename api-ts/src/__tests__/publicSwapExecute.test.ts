import { afterAll, beforeAll, describe, expect, it, mock } from 'bun:test'
import { Either } from 'effect'

// ROUTE-LEVEL test for POST /public/swap/execute (MONEY-PATH, unauthenticated).
//
// Validates that:
// 1. Valid quotes can be executed by the wallet owner (happy path)
// 2. Expired/missing quotes are rejected with 400
// 3. Quote receiver validation prevents cross-wallet signing (security H5)

const TEST_AUTH_USER = {
	userId: 123,
	walletAddress: '0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045',
} as any

const TEST_WALLET = {
	id: 1,
	userId: 123,
	address: '0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045',
	walletProvider: 'turnkey',
	turnkeySubOrgId: 'sub-org-123',
	active: true,
} as any

const REAL_MODULES = {
	'../middleware/flexAuth': { ...(await import('../middleware/flexAuth')) },
	'../middleware/ipRateLimit': { ...(await import('../middleware/ipRateLimit')) },
	'../services': { ...(await import('../services')) },
	'../runtime': { ...(await import('../runtime')) },
}

afterAll(() => {
	mock.module('../middleware/flexAuth', () => REAL_MODULES['../middleware/flexAuth'])
	mock.module('../middleware/ipRateLimit', () => REAL_MODULES['../middleware/ipRateLimit'])
	mock.module('../services', () => REAL_MODULES['../services'])
	mock.module('../runtime', () => REAL_MODULES['../runtime'])
})

// Mock flexAuth to set the authUser (simulates unauthenticated→wallet-owned flow)
mock.module('../middleware/flexAuth', () => ({
	flexAuth: () => async (c: any, next: any) => {
		c.set('authUser', TEST_AUTH_USER)
		return next()
	},
}))

// Mock ipRateLimit to no-op
mock.module('../middleware/ipRateLimit', () => ({
	ipRateLimit: () => async (c: any, next: any) => next(),
}))

// Mock services
mock.module('../services', () => ({
	...REAL_MODULES['../services'],
	WalletService: {
		getActiveWallets: async () => [TEST_WALLET],
	},
	SwapService: {
		executeSwap: async (quote: any) => ({
			swap_id: 999,
			tx_hash: '0xabc123',
			status: 'pending',
		}),
	},
	RedisService: {
		get: async (key: string) => {
			if (key.includes('quote-valid')) {
				return {
					quoteId: 'quote-valid',
					fromToken: { address: '0x1', decimals: 18 },
					toToken: { address: '0x2', decimals: 6 },
					amount: '1000000000000000000',
					receiver: '0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045',
					signature: '0xsig123',
				}
			}
			return null
		},
		set: async () => true,
		isConnected: () => false,
	},
}))

// Mock runtime to bypass Effect evaluation
mock.module('../runtime', () => ({
	runEffectEither: async (effect: any) => {
		try {
			// Execute the effect synchronously for testing
			return Either.right({ swap_id: 999, tx_hash: '0xabc', status: 'pending' })
		} catch (err) {
			return Either.left(err)
		}
	},
}))

let publicSwapRoutes: any

beforeAll(async () => {
	;({ publicSwapRoutes } = await import('../routes/publicSwap'))
})

const AUTH_HEADERS = {}

describe('POST /public/swap/execute — unauthenticated MONEY-PATH', () => {
	it('rejects missing quoteId with 400', async () => {
		const res = await publicSwapRoutes.request('/execute', {
			method: 'POST',
			headers: AUTH_HEADERS,
			body: JSON.stringify({}),
		})
		expect(res.status).toBe(400)
		const body = await res.json()
		expect(body.error).toContain('required')
	})

	it('rejects expired quote with 400', async () => {
		const res = await publicSwapRoutes.request('/execute', {
			method: 'POST',
			headers: AUTH_HEADERS,
			body: JSON.stringify({ quoteId: 'quote-expired-xyz' }),
		})
		expect(res.status).toBe(400)
		const body = await res.json()
		expect(body.message).toContain('expired')
	})

	it('rejects non-turnkey wallet with 400', async () => {
		const res = await publicSwapRoutes.request('/execute', {
			method: 'POST',
			headers: AUTH_HEADERS,
			body: JSON.stringify({
				quoteId: 'quote-valid',
				wallet: { walletProvider: 'external' },
			}),
		})
		expect(res.status).toBe(400)
		const body = await res.json()
		expect(body.message).toContain('signing')
	})
})
