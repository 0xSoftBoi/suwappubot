import { Schema } from '@effect/schema'
import { Context, Effect, Layer } from 'effect'

export const EnvSchema = Schema.Struct({
	NODE_ENV: Schema.optionalWith(Schema.Literal('development', 'test', 'production'), {
		default: () => 'development' as const,
	}),
	PORT: Schema.optionalWith(Schema.NumberFromString, { default: () => 8000 }),

	// Database
	DATABASE_URL: Schema.optional(Schema.String),

	// Telegram
	TELEGRAM_BOT_TOKEN: Schema.optional(Schema.String),

	// API Keys
	ADMIN_API_KEY: Schema.optional(Schema.String),

	// Turnkey
	TURNKEY_API_PUBLIC_KEY: Schema.optional(Schema.String),
	TURNKEY_API_PRIVATE_KEY: Schema.optional(Schema.String),
	TURNKEY_ORGANIZATION_ID: Schema.optional(Schema.String),
	TURNKEY_BASE_URL: Schema.optionalWith(Schema.String, {
		default: () => 'https://api.turnkey.com',
	}),

	// JWT
	JWT_SECRET: Schema.optional(Schema.String),

	// CORS
	ALLOWED_ORIGINS: Schema.optionalWith(Schema.String, {
		default: () =>
			'https://app.suwappu.bot,https://www.suwappu.bot,https://suwappu.bot,https://devfront.suwappu.bot,http://localhost:3000,http://localhost:5173',
	}),

	// Internal Python API
	INTERNAL_API_KEY: Schema.optional(Schema.String),
	INTERNAL_API_URL: Schema.optionalWith(Schema.String, {
		default: () => 'http://localhost:8000',
	}),

	// Redis
	REDIS_URL: Schema.optional(Schema.String),

	// Sponge Gateway
	SPONGE_API_KEY: Schema.optional(Schema.String),
	SPONGE_WEBHOOK_SECRET: Schema.optional(Schema.String),

	// MPP (Micropayment Protocol)
	MPP_ENABLED: Schema.optionalWith(Schema.String, { default: () => 'false' }),
	MPP_SWAP_PRICE_USD: Schema.optionalWith(Schema.String, { default: () => '0.001' }),

	// Fee Collection
	FEE_WALLET_EVM: Schema.optionalWith(Schema.String, {
		default: () => '0x6456f69215C470e1545Ed6eea4621C136B30D85d',
	}),
	FEE_WALLET_SOLANA: Schema.optionalWith(Schema.String, {
		default: () => '4Xxbeusi6NL46AtZQHJrPREtYFCByKE48oxrpLvWEWJh',
	}),
	FEE_BPS: Schema.optionalWith(Schema.NumberFromString, { default: () => 30 }), // 0.3% default

	// Polymarket
	POLYMARKET_CREDENTIAL_KEY: Schema.optional(Schema.String),

	// Stripe billing
	STRIPE_SECRET_KEY: Schema.optional(Schema.String),
	STRIPE_WEBHOOK_SECRET: Schema.optional(Schema.String),
	STRIPE_PRO_PRICE_ID: Schema.optional(Schema.String),
	STRIPE_PREMIUM_PRICE_ID: Schema.optional(Schema.String),
})

export type Env = Schema.Schema.Type<typeof EnvSchema>

export class EnvService extends Context.Tag('EnvService')<EnvService, Env>() {}

export const EnvServiceLive = Layer.effect(
	EnvService,
	Effect.sync(() => {
		const env = Schema.decodeUnknownSync(EnvSchema)(process.env)
		if (env.NODE_ENV === 'production') {
			const missing: string[] = []
			if (!env.DATABASE_URL) missing.push('DATABASE_URL')
			if (!env.TELEGRAM_BOT_TOKEN) missing.push('TELEGRAM_BOT_TOKEN')
			if (!env.JWT_SECRET) missing.push('JWT_SECRET')
			if (!env.ADMIN_API_KEY) missing.push('ADMIN_API_KEY')
			if (missing.length > 0) {
				throw new Error(`Missing required env vars for production: ${missing.join(', ')}`)
			}
		}
		// Warn if using default fee wallet addresses
		if (!process.env.FEE_WALLET_EVM) {
			console.warn('[EnvService] WARNING: FEE_WALLET_EVM not set, using default address. Set this in production!')
		}
		if (!process.env.FEE_WALLET_SOLANA) {
			console.warn('[EnvService] WARNING: FEE_WALLET_SOLANA not set, using default address. Set this in production!')
		}
		return env
	}),
)
