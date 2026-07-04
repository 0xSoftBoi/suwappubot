import { Schema } from '@effect/schema'
import { Context, Effect, Layer } from 'effect'
import {
	DEFAULT_AGENT_FEE_BPS,
	DEFAULT_FEE_WALLET_EVM,
	DEFAULT_FEE_WALLET_SOLANA,
} from './constants'

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
			'https://app.suwappu.bot,https://terminal.suwappu.bot,https://www.suwappu.bot,https://suwappu.bot,https://devfront.suwappu.bot,http://localhost:3000,http://localhost:5173',
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

	// Agent pay-per-call metering (x402 prepaid credits).
	// Default OFF so deploying this never blocks existing free agents.
	AGENT_METERING_ENABLED: Schema.optionalWith(Schema.String, { default: () => 'false' }),
	// Address that receives USDC topups. Falls back to FEE_WALLET_EVM in code if unset.
	AGENT_METERING_COLLECTOR_ADDRESS: Schema.optional(Schema.String),
	// Network + USDC asset address used in the x402 402 challenge body.
	AGENT_METERING_NETWORK: Schema.optionalWith(Schema.String, { default: () => 'base' }),
	// Base mainnet native USDC (0x833589...2913). Override per-network as needed.
	AGENT_METERING_USDC_ADDRESS: Schema.optionalWith(Schema.String, {
		default: () => '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
	}),

	// x402 facilitator (direct on-chain settlement of a single call via the
	// X-PAYMENT header, as an alternative to prepaid credits). OFF by default —
	// when off, the only paid paths are prepaid credits + subscriptions.
	// CDP's hosted facilitator covers Base/Polygon/Arbitrum/World/Solana; our own
	// chains (e.g. Tempo) fall back to the internal Python verifier.
	X402_FACILITATOR_ENABLED: Schema.optionalWith(Schema.String, { default: () => 'false' }),
	X402_FACILITATOR_URL: Schema.optionalWith(Schema.String, {
		default: () => 'https://x402.org/facilitator',
	}),
	// Optional bearer token for facilitators that accept one. CDP mainnet needs
	// JWT auth via @coinbase/x402 instead (follow-up).
	X402_FACILITATOR_API_KEY: Schema.optional(Schema.String),

	// Recurring crypto billing via Base Spend Permissions (true auto-renew). OFF by
	// default — needs a funded operator (spender) key on Base. SPEND_OPERATOR_PK is
	// the server key that submits approveWithSignature + spend() txs.
	RECURRING_BILLING_ENABLED: Schema.optionalWith(Schema.String, { default: () => 'false' }),
	SPEND_OPERATOR_PK: Schema.optional(Schema.String),
	// SpendPermissionManager deployment (defaults to Base mainnet).
	SPEND_PERMISSION_MANAGER_ADDRESS: Schema.optionalWith(Schema.String, {
		default: () => '0xf85210B21cC50302F477BA56686d2019dC9b67Ad',
	}),

	// Fee Collection (defaults centralized in ./constants — single source of truth)
	FEE_WALLET_EVM: Schema.optionalWith(Schema.String, {
		default: () => DEFAULT_FEE_WALLET_EVM,
	}),
	FEE_WALLET_SOLANA: Schema.optionalWith(Schema.String, {
		default: () => DEFAULT_FEE_WALLET_SOLANA,
	}),
	// Flat agent-surface platform fee (0.3%). NOT tier-aware — see DEFAULT_AGENT_FEE_BPS.
	FEE_BPS: Schema.optionalWith(Schema.NumberFromString, { default: () => DEFAULT_AGENT_FEE_BPS }),

	// Polymarket
	POLYMARKET_CREDENTIAL_KEY: Schema.optional(Schema.String),

	// Stripe billing
	STRIPE_SECRET_KEY: Schema.optional(Schema.String),
	STRIPE_WEBHOOK_SECRET: Schema.optional(Schema.String),
	STRIPE_PRO_PRICE_ID: Schema.optional(Schema.String),
	STRIPE_PREMIUM_PRICE_ID: Schema.optional(Schema.String),

	// ERC-4337 smart accounts (Kernel v0.3.1 via permissionless.js / viem).
	// OFF by default — predicting addresses is always available on supported
	// chains, but submitting UserOperations requires a configured bundler.
	SMART_ACCOUNT_ENABLED: Schema.optionalWith(Schema.String, { default: () => 'false' }),
	// ERC-4337 bundler JSON-RPC endpoint (e.g. Pimlico). Required to send UserOps.
	BUNDLER_RPC_URL: Schema.optional(Schema.String),

	// On-chain fee-cashback rewards (audited SuwappuRewardsDistributor on Base).
	// Both optional — without them the rewards API still serves balances/proofs,
	// it just can't read live isClaimed() state from the chain.
	REWARDS_DISTRIBUTOR_ADDRESS: Schema.optional(Schema.String),
	REWARDS_RPC_URL: Schema.optional(Schema.String),
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
