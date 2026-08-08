import { afterAll, beforeAll, describe, expect, it, mock } from 'bun:test'
import { Either } from 'effect'

const REAL_MODULES = {
	'../middleware': { ...(await import('../middleware')) },
	'../runtime': { ...(await import('../runtime')) },
}

afterAll(() => {
	mock.module('../middleware', () => REAL_MODULES['../middleware'])
	mock.module('../runtime', () => REAL_MODULES['../runtime'])
})

let agentAuthCalls = 0
let userAuthCalls = 0

// Routing-only stubs are intentional here: a positive agentBearerAuth() integration
// test requires a registered DB-backed agent. Existing middleware tests own malformed/
// anonymous credential rejection; this suite proves that the perps route sends each
// credential class to the correct real middleware rather than claiming to test DB auth.
mock.module('../middleware', () => ({
	agentBearerAuth: () => async (_c: any, next: any) => {
		agentAuthCalls++
		return next()
	},
	flexAuth: () => async (c: any, next: any) => {
		userAuthCalls++
		const auth = c.req.header('Authorization')
		if (auth === 'Bearer user-session-jwt') return next()
		return c.json({ error: 'Authentication required' }, 401)
	},
}))

mock.module('../runtime', () => ({
	runEffectEither: async () => Either.right([]),
	runEffect: async () => undefined,
	shutdownRuntime: async () => undefined,
}))

let perpsRoutes: any

beforeAll(async () => {
	;({ perpsRoutes } = await import('../routes/perps'))
})

afterAll(() => {
	agentAuthCalls = 0
	userAuthCalls = 0
})

const path = '/positions?address=0x1111111111111111111111111111111111111111'

describe('GET /v1/agent/perps/positions auth compatibility', () => {
	it('routes Suwappu agent keys through agent bearer auth', async () => {
		const beforeAgent = agentAuthCalls
		const beforeUser = userAuthCalls
		const res = await perpsRoutes.request(path, {
			headers: { Authorization: 'Bearer suwappu_sk_test_key_00000000000000000000' },
		})
		expect(res.status).toBe(200)
		expect(agentAuthCalls).toBe(beforeAgent + 1)
		expect(userAuthCalls).toBe(beforeUser)
	})

	it('matches agentBearerAuth whitespace normalization when selecting the agent-key path', async () => {
		const beforeAgent = agentAuthCalls
		const beforeUser = userAuthCalls
		const res = await perpsRoutes.request(path, {
			headers: { Authorization: 'Bearer    suwappu_sk_test_key_00000000000000000000   ' },
		})
		expect(res.status).toBe(200)
		expect(agentAuthCalls).toBe(beforeAgent + 1)
		expect(userAuthCalls).toBe(beforeUser)
	})

	it('preserves the existing user-session path for the first-party terminal', async () => {
		const beforeAgent = agentAuthCalls
		const beforeUser = userAuthCalls
		const res = await perpsRoutes.request(path, {
			headers: { Authorization: 'Bearer user-session-jwt' },
		})
		expect(res.status).toBe(200)
		expect(agentAuthCalls).toBe(beforeAgent)
		expect(userAuthCalls).toBe(beforeUser + 1)
	})

	it('still rejects a request with no accepted authentication', async () => {
		const res = await perpsRoutes.request(path)
		expect(res.status).toBe(401)
	})
})
