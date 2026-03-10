import { describe, expect, it } from 'bun:test'
import { Hono } from 'hono'
import { ipRateLimit } from '../../src/middleware/ipRateLimit'

function createTestApp(limit: number) {
	const app = new Hono()
	app.use('*', ipRateLimit(limit))
	app.get('/test', (c) => c.json({ ok: true }))
	return app
}

describe('ipRateLimit middleware', () => {
	it('allows requests under the limit', async () => {
		const app = createTestApp(5)
		const res = await app.request('/test', {
			headers: { 'x-forwarded-for': '10.0.0.1' },
		})
		expect(res.status).toBe(200)
		expect(res.headers.get('X-RateLimit-Limit')).toBe('5')
		expect(res.headers.get('X-RateLimit-Remaining')).toBe('4')
	})

	it('returns 429 when limit is exceeded', async () => {
		const app = createTestApp(2)
		const ip = '10.0.0.2'
		const headers = { 'x-forwarded-for': ip }

		await app.request('/test', { headers })
		await app.request('/test', { headers })

		const res = await app.request('/test', { headers })
		expect(res.status).toBe(429)
	})

	it('sets Retry-After header on 429', async () => {
		const app = createTestApp(1)
		const ip = '10.0.0.3'
		const headers = { 'x-forwarded-for': ip }

		await app.request('/test', { headers })

		const res = await app.request('/test', { headers })
		expect(res.status).toBe(429)
		const retryAfter = res.headers.get('Retry-After')
		expect(retryAfter).toBeTruthy()
		expect(Number(retryAfter)).toBeGreaterThan(0)
	})

	it('tracks different IPs independently', async () => {
		const app = createTestApp(1)

		const res1 = await app.request('/test', {
			headers: { 'x-forwarded-for': '10.0.0.4' },
		})
		expect(res1.status).toBe(200)

		const res2 = await app.request('/test', {
			headers: { 'x-forwarded-for': '10.0.0.5' },
		})
		expect(res2.status).toBe(200)
	})
})
