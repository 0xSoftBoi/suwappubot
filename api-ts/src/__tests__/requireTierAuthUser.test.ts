import { describe, expect, test } from 'bun:test'
import { Hono } from 'hono'
import { requireTier } from '../middleware/requireTier'

/**
 * Regression test for a real production outage.
 *
 * /enterprise/* was moved from telegramAuth() to flexAuth() so the web
 * dashboard could authenticate by session cookie. flexAuth sets `authUser`;
 * telegramAuth sets `telegramUser`. requireTier read ONLY `telegramUser`, so
 * it rejected every cookie- and JWT-authenticated request with
 * "Authentication required" — immediately after flexAuth had successfully
 * authenticated it.
 *
 * The failure was especially misleading because the message blames the
 * credential, not the gate, and no unit test covered it: both middlewares are
 * individually correct. Only the SEAM was broken.
 *
 * These tests assert the seam directly — that requireTier does not reject a
 * caller flexAuth has already authenticated — without needing a database.
 */

function appWith(setVar: (c: any) => void) {
	const app = new Hono()
	app.use('*', async (c, next) => {
		setVar(c)
		await next()
	})
	app.use('*', requireTier('enterprise'))
	app.get('/probe', (c) => c.json({ reached: true }))
	return app
}

async function statusFor(setVar: (c: any) => void): Promise<number> {
	const app = appWith(setVar)
	const res = await app.request('/probe')
	return res.status
}

describe('requireTier auth-context seam', () => {
	test('rejects when NEITHER auth context is present', async () => {
		const res = await appWith(() => {}).request('/probe')
		expect(res.status).toBe(401)
		expect(await res.json()).toEqual({ error: 'Authentication required' })
	})

	test('does NOT reject an authUser caller as unauthenticated', async () => {
		// The regression: this returned 401 "Authentication required" even
		// though flexAuth had authenticated the request. Any status other than
		// 401 means the gate accepted the credential and moved on to the tier
		// check (which needs a DB and is expected to fail differently here).
		const status = await statusFor((c) => c.set('authUser', { userId: 1 }))
		expect(status).not.toBe(401)
	})

	test('does NOT reject a telegramUser caller as unauthenticated', async () => {
		// The pre-existing path must keep working — this middleware still
		// guards Mini App routes mounted behind telegramAuth().
		const status = await statusFor((c) => c.set('telegramUser', { id: 12345 }))
		expect(status).not.toBe(401)
	})

	test('an authUser without a userId is still treated as unauthenticated', async () => {
		// Fail closed: a malformed context must not slip past the paywall.
		const status = await statusFor((c) => c.set('authUser', {}))
		expect(status).toBe(401)
	})
})
