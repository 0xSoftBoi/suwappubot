import { describe, expect, it } from 'bun:test'
import { Hono } from 'hono'
import {
	DatabaseError,
	ExternalServiceError,
	ForbiddenError,
	mapErrorToResponse,
	NotFoundError,
	UnauthorizedError,
	ValidationError,
} from '../errors'

// Regression test for the `as 200` cast bug.
//
// The root cause was that `mapErrorToResponse` returned `{ status: number }`,
// which is not assignable to Hono's `ContentfulStatusCode` for `c.json(body, status)`.
// Call sites worked around this with `c.json(body, status as 200)`, which lies to
// Hono's response-type inference (typed consumers see 200) and silences the type error.
//
// With `ErrorResponse.status` typed as the proper union, the cast is unnecessary and
// `c.json(body, status)` typechecks. This test file calls `c.json(body, status)` WITHOUT
// any cast — so `bun run check` (tsc --noEmit) only passes when the fix is in place.
describe('error response HTTP status codes', () => {
	const app = new Hono()

	app.get('/validation', (c) => {
		const { status, body } = mapErrorToResponse(new ValidationError({ message: 'bad input' }))
		// No `as 200` cast — relies on the union-typed return of mapErrorToResponse.
		return c.json(body, status)
	})

	app.get('/notfound', (c) => {
		const { status, body } = mapErrorToResponse(new NotFoundError({ message: 'missing' }))
		return c.json(body, status)
	})

	app.get('/database', (c) => {
		const { status, body } = mapErrorToResponse(new DatabaseError({ message: 'db down' }))
		return c.json(body, status)
	})

	app.get('/unauthorized', (c) => {
		const { status, body } = mapErrorToResponse(new UnauthorizedError({ message: 'no token' }))
		return c.json(body, status)
	})

	app.get('/forbidden', (c) => {
		const { status, body } = mapErrorToResponse(new ForbiddenError({ message: 'denied' }))
		return c.json(body, status)
	})

	app.get('/external', (c) => {
		const { status, body } = mapErrorToResponse(new ExternalServiceError({ message: 'upstream', service: 'lifi' }))
		return c.json(body, status)
	})

	it('ValidationError returns HTTP 400', async () => {
		const res = await app.request('/validation')
		expect(res.status).toBe(400)
		const body = (await res.json()) as { error: string }
		expect(body.error).toBe('Validation Error')
	})

	it('NotFoundError returns HTTP 404', async () => {
		const res = await app.request('/notfound')
		expect(res.status).toBe(404)
		const body = (await res.json()) as { error: string }
		expect(body.error).toBe('Not Found')
	})

	it('DatabaseError returns HTTP 500', async () => {
		const res = await app.request('/database')
		expect(res.status).toBe(500)
		const body = (await res.json()) as { error: string }
		expect(body.error).toBe('Database Error')
	})

	it('UnauthorizedError returns HTTP 401', async () => {
		const res = await app.request('/unauthorized')
		expect(res.status).toBe(401)
		const body = (await res.json()) as { error: string }
		expect(body.error).toBe('Unauthorized')
	})

	it('ForbiddenError returns HTTP 403', async () => {
		const res = await app.request('/forbidden')
		expect(res.status).toBe(403)
		const body = (await res.json()) as { error: string }
		expect(body.error).toBe('Forbidden')
	})

	it('ExternalServiceError returns HTTP 502', async () => {
		const res = await app.request('/external')
		expect(res.status).toBe(502)
		const body = (await res.json()) as { error: string }
		expect(body.error).toBe('External Service Error')
	})

	it('mapErrorToResponse status field is the correct numeric code', () => {
		expect(mapErrorToResponse(new ValidationError({ message: 'x' })).status).toBe(400)
		expect(mapErrorToResponse(new UnauthorizedError({})).status).toBe(401)
		expect(mapErrorToResponse(new ForbiddenError({})).status).toBe(403)
		expect(mapErrorToResponse(new NotFoundError({})).status).toBe(404)
		expect(mapErrorToResponse(new DatabaseError({ message: 'x' })).status).toBe(500)
		expect(mapErrorToResponse(new ExternalServiceError({ message: 'x' })).status).toBe(502)
	})
})
