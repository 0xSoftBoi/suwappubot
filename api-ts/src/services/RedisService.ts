import { Context, Effect, Either, Layer } from 'effect'
import Redis from 'ioredis'
import { EnvService } from '../config/EnvService'

// TTL constants
export const QUOTE_TTL = 30 // 30 seconds for quotes
export const TOKEN_LIST_TTL = 300 // 5 minutes for token lists

export interface RedisServiceInterface {
	readonly get: <T>(key: string) => Effect.Effect<T | null, Error>
	readonly set: <T>(key: string, value: T, ttlSeconds?: number) => Effect.Effect<void, Error>
	readonly del: (key: string) => Effect.Effect<void, Error>
	readonly isConnected: () => boolean
}

export class RedisService extends Context.Tag('RedisService')<
	RedisService,
	RedisServiceInterface
>() {}

// Create a no-op fallback when Redis is not configured
const createNoOpService = (): RedisServiceInterface => ({
	get: <T>(_key: string) => Effect.succeed(null as T | null),
	set: <T>(_key: string, _value: T, _ttlSeconds?: number) => Effect.void,
	del: (_key: string) => Effect.void,
	isConnected: () => false,
})

// Create the real Redis service
const createRedisService = (client: Redis): RedisServiceInterface => ({
	get: <T>(key: string) =>
		Effect.tryPromise({
			try: async () => {
				const value = await client.get(key)
				if (!value) return null
				return JSON.parse(value) as T
			},
			catch: (e) => new Error(`Redis GET failed: ${e}`),
		}),

	set: <T>(key: string, value: T, ttlSeconds?: number) =>
		Effect.tryPromise({
			try: async () => {
				const serialized = JSON.stringify(value)
				if (ttlSeconds) {
					await client.setex(key, ttlSeconds, serialized)
				} else {
					await client.set(key, serialized)
				}
			},
			catch: (e) => new Error(`Redis SET failed: ${e}`),
		}),

	del: (key: string) =>
		Effect.tryPromise({
			try: async () => {
				await client.del(key)
			},
			catch: (e) => new Error(`Redis DEL failed: ${e}`),
		}),

	isConnected: () => client.status === 'ready',
})

export const RedisServiceLive = Layer.effect(
	RedisService,
	Effect.gen(function* () {
		const env = yield* EnvService

		if (!env.REDIS_URL) {
			console.log('[RedisService] REDIS_URL not configured, using in-memory fallback')
			return createNoOpService()
		}

		console.log('[RedisService] Connecting to Redis...')

		const client = new Redis(env.REDIS_URL, {
			maxRetriesPerRequest: 3,
			retryDelayOnFailover: 100,
			lazyConnect: true,
		})

		// Attempt connection
		const connectResult = yield* Effect.tryPromise({
			try: () => client.connect(),
			catch: (e) => e as Error,
		}).pipe(Effect.either)

		if (Either.isLeft(connectResult)) {
			console.warn('[RedisService] Failed to connect to Redis, using no-op fallback:', connectResult.left)
			return createNoOpService()
		}

		console.log('[RedisService] Connected to Redis')

		// Handle connection errors gracefully
		client.on('error', (err) => {
			console.error('[RedisService] Redis error:', err.message)
		})

		client.on('reconnecting', () => {
			console.log('[RedisService] Reconnecting to Redis...')
		})

		return createRedisService(client)
	})
)

// Cache key builders
export const cacheKeys = {
	quote: (quoteId: string) => `quote:${quoteId}`,
	tokenList: (chainId: string | number) => `tokens:${chainId}`,
	jupiterQuote: (inputMint: string, outputMint: string, amount: string) =>
		`jup:quote:${inputMint}:${outputMint}:${amount}`,
}
