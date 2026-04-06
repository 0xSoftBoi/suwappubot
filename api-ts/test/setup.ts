import { Effect, Layer, ManagedRuntime, Option } from 'effect'
import type { AppConfig } from '../src/app'
import { EnvService, type Env } from '../src/config/EnvService'
import { DrizzleService } from '../src/db'
import { resetRuntimeDriver, setRuntimeDriver } from '../src/runtime'
import { RedisService, type RedisServiceInterface } from '../src/services/RedisService'
import type { TelegramUser } from '../src/services/TelegramAuthService'

const TEST_ALLOWED_ORIGINS = 'http://localhost:3000'

export const mockTelegramUser: TelegramUser = {
	id: 123456,
	first_name: 'Test',
	last_name: 'User',
	username: 'testuser',
	language_code: 'en',
	is_premium: false,
}

export const defaultEnv: Env = {
	NODE_ENV: 'test',
	PORT: 8000,
	ALLOWED_ORIGINS: TEST_ALLOWED_ORIGINS,
	TURNKEY_BASE_URL: 'https://api.turnkey.com',
	INTERNAL_API_URL: 'http://localhost:8000',
	MPP_ENABLED: 'false',
	MPP_SWAP_PRICE_USD: '0.001',
	FEE_WALLET_EVM: '0x6456f69215C470e1545Ed6eea4621C136B30D85d',
	FEE_WALLET_SOLANA: '4Xxbeusi6NL46AtZQHJrPREtYFCByKE48oxrpLvWEWJh',
	FEE_BPS: 30,
	JWT_SECRET: 'test-jwt-secret',
	ADMIN_API_KEY: 'test-admin-key',
	TELEGRAM_BOT_TOKEN: 'test-telegram-token',
	TURNKEY_API_PUBLIC_KEY: 'test-public-key',
	TURNKEY_API_PRIVATE_KEY: 'test-private-key',
	TURNKEY_ORGANIZATION_ID: 'test-org-id',
}

export const createRedisMock = (): RedisServiceInterface => {
	const store = new Map<string, unknown>()

	return {
		get: <T>(key: string) => Effect.succeed((store.get(key) as T | null) ?? null),
		set: <T>(key: string, value: T) => {
			store.set(key, value)
			return Effect.void
		},
		del: (key: string) => {
			store.delete(key)
			return Effect.void
		},
		isConnected: () => true,
	}
}

export const serviceLayer = <T>(tag: any, service: T) => Layer.succeed(tag, service)

export interface CreateTestAppOptions {
	config?: Partial<AppConfig>
	env?: Partial<Env>
	layers?: Array<Layer.Layer<any, any, any>>
}

export async function createTestApp(options: CreateTestAppOptions = {}) {
	const redis = createRedisMock()
	const env = { ...defaultEnv, ...(options.env || {}) } as Env

	const baseLayer = Layer.mergeAll(
		Layer.succeed(EnvService, env),
		Layer.succeed(DrizzleService, Option.none()),
		Layer.succeed(RedisService, redis),
		...(options.layers || []),
	)

	const runtime = ManagedRuntime.make(baseLayer as any)
	setRuntimeDriver(runtime as any)

	const { createApp } = await import('../src/app')
	const app = createApp({
		allowedOrigins: options.config?.allowedOrigins || TEST_ALLOWED_ORIGINS,
		adminApiKey: options.config?.adminApiKey || env.ADMIN_API_KEY,
		internalApiKey: options.config?.internalApiKey || env.INTERNAL_API_KEY,
	})

	return {
		app,
		env,
		redis,
		cleanup: async () => {
			await runtime.dispose()
			resetRuntimeDriver()
		},
	}
}
