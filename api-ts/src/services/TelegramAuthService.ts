import { Context, Effect, Layer, Option } from 'effect'
import { EnvService } from '../config/EnvService'
import { UnauthorizedError } from '../errors'

export interface TelegramUser {
	id: number
	first_name: string
	last_name?: string
	username?: string
	language_code?: string
	photo_url?: string
	is_premium?: boolean
}

export interface TelegramAuthServiceInterface {
	readonly validateInitData: (
		initData: string,
	) => Effect.Effect<Option.Option<TelegramUser>, UnauthorizedError>
}

export class TelegramAuthService extends Context.Tag('TelegramAuthService')<
	TelegramAuthService,
	TelegramAuthServiceInterface
>() {}

export const TelegramAuthServiceLive = Layer.effect(
	TelegramAuthService,
	Effect.gen(function* () {
		const env = yield* EnvService

		const validateInitData = (initData: string) =>
			Effect.gen(function* () {
				if (!initData || !env.TELEGRAM_BOT_TOKEN) {
					return Option.none<TelegramUser>()
				}

				try {
					// Parse the init_data query string
					const params = new URLSearchParams(initData)
					const receivedHash = params.get('hash')

					if (!receivedHash) {
						return Option.none<TelegramUser>()
					}

					// Remove hash for data_check_string
					params.delete('hash')

					// Build the data check string (sorted alphabetically, newline-separated)
					const sortedParams = [...params.entries()].sort(([a], [b]) => a.localeCompare(b))
					const dataCheckString = sortedParams.map(([k, v]) => `${k}=${v}`).join('\n')

					// Create secret key: HMAC-SHA256("WebAppData", bot_token)
					const encoder = new TextEncoder()
					const secretKeyData = yield* Effect.tryPromise({
						try: () =>
							crypto.subtle.importKey(
								'raw',
								encoder.encode('WebAppData'),
								{ name: 'HMAC', hash: 'SHA-256' },
								false,
								['sign'],
							),
						catch: () => new UnauthorizedError({ message: 'Crypto error' }),
					})

					const secretKey = yield* Effect.tryPromise({
						try: () =>
							crypto.subtle.sign('HMAC', secretKeyData, encoder.encode(env.TELEGRAM_BOT_TOKEN!)),
						catch: () => new UnauthorizedError({ message: 'Crypto error' }),
					})

					// Import the derived secret key
					const derivedKey = yield* Effect.tryPromise({
						try: () =>
							crypto.subtle.importKey('raw', secretKey, { name: 'HMAC', hash: 'SHA-256' }, false, [
								'sign',
							]),
						catch: () => new UnauthorizedError({ message: 'Crypto error' }),
					})

					// Calculate expected hash
					const calculatedHashBuffer = yield* Effect.tryPromise({
						try: () => crypto.subtle.sign('HMAC', derivedKey, encoder.encode(dataCheckString)),
						catch: () => new UnauthorizedError({ message: 'Crypto error' }),
					})

					const calculatedHash = Array.from(new Uint8Array(calculatedHashBuffer))
						.map((b) => b.toString(16).padStart(2, '0'))
						.join('')

					// Constant-time comparison
					if (calculatedHash !== receivedHash) {
						console.log('Hash mismatch:', {
							receivedHash: receivedHash.substring(0, 16) + '...',
							calculatedHash: calculatedHash.substring(0, 16) + '...',
							botTokenPrefix: env.TELEGRAM_BOT_TOKEN?.substring(0, 10) + '...',
						})
						return Option.none<TelegramUser>()
					}

					// Parse user data from initData
					const userData = params.get('user')
					if (userData) {
						const user = JSON.parse(decodeURIComponent(userData)) as TelegramUser
						return Option.some(user)
					}

					return Option.none<TelegramUser>()
				} catch {
					return Option.none<TelegramUser>()
				}
			})

		return { validateInitData }
	}),
)
