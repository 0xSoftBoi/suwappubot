import { describe, test, expect } from 'bun:test'
import { Effect, Layer, Option } from 'effect'
import { TelegramAuthService, TelegramAuthServiceLive } from '../services/TelegramAuthService'
import { EnvService } from '../config/EnvService'
import * as crypto from 'crypto'

// Mock environment
const MockEnv = Layer.succeed(EnvService, {
	NODE_ENV: 'test',
	PORT: 8000,
	DATABASE_URL: undefined,
	TELEGRAM_BOT_TOKEN: 'test_bot_token_12345',
	AGENT_API_KEY: 'test_agent_key',
	ADMIN_API_KEY: 'test_admin_key',
	ETH_RPC_URL: undefined,
	POLYGON_RPC_URL: undefined,
	ARBITRUM_RPC_URL: undefined,
	OPTIMISM_RPC_URL: undefined,
	BASE_RPC_URL: undefined,
	BSC_RPC_URL: undefined,
	SOLANA_RPC_URL: undefined,
	ALLOWED_ORIGINS: 'http://localhost:3000',
	TURNKEY_ORGANIZATION_ID: undefined,
	TURNKEY_API_PUBLIC_KEY: undefined,
	TURNKEY_API_PRIVATE_KEY: undefined,
	TURNKEY_BASE_URL: undefined,
	JWT_SECRET: 'test_secret',
	JWT_EXPIRY_HOURS: 24,
	WEBAUTHN_RP_ID: 'localhost',
	WEBAUTHN_RP_NAME: 'Suwappu Test',
	WEBAUTHN_ORIGIN: 'http://localhost:5173',
})

// Helper to create valid Telegram initData
function createValidInitData(botToken: string, user: object): string {
	const authDate = Math.floor(Date.now() / 1000)
	const userData = JSON.stringify(user)

	// Build data check string (sorted alphabetically)
	const dataCheckString = `auth_date=${authDate}\nuser=${userData}`

	// Create secret key: HMAC-SHA256("WebAppData", bot_token)
	const secretKey = crypto.createHmac('sha256', 'WebAppData').update(botToken).digest()

	// Calculate hash
	const hash = crypto.createHmac('sha256', secretKey).update(dataCheckString).digest('hex')

	// Build query string
	return `auth_date=${authDate}&user=${encodeURIComponent(userData)}&hash=${hash}`
}

describe('TelegramAuthService', () => {
	describe('validateInitData', () => {
		test('service exists and has validateInitData method', async () => {
			const TestLayer = TelegramAuthServiceLive.pipe(Layer.provide(MockEnv))

			const program = Effect.gen(function* () {
				const auth = yield* TelegramAuthService
				return auth
			})

			const service = await Effect.runPromise(program.pipe(Effect.provide(TestLayer)))
			expect(service).toBeDefined()
			expect(typeof service.validateInitData).toBe('function')
		})

		test('returns None for empty initData', async () => {
			const TestLayer = TelegramAuthServiceLive.pipe(Layer.provide(MockEnv))

			const program = Effect.gen(function* () {
				const auth = yield* TelegramAuthService
				return yield* auth.validateInitData('')
			})

			const result = await Effect.runPromise(program.pipe(Effect.provide(TestLayer)))
			expect(Option.isNone(result)).toBe(true)
		})

		test('returns None for invalid hash', async () => {
			const TestLayer = TelegramAuthServiceLive.pipe(Layer.provide(MockEnv))

			const invalidInitData = 'auth_date=123&user=%7B%22id%22%3A1%7D&hash=invalid_hash'

			const program = Effect.gen(function* () {
				const auth = yield* TelegramAuthService
				return yield* auth.validateInitData(invalidInitData)
			})

			const result = await Effect.runPromise(program.pipe(Effect.provide(TestLayer)))
			expect(Option.isNone(result)).toBe(true)
		})

		test('returns Some(user) for valid initData', async () => {
			const TestLayer = TelegramAuthServiceLive.pipe(Layer.provide(MockEnv))

			const user = {
				id: 123456789,
				first_name: 'Test',
				last_name: 'User',
				username: 'testuser',
			}

			const validInitData = createValidInitData('test_bot_token_12345', user)

			const program = Effect.gen(function* () {
				const auth = yield* TelegramAuthService
				return yield* auth.validateInitData(validInitData)
			})

			const result = await Effect.runPromise(program.pipe(Effect.provide(TestLayer)))
			expect(Option.isSome(result)).toBe(true)
			if (Option.isSome(result)) {
				expect(result.value.id).toBe(123456789)
				expect(result.value.first_name).toBe('Test')
				expect(result.value.username).toBe('testuser')
			}
		})

		test('returns None for missing hash', async () => {
			const TestLayer = TelegramAuthServiceLive.pipe(Layer.provide(MockEnv))

			const initDataNoHash = 'auth_date=123&user=%7B%22id%22%3A1%7D'

			const program = Effect.gen(function* () {
				const auth = yield* TelegramAuthService
				return yield* auth.validateInitData(initDataNoHash)
			})

			const result = await Effect.runPromise(program.pipe(Effect.provide(TestLayer)))
			expect(Option.isNone(result)).toBe(true)
		})
	})
})

describe('Telegram InitData Parsing', () => {
	test('URL decodes user data correctly', () => {
		const encodedUser = '%7B%22id%22%3A123%2C%22first_name%22%3A%22Test%22%7D'
		const decoded = decodeURIComponent(encodedUser)
		const user = JSON.parse(decoded)

		expect(user.id).toBe(123)
		expect(user.first_name).toBe('Test')
	})

	test('handles special characters in names', () => {
		const user = {
			id: 123,
			first_name: "Test's Name",
			last_name: 'User & Co.',
		}

		const encoded = encodeURIComponent(JSON.stringify(user))
		const decoded = JSON.parse(decodeURIComponent(encoded))

		expect(decoded.first_name).toBe("Test's Name")
		expect(decoded.last_name).toBe('User & Co.')
	})

	test('handles unicode characters', () => {
		const user = {
			id: 123,
			first_name: '测试',
			last_name: 'Пользователь',
		}

		const encoded = encodeURIComponent(JSON.stringify(user))
		const decoded = JSON.parse(decodeURIComponent(encoded))

		expect(decoded.first_name).toBe('测试')
		expect(decoded.last_name).toBe('Пользователь')
	})
})

describe('HMAC-SHA256 Validation', () => {
	test('generates consistent hashes', () => {
		const data = 'test_data'
		const key = 'test_key'

		const hash1 = crypto.createHmac('sha256', key).update(data).digest('hex')
		const hash2 = crypto.createHmac('sha256', key).update(data).digest('hex')

		expect(hash1).toBe(hash2)
	})

	test('different data produces different hashes', () => {
		const key = 'test_key'

		const hash1 = crypto.createHmac('sha256', key).update('data1').digest('hex')
		const hash2 = crypto.createHmac('sha256', key).update('data2').digest('hex')

		expect(hash1).not.toBe(hash2)
	})

	test('data check string is sorted alphabetically', () => {
		const parts = ['user={"id":1}', 'auth_date=123', 'query_id=abc']
		const sorted = parts.sort()

		expect(sorted[0]).toBe('auth_date=123')
		expect(sorted[1]).toBe('query_id=abc')
		expect(sorted[2]).toBe('user={"id":1}')
	})
})
