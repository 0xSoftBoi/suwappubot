import { afterAll, beforeAll, beforeEach, describe, expect, it, mock } from 'bun:test'
import { Effect, Layer, Option } from 'effect'
import { EnvService } from '../config/EnvService'
import {
	TelegramAuthService,
	TurnkeyService,
	UserService,
	WalletService,
} from '../services'

// ROUTE-LEVEL test for POST /webapp/telegram/auth (AUTH, Telegram Mini App boundary).
//
// These tests deliberately run the route's Effect program. The previous version
// replaced Context.Tag services with plain async objects and returned a canned
// Either from runEffectEither(), so none of the authentication code actually ran.

const REAL_RUNTIME = { ...(await import('../runtime')) }

const createdUsers = new Map<number, any>()

const envLayer = Layer.succeed(EnvService, { JWT_SECRET: 'test-jwt-secret' } as any)
const telegramAuthLayer = Layer.succeed(
	TelegramAuthService,
	{
		validateInitData: (initData: string) =>
			Effect.sync(() => {
				try {
					const data = JSON.parse(Buffer.from(initData, 'base64').toString()) as {
						user_id?: number
						username?: string
						first_name?: string
						invalid?: boolean
					}
					if (data.invalid || !data.user_id) return Option.none()
					return Option.some({
						id: data.user_id,
						username: data.username ?? 'testuser',
						first_name: data.first_name ?? 'Test',
						is_bot: false,
					})
				} catch {
					return Option.none()
				}
			}),
	} as any,
)
const userLayer = Layer.succeed(
	UserService,
	{
		getOrCreateUser: (params: { telegramId: number; username?: string }) =>
			Effect.sync(() => {
				const existing = createdUsers.get(params.telegramId)
				if (existing) return { user: existing, isNew: false }
				const user = {
					id: params.telegramId,
					telegramId: params.telegramId,
					username: params.username ?? null,
					createdAt: new Date(),
				}
				createdUsers.set(params.telegramId, user)
				return { user, isNew: true }
			}),
	} as any,
)
const walletLayer = Layer.succeed(
	WalletService,
	{
		getActiveWallets: (userId: number) =>
			Effect.succeed([
				{
					id: userId,
					userId,
					address: '0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045',
					walletProvider: 'turnkey',
				},
			] as any),
		createTurnkeyWallet: () => Effect.die('unexpected createTurnkeyWallet call'),
	} as any,
)
const turnkeyLayer = Layer.succeed(TurnkeyService, {} as any)
const testLayer = Layer.mergeAll(envLayer, telegramAuthLayer, userLayer, walletLayer, turnkeyLayer)

const runTestEffect = (effect: any) => Effect.runPromise(effect.pipe(Effect.provide(testLayer)))

mock.module('../runtime', () => ({
	runEffect: runTestEffect,
	runEffectEither: (effect: any) => runTestEffect(Effect.either(effect)),
	shutdownRuntime: async () => {},
}))

let webappRoutes: any

beforeAll(async () => {
	;({ webappRoutes } = await import('../routes/webapp'))
})

beforeEach(() => {
	createdUsers.clear()
})

afterAll(() => {
	mock.module('../runtime', () => REAL_RUNTIME)
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
		expect(body.success).toBe(false)
		expect(body.error).toContain('Missing initData')
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
		expect(body.success).toBe(false)
		expect(body.error).toContain('Invalid Telegram')
	})

	it('accepts valid init data and returns the current JWT response contract', async () => {
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
		expect(body.success).toBe(true)
		expect(typeof body.jwt).toBe('string')
		expect(body.jwt.length).toBeGreaterThan(20)
		expect(body.user.telegramId).toBe(123456)
		expect(body.walletAddress).toBe('0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045')
	})

	it('creates a new user on first login', async () => {
		const newUserId = 999888777
		const validInitData = Buffer.from(
			JSON.stringify({ user_id: newUserId, username: 'newuser', first_name: 'New' }),
		).toString('base64')

		const res = await webappRoutes.request('/telegram/auth', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ initData: validInitData }),
		})

		expect(res.status).toBe(200)
		expect(createdUsers.has(newUserId)).toBe(true)
	})

	it('rejects malformed init data as an authentication failure', async () => {
		const res = await webappRoutes.request('/telegram/auth', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ initData: '!@#$%^&*(not-base64)' }),
		})

		expect(res.status).toBe(401)
		const body = (await res.json()) as any
		expect(body.error).toContain('Invalid Telegram')
	})
})
