import { describe, expect, it } from 'bun:test'
import { Hono } from 'hono'
import { agentOrMppAuth } from '../middleware/agentOrMppAuth'

// Regression test for the swallowed-Response bug in agentOrMppAuth():
//
// The middleware previously did `await bearerMiddleware(c, next); return` /
// `await mppMiddleware(c, next)` without returning the inner middleware's
// Response up the Hono dispatch chain. An anonymous request (no Authorization
// header, MPP disabled) should short-circuit with a clean 401 — not fall
// through to a 500 / empty response. Fixed by `return await ...(c, next)`.
describe('agentOrMppAuth anon 401 path', () => {
	const app = new Hono()
	app.use('/protected', agentOrMppAuth())
	app.get('/protected', (c) => c.json({ ok: true }))

	it('returns 401 (not 500) for a request with no Authorization header', async () => {
		const res = await app.request('/protected')
		expect(res.status).toBe(401)
		const body = await res.json()
		expect(body.error_code).toBe('UNAUTHORIZED')
	})

	it('returns 401 for an empty Bearer token ("Bearer " with no key)', async () => {
		const res = await app.request('/protected', {
			headers: { Authorization: 'Bearer ' },
		})
		expect(res.status).toBe(401)
	})

	it('returns 401 for a malformed API key format', async () => {
		const res = await app.request('/protected', {
			headers: { Authorization: 'Bearer not-a-real-key' },
		})
		expect(res.status).toBe(401)
	})
})
