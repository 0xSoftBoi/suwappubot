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
	LIFI_API_KEY: Schema.optional(Schema.String),

	// RPC Endpoints (with public fallbacks for development)
	ETH_RPC_URL: Schema.optionalWith(Schema.String, {
		default: () => 'https://eth.llamarpc.com',
	}),
	POLYGON_RPC_URL: Schema.optionalWith(Schema.String, {
		default: () => 'https://polygon.llamarpc.com',
	}),
	ARBITRUM_RPC_URL: Schema.optionalWith(Schema.String, {
		default: () => 'https://arbitrum.llamarpc.com',
	}),
	OPTIMISM_RPC_URL: Schema.optionalWith(Schema.String, {
		default: () => 'https://optimism.llamarpc.com',
	}),
	BASE_RPC_URL: Schema.optionalWith(Schema.String, {
		default: () => 'https://base.llamarpc.com',
	}),
	BSC_RPC_URL: Schema.optionalWith(Schema.String, {
		default: () => 'https://bsc.llamarpc.com',
	}),
	SOLANA_RPC_URL: Schema.optionalWith(Schema.String, {
		default: () => 'https://api.mainnet-beta.solana.com',
	}),

	// CORS
	ALLOWED_ORIGINS: Schema.optionalWith(Schema.String, {
		default: () => 'https://app.suwappu.bot,https://devfront.suwappu.bot,http://localhost:3000,http://localhost:5173',
	}),
})

export type Env = Schema.Schema.Type<typeof EnvSchema>

export class EnvService extends Context.Tag('EnvService')<EnvService, Env>() {}

export const EnvServiceLive = Layer.effect(
	EnvService,
	Effect.sync(() => Schema.decodeUnknownSync(EnvSchema)(process.env))
)
