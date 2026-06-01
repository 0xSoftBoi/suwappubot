import crypto from 'crypto'
import { and, desc, eq, sql } from 'drizzle-orm'
import { Effect, Either, Option } from 'effect'
import { Hono } from 'hono'
import { z } from 'zod'
import openApiSpec from '../../openapi-agent.json'
import { EnvService } from '../config/EnvService'
import type { Agent } from '../db'
import { requireDb, swapTransactions, webhookEvents } from '../db'
import { mapErrorToResponse, ValidationError } from '../errors'
import { agentBearerAuth, agentBearerAuthAllowInactive } from '../middleware'
import { agentOrMppAuth } from '../middleware/agentOrMppAuth'
import { rateLimit } from '../middleware/rateLimit'
import { runEffectEither } from '../runtime'
import {
	AgentService,
	BalanceService,
	CHAINS,
	COMMON_TOKENS,
	JupiterService,
	type QuoteParams,
	SOLANA_TOKENS,
	SwapService,
	TokenService,
	TurnkeyService,
} from '../services'
import {
	CreatePolicySchema,
	ExecuteCommandSchema,
	ExecuteSwapSchema,
	formatZodErrors,
	QuoteRequestSchema,
	RegisterAgentSchema,
	SwapRequestSchema,
	SwapStatusQuerySchema,
	UpdateAgentSchema,
	WebhookEventsQuerySchema,
} from './validators'

// Extend Hono's context to include our agent
type AgentContext = {
	Variables: {
		agent: Agent
	}
}

const agentRoutes = new Hono<AgentContext>()

// In-memory quote cache
const quoteCache = new Map<
	string,
	{ quote: any; expiry: number; agentId: number; isSolana?: boolean }
>()
const QUOTE_TTL = 60_000 // 60 seconds for agent quotes
const QUOTE_CACHE_MAX = 10_000

// Cache cleanup interval: every 5 minutes purge expired, cap at max
const quoteCacheCleanup = setInterval(() => {
	const now = Date.now()
	for (const [key, entry] of quoteCache) {
		if (now > entry.expiry) {
			quoteCache.delete(key)
		}
	}
	// Evict oldest if over cap
	if (quoteCache.size > QUOTE_CACHE_MAX) {
		const entries = [...quoteCache.entries()].sort((a, b) => a[1].expiry - b[1].expiry)
		const toRemove = entries.slice(0, entries.length - QUOTE_CACHE_MAX)
		for (const [key] of toRemove) {
			quoteCache.delete(key)
		}
	}
}, 5 * 60_000)

export function stopAgentCleanup() {
	clearInterval(quoteCacheCleanup)
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

// Detect an EVM (0x-prefixed hex) address
function isEvmAddress(addr: string): boolean {
	return /^0x[0-9a-fA-F]{40}$/.test(addr.trim())
}

// Case-insensitive EVM address equality (checksummed vs lowercase are the same address)
function evmAddressesEqual(a: string, b: string): boolean {
	return a.trim().toLowerCase() === b.trim().toLowerCase()
}

// Read the agent's managed (EVM) wallet address from metadata, if any.
function getAgentWalletAddress(agent: Agent): string | undefined {
	const metadata = (agent.metadata as Record<string, unknown>) || {}
	const addr = metadata.wallet_address
	return typeof addr === 'string' ? addr : undefined
}

// Validate that a user-supplied EVM wallet_address belongs to the authenticated agent.
// Returns null if authorized, otherwise an error reason string.
// NOTE: only EVM (managed) wallets are stored, so only EVM addresses can be ownership-verified.
function checkEvmWalletOwnership(agent: Agent, walletAddress: string): string | null {
	if (!isEvmAddress(walletAddress)) {
		return 'wallet_address must be a registered EVM wallet owned by this agent'
	}
	const owned = getAgentWalletAddress(agent)
	if (!owned) {
		return 'No managed wallet found for this agent. Create one via POST /v1/agent/wallets'
	}
	if (!evmAddressesEqual(owned, walletAddress)) {
		return 'wallet_address does not belong to the authenticated agent'
	}
	return null
}

// Convert a human decimal amount string to an integer base-unit string using exact
// BigInt arithmetic (no float precision loss). Returns null on invalid input or when
// the amount specifies more decimal places than the token supports.
function parseAmountToBaseUnits(amount: string, decimals: number): string | null {
	const trimmed = amount.trim()
	if (!/^\d+(\.\d+)?$/.test(trimmed)) return null
	const [whole, frac = ''] = trimmed.split('.')
	if (frac.length > decimals) return null
	const paddedFrac = frac.padEnd(decimals, '0')
	const combined = `${whole}${paddedFrac}`.replace(/^0+(?=\d)/, '')
	let value: bigint
	try {
		value = BigInt(combined === '' ? '0' : combined)
	} catch {
		return null
	}
	if (value <= 0n) return null
	return value.toString()
}

// ===========================================
// PUBLIC ENDPOINTS (no auth required)
// ===========================================

// POST /v1/agent/register - Register a new agent
agentRoutes.post('/register', async (c) => {
	let body: unknown
	try {
		body = await c.req.json()
	} catch {
		return c.json({ success: false, error: 'Invalid JSON body' }, 400)
	}

	const parsed = RegisterAgentSchema.safeParse(body)
	if (!parsed.success) {
		return c.json(
			{
				success: false,
				error: 'Validation error',
				fields: formatZodErrors(parsed.error),
			},
			400,
		)
	}

	const { name, description, callback_url, metadata } = parsed.data

	const result = await runEffectEither(
		Effect.gen(function* () {
			const agentService = yield* AgentService

			const existing = yield* agentService.getAgentByName(name)
			if (Option.isSome(existing)) {
				return yield* Effect.fail(
					new ValidationError({ message: `Agent name "${name}" is already taken` }),
				)
			}

			const { agent, apiKey } = yield* agentService.registerAgent({
				name,
				description,
				callbackUrl: callback_url,
				metadata,
			})

			return { agent, apiKey }
		}),
	)

	if (Either.isLeft(result)) {
		const { status, body } = mapErrorToResponse(result.left)
		return c.json(body, status as 200)
	}

	const { agent, apiKey } = result.right

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
agentRoutes.post('/sponge/callback', async (c) => {
	// Validate X-Sponge-Signature if webhook secret is configured
	const envResult = await runEffectEither(
		Effect.gen(function* () {
			return yield* EnvService
		}),
	)

	if (Either.isLeft(envResult)) {
		// Cannot determine configuration — fail closed.
		return c.json({ error: 'Sponge callback unavailable' }, 503)
	}

	const env = envResult.right

	// Fail closed: signature validation must be configured. Never accept
	// unsigned Sponge callbacks — they can auto-register agents with
	// attacker-controlled callback URLs and metadata.
	if (!env.SPONGE_WEBHOOK_SECRET) {
		console.error(
			'[security] Sponge callback rejected: SPONGE_WEBHOOK_SECRET is not configured',
		)
		return c.json({ error: 'Sponge webhook signature validation is not configured' }, 503)
	}

	const signature = c.req.header('X-Sponge-Signature')
	if (!signature) {
		console.warn('[security] Sponge callback rejected: missing X-Sponge-Signature header')
		return c.json({ error: 'Missing X-Sponge-Signature header' }, 401)
	}

	const rawBody = await c.req.text()
	const expected = crypto
		.createHmac('sha256', env.SPONGE_WEBHOOK_SECRET)
		.update(rawBody)
		.digest('hex')

	let sigBuf: Buffer
	try {
		sigBuf = Buffer.from(signature, 'hex')
	} catch {
		return c.json({ error: 'Invalid signature' }, 401)
	}
	const expBuf = Buffer.from(expected, 'hex')
	if (sigBuf.length !== expBuf.length || !crypto.timingSafeEqual(sigBuf, expBuf)) {
		console.warn('[security] Sponge callback rejected: invalid signature')
		return c.json({ error: 'Invalid signature' }, 401)
	}

	// Re-parse body since we consumed it
	let body: any
	try {
		body = JSON.parse(rawBody)
	} catch {
		return c.json({ error: 'Invalid JSON body' }, 400)
	}

	return handleSpongeCallback(c, body)
})

async function handleSpongeCallback(c: any, body: any) {
	const { event, agent_name, agent_url } = body as {
		event: string
		agent_name?: string
		agent_url?: string
	}

	if (event !== 'agent_connect') {
		return c.json({ error: `Unsupported event: ${event}` }, 400)
	}

	if (!agent_name) {
		return c.json({ error: 'agent_name is required' }, 400)
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
			})

			return { agent, apiKey, isNew: true }
		}),
	)

	if (Either.isLeft(result)) {
		const { status, body: errBody } = mapErrorToResponse(result.left)
		return c.json(errBody, status as 200)
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

agentRoutes.use('/me', agentBearerAuth())
agentRoutes.use('/me/*', agentBearerAuth())
agentRoutes.use('/quote', agentOrMppAuth())
agentRoutes.use('/swap', agentOrMppAuth())
agentRoutes.use('/execute', agentBearerAuth())
agentRoutes.use('/portfolio', agentBearerAuth())
agentRoutes.use('/wallets', agentBearerAuth())
agentRoutes.use('/wallets/*', agentBearerAuth())
agentRoutes.use('/swap/*', agentBearerAuth())
agentRoutes.use('/swaps', agentBearerAuth())
agentRoutes.use('/prices', agentBearerAuth())
agentRoutes.use('/tokens', agentBearerAuth())
agentRoutes.use('/webhooks', agentBearerAuth())
agentRoutes.use('/webhooks/*', agentBearerAuth())
agentRoutes.use('/keys/*', agentBearerAuth())
agentRoutes.use('/wallet/policy', agentBearerAuth())
agentRoutes.use('/wallet/policy/*', agentBearerAuth())
agentRoutes.use('/wallet/policies', agentBearerAuth())
agentRoutes.use('/reactivate', agentBearerAuthAllowInactive())

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
agentRoutes.use('/reactivate', rateLimit())

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
		return c.json({ success: false, error: 'Invalid JSON body' }, 400)
	}

	const parsed = UpdateAgentSchema.safeParse(body)
	if (!parsed.success) {
		return c.json(
			{
				success: false,
				error: 'Validation error',
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
		return c.json(body, status as 200)
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
		return c.json({ success: false, error: 'Invalid JSON body' }, 400)
	}

	const parsed = QuoteRequestSchema.safeParse(body)
	if (!parsed.success) {
		return c.json(
			{
				success: false,
				error: 'Validation error',
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

				// Convert amount to smallest unit (lamports for SOL, etc) using exact BigInt math
				const fromAmountLamports = parseAmountToBaseUnits(amount, fromTokenInfo.decimals)
				if (fromAmountLamports === null) {
					return yield* Effect.fail(
						new ValidationError({
							message: `Invalid amount: must be a positive number with at most ${fromTokenInfo.decimals} decimal places`,
						}),
					)
				}

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
				quoteCache.set(quoteId, {
					quote,
					expiry: Date.now() + QUOTE_TTL,
					agentId: agent.id,
					isSolana: true,
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
			return c.json(body, status as 200)
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

			// Convert amount to wei/smallest unit using exact BigInt math
			const fromAmountWei = parseAmountToBaseUnits(amount, fromTokenInfo.decimals)
			if (fromAmountWei === null) {
				return yield* Effect.fail(
					new ValidationError({
						message: `Invalid amount: must be a positive number with at most ${fromTokenInfo.decimals} decimal places`,
					}),
				)
			}

			// If a wallet_address is supplied it must be one this agent owns.
			if (wallet_address) {
				const ownershipError = checkEvmWalletOwnership(agent, wallet_address)
				if (ownershipError) {
					return yield* Effect.fail(new ValidationError({ message: ownershipError }))
				}
			}

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
			quoteCache.set(quote.quoteId, {
				quote,
				expiry: Date.now() + QUOTE_TTL,
				agentId: agent.id,
				isSolana: false,
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
		return c.json(body, status as 200)
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
		return c.json({ success: false, error: 'Invalid JSON body' }, 400)
	}

	const parsed = SwapRequestSchema.safeParse(body)
	if (!parsed.success) {
		return c.json(
			{
				success: false,
				error: 'Validation error',
				fields: formatZodErrors(parsed.error),
			},
			400,
		)
	}

	const { quote_id, wallet_address } = parsed.data

	// Track swap attempt
	await runEffectEither(
		Effect.gen(function* () {
			const agentService = yield* AgentService
			yield* agentService.incrementAgentStats(agent.id, 'swap')
		}),
	)

	// If quote_id provided, use cached quote
	if (quote_id) {
		const cached = quoteCache.get(quote_id)

		if (!cached) {
			return c.json(
				{
					success: false,
					error: 'Quote expired or not found',
					hint: 'Request a new quote using POST /v1/agent/quote',
				},
				400,
			)
		}

		if (Date.now() > cached.expiry) {
			quoteCache.delete(quote_id)
			return c.json(
				{
					success: false,
					error: 'Quote expired',
					hint: 'Request a new quote using POST /v1/agent/quote',
				},
				400,
			)
		}

		// Quotes are bound to the agent that requested them. Reject cross-agent
		// quote use to prevent hijacking another agent's unsigned transaction.
		if (cached.agentId !== agent.id) {
			console.warn(
				`[security] Agent ${agent.id} attempted to use quote owned by agent ${cached.agentId}`,
			)
			return c.json(
				{
					success: false,
					error: 'Quote does not belong to the authenticated agent',
				},
				403,
			)
		}

		const quote = cached.quote

		// For EVM swaps, the wallet_address used as the transaction sender must be
		// a wallet this agent owns. (Solana wallets are not managed/stored, so they
		// are protected only by the per-agent quote binding above.)
		if (!cached.isSolana) {
			const ownershipError = checkEvmWalletOwnership(agent, wallet_address)
			if (ownershipError) {
				console.warn(
					`[security] Agent ${agent.id} attempted swap with unauthorized wallet_address`,
				)
				return c.json({ success: false, error: ownershipError }, 403)
			}
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
	return c.json(
		{
			success: false,
			error: 'quote_id required',
			hint: 'First get a quote using POST /v1/agent/quote, then pass the quote_id here',
			example: {
				step_1: 'POST /v1/agent/quote with {from_token, to_token, amount, chain, wallet_address}',
				step_2: 'POST /v1/agent/swap with {quote_id, wallet_address}',
			},
		},
		400,
	)
})

// POST /v1/agent/execute - Natural language command execution
agentRoutes.post('/execute', async (c) => {
	const agent = c.get('agent')

	let body: unknown
	try {
		body = await c.req.json()
	} catch {
		return c.json({ success: false, error: 'Invalid JSON body' }, 400)
	}

	const parsed = ExecuteCommandSchema.safeParse(body)
	if (!parsed.success) {
		return c.json(
			{
				success: false,
				error: 'Validation error',
				fields: formatZodErrors(parsed.error),
				hint: 'Example: {"command": "swap 0.5 ETH to USDC on Base", "wallet_address": "0x..."}',
			},
			400,
		)
	}

	const { command, wallet_address } = parsed.data

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

		// Require an explicit chain. Silently defaulting to ethereum can execute a
		// swap on a different chain than the user intended (same token symbol,
		// different address). Make the user state "on <chain>".
		if (!chain) {
			return c.json(
				{
					success: false,
					error: 'Chain is required. Specify the chain explicitly, e.g. "swap 0.5 ETH to USDC on base".',
					hint: 'Append "on <chain>" to your command.',
				},
				400,
			)
		}

		// If a wallet_address is supplied it must be one this agent owns.
		if (wallet_address) {
			const ownershipError = checkEvmWalletOwnership(agent, wallet_address)
			if (ownershipError) {
				console.warn(
					`[security] Agent ${agent.id} attempted execute with unauthorized wallet_address`,
				)
				return c.json({ success: false, error: ownershipError }, 403)
			}
		}

		// Get a quote
		const result = await runEffectEither(
			Effect.gen(function* () {
				const tokenService = yield* TokenService
				const swapService = yield* SwapService

				const chainKey = chain
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

				const fromAmountWei = parseAmountToBaseUnits(amount, fromTokenInfo.decimals)
				if (fromAmountWei === null) {
					return yield* Effect.fail(
						new ValidationError({
							message: `Invalid amount: must be a positive number with at most ${fromTokenInfo.decimals} decimal places`,
						}),
					)
				}
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
				quoteCache.set(quote.quoteId, {
					quote,
					expiry: Date.now() + QUOTE_TTL,
					agentId: agent.id,
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
			return c.json({ success: false, ...body }, status as 200)
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
		return c.json(
			{
				success: false,
				error: 'Missing required query parameter: wallet_address',
				hint: 'GET /v1/agent/portfolio?wallet_address=0x...',
			},
			400,
		)
	}

	// Ownership check: an agent may only query the portfolio of its own managed
	// (EVM) wallet. This prevents enumeration / disclosure of arbitrary wallets'
	// holdings, and makes per-wallet rate limiting unnecessary (the only wallet an
	// agent can query is its own).
	const ownershipError = checkEvmWalletOwnership(agent, walletAddress)
	if (ownershipError) {
		console.warn(
			`[security] Agent ${agent.id} attempted portfolio query for unauthorized wallet`,
		)
		return c.json({ success: false, error: ownershipError }, 403)
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
		return c.json(body, status as 200)
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
		return c.json(body, status as 200)
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

// POST /v1/agent/swap/execute - Managed swap execution via Python pipeline
agentRoutes.post('/swap/execute', async (c) => {
	const agent = c.get('agent')

	let body: unknown
	try {
		body = await c.req.json()
	} catch {
		return c.json({ success: false, error: 'Invalid JSON body' }, 400)
	}

	const parsed = ExecuteSwapSchema.safeParse(body)
	if (!parsed.success) {
		return c.json(
			{
				success: false,
				error: 'Validation error',
				fields: formatZodErrors(parsed.error),
			},
			400,
		)
	}

	const { quote_id } = parsed.data

	// Check agent has a Turnkey wallet with internal IDs
	const metadata = (agent.metadata as Record<string, unknown>) || {}
	const internalUserId = metadata.internal_user_id as number | undefined
	const internalWalletId = metadata.internal_wallet_id as number | undefined
	const walletAddress = metadata.wallet_address as string | undefined

	if (!internalUserId || !internalWalletId || !walletAddress) {
		return c.json(
			{
				success: false,
				error: 'No managed wallet found',
				hint: 'Create a wallet first using POST /v1/agent/wallets',
			},
			400,
		)
	}

	// Look up cached quote
	const cached = quoteCache.get(quote_id)
	if (!cached) {
		return c.json(
			{
				success: false,
				error: 'Quote expired or not found',
				hint: 'Request a new quote using POST /v1/agent/quote',
			},
			400,
		)
	}

	if (Date.now() > cached.expiry) {
		quoteCache.delete(quote_id)
		return c.json(
			{
				success: false,
				error: 'Quote expired',
				hint: 'Request a new quote using POST /v1/agent/quote',
			},
			400,
		)
	}

	// Quotes are bound to the agent that requested them. Reject cross-agent use.
	if (cached.agentId !== agent.id) {
		console.warn(
			`[security] Agent ${agent.id} attempted to execute quote owned by agent ${cached.agentId}`,
		)
		return c.json(
			{ success: false, error: 'Quote does not belong to the authenticated agent' },
			403,
		)
	}

	const quote = cached.quote

	// Build quote_data for the Python endpoint
	const quoteData: Record<string, unknown> = cached.isSolana
		? {
				provider: 'jupiter',
				from_chain: 'solana',
				to_chain: 'solana',
				from_token: quote.inputMint,
				to_token: quote.outputMint,
				from_amount: quote.inAmount,
				from_amount_human: parseFloat(quote.inAmount) / 1e9,
				to_amount: quote.outAmount,
				to_amount_human: parseFloat(quote.outAmount) / 1e6,
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
				from_amount_human: parseFloat(quote.fromAmount || '0') / 1e18,
				to_amount: quote.toAmount || '',
				to_amount_human: parseFloat(quote.toAmount || '0') / 1e18,
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

	const idempotencyKey = `agent_${agent.id}_${quote_id}`

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
					})

					if (!res.ok) {
						const errBody = (await res.json().catch(() => ({ detail: 'Unknown error' }))) as {
							detail?: string
						}
						throw new Error(errBody.detail || `Internal API error: ${res.status}`)
					}

					return (await res.json()) as { swap_id: number; tx_hash: string | null; status: string }
				},
				catch: (e) => new ValidationError({ message: e instanceof Error ? e.message : String(e) }),
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
		const { status, body } = mapErrorToResponse(result.left)
		return c.json(body, status as 200)
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

// GET /v1/agent/swap/status/:swapId - Get swap status
agentRoutes.get('/swap/status/:swapId', async (c) => {
	const agent = c.get('agent')
	const swapId = parseInt(c.req.param('swapId'), 10)

	if (isNaN(swapId)) {
		return c.json({ success: false, error: 'Invalid swap ID' }, 400)
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

			if (rows.length === 0) {
				return yield* Effect.fail(new ValidationError({ message: 'Swap not found' }))
			}

			const s = rows[0]
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
		return c.json(body, status as 200)
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
		return c.json(body, status as 200)
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

// Name prefix marking a policy as agent-created (and therefore agent-deletable).
// Policies without this prefix are treated as admin/guardrail policies that the
// agent API must not be able to delete.
const AGENT_POLICY_PREFIX = 'agent-'

// POST /v1/agent/wallet/policy - Create a Turnkey policy for agent wallet
agentRoutes.post('/wallet/policy', async (c) => {
	const agent = c.get('agent')
	const body = await c.req.json()
	const parsed = CreatePolicySchema.safeParse(body)
	if (!parsed.success) {
		return c.json({ error: 'Invalid request', details: formatZodErrors(parsed.error) }, 400)
	}

	const metadata = (agent.metadata || {}) as Record<string, unknown>
	const subOrgId = metadata.wallet_sub_org_id as string
	if (!subOrgId) {
		return c.json({ error: 'No managed wallet found', hint: 'Create a wallet first' }, 400)
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
		return c.json({ error: result.left.message }, 500)
	}

	return c.json({ success: true, policy: result.right })
})

// GET /v1/agent/wallet/policies - List policies for agent wallet
agentRoutes.get('/wallet/policies', async (c) => {
	const agent = c.get('agent')
	const metadata = (agent.metadata || {}) as Record<string, unknown>
	const subOrgId = metadata.wallet_sub_org_id as string
	if (!subOrgId) {
		return c.json({ error: 'No managed wallet found', hint: 'Create a wallet first' }, 400)
	}

	const result = await runEffectEither(
		Effect.gen(function* () {
			const turnkeyService = yield* TurnkeyService
			return yield* turnkeyService.listPolicies(subOrgId)
		})
	)

	if (Either.isLeft(result)) {
		return c.json({ error: result.left.message }, 500)
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
		return c.json({ error: 'No managed wallet found', hint: 'Create a wallet first' }, 400)
	}

	const result = await runEffectEither(
		Effect.gen(function* () {
			const turnkeyService = yield* TurnkeyService

			// Only allow agents to delete policies they created themselves.
			// Agent-created policies are named with the AGENT_POLICY_PREFIX. Any other
			// policy (e.g. an admin-applied spending limit or whitelist guardrail) is
			// immutable from the agent API and must not be deletable here.
			const policies = yield* turnkeyService.listPolicies(subOrgId)
			const target = policies.find((p) => p.policyId === policyId)

			if (!target) {
				return yield* Effect.fail(new ValidationError({ message: 'Policy not found' }))
			}

			if (!target.policyName.startsWith(AGENT_POLICY_PREFIX)) {
				return yield* Effect.fail(
					new ValidationError({
						message: 'This policy was not created by the agent and cannot be deleted',
					}),
				)
			}

			console.warn(`[security] Agent ${agent.id} deleting self-created policy ${policyId}`)
			return yield* turnkeyService.deletePolicy(subOrgId, policyId)
		})
	)

	if (Either.isLeft(result)) {
		const { status, body } = mapErrorToResponse(result.left)
		return c.json(body, status as 200)
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
		return c.json(body, errStatus as 200)
	}

	return c.json({ success: true, ...result.right })
})

// POST /v1/agent/webhooks/test - Test webhook delivery
agentRoutes.post('/webhooks/test', async (c) => {
	const agent = c.get('agent')

	if (!agent.callbackUrl) {
		return c.json(
			{
				success: false,
				error: 'No callback_url configured',
				hint: 'Set callback_url via PATCH /v1/agent/me first',
			},
			400,
		)
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

	const startTime = Date.now()
	try {
		const res = await fetch(agent.callbackUrl, {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				'X-Suwappu-Event': 'webhook.test',
				'X-Suwappu-Delivery': deliveryId,
				'X-Suwappu-Timestamp': timestamp,
				'X-Suwappu-Signature': signature,
			},
			body: jsonBody,
			signal: AbortSignal.timeout(10000),
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
		return c.json(body, status as 200)
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
		return c.json(body, status as 200)
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
		return c.json(body, status as 200)
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
		return c.json(body, status as 200)
	}

	return c.body(null, 204)
})

// ===========================================
// OPENAPI SPEC
// ===========================================

// GET /v1/agent/openapi - Machine-readable API spec
agentRoutes.get('/openapi', (c) => c.json(openApiSpec))

export { agentRoutes }
