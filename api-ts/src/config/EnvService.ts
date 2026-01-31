import { Context, Effect, Layer } from 'effect'
import { Schema } from '@effect/schema'

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
	AGENT_API_KEY: Schema.optional(Schema.String),
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
		default: () => 'https://app.suwappu.bot,https://devfront.suwappu.bot,http://localhost:3000,http://localhost:5173',
	}),

	// Fee Collection
	FEE_WALLET_EVM: Schema.optionalWith(Schema.String, {
		default: () => '0x6456f69215C470e1545Ed6eea4621C136B30D85d',
	}),
	FEE_WALLET_SOLANA: Schema.optional(Schema.String),
	FEE_BPS: Schema.optionalWith(Schema.NumberFromString, { default: () => 30 }), // 0.3% default
})

export type Env = Schema.Schema.Type<typeof EnvSchema>

export class EnvService extends Context.Tag('EnvService')<EnvService, Env>() {}

export const EnvServiceLive = Layer.effect(
	EnvService,
	Effect.sync(() => Schema.decodeUnknownSync(EnvSchema)(process.env))
)
