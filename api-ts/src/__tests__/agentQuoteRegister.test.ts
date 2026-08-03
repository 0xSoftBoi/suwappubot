import { afterAll, beforeAll, describe, expect, it, mock } from 'bun:test'
import { Either } from 'effect'

// ROUTE-LEVEL test for POST /v1/agent/register + POST /v1/agent/quote (MONEY-PATH, control-plane).
//
// Validates that:
// 1. New agent can be registered with valid EVM signature (ownership proof)
// 2. Quote is rejected if signed by non-owner wallet
// 3. Quote registration enforces signer == agent owner

const TEST_AGENT = {
	id: 1,
	uuid: 'test-agent-uuid',
	ownerAddress: '0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045',
	rateLimitTier: 'free',
} as any

const TEST_OWNER_KEY = '0x1234567890123456789012345678901234567890'

const REAL_MODULES = {
	'../middleware/auth': { ...(await import('../middleware/auth')) },
	'../services': { ...(await import('../services')) },
	'../runtime': { ...(await import('../runtime')) },
	'../db': { ...(await import('../db')) },
}

afterAll(() => {
	mock.module('../middleware/auth', () => REAL_MODULES['../middleware/auth'])
	mock.module('../services', () => REAL_MODULES['../services'])
	mock.module('../runtime', () => REAL_MODULES['../runtime'])
	mock.module('../db', () => REAL_MODULES['../db'])
})

// Mock auth to allow admin registration
mock.module('../middleware/auth', () => ({
	adminKeyAuth: () => async (c: any, next: any) => next(),
	agentBearerAuth: () => async (c: any, next: any) => {
		c.set('agent', TEST_AGENT)
		return next()
	},
}))

// Mock services
mock.module('../services', () => ({
	...REAL_MODULES['../services'],
	AgentService: {
		registerAgent: async (owner: string, sig: string) => {
			if (sig !== 'valid_sig_123') throw new Error('Invalid signature')
			return { id: 1, uuid: 'test-uuid', ownerAddress: owner, rateLimitTier: 'free' }
		},
		verifyQuoteSigner: async (agentId: number, signer: string, sig: string) => {
			if (signer !== TEST_AGENT.ownerAddress) throw new Error('Unauthorized signer')
			if (sig !== 'valid_quote_sig_456') throw new Error('Invalid quote signature')
			return true
		},
	},
	AgentTrustService: {
		validateAgentOwnership: async (address: string) => true,
	},
}))

// Mock runtime
mock.module('../runtime', () => ({
	runEffectEither: async (effect: any) => {
		try {
			return Either.right({ success: true })
		} catch (err) {
			return Either.left(err)
		}
	},
}))

let agentRoutes: any

beforeAll(async () => {
	;({ agentRoutes } = await import('../routes/agent'))
})

const AUTH_HEADERS = { Authorization: 'Bearer suwappu_sk_test_key_00000000000000000000' }

describe('POST /v1/agent/register + /v1/agent/quote — ownership proof', () => {
	it('registers new agent with valid EVM signature', async () => {
		const res = await agentRoutes.request('/register', {
			method: 'POST',
			headers: AUTH_HEADERS,
			body: JSON.stringify({
				ownerAddress: '0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045',
				signature: 'valid_sig_123',
			}),
		})

		expect(res.status).toBe(200)
		const body = (await res.json()) as any
		expect(body.id).toBeDefined()
		expect(body.ownerAddress).toBe('0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045')
	})

	it('rejects registration with invalid signature', async () => {
		const res = await agentRoutes.request('/register', {
			method: 'POST',
			headers: AUTH_HEADERS,
			body: JSON.stringify({
				ownerAddress: '0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045',
				signature: 'invalid_sig_xyz',
			}),
		})

		expect(res.status).toBe(400)
		const body = (await res.json()) as any
		expect(body.message).toContain('signature')
	})

	it('rejects quote signed by non-owner', async () => {
		const res = await agentRoutes.request('/quote', {
			method: 'POST',
			headers: AUTH_HEADERS,
			body: JSON.stringify({
				quoteId: 'quote-123',
				signer: '0xAttackerAddress1111111111111111111111111111',
				signature: 'fake_sig_999',
			}),
		})

		expect(res.status).toBe(401)
		const body = (await res.json()) as any
		expect(body.message).toContain('Unauthorized')
	})

	it('accepts quote signed by agent owner', async () => {
		const res = await agentRoutes.request('/quote', {
			method: 'POST',
			headers: AUTH_HEADERS,
			body: JSON.stringify({
				quoteId: 'quote-123',
				signer: TEST_AGENT.ownerAddress,
				signature: 'valid_quote_sig_456',
			}),
		})

		expect(res.status).toBe(200)
		const body = (await res.json()) as any
		expect(body.success).toBe(true)
	})

	it('rejects quote with missing signer', async () => {
		const res = await agentRoutes.request('/quote', {
			method: 'POST',
			headers: AUTH_HEADERS,
			body: JSON.stringify({
				quoteId: 'quote-123',
				signature: 'valid_quote_sig_456',
			}),
		})

		expect(res.status).toBe(400)
		const body = (await res.json()) as any
		expect(body.message).toContain('required')
	})
})
