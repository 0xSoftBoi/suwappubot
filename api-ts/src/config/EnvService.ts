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

	// Webapp passkey recovery (WebAuthn relying party)
	WEBAPP_RP_ID: Schema.optionalWith(Schema.String, { default: () => 'app.suwappu.bot' }),
	WEBAPP_RP_NAME: Schema.optionalWith(Schema.String, { default: () => 'Suwappu' }),

	// CORS
	ALLOWED_ORIGINS: Schema.optionalWith(Schema.String, {
		default: () =>
			'https://app.suwappu.bot,https://terminal.suwappu.bot,https://www.suwappu.bot,https://suwappu.bot,https://devfront.suwappu.bot,http://localhost:3000,http://localhost:5173',
	}),

	// Showcase site base URL — used for web checkout success/cancel redirects
	SHOWCASE_BASE_URL: Schema.optionalWith(Schema.String, {
		default: () => 'https://suwappu.bot',
	}),

	// World ID (ETHGlobal Tokyo 2026 "Agent Swap Passport" — hackathon Phase 1).
	// RP-based World ID 4.0 verify flow: POST https://developer.world.org/api/v4/verify/{rp_id}.
	// All optional — unset means worldId.ts fails closed (verification unavailable, never silently
	// "verified"). staging env unless WORLD_ID_ENV=production is set explicitly.
	// No defaults for APP_ID/RP_ID — money-path-reviewer flagged that a
	// hardcoded default silently defeats the fail-closed check in worldId.ts
	// (missing config should actually fail closed, not fall back to a baked-in
	// hackathon app). Leave unset in prod until real World ID config is wired.
	WORLD_ID_APP_ID: Schema.optional(Schema.String),
	WORLD_ID_RP_ID: Schema.optional(Schema.String),
	WORLD_ID_ACTION: Schema.optionalWith(Schema.String, {
		default: () => 'agent-swap-passport-verify',
	}),
	WORLD_ID_API_KEY: Schema.optional(Schema.String),
	WORLD_ID_ENV: Schema.optionalWith(Schema.Literal('staging', 'production'), {
		default: () => 'staging' as const,
	}),
	// RP signing key from `configure_world_id` (managed RP setup) — signs the
	// `rp_context` attestation required on every /api/v4/verify call. Without
	// it, verifyWorldIdProof fails closed (world_id_not_configured).
	WORLD_ID_RP_SIGNING_KEY: Schema.optional(Schema.String),
	// Staging-only dev-portal token (`set_world_id_staging_verification`), lets
	// the portal accept simulator-generated proofs. Never set in production.
	WORLD_ID_STAGING_VERIFICATION_TOKEN: Schema.optional(Schema.String),

	// AgentKit SIWE `domain` binding (worldIdAuth.ts) — the host callers must
	// sign against in the EIP-4361 message. Defaults to the prod api-ts host.
	API_DOMAIN: Schema.optionalWith(Schema.String, { default: () => 'api.suwappu.bot' }),

	// Intercepta (ETHGlobal Tokyo 2026 "Agent Swap Passport" — hackathon Phase 2).
	// Address risk screening: GET https://api.web3antivirus.io/api/public/v2/extension/account/{address}/quick-scan.
	// Key is obtained via a self-serve Typeform (docs.web3antivirus.io/reference/getting-started-1)
	// and is NOT YET PROVISIONED as of this build. Unset means lib/intercepta.ts fails closed
	// (screening unavailable -> the metered payment is rejected, never silently allowed through).
	INTERCEPTA_API_KEY: Schema.optional(Schema.String),
	INTERCEPTA_TOXIC_SCORE_THRESHOLD: Schema.optionalWith(Schema.NumberFromString, {
		default: () => 70,
	}),

	// ENS (ETHGlobal Tokyo 2026 "Agent Swap Passport" — hackathon Phase 3).
	// Mints `<agent>.suwappu-agents.eth` ENSv2 subnames on Sepolia once an agent
	// is claimed + World ID-verified. All optional — unset means ensSubname.ts
	// fails closed (mint skipped, agent flow proceeds without an ENS name; this
	// is a nice-to-have identity anchor, never a gate on the claim flow).
	ENS_SEPOLIA_RPC_URL: Schema.optionalWith(Schema.String, {
		default: () => 'https://ethereum-sepolia-rpc.publicnode.com',
	}),
	// Private key of 0x23865aA89E79511950987CC15cd5834BE010E8E7, the account
	// that owns `suwappu-agents.eth` and holds admin roles on its subregistry.
	// Loaded from an env var in real deployments; the hackathon build sandbox
	// keeps it at scripts/.ens_sepolia_key (gitignored, chmod 600) instead.
	ENS_MINTER_PRIVATE_KEY: Schema.optional(Schema.String),
	// Subregistry contract for suwappu-agents.eth (a PermissionedRegistry
	// instance deployed as the child registry of the parent .eth registry
	// entry) — this is what register() is actually called on to mint agent
	// subnames. Deployed and wired via setSubregistry() on 2026-09-26; see
	// docs/plans/ethglobal-tokyo2026-agent-passport.md Phase 3 for tx hashes.
	ENS_SUWAPPU_AGENTS_SUBREGISTRY: Schema.optionalWith(Schema.String, {
		default: () => '0xd617a7918b89c7bac8f85c53e327d034914bd062',
	}),
	// Resolver to attach to each minted subname. Defaults to the shared
	// PublicResolverV2 on Sepolia (verified contract, confirmed via Blockscout
	// as `PublicResolverV2`) rather than PermissionedResolver, which ENSv2
	// docs describe as a per-account proxy meant to be deployed once per
	// name via a factory — unnecessary complexity for a shared hackathon
	// namespace where every subname can safely share one resolver.
	ENS_RESOLVER_ADDRESS: Schema.optionalWith(Schema.String, {
		default: () => '0xd7e590ad0e92a6ac1d81f4483a9b951d3585a50f',
	}),

	// Internal Python API
	INTERNAL_API_KEY: Schema.optional(Schema.String),
	INTERNAL_API_URL: Schema.optionalWith(Schema.String, {
		default: () => 'http://localhost:8000',
	}),

	// Redis
	REDIS_URL: Schema.optional(Schema.String),

	// Sentry error tracking — fully optional. Unset = no-op (no init, no latency,
	// no behavior change). Never required in production; only wire it up when
	// operators provide a DSN.
	SENTRY_DSN: Schema.optional(Schema.String),

	// Sponge Gateway
	SPONGE_API_KEY: Schema.optional(Schema.String),
	SPONGE_WEBHOOK_SECRET: Schema.optional(Schema.String),

	// MPP (Micropayment Protocol)
	MPP_ENABLED: Schema.optionalWith(Schema.String, { default: () => 'false' }),
	MPP_SWAP_PRICE_USD: Schema.optionalWith(Schema.String, { default: () => '0.001' }),

	// Agent pay-per-call metering (x402 prepaid credits).
	// Default OFF so deploying this never blocks existing free agents.
	AGENT_METERING_ENABLED: Schema.optionalWith(Schema.String, { default: () => 'false' }),
	// Require a server-issued step-up challenge (approval_step_up_challenges)
	// to be presented and consumed before an owner's approve decision is
	// honored. Default OFF so existing owner approve flows are unaffected.
	APPROVAL_STEP_UP_REQUIRED: Schema.optionalWith(Schema.String, { default: () => 'false' }),
	// Address that receives USDC topups. Falls back to FEE_WALLET_EVM in code if unset.
	AGENT_METERING_COLLECTOR_ADDRESS: Schema.optional(Schema.String),
	// Network + USDC asset address used in the x402 402 challenge body.
	AGENT_METERING_NETWORK: Schema.optionalWith(Schema.String, { default: () => 'base' }),
	// Base mainnet native USDC (0x833589...2913). Override per-network as needed.
	AGENT_METERING_USDC_ADDRESS: Schema.optionalWith(Schema.String, {
		default: () => '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
	}),
	// Extra x402 payment networks advertised alongside the primary one, comma
	// separated (see config/x402Networks.ts for the registry). Empty by default:
	// enabling a payment rail is a deliberate act. e.g. "robinhood" to accept
	// Paxos USDG on Robinhood Chain (4663).
	X402_EXTRA_NETWORKS: Schema.optionalWith(Schema.String, { default: () => '' }),

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

	// OpenTelemetry tracing — fully optional, OFF by default. Unset/false = no
	// SDK init, no exporter, no network calls, no added latency (see lib/otel.ts).
	// Follows the same string 'true'/'false' convention as the other *_ENABLED
	// flags above rather than a coerced boolean, for consistency.
	OTEL_ENABLED: Schema.optionalWith(Schema.String, { default: () => 'false' }),
	OTEL_SERVICE_NAME: Schema.optionalWith(Schema.String, { default: () => 'suwappu-api-ts' }),
	// OTLP/HTTP collector base URL (e.g. http://localhost:4318 or a hosted
	// collector). Traces are POSTed to `${OTEL_EXPORTER_OTLP_ENDPOINT}/v1/traces`.
	// When unset, the exporter's own default (http://localhost:4318) is used.
	OTEL_EXPORTER_OTLP_ENDPOINT: Schema.optional(Schema.String),
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
