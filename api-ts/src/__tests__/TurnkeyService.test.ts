import { describe, test, expect, mock } from 'bun:test'
import { Effect, Layer } from 'effect'
import { TurnkeyService, TurnkeyServiceLive } from '../services/TurnkeyService'
import { EnvService, EnvServiceLive } from '../config/EnvService'

// Mock environment without Turnkey credentials
const MockEnvNotConfigured = Layer.succeed(EnvService, {
	NODE_ENV: 'test',
	PORT: 8000,
	DATABASE_URL: undefined,
	TELEGRAM_BOT_TOKEN: 'test_token',
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
	// Turnkey not configured
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

// Mock environment with Turnkey credentials (for configuration check only)
const MockEnvConfigured = Layer.succeed(EnvService, {
	NODE_ENV: 'test',
	PORT: 8000,
	DATABASE_URL: undefined,
	TELEGRAM_BOT_TOKEN: 'test_token',
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
	// Turnkey configured
	TURNKEY_ORGANIZATION_ID: 'test_org_id',
	TURNKEY_API_PUBLIC_KEY: 'test_public_key',
	TURNKEY_API_PRIVATE_KEY: 'test_private_key',
	TURNKEY_BASE_URL: 'https://api.turnkey.com',
	JWT_SECRET: 'test_secret',
	JWT_EXPIRY_HOURS: 24,
	WEBAUTHN_RP_ID: 'localhost',
	WEBAUTHN_RP_NAME: 'Suwappu Test',
	WEBAUTHN_ORIGIN: 'http://localhost:5173',
})

describe('TurnkeyService', () => {
	describe('isConfigured', () => {
		test('returns false when Turnkey credentials are not set', async () => {
			const TestLayer = TurnkeyServiceLive.pipe(Layer.provide(MockEnvNotConfigured))

			const program = Effect.gen(function* () {
				const turnkey = yield* TurnkeyService
				return turnkey.isConfigured()
			})

			const result = await Effect.runPromise(program.pipe(Effect.provide(TestLayer)))
			expect(result).toBe(false)
		})

		test('returns true when all Turnkey credentials are set', async () => {
			const TestLayer = TurnkeyServiceLive.pipe(Layer.provide(MockEnvConfigured))

			const program = Effect.gen(function* () {
				const turnkey = yield* TurnkeyService
				return turnkey.isConfigured()
			})

			const result = await Effect.runPromise(program.pipe(Effect.provide(TestLayer)))
			expect(result).toBe(true)
		})
	})

	describe('createSubOrganization', () => {
		test('fails when Turnkey is not configured', async () => {
			const TestLayer = TurnkeyServiceLive.pipe(Layer.provide(MockEnvNotConfigured))

			const program = Effect.gen(function* () {
				const turnkey = yield* TurnkeyService
				return yield* turnkey.createSubOrganization('test_sub_org')
			})

			const result = await Effect.runPromiseExit(program.pipe(Effect.provide(TestLayer)))
			expect(result._tag).toBe('Failure')
		})
	})

	describe('createWallet', () => {
		test('fails when Turnkey is not configured', async () => {
			const TestLayer = TurnkeyServiceLive.pipe(Layer.provide(MockEnvNotConfigured))

			const program = Effect.gen(function* () {
				const turnkey = yield* TurnkeyService
				return yield* turnkey.createWallet('sub_org_id', 'Test Wallet', 'evm')
			})

			const result = await Effect.runPromiseExit(program.pipe(Effect.provide(TestLayer)))
			expect(result._tag).toBe('Failure')
		})
	})

	describe('getWallets', () => {
		test('fails when Turnkey is not configured', async () => {
			const TestLayer = TurnkeyServiceLive.pipe(Layer.provide(MockEnvNotConfigured))

			const program = Effect.gen(function* () {
				const turnkey = yield* TurnkeyService
				return yield* turnkey.getWallets('sub_org_id')
			})

			const result = await Effect.runPromiseExit(program.pipe(Effect.provide(TestLayer)))
			expect(result._tag).toBe('Failure')
		})
	})
})
