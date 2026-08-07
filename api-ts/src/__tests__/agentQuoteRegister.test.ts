import { afterAll, beforeAll, describe, expect, it, mock } from 'bun:test'
import { Effect, Layer, Option } from 'effect'
import { EnvService } from '../config/EnvService'
import { AgentService } from '../services'

// ROUTE-LEVEL tests for the public registration contract and authenticated quote
// validation. Registration is name/metadata based; wallet ownership is enforced
// later at managed execution, not by fictional signature fields on /register.

const REAL_RUNTIME = { ...(await import('../runtime')) }

const API_KEY = `suwappu_sk_${'a'.repeat(32)}`
const TEST_AGENT = {
	id: 1,
	uuid: '11111111-1111-4111-8111-111111111111',
	name: 'route_test_agent',
	rateLimitTier: 'pro',
	metadata: null,
	createdAt: new Date('2026-08-01T00:00:00.000Z'),
} as any

const envLayer = Layer.succeed(EnvService, {} as any)
const agentLayer = Layer.succeed(
	AgentService,
	{
		getAgentByApiKey: () => Effect.succeed(Option.some(TEST_AGENT)),
		getAgentByName: () => Effect.succeed(Option.none()),
		registerAgent: (params: { name: string }) =>
			Effect.succeed({
				agent: { ...TEST_AGENT, name: params.name },
				apiKey: API_KEY,
				grantedCredits: 100,
			}),
		incrementAgentStats: () => Effect.void,
	} as any,
)
const testLayer = Layer.mergeAll(envLayer, agentLayer)

const runTestEffect = (effect: any) => Effect.runPromise(effect.pipe(Effect.provide(testLayer)))

mock.module('../runtime', () => ({
	runEffect: runTestEffect,
	runEffectEither: (effect: any) => runTestEffect(Effect.either(effect)),
	shutdownRuntime: async () => {},
}))

let agentRoutes: any

beforeAll(async () => {
	;({ agentRoutes } = await import('../routes/agent'))
})

afterAll(() => {
	mock.module('../runtime', () => REAL_RUNTIME)
})

const AUTH_HEADERS = {
	Authorization: `Bearer ${API_KEY}`,
	'Content-Type': 'application/json',
}

describe('POST /v1/agent/register + /v1/agent/quote — current builder contract', () => {
	it('registers a new agent from the documented name-based payload', async () => {
		const res = await agentRoutes.request('/register', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({
				name: 'builder_route_test',
				description: 'Contract test agent',
				metadata: { surface: 'test' },
			}),
		})

		expect(res.status).toBe(201)
		const body = (await res.json()) as any
		expect(body.success).toBe(true)
		expect(body.agent.name).toBe('builder_route_test')
		expect(body.agent.api_key).toBe(API_KEY)
		expect(body.credits.starting_balance).toBe(100)
	})

	it('rejects an invalid agent name at the registration boundary', async () => {
		const res = await agentRoutes.request('/register', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ name: 'x' }),
		})

		expect(res.status).toBe(400)
		const body = (await res.json()) as any
		expect(body.error_code).toBe('VALIDATION_ERROR')
		expect(body.fields.name).toContain('at least 3')
	})

	it('rejects a quote missing its required amount', async () => {
		const res = await agentRoutes.request('/quote', {
			method: 'POST',
			headers: AUTH_HEADERS,
			body: JSON.stringify({ from_token: 'ETH', to_token: 'USDC', chain: 'base' }),
		})

		expect(res.status).toBe(400)
		const body = (await res.json()) as any
		expect(body.error_code).toBe('VALIDATION_ERROR')
		expect(body.fields.amount).toBeDefined()
	})

	it('rejects a malformed managed-wallet address before quote lookup', async () => {
		const res = await agentRoutes.request('/quote', {
			method: 'POST',
			headers: AUTH_HEADERS,
			body: JSON.stringify({
				from_token: 'ETH',
				to_token: 'USDC',
				amount: '0.1',
				chain: 'base',
				wallet_address: '0x1234',
			}),
		})

		expect(res.status).toBe(400)
		const body = (await res.json()) as any
		expect(body.error_code).toBe('VALIDATION_ERROR')
		expect(body.fields.wallet_address).toContain('Invalid EVM address')
	})

	it('fails closed for Starknet instead of invoking an unsupported provider', async () => {
		const res = await agentRoutes.request('/quote', {
			method: 'POST',
			headers: AUTH_HEADERS,
			body: JSON.stringify({
				from_token: 'ETH',
				to_token: 'USDC',
				amount: '0.1',
				chain: 'starknet',
			}),
		})

		expect(res.status).toBe(400)
		const body = (await res.json()) as any
		expect(body.error_code).toBe('CHAIN_UNSUPPORTED')
		expect(body.error).toContain('bot backend')
	})
})
