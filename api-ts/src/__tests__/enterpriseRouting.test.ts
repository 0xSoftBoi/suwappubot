/**
 * Route-order regression tests for /enterprise/orgs/me.
 *
 * Hono matches routes in REGISTRATION order, so the literal `/orgs/me`
 * (and only it) must be registered before `/orgs/:orgId`. When it wasn't,
 * every `GET /enterprise/orgs/me` ran the param handler with orgId="me",
 * failed the membership check, and 403'd forever — the dashboard treated
 * that as "no organization" and re-showed workspace creation on every
 * load, letting one user mint an unbounded stream of orgs.
 */
import { describe, expect, it } from 'bun:test'
import { Hono } from 'hono'
import { enterpriseRoutes } from '../routes/enterprise'

function routeIndex(method: string, path: string): number {
	return enterpriseRoutes.routes.findIndex((r) => r.method === method && r.path === path)
}

describe('enterprise route registration order', () => {
	it('registers GET /orgs/me before GET /orgs/:orgId', () => {
		const me = routeIndex('GET', '/orgs/me')
		const param = routeIndex('GET', '/orgs/:orgId')
		expect(me).toBeGreaterThanOrEqual(0)
		expect(param).toBeGreaterThanOrEqual(0)
		expect(me).toBeLessThan(param)
	})
})

describe('hono literal-vs-param matching semantics', () => {
	// Documents the property the test above depends on: with the literal
	// route registered first, "me" reaches it; registered second, the param
	// route shadows it. If a Hono upgrade ever changes this, both cases fail
	// loudly here instead of silently breaking the dashboard.
	it('literal-first wins for /orgs/me', async () => {
		const app = new Hono()
		app.get('/orgs/me', (c) => c.json({ hit: 'me' }))
		app.get('/orgs/:orgId', (c) => c.json({ hit: 'param', orgId: c.req.param('orgId') }))
		const res = await app.request('/orgs/me')
		expect(await res.json()).toEqual({ hit: 'me' })
	})

	it('param-first shadows /orgs/me (the bug this guards against)', async () => {
		const app = new Hono()
		app.get('/orgs/:orgId', (c) => c.json({ hit: 'param', orgId: c.req.param('orgId') }))
		app.get('/orgs/me', (c) => c.json({ hit: 'me' }))
		const res = await app.request('/orgs/me')
		expect(await res.json()).toEqual({ hit: 'param', orgId: 'me' })
	})
})
