import crypto from 'crypto'
import { and, desc, eq, gte, isNull, or, sql } from 'drizzle-orm'
import { Effect, Either, Option } from 'effect'
import { Hono, type Context } from 'hono'
import { z } from 'zod'
import openApiSpec from '../../openapi-agent.json'
import { isStarknet } from '../config/chains'
import { EnvService } from '../config/EnvService'
import type { Agent } from '../db'
import { agents, agentApprovals, agentCredits, agentCreditTopups, agentLinkCodes, agentSubscriptions, recurringSubscriptions, requireDb, swapTransactions, webhookEvents, auditLogs, policyKillSwitches, organizations } from '../db'
import { PURCHASABLE_TIERS, SUBSCRIPTION_PERIOD_DAYS, TIER_PRICES_USD } from '../config/constants'
import { openApiToPostmanCollection } from '../lib/postman'
import { type SpendPermission, validateSpendPermission } from '../lib/spendPermission'
import { assertSenderBound, consumePayment } from '../lib/paymentConsumption'
import { verifyX402Payment } from '../lib/x402Verify'
import { approveSpendPermission, isRecurringEnabled, operatorAddress } from '../services/RecurringBillingService'
import { mapErrorToResponse, ValidationError } from '../errors'
import { agentError } from '../lib/agentError'
import { agentBearerAuth, agentBearerAuthAllowInactive } from '../middleware'
import { agentFlexAuth } from '../middleware/agentFlexAuth'
import { apiKeyAuth } from '../middleware/apiKeyAuth'
import { agentOrMppAuth } from '../middleware/agentOrMppAuth'
import { recordUsage } from '../middleware/recordUsage'
import { requireScope } from '../middleware/requireScope'
import { ipRateLimit, resolveRequestIp } from '../middleware/ipRateLimit'
import { rateLimit } from '../middleware/rateLimit'
import { BYPASS_TIERS, type ChargeResult, COST_WEIGHTS, CREDIT_USD_VALUE, meteredPayment, refundChargedCall } from '../middleware/x402Payment'
import { cacheAgentQuote, getCachedQuote } from '../lib/quoteCache'
import { buildEvmSimulationReport, buildSolanaSimulationReport } from '../lib/swapSimulation'
import { fetchMintPriceUsd } from '../lib/prices'
import { enforcePolicy, hasUsdPolicyRules, type PolicyGateIntent } from '../services/policyGate'
import { auditLog, computeEntryHash, verifyAuditChain, writeAuditLog } from '../services/audit'
import { runEffectEither } from '../runtime'
import {
	AgentService,
	BalanceService,
	CHAINS,
	COMMON_TOKENS,
	JupiterService,
	type JupiterQuote,
	type QuoteParams,
	SOLANA_TOKENS,
	SwapService,
	type SwapQuote,
	TokenService,
	TurnkeyService,
} from '../services'
import { assertUrlSafeForFetch, safeFetch } from './ssrfGuard'
import {
	CreatePolicySchema,
	ExecuteCommandSchema,
	ExecuteSwapSchema,
	formatZodErrors,
	QuoteRequestSchema,
	RegisterAgentSchema,
	SimulateSwapSchema,
	SwapRequestSchema,
	SwapStatusQuerySchema,
	TopupSchema,
	UpdateAgentSchema,
	WebhookEventsQuerySchema,
} from './validators'

// Extend Hono's context to include our agent
type AgentContext = {
	Variables: {
		agent: Agent
		// Set by meteredPayment() middleware — the outcome of the pay-per-call charge
		// for this request, if metering ran. Used by /swap/execute to refund a charge
		// on a non-execution failure path (mirrors mcp.ts's refundChargedCall guard).
		meterCharge?: ChargeResult
	}
}

const agentRoutes = new Hono<AgentContext>()

// Refund a pay-per-call charge when a request fails before (or without) actually
// executing a swap — e.g. blocked/require_approval from the policy gate. Mirrors
// the MCP tool-dispatch refund guard in mcp.ts (refundChargedCall call sites
// there): only refund when the charge actually deducted prepaid credits
// (kind === 'ok'); a facilitator-settled on-chain payment ('settled') is never
// refunded here, matching that guard. Shared across /swap, /execute, and
// /swap/execute so a block/require_approval verdict never leaves credits
// charged with nothing delivered.
async function refundMeteredCharge(c: Context<AgentContext>, agent: Agent, reason: string): Promise<void> {
	const charge = c.get('meterCharge')
	if (charge?.kind === 'ok') {
		await refundChargedCall({ agentId: agent.id, cost: charge.cost, reason })
	}
}

// Quote cache is shared with the MCP surface (lib/quoteCache) so a quote fetched
// via POST /v1/agent/quote can be executed through mcp.ts's execute_swap tool and
// vice versa. The shared TTLCache manages its own expiry + eviction timer.

// Retained for the shutdown hook and tests. The shared cache self-manages its
// cleanup interval (TTLCache), so this is now a no-op.
export function stopAgentCleanup() {}

// --- Managed-wallet ownership (C16/C17) ---
// Agents use managed (Turnkey) EVM wallets whose address is stored in
// agent.metadata.wallet_address. A caller-supplied `wallet_address` used as the
// swap sender must match it — otherwise an agent could build a fund-moving tx from
// an arbitrary/victim address.
const EVM_ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/
function isEvmAddress(addr: unknown): addr is string {
	return typeof addr === 'string' && EVM_ADDRESS_RE.test(addr)
}
function getAgentWalletAddress(agent: Agent): string | undefined {
	const addr = ((agent.metadata || {}) as Record<string, unknown>).wallet_address
	return typeof addr === 'string' ? addr : undefined
}
/** True only if `addr` is a valid EVM address matching the agent's managed wallet. */
export function checkEvmWalletOwnership(agent: Agent, addr: unknown): boolean {
	if (!isEvmAddress(addr)) return false
	const owned = getAgentWalletAddress(agent)
	return isEvmAddress(owned) && owned.toLowerCase() === addr.toLowerCase()
}

/**
 * Resolve the token decimals used to build `quote_data.from_amount_human` /
 * `to_amount_human` for POST /v1/agent/swap/execute. These feed the Python
 * pipeline's pre-swap balance guard (bot/utils/quote_validator.py), so
 * guessing a hardcoded constant here is what caused the original bug: a
 * 6-decimal token (USDC/USDT) silently compared against a wrong-scale
 * balance, letting an insufficient-balance swap through to an on-chain revert
 * instead of a clean rejection.
 *
 * Precedence:
 *  1. Decimals captured at QUOTE time (cached.fromDecimals/toDecimals) — the
 *     token registry was in scope then, so this is authoritative.
 *  2. Decimals carried on the raw provider quote itself. Li.Fi's SwapQuote
 *     exposes fromToken.decimals/toToken.decimals directly; Jupiter's raw
 *     quote carries only mint addresses, never decimals, so this is always
 *     undefined for Solana.
 *  3. FROM side: no further fallback — undefined means "refuse to execute,
 *     ask for a fresh quote" (handled by the caller). TO side is
 *     informational only (never gates the balance check), so falling back to
 *     the FROM decimals is an acceptable, explicitly-documented approximation
 *     rather than a silent guess of an unrelated constant.
 */
export function resolveSwapExecuteDecimals(cached: {
	quote: any
	isSolana?: boolean | undefined
	fromDecimals?: number | undefined
	toDecimals?: number | undefined
}): { fromDecimals: number | undefined; toDecimals: number | undefined } {
	const quote = cached.quote
	const rawFromDecimals: number | undefined = cached.isSolana
		? undefined
		: (quote?.fromToken?.decimals as number | undefined)
	const rawToDecimals: number | undefined = cached.isSolana
		? undefined
		: (quote?.toToken?.decimals as number | undefined)

	const fromDecimals = cached.fromDecimals ?? rawFromDecimals
	const toDecimals = cached.toDecimals ?? rawToDecimals ?? fromDecimals

	return { fromDecimals, toDecimals }
}

// CoinGecko ID mapping for token prices
const COINGECKO_IDS: Record<string, string> = {
	eth: 'ethereum',
	sol: 'solana',
	bnb: 'binancecoin',
	usdc: 'usd-coin',
	usdt: 'tether',
	btc: 'bitcoin',
	dai: 'dai',
	wbtc: 'wrapped-bitcoin',
	arb: 'arbitrum',
	op: 'optimism',
	avax: 'avalanche-2',
	matic: 'matic-network',
	weth: 'weth',
	bonk: 'bonk',
	jup: 'jupiter-exchange-solana',
	ray: 'raydium',
}

// Token price cache (60s TTL)
const tokenPriceCache = new Map<
	string,
	{ usd: number; change_24h: number | null; timestamp: number }
>()
const PRICE_CACHE_TTL = 60_000

async function fetchTokenPrices(
	symbols: string[],
): Promise<Record<string, { usd: number; change_24h: number | null }>> {
	const now = Date.now()
	const result: Record<string, { usd: number; change_24h: number | null }> = {}
	const toFetch: string[] = []

	for (const sym of symbols) {
		const lower = sym.toLowerCase()
		const cached = tokenPriceCache.get(lower)
		if (cached && now - cached.timestamp < PRICE_CACHE_TTL) {
			result[sym.toUpperCase()] = { usd: cached.usd, change_24h: cached.change_24h }
		} else if (COINGECKO_IDS[lower]) {
			toFetch.push(lower)
		}
	}

	if (toFetch.length > 0) {
		const ids = toFetch.map((s) => COINGECKO_IDS[s]).join(',')
		try {
			const res = await fetch(
				`https://api.coingecko.com/api/v3/simple/price?ids=${ids}&vs_currencies=usd&include_24hr_change=true`,
			)
			if (res.ok) {
				const data = (await res.json()) as Record<string, { usd?: number; usd_24h_change?: number }>
				for (const sym of toFetch) {
					const cgId = COINGECKO_IDS[sym]
					if (!cgId) continue
					const priceData = data[cgId]
					if (priceData?.usd !== undefined) {
						const entry = { usd: priceData.usd, change_24h: priceData.usd_24h_change ?? null }
						tokenPriceCache.set(sym, { ...entry, timestamp: now })
						result[sym.toUpperCase()] = entry
					}
				}
			}
		} catch {
			// CoinGecko unavailable, return what we have from cache
		}
	}

	return result
}

// Chain name/id mapping for token listing
const CHAIN_NAMES: Record<number, string> = {
	1: 'Ethereum',
	10: 'Optimism',
	56: 'BNB Chain',
	137: 'Polygon',
	42161: 'Arbitrum',
	8453: 'Base',
	43114: 'Avalanche',
}

// Helper to detect if chain is Solana
function isSolanaChain(chain: string): boolean {
	const normalized = chain.toLowerCase().trim()
	return normalized === 'solana' || normalized === 'sol'
}

// ===========================================
// PUBLIC ENDPOINTS (no auth required)
// ===========================================

// POST /v1/agent/register - Register a new agent
agentRoutes.post('/register', ipRateLimit(5), async (c) => {
	let body: unknown
	try {
		body = await c.req.json()
	} catch {
		return agentError(c, 400, 'VALIDATION_ERROR', 'Invalid JSON body')
	}

	const parsed = RegisterAgentSchema.safeParse(body)
	if (!parsed.success) {
		return c.json(
			{
				success: false,
				error: 'Validation error',
				error_code: 'VALIDATION_ERROR',
				fields: formatZodErrors(parsed.error),
			},
			400,
		)
	}

	const { name, description, callback_url, metadata } = parsed.data

	// Resolve client IP for the starter-credit anti-farm guard (see AgentService).
	const ip = resolveRequestIp(c)

	const result = await runEffectEither(
		Effect.gen(function* () {
			const agentService = yield* AgentService

			const existing = yield* agentService.getAgentByName(name)
			if (Option.isSome(existing)) {
				return yield* Effect.fail(
					new ValidationError({ message: `Agent name "${name}" is already taken` }),
				)
			}

			const { agent, apiKey, grantedCredits } = yield* agentService.registerAgent({
				name,
				description,
				callbackUrl: callback_url,
				metadata,
				ip,
			})

			return { agent, apiKey, grantedCredits }
		}),
	)

	if (Either.isLeft(result)) {
		const { status, body } = mapErrorToResponse(result.left)
		return c.json(body, status)
	}

	const { agent, apiKey, grantedCredits } = result.right

	return c.json(
		{
			success: true,
			message: 'Welcome to Suwappu!',
			agent: {
				id: agent.uuid,
				name: agent.name,
				api_key: apiKey,
				created_at: agent.createdAt,
			},
			important: 'SAVE YOUR API KEY! It cannot be retrieved later.',
			credits: {
				starting_balance: grantedCredits,
				note:
					grantedCredits > 0
						? `You start with ${grantedCredits} free credits (~${grantedCredits} quote calls or ${Math.floor(grantedCredits / 5)} swaps) so you can try the API immediately. GET /v1/agent/tokens and GET /v1/agent/chains are always free.`
						: 'Starter credits were not granted for this registration (rate-limited). GET /v1/agent/tokens and GET /v1/agent/chains are always free — top up to use metered endpoints.',
				topup: 'POST /v1/agent/billing/topup with {txHash, chain, amount} once your balance runs low',
			},
			next_steps: {
				step_1: 'Save your api_key securely',
				step_2: 'Use Authorization: Bearer YOUR_API_KEY for all requests',
				step_3:
					'Try POST /v1/agent/quote with {"from_token": "ETH", "to_token": "USDC", "amount": "0.1", "chain": "base"}',
			},
			docs: 'https://api.suwappu.bot/docs',
		},
		201,
	)
})

// POST /v1/agent/sponge/callback - Sponge Gateway agent connection callback (public)
agentRoutes.post('/sponge/callback', ipRateLimit(20), async (c) => {
	// Validate X-Sponge-Signature if webhook secret is configured
	const envResult = await runEffectEither(
		Effect.gen(function* () {
			return yield* EnvService
		}),
	)

	// Fail closed: this callback must be HMAC-signed. If the secret isn't configured
	// (or env is unavailable) reject — never accept an unverified callback, which
	// could forge-register agents, trigger actions, or inject metadata.
	if (Either.isLeft(envResult) || !envResult.right.SPONGE_WEBHOOK_SECRET) {
		return agentError(c, 503, 'UPSTREAM_ERROR', 'Sponge webhook is not configured')
	}
	const webhookSecret = envResult.right.SPONGE_WEBHOOK_SECRET

	const signature = c.req.header('X-Sponge-Signature')
	if (!signature) {
		return agentError(c, 401, 'UNAUTHORIZED', 'Missing X-Sponge-Signature header')
	}

	const rawBody = await c.req.text()
	const expected = crypto
		.createHmac('sha256', webhookSecret)
		.update(rawBody)
		.digest('hex')

	// Reject a malformed signature (non-hex or wrong length) before constant-time compare.
	if (!/^[0-9a-fA-F]+$/.test(signature) || signature.length !== expected.length) {
		return agentError(c, 401, 'UNAUTHORIZED', 'Invalid signature')
	}
	const sigBuf = Buffer.from(signature, 'hex')
	const expBuf = Buffer.from(expected, 'hex')
	if (sigBuf.length !== expBuf.length || !crypto.timingSafeEqual(sigBuf, expBuf)) {
		return agentError(c, 401, 'UNAUTHORIZED', 'Invalid signature')
	}

	let body: any
	try {
		body = JSON.parse(rawBody)
	} catch {
		return agentError(c, 400, 'VALIDATION_ERROR', 'Invalid JSON body')
	}

	return handleSpongeCallback(c, body)
})

async function handleSpongeCallback(c: any, body: any) {
	const { event, agent_name, agent_url } = body as {
		event: string
		agent_name?: string
		agent_url?: string
	}

	const ip = resolveRequestIp(c)

	if (event !== 'agent_connect') {
		return agentError(c, 400, 'VALIDATION_ERROR', `Unsupported event: ${event}`)
	}

	if (!agent_name) {
		return agentError(c, 400, 'VALIDATION_ERROR', 'agent_name is required')
	}

	// Auto-register the connecting agent
	const name = `sponge_${agent_name.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 40)}`
	const result = await runEffectEither(
		Effect.gen(function* () {
			const agentService = yield* AgentService

			// Check if already registered
			const existing = yield* agentService.getAgentByName(name)
			if (Option.isSome(existing)) {
				// Reuse existing agent and key on reconnect (don't rotate — breaks existing sessions)
				return { agent: existing.value, apiKey: existing.value.apiKey, isNew: false }
			}

			const { agent, apiKey } = yield* agentService.registerAgent({
				name,
				description: `Auto-registered via Sponge Gateway from ${agent_url || 'unknown'}`,
				callbackUrl: agent_url,
				metadata: { source: 'sponge', original_name: agent_name, connected_at: new Date().toISOString() },
				ip,
			})

			return { agent, apiKey, isNew: true }
		}),
	)

	if (Either.isLeft(result)) {
		const { status, body: errBody } = mapErrorToResponse(result.left)
		return c.json(errBody, status)
	}

	const { apiKey } = result.right
	return c.json({
		api_key: apiKey,
		endpoints: {
			rest: 'https://api.suwappu.bot/v1/agent',
			mcp: 'https://api.suwappu.bot/mcp',
			a2a: 'https://api.suwappu.bot/a2a',
		},
	})
}

// GET /v1/agent/chains - List supported chains (public)
agentRoutes.get('/chains', async (c) => {
	const evmChains = Object.values(CHAINS)
		.filter((chain, index, self) => index === self.findIndex((ch) => ch.id === chain.id))
		.map((chain) => ({
			id: chain.id,
			key: chain.key,
			name: chain.name,
			native_token: chain.nativeToken,
			type: 'evm',
		}))

	// Add Solana, Sui, TON
	const chains = [
		...evmChains,
		{
			id: 'solana',
			key: 'solana',
			name: 'Solana',
			native_token: 'SOL',
			type: 'solana',
		},
		{
			id: 'sui',
			key: 'sui',
			name: 'Sui',
			native_token: 'SUI',
			type: 'move',
		},
		{
			id: 'ton',
			key: 'ton',
			name: 'TON',
			native_token: 'TON',
			type: 'ton',
		},
	]

	return c.json({
		success: true,
		chains,
		note: 'Use chain key (e.g., "base", "solana") in requests. Solana uses Jupiter, EVM chains use Li.Fi.',
	})
})

// ===========================================
// AUTHENTICATED ENDPOINTS
// ===========================================

agentRoutes.use('/me', agentFlexAuth())
agentRoutes.use('/me/*', agentFlexAuth())
agentRoutes.use('/quote', agentOrMppAuth())
agentRoutes.use('/swap', agentOrMppAuth())
agentRoutes.use('/execute', agentFlexAuth())
agentRoutes.use('/portfolio', agentFlexAuth())
agentRoutes.use('/wallets', agentFlexAuth())
agentRoutes.use('/wallets/*', agentFlexAuth())
agentRoutes.use('/swap/*', agentFlexAuth())
agentRoutes.use('/swaps', agentFlexAuth())
agentRoutes.use('/prices', agentFlexAuth())
agentRoutes.use('/tokens', agentFlexAuth())
agentRoutes.use('/webhooks', agentFlexAuth())
agentRoutes.use('/webhooks/*', agentFlexAuth())
agentRoutes.use('/keys/*', agentFlexAuth())
agentRoutes.use('/wallet/policy', agentFlexAuth())
agentRoutes.use('/wallet/policy/*', agentFlexAuth())
agentRoutes.use('/wallet/policies', agentFlexAuth())
agentRoutes.use('/billing', agentFlexAuth())
agentRoutes.use('/billing/*', agentFlexAuth())
agentRoutes.use('/reactivate', agentBearerAuthAllowInactive())
agentRoutes.use('/approvals/*', agentFlexAuth())
agentRoutes.use('/link/code', agentFlexAuth())
agentRoutes.use('/audit', agentFlexAuth())
agentRoutes.use('/audit/*', agentFlexAuth())
// Kill switch is org-API-key only (see handlers below) — apiKeyAuth() is a
// no-op when no sk_live_ key is present, so the handlers explicitly reject
// requests that never resolved an apiKeyAuth context (plain agent tokens).
agentRoutes.use('/killswitch', apiKeyAuth())
agentRoutes.use('/killswitch', requireScope('admin'))

// Apply rate limiting to all authenticated endpoints
agentRoutes.use('/me', rateLimit())
agentRoutes.use('/me/*', rateLimit())
agentRoutes.use('/quote', rateLimit())
agentRoutes.use('/swap', rateLimit())
agentRoutes.use('/execute', rateLimit())
agentRoutes.use('/portfolio', rateLimit())
agentRoutes.use('/wallets', rateLimit())
agentRoutes.use('/wallets/*', rateLimit())
agentRoutes.use('/swap/*', rateLimit())
agentRoutes.use('/swaps', rateLimit())
agentRoutes.use('/prices', rateLimit())
agentRoutes.use('/tokens', rateLimit())
agentRoutes.use('/webhooks', rateLimit())
agentRoutes.use('/webhooks/*', rateLimit())
agentRoutes.use('/keys/*', rateLimit())
agentRoutes.use('/wallet/policy', rateLimit())
agentRoutes.use('/wallet/policy/*', rateLimit())
agentRoutes.use('/wallet/policies', rateLimit())
agentRoutes.use('/billing', rateLimit())
agentRoutes.use('/billing/*', rateLimit())
agentRoutes.use('/reactivate', rateLimit())
agentRoutes.use('/approvals/*', rateLimit())
agentRoutes.use('/link/code', rateLimit())

// ===========================================
// PAY-PER-CALL METERING (x402 prepaid credits)
// ===========================================
// Runs AFTER auth + rateLimit. No-op unless AGENT_METERING_ENABLED='true'.
// Free tier keeps its rate-limit free quota; payment is only enforced when
// metering is enabled AND the agent is on the free tier without credits.
// NOTE: /billing and /billing/topup are intentionally NOT metered.
agentRoutes.use('/quote', meteredPayment('quote'))
agentRoutes.use('/swap', meteredPayment('swap'))
agentRoutes.use('/execute', meteredPayment('execute'))
agentRoutes.use('/swap/execute', meteredPayment('swap/execute'))
// Read-only dry-run — same cost tier as /quote (1 credit). No funds move.
agentRoutes.use('/swap/simulate', meteredPayment('swap/simulate'))
agentRoutes.use('/portfolio', meteredPayment('portfolio'))
agentRoutes.use('/prices', meteredPayment('prices'))
agentRoutes.use('/tokens', meteredPayment('tokens'))

// Usage recording — fire-and-forget, only activates for org API key requests
agentRoutes.use('*', recordUsage())

// Scope enforcement on sensitive endpoints (API key paths only; bearer token paths bypass)
agentRoutes.use('/swap/execute', requireScope('swap:execute'))
agentRoutes.use('/swap/simulate', requireScope('trade:read'))
agentRoutes.use('/portfolio', requireScope('trade:read'))
agentRoutes.use('/wallets', requireScope('trade:read'))
agentRoutes.use('/wallets/*', requireScope('trade:read'))

// GET /v1/agent/me - Get current agent profile
agentRoutes.get('/me', async (c) => {
	const agent = c.get('agent')

	return c.json({
		success: true,
		agent: {
			id: agent.uuid,
			name: agent.name,
			description: agent.description,
			rate_limit_tier: agent.rateLimitTier,
			stats: {
				total_requests: agent.totalRequests,
				total_swaps: agent.totalSwaps,
			},
			created_at: agent.createdAt,
			last_active_at: agent.lastActiveAt,
			owner_linked: agent.ownerUserId != null,
			org_linked: agent.organizationId != null,
		},
	})
})

// PATCH /v1/agent/me - Update current agent profile
agentRoutes.patch('/me', async (c) => {
	const agent = c.get('agent')

	let body: unknown
	try {
		body = await c.req.json()
	} catch {
		return agentError(c, 400, 'VALIDATION_ERROR', 'Invalid JSON body')
	}

	const parsed = UpdateAgentSchema.safeParse(body)
	if (!parsed.success) {
		return c.json(
			{
				success: false,
				error: 'Validation error',
				error_code: 'VALIDATION_ERROR',
				fields: formatZodErrors(parsed.error),
			},
			400,
		)
	}

	const { description, callback_url, metadata } = parsed.data

	const result = await runEffectEither(
		Effect.gen(function* () {
			const agentService = yield* AgentService
			return yield* agentService.updateAgent(agent.id, {
				description,
				callbackUrl: callback_url,
				metadata,
			})
		}),
	)

	if (Either.isLeft(result)) {
		const { status, body } = mapErrorToResponse(result.left)
		return c.json(body, status)
	}

	const updated = result.right

	return c.json({
		success: true,
		agent: {
			id: updated.uuid,
			name: updated.name,
			description: updated.description,
			callback_url: updated.callbackUrl,
			metadata: updated.metadata,
			rate_limit_tier: updated.rateLimitTier,
			stats: {
				total_requests: updated.totalRequests,
				total_swaps: updated.totalSwaps,
			},
			updated_at: updated.updatedAt,
		},
	})
})

// POST /v1/agent/quote - Get a swap quote (supports EVM via Li.Fi and Solana via Jupiter)
agentRoutes.post('/quote', async (c) => {
	const agent = c.get('agent')

	let body: unknown
	try {
		body = await c.req.json()
	} catch {
		return agentError(c, 400, 'VALIDATION_ERROR', 'Invalid JSON body')
	}

	const parsed = QuoteRequestSchema.safeParse(body)
	if (!parsed.success) {
		return c.json(
			{
				success: false,
				error: 'Validation error',
				error_code: 'VALIDATION_ERROR',
				fields: formatZodErrors(parsed.error),
				examples: {
					evm: { from_token: 'ETH', to_token: 'USDC', amount: '0.5', chain: 'base' },
					solana: { from_token: 'SOL', to_token: 'USDC', amount: '1', chain: 'solana' },
				},
			},
			400,
		)
	}

	const { from_token, to_token, amount, chain, from_chain, to_chain, wallet_address, slippage } =
		parsed.data

	// Track request
	await runEffectEither(
		Effect.gen(function* () {
			const agentService = yield* AgentService
			yield* agentService.incrementAgentStats(agent.id, 'request')
		}),
	)

	const chainKey = from_chain || chain || 'ethereum'

	// Starknet is read-only in the TS stack — signing/broadcast lives in the Python bot
	if (isStarknet(chainKey) || (to_chain && isStarknet(to_chain))) {
		return c.json(
			{
				success: false,
				error: 'Starknet transactions are handled by the bot backend',
				error_code: 'CHAIN_UNSUPPORTED',
			},
			400,
		)
	}

	// Check if this is a Solana swap
	if (isSolanaChain(chainKey)) {
		// Use Jupiter for Solana
		const result = await runEffectEither(
			Effect.gen(function* () {
				const jupiterService = yield* JupiterService

				// Resolve tokens
				const fromTokenInfo = jupiterService.resolveToken(from_token)
				if (!fromTokenInfo) {
					return yield* Effect.fail(
						new ValidationError({
							message: `Token not found on Solana: ${from_token}`,
							fields: { supported: Object.keys(SOLANA_TOKENS).join(', ') },
						}),
					)
				}

				const toTokenInfo = jupiterService.resolveToken(to_token)
				if (!toTokenInfo) {
					return yield* Effect.fail(
						new ValidationError({
							message: `Token not found on Solana: ${to_token}`,
							fields: { supported: Object.keys(SOLANA_TOKENS).join(', ') },
						}),
					)
				}

				// Convert amount to smallest unit (lamports for SOL, etc)
				const amountNum = parseFloat(amount)
				if (isNaN(amountNum) || amountNum <= 0) {
					return yield* Effect.fail(new ValidationError({ message: 'Invalid amount' }))
				}
				const fromAmountLamports = BigInt(
					Math.floor(amountNum * 10 ** fromTokenInfo.decimals),
				).toString()

				// Get quote from Jupiter
				const quote = yield* jupiterService
					.getQuote({
						inputMint: fromTokenInfo.address,
						outputMint: toTokenInfo.address,
						amount: fromAmountLamports,
						slippageBps: slippage ? Math.floor(slippage * 10000) : 300, // Default 3%
					})
					.pipe(
						Effect.mapError((e) => {
							if (e instanceof ValidationError) return e
							return new ValidationError({ message: e.message })
						}),
					)

				// Generate quote ID
				const quoteId = `jupiter_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`

				// Cache the quote
				cacheAgentQuote(quoteId, quote, agent.id, true, {
					fromDecimals: fromTokenInfo.decimals,
					toDecimals: toTokenInfo.decimals,
				})

				// Calculate human-readable amounts
				const fromAmountHuman = parseFloat(quote.inAmount) / 10 ** fromTokenInfo.decimals
				const toAmountHuman = parseFloat(quote.outAmount) / 10 ** toTokenInfo.decimals
				const toAmountMinHuman = parseFloat(quote.otherAmountThreshold) / 10 ** toTokenInfo.decimals
				const exchangeRate = toAmountHuman / fromAmountHuman

				// Build route description
				const route = quote.routePlan.map((r: any) => r.swapInfo.label).join(' -> ')

				return {
					quote_id: quoteId,
					chain: 'Solana',
					chain_type: 'solana',
					from_token: {
						symbol: fromTokenInfo.name,
						address: fromTokenInfo.address,
						decimals: fromTokenInfo.decimals,
					},
					to_token: {
						symbol: toTokenInfo.name,
						address: toTokenInfo.address,
						decimals: toTokenInfo.decimals,
					},
					amount_in: fromAmountHuman.toString(),
					amount_out: toAmountHuman.toFixed(6),
					amount_out_min: toAmountMinHuman.toFixed(6),
					exchange_rate: exchangeRate.toFixed(6),
					price_impact: `${quote.priceImpactPct}%`,
					route,
					slippage: `${(quote.slippageBps / 100).toFixed(1)}%`,
					expires_in_seconds: 60,
					dex: 'Jupiter',
					requires_wallet: true,
					wallet_type: 'solana',
				}
			}),
		)

		if (Either.isLeft(result)) {
			const { status, body } = mapErrorToResponse(result.left)
			return c.json(body, status)
		}

		return c.json({ success: true, ...result.right })
	}

	// EVM chains - use Li.Fi
	const result = await runEffectEither(
		Effect.gen(function* () {
			const tokenService = yield* TokenService
			const swapService = yield* SwapService

			// Resolve chains
			const sourceChain = from_chain || chain || 'ethereum'
			const destChain = to_chain || chain || 'ethereum'

			const sourceChainInfo = tokenService.resolveChain(sourceChain)
			const destChainInfo = tokenService.resolveChain(destChain)

			if (!sourceChainInfo) {
				return yield* Effect.fail(
					new ValidationError({
						message: `Unknown chain: ${sourceChain}`,
						fields: { chain: `Supported: ${Object.keys(CHAINS).join(', ')}, solana` },
					}),
				)
			}

			if (!destChainInfo) {
				return yield* Effect.fail(
					new ValidationError({
						message: `Unknown chain: ${destChain}`,
						fields: { chain: `Supported: ${Object.keys(CHAINS).join(', ')}, solana` },
					}),
				)
			}

			// Resolve tokens
			const fromTokenInfo = yield* tokenService.resolveToken(from_token, sourceChainInfo.id)
			if (!fromTokenInfo) {
				return yield* Effect.fail(
					new ValidationError({
						message: `Token not found: ${from_token} on ${sourceChainInfo.name}`,
					}),
				)
			}

			const toTokenInfo = yield* tokenService.resolveToken(to_token, destChainInfo.id)
			if (!toTokenInfo) {
				return yield* Effect.fail(
					new ValidationError({
						message: `Token not found: ${to_token} on ${destChainInfo.name}`,
					}),
				)
			}

			// Convert amount to wei/smallest unit
			const amountNum = parseFloat(amount)
			if (isNaN(amountNum) || amountNum <= 0) {
				return yield* Effect.fail(new ValidationError({ message: 'Invalid amount' }))
			}
			const fromAmountWei = BigInt(Math.floor(amountNum * 10 ** fromTokenInfo.decimals)).toString()

			// Use a placeholder address if none provided
			const fromAddress = wallet_address || '0x0000000000000000000000000000000000000001'

			// Build quote params
			const quoteParams: QuoteParams = {
				fromChain: sourceChainInfo.id,
				toChain: destChainInfo.id,
				fromToken: fromTokenInfo.address,
				toToken: toTokenInfo.address,
				fromAmount: fromAmountWei,
				fromAddress,
				slippage: slippage || 0.03,
				order: 'RECOMMENDED',
				integrator: 'suwappu-agent',
			}

			// Get quote from Li.Fi
			const quote = yield* swapService.getQuote(quoteParams).pipe(
				Effect.mapError((e) => {
					if (e instanceof ValidationError) return e
					return new ValidationError({ message: e.message })
				}),
			)

			// Cache the quote
			cacheAgentQuote(quote.quoteId, quote, agent.id, false, {
				fromDecimals: fromTokenInfo.decimals,
				toDecimals: toTokenInfo.decimals,
			})

			// Calculate human-readable amounts
			const fromAmountHuman = parseFloat(quote.fromAmount) / 10 ** fromTokenInfo.decimals
			const toAmountHuman = parseFloat(quote.toAmount) / 10 ** toTokenInfo.decimals
			const toAmountMinHuman = parseFloat(quote.toAmountMin) / 10 ** toTokenInfo.decimals

			return {
				quote_id: quote.quoteId,
				from_chain: sourceChainInfo.name,
				from_chain_id: sourceChainInfo.id,
				to_chain: destChainInfo.name,
				to_chain_id: destChainInfo.id,
				chain_type: 'evm',
				from_token: {
					symbol: fromTokenInfo.symbol,
					address: fromTokenInfo.address,
					decimals: fromTokenInfo.decimals,
				},
				to_token: {
					symbol: toTokenInfo.symbol,
					address: toTokenInfo.address,
					decimals: toTokenInfo.decimals,
				},
				amount_in: fromAmountHuman.toString(),
				amount_out: toAmountHuman.toFixed(6),
				amount_out_min: toAmountMinHuman.toFixed(6),
				exchange_rate: quote.exchangeRate,
				price_impact: `${quote.priceImpact}%`,
				estimated_gas_usd: `$${quote.estimatedGasUsd}`,
				bridge_fee_usd: `$${quote.bridgeFeeUsd}`,
				route: quote.route,
				slippage: `${(quote.slippage * 100).toFixed(1)}%`,
				estimated_time_seconds: quote.estimatedDuration,
				expires_in_seconds: 60,
				dex: 'Li.Fi',
				// Transaction data for execution
				transaction: wallet_address
					? {
							to: quote.transactionRequest.to,
							value: quote.transactionRequest.value,
							data: quote.transactionRequest.data,
							chain_id: quote.transactionRequest.chainId,
							gas_limit: quote.transactionRequest.gasLimit,
						}
					: undefined,
			}
		}),
	)

	if (Either.isLeft(result)) {
		const { status, body } = mapErrorToResponse(result.left)
		return c.json(body, status)
	}

	return c.json({
		success: true,
		...result.right,
	})
})

// POST /v1/agent/swap - Execute a swap (returns unsigned transaction)
agentRoutes.post('/swap', async (c) => {
	const agent = c.get('agent')

	let body: unknown
	try {
		body = await c.req.json()
	} catch {
		return agentError(c, 400, 'VALIDATION_ERROR', 'Invalid JSON body')
	}

	const parsed = SwapRequestSchema.safeParse(body)
	if (!parsed.success) {
		return c.json(
			{
				success: false,
				error: 'Validation error',
				error_code: 'VALIDATION_ERROR',
				fields: formatZodErrors(parsed.error),
			},
			400,
		)
	}

	const { quote_id, wallet_address, approval_id } = parsed.data

	// Track swap attempt
	await runEffectEither(
		Effect.gen(function* () {
			const agentService = yield* AgentService
			yield* agentService.incrementAgentStats(agent.id, 'swap')
		}),
	)

	// If quote_id provided, use cached quote
	if (quote_id) {
		// getCachedQuote returns null once the TTL has elapsed (expiry handled by the
		// shared TTLCache). Reject a missing/expired quote OR one created by a different
		// agent — same generic message so an attacker can't tell "no quote" from "not
		// your quote" (cross-agent quote hijacking).
		const cached = getCachedQuote(quote_id)
		if (!cached || cached.agentId !== agent.id) {
			return c.json(
				{
					success: false,
					error: 'Quote expired or not found',
					error_code: 'QUOTE_NOT_FOUND',
					hint: 'Request a new quote using POST /v1/agent/quote',
				},
				400,
			)
		}

		const quote = cached.quote

		// --- Institutional policy gate ---
		// Evaluate the trade intent against the org's/agent's policy rules + spend
		// profile + kill switches BEFORE returning a signable tx. Enforcement is
		// hard for Suwappu-issued-key / custodial flows; advisory for a
		// self-signing EOA that could bypass this API entirely. Gated for BOTH
		// org API-key auth (apiKeyAuth) and plain agent-token auth (org-less
		// per-agent policy rows) — see PolicyService/policyGate.
		let solanaValueUsd = 0
		let priceUnavailableReason: string | undefined
		if (cached.isSolana) {
			const inputMint = quote.inputMint as string | undefined
			const priceUsd = inputMint ? await fetchMintPriceUsd(inputMint) : null
			if (priceUsd != null) {
				const decimals = cached.fromDecimals ?? 9
				const humanAmount = parseFloat(quote.inAmount ?? '0') / 10 ** decimals
				solanaValueUsd = humanAmount * priceUsd
			} else {
				// Price unresolvable — fail closed if the agent has ANY USD-denominated
				// policy rule (maxTxUsd/dailyCapUsd/sessionCapUsd/requireApprovalAboveUsd)
				// configured; otherwise (no USD rules to bypass) proceed at $0 as before.
				const orgId = (c.get('apiKeyAuth') as { orgId: string } | undefined)?.orgId ?? null
				const agentIdStr = agent.uuid ?? String(agent.id)
				const usdRulesApply = await hasUsdPolicyRules(orgId, agentIdStr)
				if (usdRulesApply) {
					priceUnavailableReason = `Solana mint price unavailable for ${inputMint ?? 'unknown mint'} — USD-denominated policy rules apply, cannot evaluate at $0`
				} else {
					writeAuditLog({
						userId: 0,
						agentId: agentIdStr,
						eventType: 'policy.solana_price_unavailable',
						details: { inputMint: inputMint ?? null, note: 'valueUsd defaulted to 0 for policy eval — no USD rules configured' },
					})
				}
			}
		}

		const gateIntent: PolicyGateIntent = cached.isSolana
			? {
					chain: 'solana',
					fromToken: quote.inputMint ?? null,
					toToken: quote.outputMint ?? null,
					valueUsd: solanaValueUsd,
					walletAddress: wallet_address ?? null,
				}
			: {
					chain: String(quote.fromChain),
					fromToken: quote.fromToken?.address ?? null,
					toToken: quote.toToken?.address ?? null,
					contractAddress: quote.transactionRequest?.to ?? null,
					valueUsd: parseFloat(quote.fromAmountUsd ?? '0') || 0,
					gasUsd: parseFloat(quote.estimatedGasUsd ?? '0') || 0,
					walletAddress: wallet_address ?? null,
				}

		// EVM ownership precondition must run BEFORE the policy gate: redemption
		// atomically consumes the approval, so any later deterministic rejection
		// would burn a human-approved authorization without executing (found in
		// live smoke test). The later in-branch check is kept as defense in depth.
		if (!cached.isSolana && !checkEvmWalletOwnership(agent, wallet_address)) {
			return c.json({ success: false, error: 'wallet_address is not your managed wallet', error_code: 'POLICY_VIOLATION' }, 403)
		}

		const policyResponse = await enforcePolicy(c, agent, gateIntent, approval_id, priceUnavailableReason)
		if (policyResponse) {
			await refundMeteredCharge(c, agent, 'blocked by policy gate')
			return policyResponse
		}

		// Handle Solana swaps
		if (cached.isSolana) {
			// Get swap transaction from Jupiter
			const result = await runEffectEither(
				Effect.gen(function* () {
					const jupiterService = yield* JupiterService

					const swapResponse = yield* jupiterService
						.getSwapTransaction({
							quote,
							userPublicKey: wallet_address,
							wrapUnwrapSOL: true,
						})
						.pipe(Effect.mapError((e) => new ValidationError({ message: e.message })))

					return swapResponse
				}),
			)

			if (Either.isLeft(result)) {
				return c.json(
					{
						success: false,
						error: 'Failed to get Solana transaction',
						error_code: 'UPSTREAM_ERROR',
						details: result.left.message,
					},
					400,
				)
			}

			const swapTx = result.right

			return c.json({
				success: true,
				status: 'ready',
				message: 'Solana transaction ready for signing',
				quote_id,
				chain: 'solana',
				swap: {
					from_token: quote.inputMint,
					to_token: quote.outputMint,
					amount_in: quote.inAmount,
					expected_amount_out: quote.outAmount,
					minimum_amount_out: quote.otherAmountThreshold,
				},
				transaction: {
					type: 'solana',
					serialized_transaction: swapTx.swapTransaction, // Base64 encoded
					last_valid_block_height: swapTx.lastValidBlockHeight,
				},
				instructions: [
					'1. Deserialize the base64 transaction',
					'2. Sign with your Solana wallet',
					'3. Submit to Solana RPC (sendTransaction)',
					'4. Monitor signature for confirmation',
				],
				explorer: 'https://solscan.io/tx/',
			})
		}

		// The EVM tx below is built with from: wallet_address, so the caller must own
		// that address (their managed wallet) — block constructing a fund-moving tx
		// from an arbitrary/victim address (C16).
		if (!checkEvmWalletOwnership(agent, wallet_address)) {
			return c.json({ success: false, error: 'wallet_address is not your managed wallet', error_code: 'POLICY_VIOLATION' }, 403)
		}

		// EVM swap - return unsigned transaction
		return c.json({
			success: true,
			status: 'ready',
			message: 'Transaction ready for signing',
			quote_id,
			chain_type: 'evm',
			swap: {
				from_chain: quote.fromChain,
				to_chain: quote.toChain,
				from_token: quote.fromToken.symbol,
				to_token: quote.toToken.symbol,
				amount_in: quote.fromAmount,
				expected_amount_out: quote.toAmount,
				minimum_amount_out: quote.toAmountMin,
			},
			transaction: {
				to: quote.transactionRequest.to,
				from: wallet_address,
				value: quote.transactionRequest.value,
				data: quote.transactionRequest.data,
				chain_id: quote.transactionRequest.chainId,
				gas_limit: quote.transactionRequest.gasLimit,
				gas_price: quote.transactionRequest.gasPrice,
			},
			instructions: [
				'1. Sign this transaction with your wallet',
				'2. Submit the signed transaction to the chain RPC',
				'3. Monitor the transaction hash for confirmation',
			],
			explorer_base_urls: {
				'1': 'https://etherscan.io/tx/',
				'10': 'https://optimistic.etherscan.io/tx/',
				'56': 'https://bscscan.com/tx/',
				'137': 'https://polygonscan.com/tx/',
				'42161': 'https://arbiscan.io/tx/',
				'8453': 'https://basescan.org/tx/',
				'43114': 'https://snowtrace.io/tx/',
			},
		})
	}

	// No quote_id - need to get a fresh quote first
	return agentError(c, 400, 'VALIDATION_ERROR', 'quote_id required', {
		hint: 'First get a quote using POST /v1/agent/quote, then pass the quote_id here',
		example: {
			step_1: 'POST /v1/agent/quote with {from_token, to_token, amount, chain, wallet_address}',
			step_2: 'POST /v1/agent/swap with {quote_id, wallet_address}',
		},
	})
})

// POST /v1/agent/swap/simulate - Tenderly-style dry run: fetch/reuse a quote and
// report balance/allowance/gas/revert checks WITHOUT signing, broadcasting, or
// persisting anything. Zero funds move. MONEY-PATH: reads live balances/quotes
// and sits next to execution paths (/swap, /swap/execute) — reviewed accordingly.
agentRoutes.post('/swap/simulate', async (c) => {
	const agent = c.get('agent')

	let body: unknown
	try {
		body = await c.req.json()
	} catch {
		return c.json({ success: false, error: 'Invalid JSON body' }, 400)
	}

	const parsed = SimulateSwapSchema.safeParse(body)
	if (!parsed.success) {
		return c.json(
			{
				success: false,
				error: 'Validation error',
				fields: formatZodErrors(parsed.error),
				hint: 'Provide quote_id, or from_token + to_token + amount (+ optional chain, wallet_address).',
			},
			400,
		)
	}

	const { quote_id, from_token, to_token, amount, chain, from_chain, to_chain, wallet_address, slippage } =
		parsed.data

	// Track request (read-only — no swap-attempt counter bump, this never executes)
	await runEffectEither(
		Effect.gen(function* () {
			const agentService = yield* AgentService
			yield* agentService.incrementAgentStats(agent.id, 'request')
		}),
	)

	// --- Case 1: simulate a previously fetched quote ---
	if (quote_id) {
		const cached = getCachedQuote(quote_id)
		// Same generic message for missing vs. cross-agent quote — avoids leaking
		// which quote_ids exist (mirrors /swap and /swap/execute).
		if (!cached || cached.agentId !== agent.id) {
			return c.json(
				{
					success: false,
					error: 'Quote expired or not found',
					hint: 'Request a new quote using POST /v1/agent/quote, or pass from_token/to_token/amount to fetch and simulate in one call',
				},
				400,
			)
		}

		if (cached.isSolana) {
			const quote = cached.quote as JupiterQuote
			const report = await buildSolanaSimulationReport({
				quoteId: quote_id,
				fromAddress: wallet_address,
				inputMint: quote.inputMint,
				outputMint: quote.outputMint,
				fromAmount: quote.inAmount,
				toAmount: quote.outAmount,
				toAmountMin: quote.otherAmountThreshold,
				priceImpactPct: quote.priceImpactPct ? parseFloat(quote.priceImpactPct) : null,
				platformFeeAmount: quote.platformFee?.amount,
			})
			return c.json(report)
		}

		const quote = cached.quote as SwapQuote
		const report = await buildEvmSimulationReport({
			quoteId: quote_id,
			fromAddress: wallet_address,
			fromTokenSymbol: quote.fromToken.symbol,
			fromTokenAddress: quote.fromToken.address,
			toTokenSymbol: quote.toToken.symbol,
			chainId: quote.transactionRequest.chainId,
			fromAmount: quote.fromAmount,
			toAmount: quote.toAmount,
			toAmountMin: quote.toAmountMin,
			toAmountUsd: quote.toAmountUsd,
			priceImpactPct: Number.isFinite(parseFloat(quote.priceImpact)) ? parseFloat(quote.priceImpact) : null,
			approvalAddress: quote._rawQuote?.estimate?.approvalAddress,
			gasEstimateUsd: quote.estimatedGasUsd,
			bridgeFeeUsd: quote.bridgeFeeUsd,
			tx: wallet_address
				? {
						to: quote.transactionRequest.to,
						data: quote.transactionRequest.data,
						value: quote.transactionRequest.value,
						from: wallet_address,
					}
				: undefined,
		})
		return c.json(report)
	}

	// --- Case 2: no quote_id — fetch a fresh quote, then simulate it ---
	if (!from_token || !to_token || !amount) {
		return c.json(
			{ success: false, error: 'quote_id is required, or from_token + to_token + amount' },
			400,
		)
	}

	const chainKey = from_chain || chain || 'ethereum'

	if (isStarknet(chainKey) || (to_chain && isStarknet(to_chain))) {
		return c.json(
			{ success: false, error: 'Starknet transactions are handled by the bot backend' },
			400,
		)
	}

	if (isSolanaChain(chainKey)) {
		const result = await runEffectEither(
			Effect.gen(function* () {
				const jupiterService = yield* JupiterService

				const fromTokenInfo = jupiterService.resolveToken(from_token)
				if (!fromTokenInfo) {
					return yield* Effect.fail(
						new ValidationError({ message: `Token not found on Solana: ${from_token}` }),
					)
				}
				const toTokenInfo = jupiterService.resolveToken(to_token)
				if (!toTokenInfo) {
					return yield* Effect.fail(
						new ValidationError({ message: `Token not found on Solana: ${to_token}` }),
					)
				}

				const amountNum = parseFloat(amount)
				if (isNaN(amountNum) || amountNum <= 0) {
					return yield* Effect.fail(new ValidationError({ message: 'Invalid amount' }))
				}
				const fromAmountLamports = BigInt(
					Math.floor(amountNum * 10 ** fromTokenInfo.decimals),
				).toString()

				const quote = yield* jupiterService
					.getQuote({
						inputMint: fromTokenInfo.address,
						outputMint: toTokenInfo.address,
						amount: fromAmountLamports,
						slippageBps: slippage ? Math.floor(slippage * 10000) : 300,
					})
					.pipe(
						Effect.mapError((e) => (e instanceof ValidationError ? e : new ValidationError({ message: e.message }))),
					)

				const quoteId = `jupiter_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
				cacheAgentQuote(quoteId, quote, agent.id, true, {
					fromDecimals: fromTokenInfo.decimals,
					toDecimals: toTokenInfo.decimals,
				})

				return { quoteId, quote }
			}),
		)

		if (Either.isLeft(result)) {
			const { status, body } = mapErrorToResponse(result.left)
			return c.json(body, status)
		}

		const { quoteId, quote } = result.right
		const report = await buildSolanaSimulationReport({
			quoteId,
			fromAddress: wallet_address,
			inputMint: quote.inputMint,
			outputMint: quote.outputMint,
			fromAmount: quote.inAmount,
			toAmount: quote.outAmount,
			toAmountMin: quote.otherAmountThreshold,
			priceImpactPct: quote.priceImpactPct ? parseFloat(quote.priceImpactPct) : null,
			platformFeeAmount: quote.platformFee?.amount,
		})
		return c.json(report)
	}

	// EVM chains - use Li.Fi (same routing as POST /quote)
	const result = await runEffectEither(
		Effect.gen(function* () {
			const tokenService = yield* TokenService
			const swapService = yield* SwapService

			const sourceChain = from_chain || chain || 'ethereum'
			const destChain = to_chain || chain || 'ethereum'

			const sourceChainInfo = tokenService.resolveChain(sourceChain)
			const destChainInfo = tokenService.resolveChain(destChain)

			if (!sourceChainInfo) {
				return yield* Effect.fail(new ValidationError({ message: `Unknown chain: ${sourceChain}` }))
			}
			if (!destChainInfo) {
				return yield* Effect.fail(new ValidationError({ message: `Unknown chain: ${destChain}` }))
			}

			const fromTokenInfo = yield* tokenService.resolveToken(from_token, sourceChainInfo.id)
			if (!fromTokenInfo) {
				return yield* Effect.fail(
					new ValidationError({ message: `Token not found: ${from_token} on ${sourceChainInfo.name}` }),
				)
			}
			const toTokenInfo = yield* tokenService.resolveToken(to_token, destChainInfo.id)
			if (!toTokenInfo) {
				return yield* Effect.fail(
					new ValidationError({ message: `Token not found: ${to_token} on ${destChainInfo.name}` }),
				)
			}

			const amountNum = parseFloat(amount)
			if (isNaN(amountNum) || amountNum <= 0) {
				return yield* Effect.fail(new ValidationError({ message: 'Invalid amount' }))
			}
			const fromAmountWei = BigInt(Math.floor(amountNum * 10 ** fromTokenInfo.decimals)).toString()

			// A placeholder sender when none is given keeps Li.Fi routing working (as
			// /quote does); the simulation checks below only run against a REAL
			// fromAddress (wallet_address), never the placeholder.
			const fromAddress = wallet_address || '0x0000000000000000000000000000000000000001'

			const quoteParams: QuoteParams = {
				fromChain: sourceChainInfo.id,
				toChain: destChainInfo.id,
				fromToken: fromTokenInfo.address,
				toToken: toTokenInfo.address,
				fromAmount: fromAmountWei,
				fromAddress,
				slippage: slippage || 0.03,
				order: 'RECOMMENDED',
				integrator: 'suwappu-agent',
			}

			const quote = yield* swapService.getQuote(quoteParams).pipe(
				Effect.mapError((e) => (e instanceof ValidationError ? e : new ValidationError({ message: e.message }))),
			)

			cacheAgentQuote(quote.quoteId, quote, agent.id, false, {
				fromDecimals: fromTokenInfo.decimals,
				toDecimals: toTokenInfo.decimals,
			})

			return quote
		}),
	)

	if (Either.isLeft(result)) {
		const { status, body } = mapErrorToResponse(result.left)
		return c.json(body, status)
	}

	const quote = result.right
	const report = await buildEvmSimulationReport({
		quoteId: quote.quoteId,
		fromAddress: wallet_address,
		fromTokenSymbol: quote.fromToken.symbol,
		fromTokenAddress: quote.fromToken.address,
		toTokenSymbol: quote.toToken.symbol,
		chainId: quote.transactionRequest.chainId,
		fromAmount: quote.fromAmount,
		toAmount: quote.toAmount,
		toAmountMin: quote.toAmountMin,
		toAmountUsd: quote.toAmountUsd,
		priceImpactPct: Number.isFinite(parseFloat(quote.priceImpact)) ? parseFloat(quote.priceImpact) : null,
		approvalAddress: quote._rawQuote?.estimate?.approvalAddress,
		gasEstimateUsd: quote.estimatedGasUsd,
		bridgeFeeUsd: quote.bridgeFeeUsd,
		tx: wallet_address
			? {
					to: quote.transactionRequest.to,
					data: quote.transactionRequest.data,
					value: quote.transactionRequest.value,
					from: wallet_address,
				}
			: undefined,
	})
	return c.json(report)
})

// POST /v1/agent/execute - Natural language command execution
agentRoutes.post('/execute', async (c) => {
	const agent = c.get('agent')

	let body: unknown
	try {
		body = await c.req.json()
	} catch {
		return agentError(c, 400, 'VALIDATION_ERROR', 'Invalid JSON body')
	}

	const parsed = ExecuteCommandSchema.safeParse(body)
	if (!parsed.success) {
		return c.json(
			{
				success: false,
				error: 'Validation error',
				error_code: 'VALIDATION_ERROR',
				fields: formatZodErrors(parsed.error),
				hint: 'Example: {"command": "swap 0.5 ETH to USDC on Base", "wallet_address": "0x..."}',
			},
			400,
		)
	}

	const { command, wallet_address } = parsed.data

	// If a wallet_address is supplied it must be the agent's own managed EVM wallet —
	// otherwise a natural-language command could carry a victim's address as the swap
	// sender (C17).
	if (wallet_address && !checkEvmWalletOwnership(agent, wallet_address)) {
		return c.json({ success: false, error: 'wallet_address is not your managed wallet', error_code: 'POLICY_VIOLATION' }, 403)
	}

	// Track request
	await runEffectEither(
		Effect.gen(function* () {
			const agentService = yield* AgentService
			yield* agentService.incrementAgentStats(agent.id, 'request')
		}),
	)

	const lowerCommand = command.toLowerCase()

	// Parse swap command
	const swapMatch = lowerCommand.match(
		/swap\s+([\d.]+)\s+(\w+)\s+(?:to|for)\s+(\w+)(?:\s+on\s+(\w+))?/,
	)

	if (swapMatch) {
		const [, amount, fromToken, toToken, chain] = swapMatch

		if (!amount || !fromToken || !toToken) {
			return agentError(c, 400, 'VALIDATION_ERROR', 'Invalid swap command format')
		}

		// Get a quote
		const result = await runEffectEither(
			Effect.gen(function* () {
				const tokenService = yield* TokenService
				const swapService = yield* SwapService

				const chainKey = chain || 'ethereum'
				const chainInfo = tokenService.resolveChain(chainKey)

				if (!chainInfo) {
					return yield* Effect.fail(
						new ValidationError({
							message: `Unknown chain: ${chainKey}`,
						}),
					)
				}

				const fromTokenInfo = yield* tokenService.resolveToken(fromToken, chainInfo.id)
				if (!fromTokenInfo) {
					return yield* Effect.fail(
						new ValidationError({
							message: `Token not found: ${fromToken}`,
						}),
					)
				}

				const toTokenInfo = yield* tokenService.resolveToken(toToken, chainInfo.id)
				if (!toTokenInfo) {
					return yield* Effect.fail(
						new ValidationError({
							message: `Token not found: ${toToken}`,
						}),
					)
				}

				const amountNum = parseFloat(amount)
				const fromAmountWei = BigInt(
					Math.floor(amountNum * 10 ** fromTokenInfo.decimals),
				).toString()
				const fromAddress = wallet_address || '0x0000000000000000000000000000000000000001'

				const quote = yield* swapService
					.getQuote({
						fromChain: chainInfo.id,
						toChain: chainInfo.id,
						fromToken: fromTokenInfo.address,
						toToken: toTokenInfo.address,
						fromAmount: fromAmountWei,
						fromAddress,
						slippage: 0.03,
						integrator: 'suwappu-agent',
					} as QuoteParams)
					.pipe(Effect.mapError((e) => new ValidationError({ message: e.message })))

				// Cache quote
				cacheAgentQuote(quote.quoteId, quote, agent.id, false, {
					fromDecimals: fromTokenInfo.decimals,
					toDecimals: toTokenInfo.decimals,
				})

				const toAmountHuman = parseFloat(quote.toAmount) / 10 ** toTokenInfo.decimals

				return {
					quote_id: quote.quoteId,
					from_token: fromTokenInfo.symbol,
					to_token: toTokenInfo.symbol,
					amount_in: amount,
					amount_out: toAmountHuman.toFixed(6),
					chain: chainInfo.name,
					chain_id: chainInfo.id,
					exchange_rate: quote.exchangeRate,
					gas_usd: quote.estimatedGasUsd,
					value_usd: quote.fromAmountUsd,
					route: quote.route,
					has_transaction: !!wallet_address,
					transaction: wallet_address
						? {
								to: quote.transactionRequest.to,
								value: quote.transactionRequest.value,
								data: quote.transactionRequest.data,
								chain_id: quote.transactionRequest.chainId,
							}
						: undefined,
				}
			}),
		)

		// Track swap attempt
		await runEffectEither(
			Effect.gen(function* () {
				const agentService = yield* AgentService
				yield* agentService.incrementAgentStats(agent.id, 'swap')
			}),
		)

		if (Either.isLeft(result)) {
			const { status, body } = mapErrorToResponse(result.left)
			return c.json({ success: false, ...body }, status)
		}

		// Gate BEFORE returning a signable transaction. No wallet_address means no
		// transaction is returned (has_transaction: false), so nothing to gate.
		if (wallet_address) {
			// This NL-command path resolves the SAME quote shape /swap uses, which
			// does carry a USD value (quote.fromAmountUsd, surfaced above as
			// result.right.value_usd) — use it. If it's genuinely unresolvable
			// (e.g. Li.Fi didn't report a USD notional for this route), fall back
			// to the shared price-fetch lib (same CoinGecko lookup /tokens.ts uses)
			// keyed off the parsed from-token symbol and amount. Only if BOTH fail
			// do we check whether the agent/org has any USD-denominated policy
			// rule and force require_approval instead of silently gating at $0.
			const parsedValueUsd = parseFloat(result.right.value_usd ?? '')
			let valueUsd = 0
			let priceUnavailableReason: string | undefined
			const agentIdStr = agent.uuid ?? String(agent.id)
			let valueSource: 'quote' | 'price_api' | 'unresolved' = 'unresolved'
			// Must be strictly positive: a 0/negative notional would evaluate real
			// trades against USD caps as $0 and skip the fail-closed path below.
			if (Number.isFinite(parsedValueUsd) && parsedValueUsd > 0) {
				valueUsd = parsedValueUsd
				valueSource = 'quote'
			} else {
				// Quote carried no USD notional — try resolving a price directly off
				// the parsed from-token symbol + amount before giving up.
				const prices = await fetchTokenPrices([fromToken])
				const priceEntry = prices[fromToken.toUpperCase()]
				const parsedAmount = parseFloat(amount)
				if (
					priceEntry?.usd != null &&
					priceEntry.usd > 0 &&
					Number.isFinite(parsedAmount) &&
					parsedAmount > 0
				) {
					valueUsd = priceEntry.usd * parsedAmount
					valueSource = 'price_api'
				} else {
					const orgId = (c.get('apiKeyAuth') as { orgId: string } | undefined)?.orgId ?? null
					const usdRulesApply = await hasUsdPolicyRules(orgId, agentIdStr)
					if (usdRulesApply) {
						priceUnavailableReason =
							'USD value unresolvable for this NL command quote — USD-denominated policy rules apply, cannot evaluate at $0'
					} else {
						writeAuditLog({
							userId: 0,
							agentId: agentIdStr,
							eventType: 'policy.price_unavailable',
							details: { note: 'valueUsd defaulted to 0 for /execute policy eval — no USD rules configured' },
						})
					}
				}
			}
			writeAuditLog({
				userId: 0,
				agentId: agentIdStr,
				eventType: 'policy.execute_value_resolved',
				details: { source: valueSource, valueUsd, fromToken, chain: chain || 'ethereum' },
			})
			const policyResponse = await enforcePolicy(
				c,
				agent,
				{
					chain: String(chain || 'ethereum'),
					valueUsd,
					gasUsd: parseFloat(result.right.gas_usd || '0') || 0,
					walletAddress: wallet_address ?? null,
				},
				undefined,
				priceUnavailableReason,
			)
			if (policyResponse) {
				await refundMeteredCharge(c, agent, 'blocked by policy gate')
				return policyResponse
			}
		}

		return c.json({
			success: true,
			action: 'swap',
			status: 'quoted',
			message: `Quote ready: ${amount} ${fromToken.toUpperCase()} -> ${result.right.amount_out} ${toToken.toUpperCase()} on ${result.right.chain}`,
			...result.right,
			next_step: wallet_address
				? 'Sign and submit the transaction to execute the swap'
				: 'Add wallet_address to get executable transaction data',
		})
	}

	// Parse quote/price command
	const quoteMatch = lowerCommand.match(
		/(?:quote|price)\s+(?:of\s+)?([\d.]+)\s+(\w+)\s+(?:to|in|for)\s+(\w+)(?:\s+on\s+(\w+))?/,
	)

	if (quoteMatch) {
		const [, amount, fromToken, toToken, chain] = quoteMatch
		if (!amount || !fromToken || !toToken) {
			return agentError(c, 400, 'VALIDATION_ERROR', 'Invalid quote command format')
		}
		// Redirect to quote endpoint logic (same as swap but different message)
		return c.json({
			success: true,
			action: 'quote',
			message: `Use POST /v1/agent/quote for detailed quotes`,
			parsed: {
				from_token: fromToken.toUpperCase(),
				to_token: toToken.toUpperCase(),
				amount,
				chain: chain || 'ethereum',
			},
		})
	}

	// Parse balance/portfolio check
	if (lowerCommand.includes('balance') || lowerCommand.includes('portfolio')) {
		if (wallet_address) {
			return c.json({
				success: true,
				action: 'portfolio',
				message: 'Use GET /v1/agent/portfolio?wallet_address=... for balance details',
				wallet_address,
			})
		}
		return c.json({
			success: true,
			action: 'portfolio',
			message: 'Portfolio check requires a wallet address. Provide wallet_address in the request.',
		})
	}

	// Unknown command
	return c.json({
		success: true,
		action: 'unknown',
		status: 'unrecognized',
		message: `Could not parse command: "${command}"`,
		supported_commands: [
			'swap <amount> <token> to <token> on <chain>',
			'quote <amount> <token> to <token>',
			'check balance',
		],
		examples: [
			'swap 0.5 ETH to USDC on base',
			'swap 100 USDC to ETH on arbitrum',
			'quote 1 ETH to USDC',
		],
	})
})

// GET /v1/agent/portfolio - Real balance fetching
agentRoutes.get('/portfolio', async (c) => {
	const agent = c.get('agent')
	const walletAddress = c.req.query('wallet_address')

	if (!walletAddress) {
		return agentError(c, 400, 'VALIDATION_ERROR', 'Missing required query parameter: wallet_address', {
			hint: 'GET /v1/agent/portfolio?wallet_address=0x...',
		})
	}

	// Only allow an agent to read its own managed wallet's balances — otherwise the
	// endpoint discloses live balances for any address and enables wallet enumeration (H9).
	if (!checkEvmWalletOwnership(agent, walletAddress)) {
		return c.json({ success: false, error: 'wallet_address is not your managed wallet', error_code: 'POLICY_VIOLATION' }, 403)
	}

	const chain = c.req.query('chain')

	// Track request
	await runEffectEither(
		Effect.gen(function* () {
			const agentService = yield* AgentService
			yield* agentService.incrementAgentStats(agent.id, 'request')
		}),
	)

	// Determine if this is a Solana address (base58, 32-44 chars, no 0x prefix)
	const isSolana = chain
		? isSolanaChain(chain)
		: !walletAddress.startsWith('0x') && walletAddress.length >= 32 && walletAddress.length <= 44
	const isEvm = chain ? !isSolanaChain(chain) : walletAddress.startsWith('0x')

	const result = await runEffectEither(
		Effect.gen(function* () {
			const balanceService = yield* BalanceService

			// Build a synthetic wallet object for BalanceService
			const wallet = {
				address: walletAddress,
				chainType: isSolana ? 'solana' : 'evm',
			} as any

			const balances = yield* balanceService
				.getWalletBalances(wallet)
				.pipe(Effect.mapError((e) => new ValidationError({ message: e.message })))

			// If a specific chain was requested, filter
			const filtered =
				chain && !isSolana
					? balances.filter((b) => b.chain.toLowerCase() === chain.toLowerCase())
					: balances

			const totalUsd = filtered.reduce((sum, b) => sum + b.usdValue, 0)

			return {
				wallet_address: walletAddress,
				wallet_type: isSolana ? 'solana' : 'evm',
				chain_filter: chain || 'all',
				total_usd: totalUsd.toFixed(2),
				balances: filtered.map((b) => ({
					symbol: b.symbol,
					name: b.name,
					chain: b.chain,
					balance: b.balance,
					usd_value: b.usdValue.toFixed(2),
				})),
			}
		}),
	)

	if (Either.isLeft(result)) {
		const { status, body } = mapErrorToResponse(result.left)
		return c.json(body, status)
	}

	return c.json({
		success: true,
		...result.right,
	})
})

// POST /v1/agent/wallets - Create agent wallet via Turnkey + internal provision
agentRoutes.post('/wallets', async (c) => {
	const agent = c.get('agent')

	const result = await runEffectEither(
		Effect.gen(function* () {
			const turnkeyService = yield* TurnkeyService

			// Create wallet for agent
			const wallet = yield* turnkeyService
				.createAgentWallet(agent.id, 'evm')
				.pipe(Effect.mapError((e) => new ValidationError({ message: e.message })))

			// Call internal Python API to provision a User + Wallet row for swap execution
			const env = yield* EnvService
			let internalUserId: number | undefined
			let internalWalletId: number | undefined

			if (env.INTERNAL_API_KEY && env.INTERNAL_API_URL) {
				const provisionResult = yield* Effect.tryPromise({
					try: async () => {
						const res = await fetch(`${env.INTERNAL_API_URL}/internal/agent/provision-wallet`, {
							method: 'POST',
							headers: {
								'Content-Type': 'application/json',
								'X-Internal-Key': env.INTERNAL_API_KEY!,
							},
							body: JSON.stringify({
								agent_uuid: agent.uuid,
								chain_type: 'evm',
								turnkey_wallet_id: wallet.walletId,
								turnkey_sub_org_id: wallet.subOrgId,
							}),
							signal: AbortSignal.timeout(15_000),
						})
						if (res.ok) {
							return (await res.json()) as { internal_user_id: number; internal_wallet_id: number }
						}
						return null
					},
					catch: () => null, // Non-fatal
				}).pipe(Effect.catchAll(() => Effect.succeed(null)))

				if (provisionResult) {
					internalUserId = provisionResult.internal_user_id
					internalWalletId = provisionResult.internal_wallet_id
				}
			}

			// Store wallet address in agent metadata
			const agentService = yield* AgentService
			const existingMetadata = (agent.metadata as Record<string, unknown>) || {}
			yield* agentService.updateAgent(agent.id, {
				metadata: {
					...existingMetadata,
					wallet_address: wallet.address,
					wallet_sub_org_id: wallet.subOrgId,
					...(internalUserId !== undefined && { internal_user_id: internalUserId }),
					...(internalWalletId !== undefined && { internal_wallet_id: internalWalletId }),
				},
			})

			return wallet
		}),
	)

	if (Either.isLeft(result)) {
		const { status, body } = mapErrorToResponse(result.left)
		return c.json(body, status)
	}

	const wallet = result.right

	return c.json(
		{
			success: true,
			wallet: {
				address: wallet.address,
				chain_type: 'evm',
				supported_chains: ['ethereum', 'polygon', 'arbitrum', 'optimism', 'base', 'bsc'],
			},
			message: 'Wallet created. Fund it to start swapping.',
		},
		201,
	)
})

// Back-compat alias — /swap/execute's call sites below were written against this
// name; behavior is identical to refundMeteredCharge (defined once, near the top
// of this file, and shared with /swap and /execute).
const refundSwapExecuteCharge = refundMeteredCharge

// POST /v1/agent/swap/execute - Managed swap execution via Python pipeline
agentRoutes.post('/swap/execute', async (c) => {
	const agent = c.get('agent')

	let body: unknown
	try {
		body = await c.req.json()
	} catch {
		await refundSwapExecuteCharge(c, agent, 'invalid JSON body')
		return agentError(c, 400, 'VALIDATION_ERROR', 'Invalid JSON body')
	}

	const parsed = ExecuteSwapSchema.safeParse(body)
	if (!parsed.success) {
		await refundSwapExecuteCharge(c, agent, 'schema validation failed')
		return c.json(
			{
				success: false,
				error: 'Validation error',
				error_code: 'VALIDATION_ERROR',
				fields: formatZodErrors(parsed.error),
			},
			400,
		)
	}

	const { quote_id, approval_id } = parsed.data

	// Check agent has a Turnkey wallet with internal IDs
	const metadata = (agent.metadata as Record<string, unknown>) || {}
	const internalUserId = metadata.internal_user_id as number | undefined
	const internalWalletId = metadata.internal_wallet_id as number | undefined
	const walletAddress = metadata.wallet_address as string | undefined

	if (!internalUserId || !internalWalletId || !walletAddress) {
		await refundSwapExecuteCharge(c, agent, 'WALLET_NOT_FOUND')
		return agentError(c, 400, 'WALLET_NOT_FOUND', 'No managed wallet found', {
			hint: 'Create a wallet first using POST /v1/agent/wallets',
		})
	}

	// Look up cached quote (getCachedQuote returns null once the TTL has elapsed).
	// Reject a missing/expired quote OR one created by a different agent — same generic
	// message so cross-agent quote hijacking can't be probed.
	const cached = getCachedQuote(quote_id)
	if (!cached || cached.agentId !== agent.id) {
		await refundSwapExecuteCharge(c, agent, 'QUOTE_NOT_FOUND')
		return agentError(c, 400, 'QUOTE_NOT_FOUND', 'Quote expired or not found', {
			hint: 'Request a new quote using POST /v1/agent/quote',
		})
	}

	const quote = cached.quote

	// Resolve decimals used to build the human-readable amounts that the Python
	// pipeline's pre-swap balance guard relies on (bot/utils/quote_validator.py).
	const { fromDecimals, toDecimals } = resolveSwapExecuteDecimals(cached)

	if (fromDecimals === undefined) {
		await refundSwapExecuteCharge(c, agent, 'unresolvable quote decimals')
		return agentError(
			c,
			422,
			'QUOTE_NOT_FOUND',
			'Unable to resolve token decimals for this quote; request a fresh quote before executing',
			{ hint: 'Request a new quote using POST /v1/agent/quote' },
		)
	}

	// Build quote_data for the Python endpoint
	const quoteData: Record<string, unknown> = cached.isSolana
		? {
				provider: 'jupiter',
				from_chain: 'solana',
				to_chain: 'solana',
				from_token: quote.inputMint,
				to_token: quote.outputMint,
				from_amount: quote.inAmount,
				from_amount_human: parseFloat(quote.inAmount) / 10 ** fromDecimals,
				to_amount: quote.outAmount,
				to_amount_human: parseFloat(quote.outAmount) / 10 ** (toDecimals ?? fromDecimals),
				to_amount_min: quote.otherAmountThreshold,
				gas_cost_usd: 0,
				fee_cost_usd: 0,
				total_cost_usd: 0,
				estimated_time: 30,
				price_impact: parseFloat(quote.priceImpactPct || '0'),
				exchange_rate: 0,
				raw_quote: quote,
			}
		: {
				provider: 'lifi',
				from_chain: quote.fromChain?.key || quote.action?.fromChainId?.toString() || 'ethereum',
				to_chain: quote.toChain?.key || quote.action?.toChainId?.toString() || 'ethereum',
				from_token: quote.fromToken?.symbol || '',
				to_token: quote.toToken?.symbol || '',
				from_amount: quote.fromAmount || '',
				from_amount_human: parseFloat(quote.fromAmount || '0') / 10 ** fromDecimals,
				to_amount: quote.toAmount || '',
				to_amount_human: parseFloat(quote.toAmount || '0') / 10 ** (toDecimals ?? fromDecimals),
				to_amount_min: quote.toAmountMin || quote.toAmount || '',
				gas_cost_usd: parseFloat(quote.estimatedGasUsd || '0'),
				fee_cost_usd: parseFloat(quote.bridgeFeeUsd || '0'),
				total_cost_usd:
					parseFloat(quote.estimatedGasUsd || '0') + parseFloat(quote.bridgeFeeUsd || '0'),
				estimated_time: quote.estimatedDuration || 60,
				price_impact: parseFloat(quote.priceImpact || '0'),
				exchange_rate: parseFloat(quote.exchangeRate || '0'),
				raw_quote: quote,
			}

	// --- Institutional policy gate ---
	// This is the ACTUAL execution path (broadcasts on-chain via the internal
	// Python endpoint below) — gate it same as /swap, using the built quoteData
	// for chain/token/USD context. Credits were already charged before this
	// handler ran (meteredPayment middleware), so a block/approval verdict must
	// refund the charge, same as every other rejection path in this handler.
	{
		let priceUnavailableReason: string | undefined
		const valueUsd = cached.isSolana
			? await (async () => {
					const inputMint = quote.inputMint as string | undefined
					const priceUsd = inputMint ? await fetchMintPriceUsd(inputMint) : null
					if (priceUsd == null) {
						// Fail closed if any USD-denominated policy rule applies to this
						// agent/org; otherwise proceed at $0 as before (no rule to bypass).
						const orgId = (c.get('apiKeyAuth') as { orgId: string } | undefined)?.orgId ?? null
						const agentIdStr = agent.uuid ?? String(agent.id)
						const usdRulesApply = await hasUsdPolicyRules(orgId, agentIdStr)
						if (usdRulesApply) {
							priceUnavailableReason = `Solana mint price unavailable for ${inputMint ?? 'unknown mint'} — USD-denominated policy rules apply, cannot evaluate at $0`
						} else {
							writeAuditLog({
								userId: 0,
								agentId: agentIdStr,
								eventType: 'policy.solana_price_unavailable',
								details: { inputMint: inputMint ?? null, note: 'valueUsd defaulted to 0 for policy eval — no USD rules configured' },
							})
						}
						return 0
					}
					return (quoteData.from_amount_human as number) * priceUsd
				})()
			: parseFloat(quote.fromAmountUsd ?? '0') || 0

		const gateIntent: PolicyGateIntent = cached.isSolana
			? {
					chain: 'solana',
					fromToken: quote.inputMint ?? null,
					toToken: quote.outputMint ?? null,
					valueUsd,
					walletAddress: walletAddress ?? null,
				}
			: {
					chain: String(quote.fromChain),
					fromToken: quote.fromToken?.address ?? null,
					toToken: quote.toToken?.address ?? null,
					contractAddress: quote.transactionRequest?.to ?? null,
					valueUsd,
					gasUsd: parseFloat(quote.estimatedGasUsd ?? '0') || 0,
					walletAddress: walletAddress ?? null,
				}

		const policyResponse = await enforcePolicy(c, agent, gateIntent, approval_id, priceUnavailableReason)
		if (policyResponse) {
			await refundSwapExecuteCharge(c, agent, 'blocked by policy gate')
			return policyResponse
		}
	}

	// Prefer a client-supplied Idempotency-Key (scoped per agent so agents can't
	// collide on each other's keys) over the derived quote_id key. This lets a
	// caller safely retry a request that timed out client-side without risking a
	// duplicate on-chain swap, even if it regenerates a fresh quote_id on retry.
	// The key embeds a fingerprint of the request (quote_id + route + amounts) so
	// reusing the same key with a DIFFERENT quote can never return a stale swap's
	// result as if it were this request's success — a mismatched reuse executes as
	// a new swap instead of silently misreporting.
	const clientIdempotencyKey = c.req.header('Idempotency-Key')?.trim()
	if (clientIdempotencyKey && !/^[A-Za-z0-9_.:-]{1,64}$/.test(clientIdempotencyKey)) {
		await refundSwapExecuteCharge(c, agent, 'invalid Idempotency-Key')
		return agentError(c, 400, 'VALIDATION_ERROR', 'Invalid Idempotency-Key', {
			hint: 'Use 1-64 characters from A-Za-z0-9_.:-',
		})
	}
	const requestFingerprint = crypto
		.createHash('sha256')
		.update(
			// Deliberately EXCLUDES quote_id: a client retrying a timed-out request
			// typically re-quotes first, so binding to quote_id would mint a new key
			// and execute a second swap — the exact duplicate this header prevents.
			// The fingerprint binds the economic terms instead, so reusing a key for a
			// genuinely different trade executes fresh rather than returning a stale swap.
			`${quoteData.from_chain}|${quoteData.to_chain}|${quoteData.from_token}|${quoteData.to_token}|${quoteData.from_amount}`,
		)
		.digest('hex')
		.slice(0, 12)
	const idempotencyKey = clientIdempotencyKey
		? `agent_${agent.id}_${clientIdempotencyKey}_${requestFingerprint}`
		: `agent_${agent.id}_${quote_id}`

	// Set when a failure leaves the swap's on-chain outcome UNKNOWN (the request may
	// have been received and broadcast). Such failures must NOT be refunded.
	let internalOutcomeUnknown = false

	// Call internal Python endpoint
	const result = await runEffectEither(
		Effect.gen(function* () {
			const env = yield* EnvService

			if (!env.INTERNAL_API_KEY || !env.INTERNAL_API_URL) {
				return yield* Effect.fail(new ValidationError({ message: 'Internal API not configured' }))
			}

			const internalUrl = env.INTERNAL_API_URL
			const internalKey = env.INTERNAL_API_KEY

			const swapResponse = yield* Effect.tryPromise({
				try: async () => {
					const res = await fetch(`${internalUrl}/internal/agent/execute-swap`, {
						method: 'POST',
						headers: {
							'Content-Type': 'application/json',
							'X-Internal-Key': internalKey,
						},
						body: JSON.stringify({
							agent_id: agent.id,
							agent_uuid: agent.uuid,
							wallet_address: walletAddress,
							internal_user_id: internalUserId,
							internal_wallet_id: internalWalletId,
							chain_type: cached.isSolana ? 'solana' : 'evm',
							idempotency_key: idempotencyKey,
							quote_data: quoteData,
						}),
						signal: AbortSignal.timeout(30_000),
					})

					if (!res.ok) {
						// A 5xx can arrive after the Python side already broadcast the tx
						// (e.g. it failed while recording the swap), so the outcome is unknown.
						// A 4xx is an explicit pre-submit rejection.
						if (res.status >= 500) internalOutcomeUnknown = true
						const errBody = (await res.json().catch(() => ({ detail: 'Unknown error' }))) as {
							detail?: string
						}
						throw new Error(errBody.detail || `Internal API error: ${res.status}`)
					}

					return (await res.json()) as { swap_id: number; tx_hash: string | null; status: string }
				},
				catch: (e) => {
					// execute-swap is synchronous through broadcast on the Python side and
					// can wait ~120s on an ERC-20 approval receipt, while this fetch aborts
					// at 30s. A timeout/abort/network error therefore does NOT mean the swap
					// didn't execute — refunding here would hand credits back for trades that
					// landed on-chain, which an agent could trigger deliberately.
					if (e instanceof Error && (e.name === 'TimeoutError' || e.name === 'AbortError')) {
						internalOutcomeUnknown = true
					} else if (e instanceof TypeError) {
						// fetch() throws TypeError for connection-level failures, which may
						// occur after the request was received and acted upon.
						internalOutcomeUnknown = true
					}
					return new ValidationError({ message: e instanceof Error ? e.message : String(e) })
				},
			})

			return swapResponse
		}),
	)

	// Track swap
	await runEffectEither(
		Effect.gen(function* () {
			const agentService = yield* AgentService
			yield* agentService.incrementAgentStats(agent.id, 'swap')
		}),
	)

	if (Either.isLeft(result)) {
		// Refund ONLY when the swap provably did not execute (misconfiguration, or an
		// explicit 4xx rejection from execute-swap). On a timeout/abort/network error or
		// a 5xx the tx may already be on-chain, so we keep the charge and log for
		// reconciliation — the idempotency key identifies the swap.
		if (internalOutcomeUnknown) {
			console.warn(
				`[swap/execute] outcome unknown for agent=${agent.id} idempotency_key=${idempotencyKey}: ${result.left.message} — charge retained, needs reconciliation`,
			)
		} else {
			await refundSwapExecuteCharge(
				c,
				agent,
				`internal execute-swap call failed pre-submit: ${result.left.message}`,
			)
		}
		const { status, body } = mapErrorToResponse(result.left)
		return c.json(body, status)
	}

	const swapResult = result.right

	return c.json({
		success: true,
		swap_id: swapResult.swap_id,
		status: swapResult.status,
		tx_hash: swapResult.tx_hash,
		tracking: {
			poll_url: `/v1/agent/swap/status/${swapResult.swap_id}`,
			webhook_note: agent.callbackUrl
				? 'You will receive webhook notifications at your callback_url'
				: 'Set callback_url via PATCH /v1/agent/me to receive webhook notifications',
		},
	})
})

// POST /v1/agent/link/code - Mint a short-lived one-time code to link this
// agent to a human Telegram owner (agents.ownerUserId). The human runs
// `/claim <code>` in the Suwappu Telegram bot, which writes ownerUserId
// directly (shared DB, cross-stack). Only the sha256 hash of the code is
// persisted — the raw code is returned exactly once and never stored.
//
// Takeover guard: if the agent already has an owner, this refuses to mint a
// new code — a re-link must go through the CURRENT owner unlinking first via
// `/unlink` in the bot. Without this, any holder of the agent's bearer token
// (e.g. a leaked key) could mint a fresh code and hijack the agent to a
// different Telegram account.
agentRoutes.post('/link/code', async (c) => {
	const agent = c.get('agent')

	if (agent.ownerUserId != null) {
		void writeAuditLog({
			userId: 0,
			agentId: agent.uuid ?? String(agent.id),
			eventType: 'agent.link_code_rejected',
			details: { reason: 'already_linked', agentId: agent.uuid ?? String(agent.id) },
			ipAddress: resolveRequestIp(c),
		})
		return agentError(
			c,
			409,
			'CONFLICT',
			'This agent is already linked to an owner. The current owner must run /unlink in the Suwappu Telegram bot before a new link code can be minted.',
		)
	}

	// 16 hex chars = 64 bits of entropy, no truncation.
	const rawCode = crypto.randomBytes(8).toString('hex').toUpperCase()
	const codeHash = crypto.createHash('sha256').update(rawCode).digest('hex')
	// Date.now() is already a UTC epoch — spelled out explicitly here since the
	// column is timestamptz and both Python and TS writers must agree on UTC.
	const expiresAt = new Date(Date.now() + 10 * 60 * 1000)

	const result = await runEffectEither(
		Effect.gen(function* () {
			const db = yield* requireDb
			yield* Effect.tryPromise({
				try: () =>
					db.insert(agentLinkCodes).values({
						agentId: agent.id,
						codeHash,
						expiresAt,
					}),
				catch: (e) => (e instanceof Error ? e : new Error(String(e))),
			})
			yield* auditLog({
				userId: 0,
				agentId: agent.uuid ?? String(agent.id),
				eventType: 'agent.link_code_minted',
				details: { agentId: agent.uuid ?? String(agent.id), expiresAt: expiresAt.toISOString() },
				ipAddress: resolveRequestIp(c),
			})
		}),
	)

	if (Either.isLeft(result)) {
		return agentError(c, 500, 'INTERNAL', 'Failed to mint link code')
	}

	return c.json({
		success: true,
		code: rawCode,
		expires_at: expiresAt.toISOString(),
		// The bot verifies this code server-side over a 5-minute-or-shorter
		// window (see expires_at) and consumes it exactly once (used_at) —
		// there is no client-side signature scheme here, just a single-use
		// hashed bearer code checked against the DB.
		instructions:
			'Run /claim <code> in the Suwappu Telegram bot within 10 minutes. The code is single-use and verified server-side.',
	})
})

// GET /v1/agent/approvals/:id - Poll a human-in-the-loop approval (SUW-204).
// The Python side owns approve/deny (Telegram) and DDL; this only reads +
// lazily expires. Minimal response — intent_json is deliberately withheld to
// avoid widening the replay surface for a leaked approval id.
agentRoutes.get('/approvals/:id', async (c) => {
	const agent = c.get('agent')
	const id = c.req.param('id')

	const result = await runEffectEither(
		Effect.gen(function* () {
			const db = yield* requireDb
			const rows = yield* Effect.tryPromise({
				try: () => db.select().from(agentApprovals).where(eq(agentApprovals.id, id)).limit(1),
				catch: (e) => (e instanceof Error ? e : new Error(String(e))),
			})
			return rows[0] ?? null
		}),
	)

	if (Either.isLeft(result)) {
		return agentError(c, 500, 'INTERNAL', 'Failed to load approval')
	}
	const row = result.right
	if (!row) {
		return agentError(c, 404, 'NOT_FOUND', 'Approval not found')
	}
	// Never leak whether an approval belongs to another agent — same 403 either
	// way, no distinguishing detail.
	if (row.agentId !== (agent.uuid ?? String(agent.id))) {
		return agentError(c, 403, 'UNAUTHORIZED', 'Approval does not belong to this agent')
	}

	let status = row.status
	let expiresAt = row.expiresAt
	if (status === 'pending' && expiresAt && expiresAt.getTime() < Date.now()) {
		status = 'expired'
		await runEffectEither(
			Effect.gen(function* () {
				const db = yield* requireDb
				yield* Effect.tryPromise({
					try: () =>
						db
							.update(agentApprovals)
							.set({ status: 'expired' })
							.where(and(eq(agentApprovals.id, id), eq(agentApprovals.status, 'pending'))),
					catch: (e) => (e instanceof Error ? e : new Error(String(e))),
				})
			}),
		)
	}

	return c.json({
		success: true,
		id: row.id,
		status,
		chain: row.chain,
		value_usd: row.valueUsd,
		created_at: row.createdAt,
		expires_at: expiresAt,
	})
})

// GET /v1/agent/swap/status/:swapId - Get swap status
agentRoutes.get('/swap/status/:swapId', async (c) => {
	const agent = c.get('agent')
	const swapId = parseInt(c.req.param('swapId'), 10)

	if (isNaN(swapId)) {
		return agentError(c, 400, 'VALIDATION_ERROR', 'Invalid swap ID')
	}

	const result = await runEffectEither(
		Effect.gen(function* () {
			const db = yield* requireDb

			const rows = yield* Effect.tryPromise({
				try: () =>
					db
						.select()
						.from(swapTransactions)
						.where(and(eq(swapTransactions.id, swapId), eq(swapTransactions.agentId, agent.id)))
						.limit(1),
				catch: (e) => new Error(`Database error: ${e}`),
			})

			const s = rows[0]
			if (!s) {
				return yield* Effect.fail(new ValidationError({ message: 'Swap not found' }))
			}
			return {
				swap_id: s.id,
				status: s.status,
				tx_hash: s.txHash,
				from_chain: s.fromChain,
				to_chain: s.toChain,
				from_token: s.fromToken,
				to_token: s.toToken,
				from_amount: s.fromAmount,
				to_amount: s.toAmount,
				error_message: s.errorMessage,
				created_at: s.createdAt,
				completed_at: s.completedAt,
			}
		}),
	)

	if (Either.isLeft(result)) {
		const { status, body } = mapErrorToResponse(result.left)
		return c.json(body, status)
	}

	return c.json({ success: true, ...result.right })
})

// GET /v1/agent/swaps - Paginated swap history for agent
agentRoutes.get('/swaps', async (c) => {
	const agent = c.get('agent')

	const statusFilter = c.req.query('status')
	const limit = Math.min(Math.max(parseInt(c.req.query('limit') || '20', 10) || 20, 1), 100)
	const offset = Math.max(parseInt(c.req.query('offset') || '0', 10) || 0, 0)

	const result = await runEffectEither(
		Effect.gen(function* () {
			const db = yield* requireDb

			const conditions = [eq(swapTransactions.agentId, agent.id)]
			if (statusFilter) {
				conditions.push(eq(swapTransactions.status, statusFilter))
			}

			const rows = yield* Effect.tryPromise({
				try: () =>
					db
						.select()
						.from(swapTransactions)
						.where(and(...conditions))
						.orderBy(desc(swapTransactions.createdAt))
						.limit(limit)
						.offset(offset),
				catch: (e) => new Error(`Database error: ${e}`),
			})

			const countRows = yield* Effect.tryPromise({
				try: () =>
					db
						.select({ count: sql<number>`count(*)` })
						.from(swapTransactions)
						.where(and(...conditions)),
				catch: (e) => new Error(`Database error: ${e}`),
			})

			const total = countRows[0]?.count ?? 0

			return {
				swaps: rows.map((s) => ({
					swap_id: s.id,
					status: s.status,
					tx_hash: s.txHash,
					from_chain: s.fromChain,
					to_chain: s.toChain,
					from_token: s.fromToken,
					to_token: s.toToken,
					from_amount: s.fromAmount,
					to_amount: s.toAmount,
					created_at: s.createdAt,
					completed_at: s.completedAt,
				})),
				pagination: {
					total,
					limit,
					offset,
					has_more: offset + limit < total,
				},
			}
		}),
	)

	if (Either.isLeft(result)) {
		const { status, body } = mapErrorToResponse(result.left)
		return c.json(body, status)
	}

	return c.json({ success: true, ...result.right })
})

// ===========================================
// TOKEN PRICES
// ===========================================

// GET /v1/agent/prices - Get token prices
agentRoutes.get('/prices', async (c) => {
	const symbolsParam = c.req.query('symbols')
	if (!symbolsParam) {
		return c.json(
			{
				success: false,
				error: 'Missing required query parameter: symbols',
				error_code: 'VALIDATION_ERROR',
				hint: 'GET /v1/agent/prices?symbols=ETH,SOL,USDC',
				supported: Object.keys(COINGECKO_IDS).map((s) => s.toUpperCase()),
			},
			400,
		)
	}

	const symbols = symbolsParam
		.split(',')
		.map((s) => s.trim())
		.filter(Boolean)
	if (symbols.length === 0 || symbols.length > 20) {
		return c.json(
			{
				success: false,
				error: 'Provide 1-20 comma-separated symbols',
				error_code: 'VALIDATION_ERROR',
			},
			400,
		)
	}

	const prices = await fetchTokenPrices(symbols)
	const unknownSymbols = symbols.filter((s) => !prices[s.toUpperCase()]).map((s) => s.toUpperCase())

	return c.json({
		success: true,
		prices,
		...(unknownSymbols.length > 0 && { unknown_symbols: unknownSymbols }),
	})
})

// ===========================================
// TOKEN SEARCH / LISTING
// ===========================================

// GET /v1/agent/tokens - List available tokens per chain
agentRoutes.get('/tokens', async (c) => {
	const chainParam = c.req.query('chain')
	const searchParam = c.req.query('search')?.toUpperCase()

	const buildTokenList = (chainId: number, tokens: Record<string, string>) => {
		let entries = Object.entries(tokens).map(([symbol, address]) => ({
			symbol,
			address,
			decimals: symbol === 'USDC' || symbol === 'USDT' || symbol.includes('USDC') ? 6 : 18,
		}))
		if (searchParam) {
			entries = entries.filter((t) => t.symbol.includes(searchParam))
		}
		return entries
	}

	if (chainParam) {
		const lower = chainParam.toLowerCase().trim()

		// Handle Solana
		if (lower === 'solana' || lower === 'sol') {
			let tokens = Object.entries(SOLANA_TOKENS).map(([symbol, info]) => ({
				symbol,
				address: info.address,
				decimals: info.decimals,
			}))
			if (searchParam) {
				tokens = tokens.filter((t) => t.symbol.includes(searchParam))
			}
			return c.json({
				success: true,
				chain: 'Solana',
				chain_id: 'solana',
				tokens,
			})
		}

		// EVM chain
		const chainInfo = CHAINS[lower]
		if (!chainInfo) {
			return c.json(
				{
					success: false,
					error: `Unknown chain: ${chainParam}`,
					error_code: 'CHAIN_UNSUPPORTED',
					supported: [...new Set(Object.values(CHAINS).map((c) => c.key)), 'solana'],
				},
				400,
			)
		}

		const chainTokens = COMMON_TOKENS[chainInfo.id] || {}
		return c.json({
			success: true,
			chain: chainInfo.name,
			chain_id: chainInfo.id,
			tokens: buildTokenList(chainInfo.id, chainTokens),
		})
	}

	// No chain param — return all
	const chains: Array<{
		chain: string
		chain_id: number | string
		tokens: Array<{ symbol: string; address: string; decimals: number }>
	}> = []

	for (const [chainId, tokens] of Object.entries(COMMON_TOKENS)) {
		const id = parseInt(chainId, 10)
		const name = CHAIN_NAMES[id] || `Chain ${id}`
		chains.push({
			chain: name,
			chain_id: id,
			tokens: buildTokenList(id, tokens),
		})
	}

	// Add Solana
	let solanaTokens = Object.entries(SOLANA_TOKENS).map(([symbol, info]) => ({
		symbol,
		address: info.address,
		decimals: info.decimals,
	}))
	if (searchParam) {
		solanaTokens = solanaTokens.filter((t) => t.symbol.includes(searchParam))
	}
	chains.push({ chain: 'Solana', chain_id: 'solana' as any, tokens: solanaTokens })

	return c.json({ success: true, chains })
})

// ===========================================
// WALLETS (GET)
// ===========================================

// GET /v1/agent/wallets - List agent wallets
agentRoutes.get('/wallets', async (c) => {
	const agent = c.get('agent')
	const metadata = (agent.metadata as Record<string, unknown>) || {}
	const walletAddress = metadata.wallet_address as string | undefined

	if (!walletAddress) {
		return c.json({
			success: true,
			wallets: [],
			hint: 'Create a wallet with POST /v1/agent/wallets',
		})
	}

	return c.json({
		success: true,
		wallets: [
			{
				address: walletAddress,
				chain_type: 'evm',
				supported_chains: [
					'ethereum',
					'polygon',
					'arbitrum',
					'optimism',
					'base',
					'bsc',
					'avalanche',
				],
			},
		],
	})
})

// ===========================================
// WALLET POLICIES (Turnkey)
// ===========================================

// Agent-created policies are name-prefixed so the delete endpoint can distinguish
// them from admin/guardrail policies (spending caps, whitelists) that an agent must
// not be able to remove.
const AGENT_POLICY_PREFIX = 'agent-'

// POST /v1/agent/wallet/policy - Create a Turnkey policy for agent wallet
agentRoutes.post('/wallet/policy', async (c) => {
	const agent = c.get('agent')
	const body = await c.req.json()
	const parsed = CreatePolicySchema.safeParse(body)
	if (!parsed.success) {
		return agentError(c, 400, 'VALIDATION_ERROR', 'Invalid request', { details: formatZodErrors(parsed.error) })
	}

	const metadata = (agent.metadata || {}) as Record<string, unknown>
	const subOrgId = metadata.wallet_sub_org_id as string
	if (!subOrgId) {
		return agentError(c, 400, 'WALLET_NOT_FOUND', 'No managed wallet found', { hint: 'Create a wallet first' })
	}

	const { type, params } = parsed.data

	const result = await runEffectEither(
		Effect.gen(function* () {
			const turnkeyService = yield* TurnkeyService

			if (type === 'spending_limit') {
				const condition = `eth.value <= ${params.maxAmountWei}`
				const policyId = yield* turnkeyService.createPolicy(
					subOrgId,
					`${AGENT_POLICY_PREFIX}spending-limit-${params.timeWindowSeconds}s`,
					'EFFECT_DENY',
					condition,
				)
				return { policyId, type, condition }
			} else {
				const addresses = params.allowedAddresses!.map(a => `"${a.toLowerCase()}"`).join(', ')
				const condition = `eth.tx.to in [${addresses}]`
				const policyId = yield* turnkeyService.createPolicy(
					subOrgId,
					`${AGENT_POLICY_PREFIX}whitelist-${params.allowedAddresses!.length}`,
					'EFFECT_ALLOW',
					condition,
				)
				return { policyId, type, condition }
			}
		})
	)

	if (Either.isLeft(result)) {
		return agentError(c, 500, 'INTERNAL', result.left.message)
	}

	return c.json({ success: true, policy: result.right })
})

// GET /v1/agent/wallet/policies - List policies for agent wallet
agentRoutes.get('/wallet/policies', async (c) => {
	const agent = c.get('agent')
	const metadata = (agent.metadata || {}) as Record<string, unknown>
	const subOrgId = metadata.wallet_sub_org_id as string
	if (!subOrgId) {
		return agentError(c, 400, 'WALLET_NOT_FOUND', 'No managed wallet found', { hint: 'Create a wallet first' })
	}

	const result = await runEffectEither(
		Effect.gen(function* () {
			const turnkeyService = yield* TurnkeyService
			return yield* turnkeyService.listPolicies(subOrgId)
		})
	)

	if (Either.isLeft(result)) {
		return agentError(c, 500, 'INTERNAL', result.left.message)
	}

	return c.json({ success: true, policies: result.right })
})

// DELETE /v1/agent/wallet/policy/:policyId - Delete a policy
agentRoutes.delete('/wallet/policy/:policyId', async (c) => {
	const agent = c.get('agent')
	const policyId = c.req.param('policyId')
	const metadata = (agent.metadata || {}) as Record<string, unknown>
	const subOrgId = metadata.wallet_sub_org_id as string
	if (!subOrgId) {
		return agentError(c, 400, 'WALLET_NOT_FOUND', 'No managed wallet found', { hint: 'Create a wallet first' })
	}

	const result = await runEffectEither(
		Effect.gen(function* () {
			const turnkeyService = yield* TurnkeyService
			// Only allow deleting agent-created policies. An agent must not be able to
			// remove admin/guardrail policies (spending caps, address whitelists) on its
			// own sub-org and then swap freely. Identify by the agent name-prefix.
			const policies = yield* turnkeyService.listPolicies(subOrgId)
			const target = policies.find((p) => p.policyId === policyId)
			if (!target) {
				return yield* Effect.fail(new ValidationError({ message: 'Policy not found' }))
			}
			if (!target.policyName.startsWith(AGENT_POLICY_PREFIX)) {
				return yield* Effect.fail(
					new ValidationError({ message: 'Cannot delete a protected (non-agent) policy' }),
				)
			}
			return yield* turnkeyService.deletePolicy(subOrgId, policyId)
		})
	)

	if (Either.isLeft(result)) {
		const { status, body } = mapErrorToResponse(result.left)
		return c.json(body, status)
	}

	return c.json({ success: true, deleted: true })
})

// ===========================================
// WEBHOOK EVENTS
// ===========================================

// GET /v1/agent/webhooks - List webhook events
agentRoutes.get('/webhooks', async (c) => {
	const agent = c.get('agent')

	const parsed = WebhookEventsQuerySchema.safeParse(c.req.query())
	if (!parsed.success) {
		return c.json(
			{
				success: false,
				error: 'Validation error',
				error_code: 'VALIDATION_ERROR',
				fields: formatZodErrors(parsed.error),
			},
			400,
		)
	}

	const { status, event_type, limit, offset } = parsed.data

	const result = await runEffectEither(
		Effect.gen(function* () {
			const db = yield* requireDb

			const conditions = [eq(webhookEvents.agentId, agent.id)]
			if (status) {
				conditions.push(eq(webhookEvents.status, status))
			}
			if (event_type) {
				conditions.push(eq(webhookEvents.eventType, event_type))
			}

			const rows = yield* Effect.tryPromise({
				try: () =>
					db
						.select()
						.from(webhookEvents)
						.where(and(...conditions))
						.orderBy(desc(webhookEvents.createdAt))
						.limit(limit)
						.offset(offset),
				catch: (e) => new Error(`Database error: ${e}`),
			})

			const countRows = yield* Effect.tryPromise({
				try: () =>
					db
						.select({ count: sql<number>`count(*)` })
						.from(webhookEvents)
						.where(and(...conditions)),
				catch: (e) => new Error(`Database error: ${e}`),
			})

			const total = countRows[0]?.count ?? 0

			return {
				events: rows.map((ev) => ({
					id: ev.id,
					event_type: ev.eventType,
					status: ev.status,
					attempts: ev.attempts,
					last_error: ev.lastError,
					response_status: ev.responseStatus,
					callback_url: ev.callbackUrl,
					created_at: ev.createdAt,
					delivered_at: ev.deliveredAt,
				})),
				pagination: {
					total,
					limit,
					offset,
					has_more: offset + limit < total,
				},
			}
		}),
	)

	if (Either.isLeft(result)) {
		const { status: errStatus, body } = mapErrorToResponse(result.left)
		return c.json(body, errStatus)
	}

	return c.json({ success: true, ...result.right })
})

// POST /v1/agent/webhooks/test - Test webhook delivery
agentRoutes.post('/webhooks/test', async (c) => {
	const agent = c.get('agent')

	if (!agent.callbackUrl) {
		return agentError(c, 400, 'VALIDATION_ERROR', 'No callback_url configured', {
			hint: 'Set callback_url via PATCH /v1/agent/me first',
		})
	}

	// Extract raw API key from Authorization header for signing
	const rawApiKey = c.req.header('Authorization')!.slice(7)
	const signingKey = crypto.createHash('sha256').update(rawApiKey).digest()

	const testPayload = {
		event: 'webhook.test',
		timestamp: new Date().toISOString(),
		data: {
			message: 'Test webhook from Suwappu',
			agent_id: agent.uuid,
		},
	}

	const jsonBody = JSON.stringify(testPayload)
	const deliveryId = crypto.randomUUID()
	const timestamp = Math.floor(Date.now() / 1000).toString()
	const signature = crypto.createHmac('sha256', signingKey).update(jsonBody).digest('hex')

	// Re-validate the stored callback URL right before fetching so a URL that now
	// points at a private/metadata endpoint returns a clean 400 (policy error)
	// rather than a generic connection failure.
	try {
		await assertUrlSafeForFetch(agent.callbackUrl)
	} catch (err) {
		return c.json(
			{
				success: false,
				callback_url: agent.callbackUrl,
				error: err instanceof Error ? err.message : 'callback_url is not allowed',
			},
			400,
		)
	}

	// safeFetch re-resolves+validates and PINS the socket to that exact vetted IP,
	// so the HTTP client cannot re-resolve to a freshly-rebound private address
	// (closes the TOCTOU DNS-rebinding window left by validate-then-fetch).
	const startTime = Date.now()
	try {
		const res = await safeFetch(agent.callbackUrl, {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				'X-Suwappu-Event': 'webhook.test',
				'X-Suwappu-Delivery': deliveryId,
				'X-Suwappu-Timestamp': timestamp,
				'X-Suwappu-Signature': signature,
			},
			body: jsonBody,
			timeoutMs: 10000,
		})

		return c.json({
			success: true,
			callback_url: agent.callbackUrl,
			status_code: res.status,
			response_time_ms: Date.now() - startTime,
		})
	} catch (err) {
		return c.json({
			success: false,
			callback_url: agent.callbackUrl,
			error: err instanceof Error ? err.message : 'Connection failed',
			response_time_ms: Date.now() - startTime,
		})
	}
})

// ===========================================
// API KEY ROTATION
// ===========================================

// POST /v1/agent/keys/rotate - Rotate API key
agentRoutes.post('/keys/rotate', async (c) => {
	const agent = c.get('agent')

	const result = await runEffectEither(
		Effect.gen(function* () {
			const agentService = yield* AgentService
			return yield* agentService.rotateApiKey(agent.id)
		}),
	)

	if (Either.isLeft(result)) {
		const { status, body } = mapErrorToResponse(result.left)
		return c.json(body, status)
	}

	return c.json({
		success: true,
		api_key: result.right.apiKey,
		message: 'API key rotated. Save this key — the old key is now invalid.',
	})
})

// ===========================================
// AGENT LIFECYCLE
// ===========================================

// POST /v1/agent/me/deactivate - Deactivate agent
agentRoutes.post('/me/deactivate', async (c) => {
	const agent = c.get('agent')

	const result = await runEffectEither(
		Effect.gen(function* () {
			const agentService = yield* AgentService
			return yield* agentService.deactivateAgent(agent.id)
		}),
	)

	if (Either.isLeft(result)) {
		const { status, body } = mapErrorToResponse(result.left)
		return c.json(body, status)
	}

	return c.json({
		success: true,
		message: 'Agent deactivated. Use POST /v1/agent/reactivate to restore.',
	})
})

// POST /v1/agent/reactivate - Reactivate agent (uses allow-inactive auth)
agentRoutes.post('/reactivate', async (c) => {
	const agent = c.get('agent')

	if (agent.isActive) {
		return c.json({
			success: true,
			message: 'Agent is already active.',
		})
	}

	const result = await runEffectEither(
		Effect.gen(function* () {
			const agentService = yield* AgentService
			return yield* agentService.reactivateAgent(agent.id)
		}),
	)

	if (Either.isLeft(result)) {
		const { status, body } = mapErrorToResponse(result.left)
		return c.json(body, status)
	}

	return c.json({
		success: true,
		message: 'Agent reactivated.',
	})
})

// DELETE /v1/agent/me - Permanently delete agent
agentRoutes.delete('/me', async (c) => {
	const agent = c.get('agent')

	const result = await runEffectEither(
		Effect.gen(function* () {
			const agentService = yield* AgentService
			yield* agentService.deleteAgent(agent.id)
		}),
	)

	if (Either.isLeft(result)) {
		const { status, body } = mapErrorToResponse(result.left)
		return c.json(body, status)
	}

	return c.body(null, 204)
})

// ===========================================
// BILLING / PAY-PER-CALL METERING
// ===========================================

const BYPASS_TIERS_DOC = Array.from(BYPASS_TIERS)

// GET /v1/agent/billing - Current credit balance, usage, tier, cost weights
agentRoutes.get('/billing', async (c) => {
	const agent = c.get('agent')

	const result = await runEffectEither(
		Effect.gen(function* () {
			const env = yield* EnvService
			const db = yield* requireDb
			const rows = yield* Effect.tryPromise({
				try: () =>
					db.select().from(agentCredits).where(eq(agentCredits.agentId, agent.id)).limit(1),
				catch: (e) => new Error(`Database error: ${e}`),
			})
			return { credit: rows[0] ?? null, meteringEnabled: env.AGENT_METERING_ENABLED === 'true' }
		}),
	)

	if (Either.isLeft(result)) {
		const { status, body } = mapErrorToResponse(result.left)
		return c.json(body, status)
	}

	const { credit, meteringEnabled } = result.right
	const tier = agent.rateLimitTier || 'free'

	return c.json({
		success: true,
		agent_id: agent.uuid,
		tier,
		metering_enabled: meteringEnabled,
		// Tiers that bypass metering entirely (treated as paid / active subscription).
		bypass_tiers: BYPASS_TIERS_DOC,
		is_metered: !BYPASS_TIERS_DOC.includes(tier),
		credits: {
			balance: credit?.balance ?? 0,
			lifetime_purchased: credit?.lifetimePurchased ?? 0,
			lifetime_used: credit?.lifetimeUsed ?? 0,
		},
		credit_usd_value: CREDIT_USD_VALUE,
		cost_weights: COST_WEIGHTS,
		topup: {
			endpoint: 'POST /v1/agent/billing/topup',
			body: { txHash: '0x...', chain: 'base', amount: '<USDC amount paid>' },
			note: '1 credit ≈ $0.001 USD. Pay USDC to the collector address, then submit the txHash here.',
		},
		subscribe: {
			endpoint: 'POST /v1/agent/billing/subscribe',
			body: { txHash: '0x...', chain: 'base', amount: '<USDC paid>', tier: 'pro' },
			tier_prices_usd: TIER_PRICES_USD,
			period_days: SUBSCRIPTION_PERIOD_DAYS,
			note: 'Pay the tier price in USDC to the collector, then submit the txHash. Grants a PREPAID access window (no auto-renew) of unmetered API + MCP access; re-POST before expiry to extend (time stacks).',
			auto_renew: false,
			active: agent.subscriptionTier && agent.subscriptionExpiresAt && new Date(agent.subscriptionExpiresAt).getTime() > Date.now()
				? { tier: agent.subscriptionTier, expires_at: agent.subscriptionExpiresAt }
				: null,
		},
	})
})

// POST /v1/agent/billing/topup - Credit the agent's balance from an on-chain USDC payment.
// Idempotent on txHash (no double-credit). Body: { txHash, chain, amount }.
agentRoutes.post('/billing/topup', async (c) => {
	const agent = c.get('agent')

	let body: unknown
	try {
		body = await c.req.json()
	} catch {
		return agentError(c, 400, 'VALIDATION_ERROR', 'Invalid JSON body')
	}

	const parsed = TopupSchema.safeParse(body)
	if (!parsed.success) {
		return c.json(
			{ success: false, error: 'Validation error', error_code: 'VALIDATION_ERROR', fields: formatZodErrors(parsed.error) },
			400,
		)
	}

	const { txHash, chain, amount } = parsed.data
	if (!Number.isFinite(amount) || amount <= 0) {
		return c.json(
			{ success: false, error: 'amount must be a positive number (USDC)', error_code: 'VALIDATION_ERROR' },
			400,
		)
	}

	const result = await runEffectEither(
		Effect.gen(function* () {
			const env = yield* EnvService
			const db = yield* requireDb

			// 1) Fast idempotency pre-check: already processed this txHash?
			const existing = yield* Effect.tryPromise({
				try: () =>
					db
						.select()
						.from(agentCreditTopups)
						.where(eq(agentCreditTopups.txHash, txHash))
						.limit(1),
				catch: (e) => new Error(`Database error: ${e}`),
			})
			if (existing[0]) {
				const balRows = yield* Effect.tryPromise({
					try: () =>
						db.select().from(agentCredits).where(eq(agentCredits.agentId, agent.id)).limit(1),
					catch: (e) => new Error(`Database error: ${e}`),
				})
				return {
					alreadyProcessed: true as const,
					creditsAdded: existing[0].creditsAdded,
					balance: balRows[0]?.balance ?? 0,
				}
			}

			// 2) Verify the on-chain USDC payment via the internal Python x402 verifier
			//    (same path mppAuth uses). If the internal API isn't configured, fail closed —
			//    we must never credit an unverified payment.
			if (!env.INTERNAL_API_KEY || !env.INTERNAL_API_URL) {
				return yield* Effect.fail(
					new ValidationError({ message: 'Payment verification is not configured' }),
				)
			}
			const collector = env.AGENT_METERING_COLLECTOR_ADDRESS || env.FEE_WALLET_EVM
			const internalUrl = env.INTERNAL_API_URL
			const internalKey = env.INTERNAL_API_KEY

			const verification = yield* Effect.tryPromise({
				try: () =>
					verifyX402Payment({
						internalUrl,
						internalKey,
						txHash,
						chain,
						expectedAmount: String(amount),
						expectedToken: 'USDC',
						expectedRecipient: collector,
					}),
				catch: (e) =>
					new ValidationError({ message: e instanceof Error ? e.message : String(e) }),
			})
			if (!verification.verified) {
				return yield* Effect.fail(
					new ValidationError({ message: verification.error || 'Payment not verified on-chain' }),
				)
			}

			// 2b) Sender-spoof defense: the on-chain payer MUST be this agent's own
			//     managed wallet. Otherwise an agent could credit itself with another
			//     user's inbound payment txHash.
			if (!assertSenderBound(verification.sender, [getAgentWalletAddress(agent)])) {
				return yield* Effect.fail(
					new ValidationError({
						message:
							'Payment sender does not match your managed wallet (sender-spoof rejected).',
					}),
				)
			}

			// 3) Credit atomically + idempotently inside a transaction. Consume the
			//    payment in the SHARED (chain, txHash) ledger FIRST — this is the global
			//    replay / cross-table double-redeem guard. If it's already consumed
			//    (any path) or a concurrent request wins the race, we credit nothing.
			const creditsAdded = amount / CREDIT_USD_VALUE

			const txResult = yield* Effect.tryPromise({
				try: () =>
					db.transaction(async (tx) => {
						const consumed = await consumePayment(tx, {
							chain,
							txHash,
							purpose: 'agent_topup',
							consumedBy: String(agent.id),
						})
						if (!consumed) {
							const balRows = await tx
								.select()
								.from(agentCredits)
								.where(eq(agentCredits.agentId, agent.id))
								.limit(1)
							return { credited: false, balance: balRows[0]?.balance ?? 0 }
						}

						const inserted = await tx
							.insert(agentCreditTopups)
							.values({ agentId: agent.id, txHash, chain, amountUsd: amount, creditsAdded })
							.onConflictDoNothing({ target: agentCreditTopups.txHash })
							.returning({ id: agentCreditTopups.id })

						if (inserted.length === 0) {
							// Lost the race — another request already processed this txHash.
							const balRows = await tx
								.select()
								.from(agentCredits)
								.where(eq(agentCredits.agentId, agent.id))
								.limit(1)
							return { credited: false, balance: balRows[0]?.balance ?? 0 }
						}

						// Upsert the credit balance (create row if first topup).
						const upserted = await tx
							.insert(agentCredits)
							.values({
								agentId: agent.id,
								balance: creditsAdded,
								lifetimePurchased: creditsAdded,
								lifetimeUsed: 0,
							})
							.onConflictDoUpdate({
								target: agentCredits.agentId,
								set: {
									balance: sql`${agentCredits.balance} + ${creditsAdded}`,
									lifetimePurchased: sql`${agentCredits.lifetimePurchased} + ${creditsAdded}`,
									updatedAt: new Date(),
								},
							})
							.returning({ balance: agentCredits.balance })

						return { credited: true, balance: upserted[0]?.balance ?? creditsAdded }
					}),
				catch: (e) => new Error(`Database error during topup: ${e}`),
			})

			// Normalize BOTH "already done" cases to a single idempotent no-op success
			// shape: the fast-path pre-check (existing topup row) AND the consume-loss /
			// race branches (credited:false) collapse to alreadyProcessed=true with
			// creditsAdded=0. The caller renders this as a success ("already credited"),
			// NOT a spurious error — a lost replay/race is a no-op, not a failure.
			return {
				alreadyProcessed: !txResult.credited,
				creditsAdded: txResult.credited ? creditsAdded : 0,
				balance: txResult.balance,
			}
		}),
	)

	if (Either.isLeft(result)) {
		const { status, body } = mapErrorToResponse(result.left)
		return c.json(body, status)
	}

	const r = result.right
	return c.json({
		success: true,
		already_processed: r.alreadyProcessed,
		tx_hash: txHash,
		credits_added: r.creditsAdded,
		balance: r.balance,
		message: r.alreadyProcessed
			? 'This transaction was already credited (idempotent — no double-credit).'
			: `Credited ${r.creditsAdded} credits.`,
	})
})

// POST /v1/agent/billing/subscribe - Crypto-native subscription.
// Verifies an on-chain USDC payment >= the tier price and grants the agent a
// metering-bypass tier for SUBSCRIPTION_PERIOD_DAYS. Idempotent on txHash.
// Body: { txHash, chain, amount (USDC paid), tier }.
const SubscribeSchema = z.object({
	txHash: z.string().min(4).max(128),
	chain: z.string().min(2).max(32).default('base'),
	amount: z.number().positive(),
	tier: z.enum(['pro', 'premium', 'enterprise']),
})

agentRoutes.post('/billing/subscribe', async (c) => {
	const agent = c.get('agent')

	let body: unknown
	try {
		body = await c.req.json()
	} catch {
		return agentError(c, 400, 'VALIDATION_ERROR', 'Invalid JSON body')
	}

	const parsed = SubscribeSchema.safeParse(body)
	if (!parsed.success) {
		return c.json(
			{ success: false, error: 'Validation error', error_code: 'VALIDATION_ERROR', fields: formatZodErrors(parsed.error) },
			400,
		)
	}

	const { txHash, chain, amount, tier } = parsed.data
	const price = TIER_PRICES_USD[tier]
	if (price === undefined) {
		return c.json({ success: false, error: `Unknown tier: ${tier}`, error_code: 'VALIDATION_ERROR', purchasable: PURCHASABLE_TIERS }, 400)
	}
	if (amount + 1e-9 < price) {
		return c.json(
			{
				success: false,
				error: `Insufficient payment: ${tier} costs $${price}/30d, paid $${amount}`,
				error_code: 'INSUFFICIENT_CREDITS',
			},
			400,
		)
	}

	const result = await runEffectEither(
		Effect.gen(function* () {
			const env = yield* EnvService
			const db = yield* requireDb

			// 1) Fast idempotency pre-check on the funding tx.
			const existing = yield* Effect.tryPromise({
				try: () =>
					db.select().from(agentSubscriptions).where(eq(agentSubscriptions.txHash, txHash)).limit(1),
				catch: (e) => new Error(`Database error: ${e}`),
			})
			if (existing[0]) {
				return {
					alreadyProcessed: true as const,
					tier: existing[0].tier,
					expiresAt: existing[0].expiresAt,
				}
			}

			// 2) Verify the on-chain payment via the internal Python verifier.
			//    Fail closed if not configured — never grant an unverified sub.
			if (!env.INTERNAL_API_KEY || !env.INTERNAL_API_URL) {
				return yield* Effect.fail(
					new ValidationError({ message: 'Payment verification is not configured' }),
				)
			}
			const collector = env.AGENT_METERING_COLLECTOR_ADDRESS || env.FEE_WALLET_EVM
			const internalUrl = env.INTERNAL_API_URL
			const internalKey = env.INTERNAL_API_KEY

			const verification = yield* Effect.tryPromise({
				try: () =>
					verifyX402Payment({
						internalUrl,
						internalKey,
						txHash,
						chain,
						expectedAmount: String(price),
						expectedToken: 'USDC',
						expectedRecipient: collector,
					}),
				catch: (e) => new ValidationError({ message: e instanceof Error ? e.message : String(e) }),
			})
			if (!verification.verified) {
				return yield* Effect.fail(
					new ValidationError({ message: verification.error || 'Payment not verified on-chain' }),
				)
			}

			// 2b) Sender-spoof defense: on-chain payer must be this agent's managed wallet.
			if (!assertSenderBound(verification.sender, [getAgentWalletAddress(agent)])) {
				return yield* Effect.fail(
					new ValidationError({
						message:
							'Payment sender does not match your managed wallet (sender-spoof rejected).',
					}),
				)
			}

			// 3) Grant atomically + idempotently. The ledger row's UNIQUE txHash is the
			//    idempotency guard; we also denormalize the active window onto the agent
			//    row so auth-time tier resolution needs no join.
			const now = new Date()
			// Prepaid access WINDOW (no auto-renew): if a paid window is still active,
			// extend from its current expiry so early renewal never burns paid time.
			const currentRows = yield* Effect.tryPromise({
				try: () =>
					db
						.select({ expiresAt: agentSubscriptions.expiresAt })
						.from(agentSubscriptions)
						.where(eq(agentSubscriptions.agentId, agent.id))
						.limit(1),
				catch: (e) => new Error(`Database error: ${e}`),
			})
			const currentExpiry = currentRows[0]?.expiresAt
			const base =
				currentExpiry && new Date(currentExpiry).getTime() > now.getTime()
					? new Date(currentExpiry)
					: now
			const expiresAt = new Date(base.getTime() + SUBSCRIPTION_PERIOD_DAYS * 24 * 60 * 60 * 1000)

			const txResult = yield* Effect.tryPromise({
				try: () =>
					db.transaction(async (tx) => {
						// Consume the payment in the SHARED (chain, txHash) ledger FIRST —
						// global replay / cross-table double-redeem guard. Note the
						// agent_subscriptions row is keyed by agentId (upserted on renew),
						// so its own txHash uniqueness does NOT stop the same payment being
						// reused for a topup or a webapp sub; this ledger does.
						const consumed = await consumePayment(tx, {
							chain,
							txHash,
							purpose: 'agent_subscribe',
							consumedBy: String(agent.id),
						})
						if (!consumed) {
							return { granted: false as const }
						}

						const inserted = await tx
							.insert(agentSubscriptions)
							.values({ agentId: agent.id, tier, txHash, chain, amountUsd: amount, startedAt: now, expiresAt })
							.onConflictDoUpdate({
								// Renew/upgrade: one active row per agent.
								target: agentSubscriptions.agentId,
								set: { tier, txHash, chain, amountUsd: amount, startedAt: now, expiresAt },
							})
							.returning({ id: agentSubscriptions.id })

						if (inserted.length === 0) {
							return { granted: false as const }
						}

						await tx
							.update(agents)
							.set({ subscriptionTier: tier, subscriptionExpiresAt: expiresAt, updatedAt: now })
							.where(eq(agents.id, agent.id))

						return { granted: true as const }
					}),
				catch: (e) => {
					// A unique-violation on txHash means a concurrent request won the race.
					const msg = String(e)
					if (msg.includes('unique') || msg.includes('duplicate')) {
						return new ValidationError({ message: 'duplicate_tx' })
					}
					return new Error(`Database error during subscribe: ${e}`)
				},
			})

			return { alreadyProcessed: !txResult.granted, tier, expiresAt }
		}),
	)

	if (Either.isLeft(result)) {
		// Treat a lost idempotency race as success (already granted).
		if (result.left instanceof ValidationError && result.left.message === 'duplicate_tx') {
			return c.json({ success: true, already_processed: true, tier, message: 'Already subscribed (idempotent).' })
		}
		const { status, body } = mapErrorToResponse(result.left)
		return c.json(body, status)
	}

	const r = result.right
	return c.json({
		success: true,
		already_processed: r.alreadyProcessed,
		tx_hash: txHash,
		tier: r.tier,
		expires_at: r.expiresAt,
		auto_renew: false,
		renew: 'Prepaid window — re-POST before expiry to extend; time stacks.',
		message: r.alreadyProcessed
			? 'This transaction was already credited (idempotent — no double-grant).'
			: `Prepaid ${r.tier} access window active until ${new Date(r.expiresAt).toISOString()} (no auto-renew). Metered API + MCP calls are free for the window.`,
	})
})

// POST /v1/agent/billing/recurring - TRUE auto-renew via Base Spend Permissions.
// The user signs an EIP-712 SpendPermission letting our operator pull the tier
// price in USDC once per period. We validate + record it (and register on-chain
// when the operator is enabled). A scheduler then calls spend() each period.
// Idempotent on the permission (account, spender, token, salt).
const RecurringSchema = z.object({
	tier: z.enum(['pro', 'premium', 'enterprise']),
	signature: z.string().min(4),
	permission: z.object({
		account: z.string().min(4),
		spender: z.string().min(4),
		token: z.string().min(4),
		allowance: z.string().min(1),
		period: z.union([z.string(), z.number()]),
		start: z.union([z.string(), z.number()]),
		end: z.union([z.string(), z.number()]),
		salt: z.string().min(1),
		extraData: z.string().default('0x'),
	}),
})

agentRoutes.post('/billing/recurring', async (c) => {
	const agent = c.get('agent')

	let body: unknown
	try {
		body = await c.req.json()
	} catch {
		return agentError(c, 400, 'VALIDATION_ERROR', 'Invalid JSON body')
	}
	const parsed = RecurringSchema.safeParse(body)
	if (!parsed.success) {
		return c.json(
			{ success: false, error: 'Validation error', error_code: 'VALIDATION_ERROR', fields: formatZodErrors(parsed.error) },
			400,
		)
	}
	const { tier, signature, permission: pin } = parsed.data
	const price = TIER_PRICES_USD[tier]
	if (price === undefined) {
		return c.json({ success: false, error: `Unknown tier: ${tier}`, error_code: 'VALIDATION_ERROR', purchasable: PURCHASABLE_TIERS }, 400)
	}

	const result = await runEffectEither(
		Effect.gen(function* () {
			const env = yield* EnvService
			const db = yield* requireDb

			const operator = operatorAddress(env)
			if (!operator) {
				return yield* Effect.fail(
					new ValidationError({ message: 'Recurring billing operator is not configured' }),
				)
			}

			// Parse numeric permission fields (uint160/uint256 → bigint).
			let perm: SpendPermission
			try {
				perm = {
					account: pin.account as `0x${string}`,
					spender: pin.spender as `0x${string}`,
					token: pin.token as `0x${string}`,
					allowance: BigInt(pin.allowance),
					period: Number(pin.period),
					start: Number(pin.start),
					end: Number(pin.end),
					salt: BigInt(pin.salt),
					extraData: (pin.extraData || '0x') as `0x${string}`,
				}
			} catch {
				return yield* Effect.fail(new ValidationError({ message: 'Malformed permission numeric field' }))
			}

			// Security: spender must be OUR operator, token the configured USDC,
			// allowance bounded (>= tier price, <= 10x to cap blast radius).
			const usdc = env.AGENT_METERING_USDC_ADDRESS as `0x${string}`
			const priceAtomic = BigInt(Math.round(price * 1_000_000))
			const nowSec = Math.floor(Date.now() / 1000)
			const check = validateSpendPermission(perm, {
				spender: operator,
				token: usdc,
				nowSec,
				maxAllowance: priceAtomic * 10n,
			})
			if (!check.ok) {
				return yield* Effect.fail(new ValidationError({ message: `Invalid permission: ${check.error}` }))
			}
			if (perm.allowance < priceAtomic) {
				return yield* Effect.fail(new ValidationError({ message: 'allowance below tier price' }))
			}

			// Register on-chain when the operator is live (gated). The contract is the
			// real signature gate; a bad signature fails here and nothing is recorded.
			let approvedTx: string | null = null
			if (isRecurringEnabled(env)) {
				const appr = yield* Effect.tryPromise({
					try: () => approveSpendPermission(env, perm, signature as `0x${string}`),
					catch: (e) => new Error(String(e)),
				})
				if (!appr.ok) {
					return yield* Effect.fail(
						new ValidationError({ message: `On-chain approval failed: ${appr.error}` }),
					)
				}
				approvedTx = appr.txHash
			}

			const nextChargeAt = new Date(Number(perm.start) * 1000)
			const inserted = yield* Effect.tryPromise({
				try: () =>
					db
						.insert(recurringSubscriptions)
						.values({
							agentId: agent.id,
							account: perm.account,
							spender: perm.spender,
							token: perm.token,
							allowance: perm.allowance.toString(),
							periodSeconds: Number(perm.period),
							startTs: Number(perm.start),
							endTs: Number(perm.end),
							salt: perm.salt.toString(),
							signature,
							tier,
							status: 'active',
							approvedTx,
							nextChargeAt,
						})
						.onConflictDoNothing()
						.returning({ id: recurringSubscriptions.id }),
				catch: (e) => new Error(`Database error: ${e}`),
			})

			return { alreadyExists: inserted.length === 0, approvedTx, tier, nextChargeAt, operator }
		}),
	)

	if (Either.isLeft(result)) {
		const { status, body } = mapErrorToResponse(result.left)
		return c.json(body, status)
	}
	const r = result.right
	return c.json({
		success: true,
		already_exists: r.alreadyExists,
		tier: r.tier,
		operator: r.operator,
		approved_onchain: !!r.approvedTx,
		approved_tx: r.approvedTx,
		next_charge_at: r.nextChargeAt,
		note: r.approvedTx
			? 'Recurring authorization registered on-chain — we pull the tier price each period (cancel by revoking the permission).'
			: 'Recurring authorization recorded; on-chain registration pending (operator not yet enabled).',
	})
})

// ===========================================
// AUDIT TRAIL (hash-chained)
// ===========================================

/**
 * Resolve the caller's audit scope from context set by agentFlexAuth: an org
 * API key scopes to that org's chain; a plain agent bearer token scopes to
 * the global (org-less) chain and further narrows to that agent's own rows.
 */
function resolveAuditScope(c: Context): { orgId: string | null; agentId: string | null } {
	const apiKeyCtx = c.get('apiKeyAuth') as { orgId: string } | undefined
	if (apiKeyCtx) return { orgId: apiKeyCtx.orgId, agentId: null }
	const agent = c.get('agent') as Agent | undefined
	const agentId = agent ? (agent.uuid ?? String(agent.id)) : null
	return { orgId: null, agentId }
}

// GET /v1/agent/audit - List audit events visible to the caller
agentRoutes.get('/audit', async (c) => {
	const { orgId, agentId } = resolveAuditScope(c)

	const eventType = c.req.query('event_type')
	const filterAgentId = c.req.query('agent_id')
	const since = c.req.query('since')
	const limitParam = parseInt(c.req.query('limit') ?? '100', 10)
	const limit = Math.min(Math.max(Number.isFinite(limitParam) ? limitParam : 100, 1), 500)

	const conditions: ReturnType<typeof eq>[] = []
	if (orgId) {
		// Org key: own org's rows only.
		conditions.push(eq(auditLogs.orgId, orgId))
	} else if (agentId) {
		// Plain agent token: own agentId only (global/org-less chain).
		conditions.push(isNull(auditLogs.orgId))
		conditions.push(eq(auditLogs.agentId, agentId))
	} else {
		return agentError(c, 401, 'UNAUTHORIZED', 'Authentication required')
	}
	if (eventType) conditions.push(eq(auditLogs.eventType, eventType))
	// agent_id filter only meaningful/allowed for org-key callers — a plain
	// agent token is already pinned to its own agentId above.
	if (orgId && filterAgentId) conditions.push(eq(auditLogs.agentId, filterAgentId))
	if (since) {
		const sinceDate = new Date(since)
		if (!Number.isNaN(sinceDate.getTime())) conditions.push(gte(auditLogs.createdAt, sinceDate))
	}

	const result = await runEffectEither(
		Effect.gen(function* () {
			const db = yield* requireDb
			return yield* Effect.tryPromise({
				try: () =>
					db
						.select({
							eventType: auditLogs.eventType,
							agentId: auditLogs.agentId,
							orgId: auditLogs.orgId,
							details: auditLogs.details,
							createdAt: auditLogs.createdAt,
							entryHash: auditLogs.entryHash,
						})
						.from(auditLogs)
						.where(and(...conditions))
						.orderBy(desc(auditLogs.id))
						.limit(limit),
				catch: (e) => (e instanceof Error ? e : new Error(String(e))),
			})
		}),
	)

	if (Either.isLeft(result)) {
		return agentError(c, 500, 'INTERNAL', result.left.message)
	}

	return c.json({ success: true, events: result.right, count: result.right.length })
})

// GET /v1/agent/audit/verify - Walk the hash chain and confirm no tampering
agentRoutes.get('/audit/verify', async (c) => {
	const { orgId, agentId } = resolveAuditScope(c)
	if (!orgId && !agentId) {
		return agentError(c, 401, 'UNAUTHORIZED', 'Authentication required')
	}

	const limitParam = parseInt(c.req.query('limit') ?? '1000', 10)
	const limit = Math.min(Math.max(Number.isFinite(limitParam) ? limitParam : 1000, 1), 5000)

	const result = await runEffectEither(verifyAuditChain(orgId, limit))

	if (Either.isLeft(result)) {
		return agentError(c, 500, 'INTERNAL', result.left.message)
	}

	return c.json({ success: true, ...result.right })
})

// ===========================================
// KILL SWITCH
// ===========================================

const KillSwitchSchema = z.object({
	scope: z.enum(['org', 'agent']),
	scope_id: z.string().optional(),
	active: z.boolean(),
	reason: z.string().max(300).optional(),
})

// POST /v1/agent/killswitch - Activate/deactivate a kill switch (org API key only)
agentRoutes.post('/killswitch', async (c) => {
	const apiKeyCtx = c.get('apiKeyAuth') as { orgId: string } | undefined
	if (!apiKeyCtx) {
		return agentError(c, 401, 'UNAUTHORIZED', 'Org API key required for kill-switch management')
	}

	const body = await c.req.json().catch(() => ({}))
	const parsed = KillSwitchSchema.safeParse(body)
	if (!parsed.success) {
		return agentError(c, 400, 'VALIDATION_ERROR', 'Invalid request', { details: formatZodErrors(parsed.error) })
	}
	const { scope, active, reason } = parsed.data

	// Org keys may only manage their OWN org's org-scope switch. There is no
	// agent->org ownership mapping in this schema, so agent-scope kill switches
	// via an org key are not permitted (would let one org silence an arbitrary
	// agentId it doesn't control). Global scope is admin/bot-only, never via
	// this API.
	if (scope !== 'org') {
		return agentError(c, 403, 'POLICY_VIOLATION', "Org API keys may only manage scope='org' kill switches")
	}
	if (parsed.data.scope_id && parsed.data.scope_id !== apiKeyCtx.orgId) {
		return agentError(c, 403, 'POLICY_VIOLATION', 'Cannot set a kill switch for another organization')
	}

	const result = await runEffectEither(
		Effect.gen(function* () {
			const db = yield* requireDb
			const [org] = yield* Effect.tryPromise({
				try: () =>
					db
						.select({ ownerId: organizations.ownerId })
						.from(organizations)
						.where(eq(organizations.id, apiKeyCtx.orgId))
						.limit(1),
				catch: (e) => (e instanceof Error ? e : new Error(String(e))),
			})
			if (!org) return yield* Effect.fail(new ValidationError({ message: 'Organization not found' }))

			const [existing] = yield* Effect.tryPromise({
				try: () =>
					db
						.select({ id: policyKillSwitches.id })
						.from(policyKillSwitches)
						.where(and(eq(policyKillSwitches.scope, 'org'), eq(policyKillSwitches.scopeId, apiKeyCtx.orgId)))
						.limit(1),
				catch: (e) => (e instanceof Error ? e : new Error(String(e))),
			})

			if (existing) {
				yield* Effect.tryPromise({
					try: () =>
						db
							.update(policyKillSwitches)
							.set({
								active,
								reason: reason ?? null,
								activatedBy: org.ownerId,
								activatedAt: new Date(),
								deactivatedAt: active ? null : new Date(),
							})
							.where(eq(policyKillSwitches.id, existing.id)),
					catch: (e) => (e instanceof Error ? e : new Error(String(e))),
				})
			} else {
				yield* Effect.tryPromise({
					try: () =>
						db.insert(policyKillSwitches).values({
							scope: 'org',
							scopeId: apiKeyCtx.orgId,
							active,
							reason: reason ?? null,
							activatedBy: org.ownerId,
							deactivatedAt: active ? null : new Date(),
						}),
					catch: (e) => (e instanceof Error ? e : new Error(String(e))),
				})
			}

			return { scope: 'org' as const, scopeId: apiKeyCtx.orgId, active }
		}),
	)

	if (Either.isLeft(result)) {
		const { status, body } = mapErrorToResponse(result.left)
		return c.json(body, status)
	}

	writeAuditLog({
		userId: 0,
		orgId: apiKeyCtx.orgId,
		eventType: active ? 'killswitch.activated' : 'killswitch.deactivated',
		details: { scope: 'org', scopeId: apiKeyCtx.orgId, reason: reason ?? null },
	})

	return c.json({ success: true, killswitch: result.right })
})

// GET /v1/agent/killswitch - List active kill switches visible to the caller
agentRoutes.get('/killswitch', async (c) => {
	const apiKeyCtx = c.get('apiKeyAuth') as { orgId: string } | undefined
	if (!apiKeyCtx) {
		return agentError(c, 401, 'UNAUTHORIZED', 'Org API key required for kill-switch visibility')
	}

	const result = await runEffectEither(
		Effect.gen(function* () {
			const db = yield* requireDb
			return yield* Effect.tryPromise({
				try: () =>
					db
						.select({
							scope: policyKillSwitches.scope,
							scopeId: policyKillSwitches.scopeId,
							active: policyKillSwitches.active,
							reason: policyKillSwitches.reason,
							activatedAt: policyKillSwitches.activatedAt,
							deactivatedAt: policyKillSwitches.deactivatedAt,
						})
						.from(policyKillSwitches)
						.where(
							and(
								eq(policyKillSwitches.active, true),
								or(
									eq(policyKillSwitches.scope, 'global'),
									and(eq(policyKillSwitches.scope, 'org'), eq(policyKillSwitches.scopeId, apiKeyCtx.orgId)),
								),
							),
						)
						.orderBy(desc(policyKillSwitches.activatedAt)),
				catch: (e) => (e instanceof Error ? e : new Error(String(e))),
			})
		}),
	)

	if (Either.isLeft(result)) {
		return agentError(c, 500, 'INTERNAL', result.left.message)
	}

	return c.json({ success: true, killswitches: result.right })
})

// ===========================================
// OPENAPI SPEC
// ===========================================

// GET /v1/agent/openapi - Machine-readable API spec
agentRoutes.get('/openapi', (c) => c.json(openApiSpec))

// GET /v1/agent/postman - Postman Collection v2.1, auto-derived from the live OpenAPI spec
agentRoutes.get('/postman', (c) => c.json(openApiToPostmanCollection(openApiSpec as never)))

export { agentRoutes }
