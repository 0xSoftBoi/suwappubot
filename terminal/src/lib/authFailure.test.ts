import { describe, expect, it } from 'bun:test'
import { isRetryableAuthError, shouldClearSession } from './authFailure'

describe('shouldClearSession', () => {
	it('clears on an explicit 401 from the server', () => {
		expect(shouldClearSession({ detail: 'Your session expired', status: 401 })).toBe(true)
	})

	it("clears on getMe()'s synthetic 401 (200 body reporting not-authenticated)", () => {
		expect(shouldClearSession({ detail: 'Not authenticated', status: 401 })).toBe(true)
	})

	// The regression this module exists for: a transient upstream failure used
	// to sign the user out even though the stored token was still valid.
	it('KEEPS the session on a network/CORS failure (status 0)', () => {
		expect(shouldClearSession({ detail: "Can't reach Suwappu right now.", status: 0 })).toBe(false)
	})

	it('KEEPS the session on 5xx from the upstream API', () => {
		for (const status of [500, 502, 503, 504]) {
			expect(shouldClearSession({ detail: 'Server hiccup', status })).toBe(false)
		}
	})

	it('KEEPS the session on 403 and 429', () => {
		expect(shouldClearSession({ detail: 'no access', status: 403 })).toBe(false)
		expect(shouldClearSession({ detail: 'slow down', status: 429 })).toBe(false)
	})

	it('KEEPS the session for unclassifiable errors — never sign out on a guess', () => {
		for (const err of [null, undefined, 'boom', new Error('boom'), {}, { status: 'nope' }]) {
			expect(shouldClearSession(err)).toBe(false)
		}
	})
})

describe('isRetryableAuthError', () => {
	it('retries network drops and 5xx', () => {
		expect(isRetryableAuthError({ status: 0 })).toBe(true)
		for (const status of [500, 502, 503]) {
			expect(isRetryableAuthError({ status })).toBe(true)
		}
	})

	it('does not retry a real answer from a reachable server', () => {
		// Retrying 429 would make the rate limiting worse, and 401/403 are settled.
		for (const status of [401, 403, 404, 429]) {
			expect(isRetryableAuthError({ status })).toBe(false)
		}
	})

	it('does not retry unclassifiable errors', () => {
		expect(isRetryableAuthError(new Error('boom'))).toBe(false)
		expect(isRetryableAuthError(null)).toBe(false)
	})
})
