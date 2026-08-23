import { describe, expect, it } from 'bun:test'
import { Hono } from 'hono'

// Minimal public-infrastructure route tests without requiring the full runtime.
describe('health and developer contract endpoints', () => {
	it('returns 200 with status ok', async () => {
		const { healthRoutes } = await import('../routes/health')
		const app = new Hono()
		app.route('/', healthRoutes)

		const res = await app.request('/health')
		expect(res.status).toBe(200)

		const body = (await res.json()) as any
		expect(body.service).toBe('suwappu-api-ts')
		expect(body.status).toBeDefined()
		expect(body.timestamp).toBeDefined()
	})

	it('returns chains list', async () => {
		const { healthRoutes } = await import('../routes/health')
		const app = new Hono()
		app.route('/', healthRoutes)

		const res = await app.request('/chains')
		expect(res.status).toBe(200)

		const body = (await res.json()) as { chains: Array<{ id: number; key: string }> }
		expect(body.chains.length).toBeGreaterThan(0)
		expect(body.chains.find((c) => c.key === 'base')).toBeDefined()
		expect(body.chains.find((c) => c.key === 'ethereum')).toBeDefined()
	})

	it('serves the same machine-readable developer contract CI validates', async () => {
		const { healthRoutes } = await import('../routes/health')
		const app = new Hono()
		app.route('/', healthRoutes)

		const res = await app.request('/v1/developer-contract')
		expect(res.status).toBe(200)
		const body = (await res.json()) as any
		expect(body.agentRest.compatibilityMajor).toBe('v1')
		expect(body.agentRest.discovery.developerContract).toBe('GET /v1/developer-contract')
		expect(body.sandbox.endpoint).toBe('https://api.suwappu.bot/v1/sandbox')
		expect(body.sandbox.realFunds).toBe(false)
		expect(body.sandbox.signing).toBe(false)
		expect(body.sandbox.broadcast).toBe(false)
		expect(body.sandbox.devapiCustomerSandboxStatus).toBe('unverified-do-not-assume-isolated')
	})
})
