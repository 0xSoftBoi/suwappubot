import { describe, expect, it } from 'bun:test'
import { Hono } from 'hono'

// Minimal health route test without requiring full runtime
describe('health endpoint', () => {
	it('returns 200 with status ok', async () => {
		// Import the actual routes
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
})
