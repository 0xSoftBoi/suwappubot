import { describe, expect, it } from 'bun:test'
import { Hono } from 'hono'
import { HTTPException } from 'hono/http-exception'
import { flexAuth } from '../../src/middleware/flexAuth'

function createTestApp() {
	const app = new Hono()
	app.onError((err, c) => {
		if (err instanceof HTTPException) {
			return c.json({ error: err.message }, err.status)
		}
		return c.json({ error: 'Internal Server Error' }, 500)
	})
	app.use('*', flexAuth())
	app.get('/protected', (c) => c.json({ ok: true }))
	return app
}

describe('flexAuth middleware', () => {
	it('returns 401 when no auth is provided', async () => {
		const app = createTestApp()
		const res = await app.request('/protected')
		expect(res.status).toBe(401)

		const body = await res.json()
		expect(body.error).toBe('Authentication required')
	})

	it('returns 401 for invalid Bearer token', async () => {
		const app = createTestApp()
		const res = await app.request('/protected', {
			headers: { Authorization: 'Bearer invalid.token.here' },
		})
		expect(res.status).toBe(401)

		const body = await res.json()
		expect(body.error).toBe('Invalid authentication token')
	})

	it('returns 401 for malformed Authorization header', async () => {
		const app = createTestApp()
		const res = await app.request('/protected', {
			headers: { Authorization: 'NotBearer token' },
		})
		expect(res.status).toBe(401)

		const body = await res.json()
		expect(body.error).toBe('Authentication required')
	})
})
