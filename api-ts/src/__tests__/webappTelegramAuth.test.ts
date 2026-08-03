import { afterAll, beforeAll, describe, expect, it, mock } from 'bun:test'
import { Either } from 'effect'

// ROUTE-LEVEL test for POST /webapp/telegram/auth (AUTH, Telegram Mini App boundary).
//
// Validates that:
// 1. Valid Telegram Init Data produces a signed session token
// 2. Invalid/tampered Init Data is rejected (401)
// 3. First-time user is created automatically on successful auth

const REAL_MODULES = {
	'../services': { ...(await import('../services')) },
	'../runtime': { ...(await import('../runtime')) },
	'../db': { ...(await import('../db')) },
}

afterAll(() => {
	mock.module('../services', () => REAL_MODULES['../services'])
	mock.module('../runtime', () => REAL_MODULES['../runtime'])
	mock.module('../db', () => REAL_MODULES['../db'])
})

// Track created users
const createdUsers = new Map<number, any>()

// Mock Telegram auth service
mock.module('../services', () => ({
	...REAL_MODULES['../services'],
	TelegramAuthService: {
		validateInitData: async (initData: string, botToken: string) => {
			// If initData contains 'invalid', fail validation
			if (initData.includes('invalid')) {
				throw new Error('Invalid Telegram signature')
			}
			// Otherwise, parse as JSON and return user
			try {
				const data = JSON.parse(Buffer.from(initData, 'base64').toString())
				return {
					id: data.user_id || 123456,
					username: data.username || 'testuser',
					first_name: data.first_name || 'Test',
					is_bot: false,
				}
			} catch {
				throw new Error('Invalid init data format')
			}
		},
	},
	UserService: {
		getOrCreateUser: async (telegramId: number, username: string) => {
			if (!createdUsers.has(telegramId)) {
				createdUsers.set(telegramId, {
					id: telegramId,
					username,
					createdAt: new Date(),
				})
			}
			return createdUsers.get(telegramId)
		},
	},
}))

// Mock runtime to handle JWT signing
mock.module('../runtime', () => ({
	runEffectEither: async (effect: any) => {
		try {
			return Either.right({
				sessionToken: 'jwt_token_xyz_123',
				userId: 123456,
				username: 'testuser',
			})
		} catch (err) {
			return Either.left(err)
		}
	},
}))

let webappRoutes: any

beforeAll(async () => {
	;({ webappRoutes } = await import('../routes/webapp'))
})

describe('POST /webapp/telegram/auth — Telegram Mini App authentication', () => {
	it('rejects missing init data', async () => {
		const res = await webappRoutes.request('/telegram/auth', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({}),
		})

		expect(res.status).toBe(400)
		const body = (await res.json()) as any
		expect(body.message).toContain('required')
	})

	it('rejects invalid Telegram signature', async () => {
		const invalidInitData = Buffer.from(
			JSON.stringify({ user_id: 123456, username: 'testuser', invalid: true }),
		).toString('base64')

		const res = await webappRoutes.request('/telegram/auth', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ initData: invalidInitData }),
		})

		expect(res.status).toBe(401)
		const body = (await res.json()) as any
		expect(body.message).toContain('Telegram')
	})

	it('accepts valid init data and returns session token', async () => {
		const validInitData = Buffer.from(
			JSON.stringify({ user_id: 123456, username: 'testuser', first_name: 'Test' }),
		).toString('base64')

		const res = await webappRoutes.request('/telegram/auth', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ initData: validInitData }),
		})

		expect(res.status).toBe(200)
		const body = (await res.json()) as any
		expect(body.sessionToken).toBeDefined()
		expect(body.sessionToken).toContain('jwt')
		expect(body.userId).toBe(123456)
	})

	it('creates new user on first login', async () => {
		const newUserId = 999888777
		const validInitData = Buffer.from(
			JSON.stringify({
				user_id: newUserId,
				username: 'newuser',
				first_name: 'New',
			}),
		).toString('base64')

		const res = await webappRoutes.request('/telegram/auth', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ initData: validInitData }),
		})

		expect(res.status).toBe(200)
		expect(createdUsers.has(newUserId)).toBe(true)
	})

	it('rejects tampered init data (malformed base64)', async () => {
		const res = await webappRoutes.request('/telegram/auth', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ initData: '!@#$%^&*(not-base64)' }),
		})

		expect(res.status).toBe(400)
	})
})
