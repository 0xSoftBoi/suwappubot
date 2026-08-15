import { beforeEach, describe, expect, it, mock } from 'bun:test'
import { ApiClient } from './api'
import { clearAuthToken, getAuthToken, setAuthToken } from './auth'

/**
 * Regression guard for the bug class fixed in the terminal
 * (terminal/src/lib/authFailure.ts): a transient API failure must never
 * destroy a valid session.
 *
 * The terminal's boot path used to run `catch { clearAuthToken() }` around its
 * session probe, so one 5xx from the upstream Python API — or a dropped
 * connection — silently signed the user out even though the stored token was
 * still good. The Mini App does not have that defect today: it clears the token
 * only on genuine expiry (lib/auth.ts) or an explicit logout()
 * (contexts/AuthContext.tsx). These tests pin that down so the pattern can't be
 * introduced here later.
 */

if (typeof globalThis.localStorage === 'undefined') {
	const store: Record<string, string> = {}
	// @ts-ignore - minimal localStorage for the auth module under bun
	globalThis.localStorage = {
		getItem: (key: string) => store[key] ?? null,
		setItem: (key: string, value: string) => {
			store[key] = value
		},
		removeItem: (key: string) => {
			delete store[key]
		},
		clear: () => {
			Object.keys(store).forEach((k) => delete store[k])
		},
	}
}

const mockFetch = mock(() => Promise.resolve({ ok: true, json: () => Promise.resolve({}) }))
// @ts-ignore
globalThis.fetch = mockFetch

const HOUR_FROM_NOW = () => new Date(Date.now() + 3600_000).toISOString()

function failWith(status: number) {
	mockFetch.mockImplementation(() =>
		Promise.resolve({
			ok: false,
			status,
			json: () => Promise.resolve({ detail: 'upstream unavailable' }),
		}),
	)
}

describe('session survives transient API failures', () => {
	let api: ApiClient

	beforeEach(() => {
		api = new ApiClient('https://api.test.com')
		clearAuthToken()
		mockFetch.mockReset()
		setAuthToken('valid-token-abc', HOUR_FROM_NOW())
	})

	// The exact shape of the terminal regression: upstream hiccups, session dies.
	it('keeps the token when the API returns 502', async () => {
		failWith(502)
		await expect(api.getPortfolio()).rejects.toMatchObject({ status: 502 })
		expect(getAuthToken()).toBe('valid-token-abc')
	})

	it('keeps the token across 500/503/504', async () => {
		for (const status of [500, 503, 504]) {
			failWith(status)
			await expect(api.getPortfolio()).rejects.toMatchObject({ status })
			expect(getAuthToken()).toBe('valid-token-abc')
		}
	})

	it('keeps the token when fetch rejects outright (network drop)', async () => {
		mockFetch.mockImplementation(() => Promise.reject(new TypeError('Failed to fetch')))
		await expect(api.getPortfolio()).rejects.toThrow()
		expect(getAuthToken()).toBe('valid-token-abc')
	})

	// A 401 is a real rejection, but the Mini App deliberately leaves the
	// decision to the caller rather than nuking storage inside the client.
	// Asserted so a future "helpful" auto-clear is a conscious change.
	it('does not auto-clear inside the API client on 401', async () => {
		failWith(401)
		await expect(api.getPortfolio()).rejects.toMatchObject({ status: 401 })
		expect(getAuthToken()).toBe('valid-token-abc')
	})
})

describe('expiry is the only automatic clear', () => {
	beforeEach(() => clearAuthToken())

	it('returns the token while unexpired', () => {
		setAuthToken('tok', HOUR_FROM_NOW())
		expect(getAuthToken()).toBe('tok')
	})

	it('clears once expired', () => {
		setAuthToken('tok', new Date(Date.now() - 1000).toISOString())
		expect(getAuthToken()).toBeNull()
		expect(localStorage.getItem('suwappu_auth_token')).toBeNull()
	})
})
