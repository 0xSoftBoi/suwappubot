import { Turnkey } from '@turnkey/sdk-server'
import { eq } from 'drizzle-orm'
import { Effect, Either, Option } from 'effect'
import { Hono } from 'hono'
import jwt from 'jsonwebtoken'
import { EnvService } from '../config/EnvService'
import { DEFAULT_SLIPPAGE } from '../config/constants'
import { logger } from '../lib/logger'
import { DrizzleService, requireDb, wallets } from '../db'
import { mapErrorToResponse, NotFoundError, UnauthorizedError, ValidationError } from '../errors'
import { fetchWithRetry } from '../lib/retry'
import { withSigningFallback } from '../services/FallbackSigningService'
import { type AuthUser, flexAuth } from '../middleware/flexAuth'
import { ipRateLimit } from '../middleware/ipRateLimit'
import { runEffectEither } from '../runtime'
import {
	cacheKeys,
	chainKeyFromId,
	QUOTE_TTL,
	type QuoteParams,
	RedisService,
	type RedisServiceInterface,
	resolveChainId,
	type SwapQuote,
	SwapService,
	TOKEN_LIST_TTL,
	UserService,
	WalletService,
} from '../services'

const publicSwapRoutes = new Hono()

// Chain ID to RPC endpoint mapping (shared with swap.ts)
const alchemyKey = process.env.ALCHEMY_API_KEY || ''
const CHAIN_RPC_ENDPOINTS: Record<number, string> = {
	1:
		process.env.ETH_RPC_URL ||
		(alchemyKey
			? `https://eth-mainnet.g.alchemy.com/v2/${alchemyKey}`
			: 'https://eth.llamarpc.com'),
	10:
		process.env.OPTIMISM_RPC_URL ||
		(alchemyKey
			? `https://opt-mainnet.g.alchemy.com/v2/${alchemyKey}`
			: 'https://optimism.llamarpc.com'),
	56: process.env.BSC_RPC_URL || 'https://bsc.llamarpc.com',
	137:
		process.env.POLYGON_RPC_URL ||
		(alchemyKey
			? `https://polygon-mainnet.g.alchemy.com/v2/${alchemyKey}`
			: 'https://polygon.llamarpc.com'),
	8453:
		process.env.BASE_RPC_URL ||
		(alchemyKey
			? `https://base-mainnet.g.alchemy.com/v2/${alchemyKey}`
			: 'https://base.llamarpc.com'),
	42161:
		process.env.ARBITRUM_RPC_URL ||
		(alchemyKey
			? `https://arb-mainnet.g.alchemy.com/v2/${alchemyKey}`
			: 'https://arbitrum.llamarpc.com'),
	43114: process.env.AVALANCHE_RPC_URL || 'https://api.avax.network/ext/bc/C/rpc',
	59144: process.env.LINEA_RPC_URL || 'https://rpc.linea.build',
	324: process.env.ZKSYNC_RPC_URL || 'https://mainnet.era.zksync.io',
}

// In-memory quote cache as fallback when Redis is not available
// Receiver used to price unauthenticated previews. Never signs anything.
const PREVIEW_PLACEHOLDER_ADDRESS = '0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045'

const quoteCacheMemory = new Map<string, { quote: SwapQuote; expiry: number }>()
const QUOTE_TTL_MS = QUOTE_TTL * 1000

const cacheQuote = (redis: RedisServiceInterface, quote: SwapQuote): Effect.Effect<void, never> =>
	Effect.gen(function* () {
		const key = cacheKeys.quote(quote.quoteId)
		const result = yield* Effect.either(redis.set(key, quote, QUOTE_TTL))
		if (Either.isLeft(result) || !redis.isConnected()) {
			quoteCacheMemory.set(quote.quoteId, {
				quote,
				expiry: Date.now() + QUOTE_TTL_MS,
			})
		}
	})

const getCachedQuote = (
	redis: RedisServiceInterface,
	quoteId: string,
): Effect.Effect<SwapQuote | null, never> =>
	Effect.gen(function* () {
		const key = cacheKeys.quote(quoteId)
		const result = yield* Effect.either(redis.get<SwapQuote>(key))
		if (Either.isRight(result) && result.right) {
			return result.right
		}
		const cached = quoteCacheMemory.get(quoteId)
		if (!cached) return null
		if (Date.now() > cached.expiry) {
			quoteCacheMemory.delete(quoteId)
			return null
		}
		return cached.quote
	})

const deleteCachedQuote = (
	redis: RedisServiceInterface,
	quoteId: string,
): Effect.Effect<void, never> =>
	Effect.gen(function* () {
		const key = cacheKeys.quote(quoteId)
		yield* Effect.either(redis.del(key))
		quoteCacheMemory.delete(quoteId)
	})

/**
 * MONEY-PATH (H5 fix): SwapService.getQuote defaults `toAddress` to
 * `fromAddress` (SwapService.ts:313), and /quote falls back to a placeholder
 * address for JWT users with no wallet on record. Li.Fi bakes that receiver
 * into the quote's calldata (`_rawQuote.action.toAddress`) at quote time, and
 * /execute signs that calldata VERBATIM later. If the receiver the quote was
 * built for doesn't match the wallet we're about to sign with, signing would
 * send the swap's output to the wrong address. Exported so it's unit-testable
 * without spinning up the Effect/DB/Turnkey stack (same pattern as
 * resolveSwapExecuteDecimals in routes/agent.ts).
 */
export function assertQuoteReceiverMatchesWallet(
	quote: { _rawQuote?: { action?: { toAddress?: string } } },
	walletAddress: string,
): { ok: true } | { ok: false; reason: string } {
	const receiver = quote._rawQuote?.action?.toAddress
	if (!receiver || !walletAddress || receiver.toLowerCase() !== walletAddress.toLowerCase()) {
		return {
			ok: false,
			reason: 'Quote receiver does not match the executing wallet. Please request a new quote.',
		}
	}
	return { ok: true }
}

/**
 * Human-readable amount -> base units, in integer math.
 *
 * MONEY-PATH: never via Number(). "0.1" at 18 decimals is not representable in
 * a float, and rounding an amount before it reaches the aggregator quietly
 * misprices the trade. Digits are shifted as strings and combined as BigInt.
 */
export function toBaseUnits(amount: string, decimals: number): string {
	if (!/^\d*\.?\d+$/.test(amount)) throw new Error(`Invalid amount: ${amount}`)
	const [whole, frac = ''] = amount.split('.')
	if (frac.length > decimals) {
		// Refuse to silently truncate precision the caller asked for.
		throw new Error(`Amount has more than ${decimals} decimal places: ${amount}`)
	}
	const padded = frac.padEnd(decimals, '0')
	return (BigInt(whole || '0') * 10n ** BigInt(decimals) + BigInt(padded || '0')).toString()
}

/**
 * Base units -> human-readable, in integer math for the same reason as above.
 *
 * The mirror of toBaseUnits: Li.Fi answers in base units, and a UI that prints
 * them raw shows "122966842 USDC" for what is actually 122.97. Trailing zeros
 * are trimmed so the number reads the way a person would write it.
 */
export function fromBaseUnits(amount: string, decimals: number): string {
	if (!/^\d+$/.test(amount)) return amount
	if (decimals === 0) return amount
	const padded = amount.padStart(decimals + 1, '0')
	const whole = padded.slice(0, -decimals)
	const frac = padded.slice(-decimals).replace(/0+$/, '')
	return frac ? `${whole}.${frac}` : whole
}

/**
 * Resolves a token's decimals from Li.Fi. The preview endpoint takes amounts
 * the way a person says them ("0.05"), but Li.Fi wants base units, and the
 * conversion is meaningless without decimals for that exact token on that exact
 * chain — USDC is 6 on Base and 18 elsewhere, so a shared default would be wrong.
 */
const decimalsCache = new Map<string, { decimals: number; expiry: number }>()
const DECIMALS_TTL_MS = 60 * 60 * 1000

async function resolveTokenDecimals(chain: string, token: string): Promise<number> {
	const chainId = resolveChainId(chain)
	const key = `${chainId}:${token.toLowerCase()}`
	const cached = decimalsCache.get(key)
	if (cached && Date.now() < cached.expiry) return cached.decimals

	const url = `https://li.quest/v1/token?chain=${encodeURIComponent(String(chainId))}&token=${encodeURIComponent(token)}`
	const res = await fetch(url, {
		headers: {
			Accept: 'application/json',
			...(process.env.LIFI_API_KEY && { 'x-lifi-api-key': process.env.LIFI_API_KEY }),
		},
	})
	if (!res.ok) throw new Error(`Could not resolve token "${token}" on ${chain}`)
	const body = (await res.json()) as { decimals?: number; symbol?: string }
	if (typeof body.decimals !== 'number') {
		throw new Error(`Token "${token}" on ${chain} has no decimals in the Li.Fi registry`)
	}
	decimalsCache.set(key, { decimals: body.decimals, expiry: Date.now() + DECIMALS_TTL_MS })
	return body.decimals
}

/**
 * One leg of a routed swap, display-shaped for the preview response. Most
 * cross-chain routes are more than one transaction — a swap on the source
 * chain, a bridge relay, a swap on the destination — and the desk's agents
 * reason about each leg, so the preview must not flatten them into a string.
 */
export interface PreviewHop {
	index: number
	/** Li.Fi step type: 'swap' (same-chain DEX), 'cross' (bridge/relay), 'protocol', … */
	type: string
	tool: string
	toolName: string
	fromChain: string | null
	toChain: string | null
	fromToken: string | null
	toToken: string | null
	/** Human-readable amounts, like the rest of the preview. */
	fromAmount: string | null
	toAmount: string | null
	estimatedGasUsd: string | null
	feeUsd: string | null
	estimatedDurationSeconds: number | null
}

/** Loosely-typed view of an includedStep's action — Li.Fi-shaped, guarded. */
interface HopAction {
	fromChainId?: number
	toChainId?: number
	fromToken?: { symbol?: string; decimals?: number }
	toToken?: { symbol?: string; decimals?: number }
}

const sumUsd = (rows: Array<{ amountUSD?: string }> | undefined): string | null => {
	if (!Array.isArray(rows) || rows.length === 0) return null
	const total = rows.reduce((acc, r) => acc + (Number.parseFloat(r.amountUSD ?? '') || 0), 0)
	return total.toFixed(4)
}

/**
 * Maps the aggregator's real route legs (`_rawQuote.includedSteps`) into the
 * preview's hop list. Read-only over the raw quote — this never selects or
 * mutates a route (see the comparison-only note in SwapService). Falls back to
 * a single synthetic hop when a provider answers without step detail, so
 * `hops` is never empty and `hopCount` is always honest about what we know.
 */
export function buildPreviewHops(quote: SwapQuote): PreviewHop[] {
	const steps = quote._rawQuote?.includedSteps
	if (Array.isArray(steps) && steps.length > 0) {
		return steps.map((step, index) => {
			const action = (step.action ?? {}) as HopAction
			const fromChainId = typeof action.fromChainId === 'number' ? action.fromChainId : null
			const toChainId = typeof action.toChainId === 'number' ? action.toChainId : null
			const fromDecimals = action.fromToken?.decimals
			const toDecimals = action.toToken?.decimals
			return {
				index,
				type: step.type || 'swap',
				tool: step.tool,
				toolName: step.toolDetails?.name ?? step.tool,
				fromChain: fromChainId !== null ? (chainKeyFromId(fromChainId) ?? String(fromChainId)) : null,
				toChain: toChainId !== null ? (chainKeyFromId(toChainId) ?? String(toChainId)) : null,
				fromToken: action.fromToken?.symbol ?? null,
				toToken: action.toToken?.symbol ?? null,
				fromAmount:
					typeof fromDecimals === 'number' && step.estimate?.fromAmount
						? fromBaseUnits(step.estimate.fromAmount, fromDecimals)
						: null,
				toAmount:
					typeof toDecimals === 'number' && step.estimate?.toAmount
						? fromBaseUnits(step.estimate.toAmount, toDecimals)
						: null,
				estimatedGasUsd: sumUsd(step.estimate?.gasCosts),
				feeUsd: sumUsd(step.estimate?.feeCosts),
				estimatedDurationSeconds: step.estimate?.executionDuration ?? null,
			}
		})
	}
	// Provider gave no step breakdown: report the whole quote as one hop.
	return [
		{
			index: 0,
			type: quote.fromChain === quote.toChain ? 'swap' : 'cross',
			tool: quote.route,
			toolName: quote.route,
			fromChain: quote.fromChain,
			toChain: quote.toChain,
			fromToken: quote.fromToken.symbol,
			toToken: quote.toToken.symbol,
			fromAmount: fromBaseUnits(quote.fromAmount, quote.fromToken.decimals),
			toAmount: fromBaseUnits(quote.toAmount, quote.toToken.decimals),
			estimatedGasUsd: quote.estimatedGasUsd || null,
			feeUsd: quote.bridgeFeeUsd || null,
			estimatedDurationSeconds: quote.estimatedDuration ?? null,
		},
	]
}

// ─── Public Routes (IP rate-limited, no auth) ───

/**
 * GET /public/swap/chains
 */
publicSwapRoutes.get('/chains', ipRateLimit(), async (c) => {
	const chains = [
		{
			id: 1,
			key: 'ethereum',
			name: 'Ethereum',
			logoURI:
				'https://raw.githubusercontent.com/lifinance/types/main/src/assets/icons/chains/ethereum.svg',
		},
		{
			id: 10,
			key: 'optimism',
			name: 'Optimism',
			logoURI:
				'https://raw.githubusercontent.com/lifinance/types/main/src/assets/icons/chains/optimism.svg',
		},
		{
			id: 56,
			key: 'bsc',
			name: 'BNB Chain',
			logoURI:
				'https://raw.githubusercontent.com/lifinance/types/main/src/assets/icons/chains/bsc.svg',
		},
		{
			id: 137,
			key: 'polygon',
			name: 'Polygon',
			logoURI:
				'https://raw.githubusercontent.com/lifinance/types/main/src/assets/icons/chains/polygon.svg',
		},
		{
			id: 42161,
			key: 'arbitrum',
			name: 'Arbitrum',
			logoURI:
				'https://raw.githubusercontent.com/lifinance/types/main/src/assets/icons/chains/arbitrum.svg',
		},
		{
			id: 43114,
			key: 'avalanche',
			name: 'Avalanche',
			logoURI:
				'https://raw.githubusercontent.com/lifinance/types/main/src/assets/icons/chains/avalanche.svg',
		},
		{
			id: 8453,
			key: 'base',
			name: 'Base',
			logoURI:
				'https://raw.githubusercontent.com/lifinance/types/main/src/assets/icons/chains/base.svg',
		},
		{
			id: 59144,
			key: 'linea',
			name: 'Linea',
			logoURI:
				'https://raw.githubusercontent.com/lifinance/types/main/src/assets/icons/chains/linea.svg',
		},
		{
			id: 324,
			key: 'zksync',
			name: 'zkSync Era',
			logoURI:
				'https://raw.githubusercontent.com/lifinance/types/main/src/assets/icons/chains/zksync.svg',
		},
	]
	return c.json({ chains })
})

/**
 * GET /public/swap/tokens?chainId=X
 */
publicSwapRoutes.get('/tokens', ipRateLimit(), async (c) => {
	const chainId = c.req.query('chainId')
	if (!chainId) {
		return c.json({ error: 'Validation Error', message: 'chainId is required' }, 400)
	}

	const result = await runEffectEither(
		Effect.gen(function* () {
			const redis = yield* RedisService
			const cacheKey = cacheKeys.tokenList(chainId)

			const cached = yield* Effect.either(
				redis.get<{
					chainId: number
					tokens: Array<{
						address: string
						symbol: string
						decimals: number
						name: string
						logoURI?: string
						priceUSD?: string
					}>
				}>(cacheKey),
			)
			if (Either.isRight(cached) && cached.right) {
				return cached.right
			}

			const response = yield* Effect.tryPromise({
				try: async () => {
					const res = await fetch(`https://li.quest/v1/tokens?chains=${chainId}`, {
						headers: {
							Accept: 'application/json',
							...(process.env.LIFI_API_KEY && {
								'x-lifi-api-key': process.env.LIFI_API_KEY,
							}),
						},
					})
					if (!res.ok) throw new Error(`Failed to fetch tokens: ${res.statusText}`)
					return (await res.json()) as {
						tokens: Record<
							string,
							Array<{
								address: string
								symbol: string
								decimals: number
								name: string
								logoURI?: string
								priceUSD?: string
							}>
						>
					}
				},
				catch: (e) => new Error(`Token fetch failed: ${e}`),
			})

			const tokens = response.tokens[chainId] || []
			const tokenListResponse = {
				chainId: parseInt(chainId, 10),
				tokens: tokens.slice(0, 50).map((t) => ({
					address: t.address,
					symbol: t.symbol,
					decimals: t.decimals,
					name: t.name,
					logoURI: t.logoURI,
					priceUSD: t.priceUSD,
				})),
			}

			yield* Effect.either(redis.set(cacheKey, tokenListResponse, TOKEN_LIST_TTL))
			return tokenListResponse
		}),
	)

	if (Either.isLeft(result)) {
		logger.error({ err: result.left }, '[PublicSwap] Failed to fetch tokens')
		return c.json({ error: 'Failed to fetch tokens' }, 500)
	}

	return c.json(result.right)
})

/**
 * GET /public/swap/preview
 *
 * Indicative, unauthenticated cross-chain route preview. This exists for the
 * WebMCP surface (showcase `/agent-terminal`), where a browser agent must be
 * able to price a swap with no credential at all.
 *
 * `fromAmount` is HUMAN-READABLE ("0.05"), unlike the authenticated /quote
 * route which takes base units. Agents and people both say "half an ETH", not
 * "5e17", so the endpoint resolves the token's decimals and converts. The
 * response echoes the human amount back and carries `fromAmountBaseUnits` and
 * `fromTokenDecimals` alongside it for anything that needs exact integers.
 *
 * MONEY-PATH NOTE: this is deliberately NOT executable. The quote is never
 * written to the quote cache and no `transactionRequest`/`txData` is returned,
 * so a preview quoteId can never be handed to POST /public/swap/execute (which
 * resolves quotes from the cache and would 404). Pricing uses a placeholder
 * receiver unless the caller names `fromAddress`, and the returned quoteId is
 * prefixed so it can't be mistaken for an executable one.
 */
publicSwapRoutes.get('/preview', ipRateLimit(), async (c) => {
	const fromChain = c.req.query('fromChain')
	const toChain = c.req.query('toChain') || fromChain
	const fromToken = c.req.query('fromToken')
	const toToken = c.req.query('toToken')
	const fromAmount = c.req.query('fromAmount')
	const slippageParam = c.req.query('slippage')
	const orderParam = (c.req.query('order') || 'RECOMMENDED').toUpperCase()
	const fromAddressParam = c.req.query('fromAddress')

	if (!fromChain || !toChain || !fromToken || !toToken || !fromAmount) {
		return c.json(
			{
				error: 'Validation Error',
				message: 'fromChain, toChain, fromToken, toToken and fromAmount are required',
			},
			400,
		)
	}

	if (!/^\d*\.?\d+$/.test(fromAmount) || Number(fromAmount) <= 0) {
		return c.json(
			{ error: 'Validation Error', message: 'fromAmount must be a positive decimal number' },
			400,
		)
	}

	const ORDERS = ['RECOMMENDED', 'FASTEST', 'CHEAPEST', 'SAFEST'] as const
	if (!ORDERS.includes(orderParam as (typeof ORDERS)[number])) {
		return c.json(
			{ error: 'Validation Error', message: `order must be one of ${ORDERS.join(', ')}` },
			400,
		)
	}

	// Only a well-formed EVM address is ever forwarded; anything else falls back
	// to the placeholder so a malformed value can't reach the aggregator.
	const fromAddress =
		fromAddressParam && /^0x[a-fA-F0-9]{40}$/.test(fromAddressParam)
			? fromAddressParam
			: PREVIEW_PLACEHOLDER_ADDRESS

	const slippage = slippageParam ? Number.parseFloat(slippageParam) : DEFAULT_SLIPPAGE
	if (!Number.isFinite(slippage) || slippage <= 0 || slippage > 0.5) {
		return c.json(
			{ error: 'Validation Error', message: 'slippage must be a fraction between 0 and 0.5' },
			400,
		)
	}

	// Li.Fi prices in base units; the desk and any agent speak human amounts.
	// Convert here rather than pushing the decimals problem onto every caller.
	let fromAmountBaseUnits: string
	let fromTokenDecimals: number
	try {
		fromTokenDecimals = await resolveTokenDecimals(fromChain, fromToken)
		fromAmountBaseUnits = toBaseUnits(fromAmount, fromTokenDecimals)
	} catch (e) {
		return c.json(
			{
				error: 'Validation Error',
				message: e instanceof Error ? e.message : String(e),
			},
			400,
		)
	}

	const result = await runEffectEither(
		Effect.gen(function* () {
			const swapService = yield* SwapService
			const quote = yield* swapService
				.getQuote({
					fromChain,
					toChain,
					fromToken,
					toToken,
					fromAmount: fromAmountBaseUnits,
					fromAddress,
					slippage,
					order: orderParam as (typeof ORDERS)[number],
				})
				.pipe(
					Effect.mapError((e) =>
						e instanceof ValidationError ? e : new ValidationError({ message: e.message }),
					),
				)

			const hops = buildPreviewHops(quote)

			return {
				indicative: true,
				executable: false,
				previewId: `preview_${quote.quoteId}`,
				order: orderParam,
				fromChain: quote.fromChain,
				toChain: quote.toChain,
				fromToken: quote.fromToken,
				toToken: quote.toToken,
				// Echo the amount the caller asked for. Li.Fi answers in base
				// units; handing that back would have every UI render 5e16 ETH.
				fromAmount,
				fromAmountBaseUnits: quote.fromAmount,
				fromTokenDecimals,
				fromAmountUsd: quote.fromAmountUsd,
				// Same reason fromAmount is echoed human-readable: base units in a
				// UI read as absurd numbers, and the desk shows this to a person
				// who is deciding whether to approve it.
				toAmount: fromBaseUnits(quote.toAmount, quote.toToken.decimals),
				toAmountMin: fromBaseUnits(quote.toAmountMin, quote.toToken.decimals),
				toAmountBaseUnits: quote.toAmount,
				toAmountMinBaseUnits: quote.toAmountMin,
				toAmountUsd: quote.toAmountUsd,
				exchangeRate: quote.exchangeRate,
				priceImpact: quote.priceImpact,
				estimatedGasUsd: quote.estimatedGasUsd,
				bridgeFeeUsd: quote.bridgeFeeUsd,
				estimatedDurationSeconds: quote.estimatedDuration,
				slippage: quote.slippage,
				route: quote.route,
				// The real legs of the route. Most cross-chain routes are more
				// than one transaction; agents plan against hops, not the string.
				hops,
				hopCount: hops.length,
				pricedFor: fromAddress,
				notice:
					'Indicative preview only. Not executable and not tied to a wallet — ' +
					'the human must confirm and sign the real swap.',
			}
		}),
	)

	if (Either.isLeft(result)) {
		const { status, body } = mapErrorToResponse(result.left as any)
		return c.json(body, status)
	}

	return c.json(result.right)
})

// ─── Authenticated Routes (flexAuth) ───

/**
 * GET /public/swap/quote
 */
publicSwapRoutes.get('/quote', flexAuth(), async (c) => {
	const authUser = c.get('authUser') as AuthUser

	const fromChain = c.req.query('fromChain')
	const toChain = c.req.query('toChain')
	const fromToken = c.req.query('fromToken')
	const toToken = c.req.query('toToken')
	const fromAmount = c.req.query('fromAmount')
	const slippage = c.req.query('slippage')
	const order = c.req.query('order') as
		| 'RECOMMENDED'
		| 'FASTEST'
		| 'CHEAPEST'
		| 'SAFEST'
		| undefined

	const result = await runEffectEither(
		Effect.gen(function* () {
			const swapService = yield* SwapService
			const redis = yield* RedisService

			// Use auth user's wallet or vitalik.eth placeholder
			const walletAddress = authUser.walletAddress || '0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045'

			if (!fromChain || !toChain || !fromToken || !toToken || !fromAmount) {
				return yield* Effect.fail(
					new ValidationError({
						message: 'Missing required parameters',
						fields: {
							...(fromChain ? {} : { fromChain: 'required' }),
							...(toChain ? {} : { toChain: 'required' }),
							...(fromToken ? {} : { fromToken: 'required' }),
							...(toToken ? {} : { toToken: 'required' }),
							...(fromAmount ? {} : { fromAmount: 'required' }),
						},
					}),
				)
			}

			const quoteParams: QuoteParams = {
				fromChain,
				toChain,
				fromToken,
				toToken,
				fromAmount,
				fromAddress: walletAddress,
				slippage: slippage ? parseFloat(slippage) : DEFAULT_SLIPPAGE,
				order: order || 'RECOMMENDED',
			}

			const quote = yield* swapService.getQuote(quoteParams).pipe(
				Effect.mapError((e) => {
					if (e instanceof ValidationError) return e
					return new ValidationError({ message: e.message })
				}),
			)

			yield* cacheQuote(redis, quote)

			const { _rawQuote, transactionRequest, ...publicQuote } = quote
			return {
				...publicQuote,
				txData: {
					to: transactionRequest.to,
					value: transactionRequest.value,
					chainId: transactionRequest.chainId,
					gasLimit: transactionRequest.gasLimit,
				},
			}
		}),
	)

	if (Either.isLeft(result)) {
		const { status, body } = mapErrorToResponse(result.left as any)
		return c.json(body, status)
	}

	return c.json(result.right)
})

/**
 * POST /public/swap/execute
 */
publicSwapRoutes.post('/execute', flexAuth(), async (c) => {
	const authUser = c.get('authUser') as AuthUser
	const body = await c.req.json().catch(() => ({}))
	const { quoteId, idempotencyKey } = body as { quoteId?: string; idempotencyKey?: string }

	if (!quoteId) {
		return c.json({ error: 'Validation Error', message: 'quoteId is required' }, 400)
	}

	const result = await runEffectEither(
		Effect.gen(function* () {
			const env = yield* EnvService
			const walletService = yield* WalletService
			const swapService = yield* SwapService
			const redis = yield* RedisService

			// Get user's wallet. Select the wallet the quote was built for — the
			// JWT's walletAddress — not just the first active row. Otherwise a
			// multi-wallet user's receiver check (below) compares against the wrong
			// wallet and their swap is wrongly blocked, and we could sign from a
			// wallet the quote wasn't built for. EVM addresses compare
			// case-insensitively; a JWT without walletAddress (non-showcase flows)
			// keeps the prior first-wallet behavior.
			const wallets = yield* walletService.getActiveWallets(authUser.userId)
			const wallet = authUser.walletAddress
				? wallets.find(
						(w) => w.address.toLowerCase() === authUser.walletAddress!.toLowerCase(),
					)
				: wallets[0]
			if (!wallet) {
				return yield* Effect.fail(
					new NotFoundError({ message: 'No wallet found', resource: 'wallet' }),
				)
			}

			if (wallet.walletProvider !== 'turnkey' || !wallet.turnkeySubOrgId) {
				return yield* Effect.fail(
					new ValidationError({
						message: 'Wallet does not support server-side signing.',
					}),
				)
			}

			const quote = yield* getCachedQuote(redis, quoteId)
			if (!quote) {
				return yield* Effect.fail(
					new ValidationError({
						message: 'Quote expired or not found. Please request a new quote.',
					}),
				)
			}

			// MONEY-PATH (H5 fix): refuse to sign a quote whose baked-in receiver
			// isn't this wallet — see assertQuoteReceiverMatchesWallet above.
			const receiverCheck = assertQuoteReceiverMatchesWallet(quote, wallet.address)
			if (!receiverCheck.ok) {
				return yield* Effect.fail(new ValidationError({ message: receiverCheck.reason }))
			}

			const swapRecord = yield* swapService.createSwapRecord({
				userId: authUser.userId,
				fromChain: quote.fromChain,
				toChain: quote.toChain,
				fromToken: quote.fromToken.symbol,
				toToken: quote.toToken.symbol,
				fromAmount: quote.fromAmount,
				toAmount: quote.toAmount,
				fromAmountUsd: parseFloat(quote.fromAmountUsd) || null,
				toAmountUsd: parseFloat(quote.toAmountUsd) || null,
				status: 'pending',
				routeProvider: 'lifi',
				routeData: JSON.stringify(quote._rawQuote),
				slippage: Math.round(quote.slippage * 10000),
				gasFee: parseFloat(quote.estimatedGasUsd) || null,
				bridgeFee: parseFloat(quote.bridgeFeeUsd) || null,
				idempotencyKey,
			})

			if (
				!env.TURNKEY_API_PUBLIC_KEY ||
				!env.TURNKEY_API_PRIVATE_KEY ||
				!env.TURNKEY_ORGANIZATION_ID
			) {
				yield* swapService.updateSwapStatus(
					swapRecord.id,
					'failed',
					undefined,
					'Turnkey not configured',
				)
				return yield* Effect.fail(
					new ValidationError({ message: 'Signing service not configured' }),
				)
			}

			const turnkeyClient = new Turnkey({
				apiBaseUrl: env.TURNKEY_BASE_URL || 'https://api.turnkey.com',
				apiPublicKey: env.TURNKEY_API_PUBLIC_KEY,
				apiPrivateKey: env.TURNKEY_API_PRIVATE_KEY,
				defaultOrganizationId: wallet.turnkeySubOrgId!,
			})

			const txRequest = quote.transactionRequest

			logger.info({
				swapId: swapRecord.id,
				from: txRequest.from,
				to: txRequest.to,
				chainId: txRequest.chainId,
			}, '[PublicSwap] Signing transaction')

			const publicSwapUnsignedTx = {
							type: '0x2',
							chainId: `0x${txRequest.chainId.toString(16)}`,
							to: txRequest.to,
							value: txRequest.value,
							data: txRequest.data,
							...(txRequest.gasPrice ? { maxFeePerGas: txRequest.gasPrice } : {}),
							maxPriorityFeePerGas: '0x0',
							gas: txRequest.gasLimit || '0x0',
						}
			const signResult = yield* Effect.tryPromise({
				try: async () => {
					return await withSigningFallback(
						async () => {
							const result = await turnkeyClient.apiClient().signTransaction({
								organizationId: wallet.turnkeySubOrgId!,
								signWith: wallet.address,
								type: 'TRANSACTION_TYPE_ETHEREUM',
								unsignedTransaction: JSON.stringify(publicSwapUnsignedTx),
							})
							return result.signedTransaction
						},
						wallet.id,
						// wallet.userId === authUser.userId (getActiveWallets filters by it)
						// and maps to Python wallets.user_id — required for ownership check.
						authUser.userId,
						publicSwapUnsignedTx,
					)
				},
				catch: (e) => new Error(`Failed to sign transaction: ${e}`),
			})

			const signedTransaction = signResult.signedTransaction

			const rpcUrl = CHAIN_RPC_ENDPOINTS[txRequest.chainId]
			let txHash: string | null = null

			if (rpcUrl) {
				const broadcastResult = yield* Effect.tryPromise({
					try: async () => {
						const res = await fetchWithRetry(rpcUrl, {
							method: 'POST',
							headers: { 'Content-Type': 'application/json' },
							body: JSON.stringify({
								jsonrpc: '2.0',
								method: 'eth_sendRawTransaction',
								params: [signedTransaction],
								id: 1,
							}),
						})
						const data = (await res.json()) as {
							result?: string
							error?: { message: string; code: number }
						}
						if (data.error) {
							throw new Error(`RPC error: ${data.error.message} (code ${data.error.code})`)
						}
						return data.result as string
					},
					catch: (e) => new Error(`Failed to broadcast transaction: ${e}`),
				})
				txHash = broadcastResult
				logger.info('[PublicSwap] Transaction broadcast, txHash: %s', txHash)
			}

			const newStatus = txHash ? 'submitted' : 'signed'
			// SECURITY: Never persist the raw signed tx into tx_hash — a signed,
			// un-broadcast tx is replayable. Store null on broadcast failure and
			// keep the non-terminal 'signed' status.
			yield* swapService.updateSwapStatus(swapRecord.id, newStatus, txHash ?? undefined)
			yield* deleteCachedQuote(redis, quoteId)

			return {
				success: true,
				swapId: swapRecord.id,
				status: newStatus,
				txHash,
				signedTransaction: txHash ? undefined : signedTransaction,
				message: txHash
					? 'Transaction submitted to the network.'
					: 'Transaction signed but no RPC available for broadcast.',
				swap: {
					fromChain: quote.fromChain,
					toChain: quote.toChain,
					fromToken: quote.fromToken.symbol,
					toToken: quote.toToken.symbol,
					fromAmount: quote.fromAmount,
					expectedToAmount: quote.toAmount,
				},
			}
		}),
	)

	if (Either.isLeft(result)) {
		const error = result.left
		logger.error({ err: error }, '[PublicSwap] Execute error')
		if ('status' in error) {
			const { status, body } = mapErrorToResponse(error as any)
			return c.json(body, status)
		}
		return c.json(
			{ error: 'Internal Error', message: (error as Error).message || 'Failed to execute swap' },
			500,
		)
	}

	return c.json(result.right)
})

/**
 * GET /public/swap/status/:swapId
 */
publicSwapRoutes.get('/status/:swapId', flexAuth(), async (c) => {
	const authUser = c.get('authUser') as AuthUser
	const swapId = parseInt(c.req.param('swapId') ?? '', 10)

	if (isNaN(swapId)) {
		return c.json({ error: 'Validation Error', message: 'Invalid swap ID' }, 400)
	}

	const result = await runEffectEither(
		Effect.gen(function* () {
			const swapService = yield* SwapService

			const swap = yield* swapService.getSwapById(swapId)
			if (!swap) {
				return yield* Effect.fail(
					new NotFoundError({ message: 'Swap not found', resource: 'swap' }),
				)
			}

			if (swap.userId !== authUser.userId) {
				return yield* Effect.fail(
					new NotFoundError({ message: 'Swap not found', resource: 'swap' }),
				)
			}

			return {
				id: swap.id,
				status: swap.status,
				fromChain: swap.fromChain,
				toChain: swap.toChain,
				fromToken: swap.fromToken,
				toToken: swap.toToken,
				fromAmount: swap.fromAmount,
				toAmount: swap.toAmount,
				txHash: swap.txHash,
				bridgeTxHash: swap.bridgeTxHash,
				destinationTxHash: swap.destinationTxHash,
				errorMessage: swap.errorMessage,
				createdAt: swap.createdAt?.toISOString(),
				completedAt: swap.completedAt?.toISOString(),
			}
		}),
	)

	if (Either.isLeft(result)) {
		const { status, body } = mapErrorToResponse(result.left as any)
		return c.json(body, status)
	}

	return c.json(result.right)
})

// ─── Passkey Auth Endpoint ───

/**
 * POST /public/swap/auth
 * Authenticate a passkey user from the showcase site.
 *
 * MONEY-PATH / SECURITY (C1 fix — was a live account-takeover): wallet
 * addresses are public on-chain, so `{subOrgId, walletAddress}` alone proves
 * NOTHING about who is asking. The old handler looked up the wallet row by
 * address and minted a 7-day JWT for `existingWalletRow.userId` with zero
 * proof the caller controls that wallet/sub-org — anyone could mint anyone
 * else's session and drain them via POST /public/swap/execute, which signs
 * with the server's own Turnkey key.
 *
 * Fix: the caller must additionally submit `stampedWhoami`, a Turnkey
 * "stamped" GetWhoami request (produced client-side via the Turnkey browser
 * SDK's `stampGetWhoami({ organizationId: subOrgId })`, signed with the
 * caller's own passkey/session credential — see @turnkey/http's
 * `TSignedRequest = { url, body, stamp: { stampHeaderName, stampHeaderValue } }`).
 * We forward that stamped request verbatim to Turnkey's own
 * /public/v1/query/whoami endpoint: Turnkey verifies the signature against
 * the credential registered on the claimed sub-org and returns the
 * organizationId it actually resolves to. We then independently confirm
 * `walletAddress` is a real wallet account under that verified sub-org via
 * our own Turnkey admin key (the same trust relationship /execute already
 * relies on to sign) — Ethereum addresses are deterministically derived from
 * a Turnkey wallet's seed, so no other sub-org can ever legitimately produce
 * the victim's address. Any failure anywhere in this chain fails closed with
 * 401 — we never mint a JWT on an unverified path.
 */
publicSwapRoutes.post('/auth', ipRateLimit(), async (c) => {
	const body = await c.req.json().catch(() => ({}))
	const { subOrgId, walletAddress, stampedWhoami } = body as {
		subOrgId?: string
		walletAddress?: string
		stampedWhoami?: {
			url?: string
			body?: string
			stamp?: { stampHeaderName?: string; stampHeaderValue?: string }
		}
	}

	if (!subOrgId || !walletAddress) {
		return c.json({ error: 'subOrgId and walletAddress are required' }, 400)
	}

	// MONEY-PATH / SECURITY: no verifiable ownership proof, no JWT. Fail closed.
	const whoamiUrl = stampedWhoami?.url
	const whoamiBody = stampedWhoami?.body
	const stampHeaderName = stampedWhoami?.stamp?.stampHeaderName
	const stampHeaderValue = stampedWhoami?.stamp?.stampHeaderValue
	if (!whoamiUrl || !whoamiBody || !stampHeaderName || !stampHeaderValue) {
		return c.json(
			{
				error: 'Unauthorized',
				message:
					'A stamped Turnkey whoami request proving control of subOrgId is required: ' +
					'{ stampedWhoami: { url, body, stamp: { stampHeaderName, stampHeaderValue } } } ' +
					'(client: turnkeyClient.stampGetWhoami({ organizationId: subOrgId })).',
			},
			401,
		)
	}

	const result = await runEffectEither(
		Effect.gen(function* () {
			const env = yield* EnvService
			const userService = yield* UserService
			const walletService = yield* WalletService

			const turnkeyBase = env.TURNKEY_BASE_URL || 'https://api.turnkey.com'
			const expectedWhoamiUrl = `${turnkeyBase}/public/v1/query/whoami`

			// SSRF / mix-up guard: only ever forward the stamp to Turnkey's real
			// whoami endpoint, never wherever the caller points us.
			if (whoamiUrl !== expectedWhoamiUrl) {
				return yield* Effect.fail(
					new UnauthorizedError({
						message: 'stampedWhoami.url must target the Turnkey whoami endpoint',
					}),
				)
			}

			// Forward the caller's stamped request to Turnkey verbatim. Turnkey
			// verifies the signature against the credential registered on the
			// claimed sub-org and tells us which org it actually belongs to — this
			// IS the proof of control; we never see or need the private key.
			const whoamiResponse = yield* Effect.tryPromise({
				try: async () => {
					const res = await fetch(expectedWhoamiUrl, {
						method: 'POST',
						headers: { [stampHeaderName]: stampHeaderValue, 'Content-Type': 'application/json' },
						body: whoamiBody,
					})
					if (!res.ok) {
						throw new Error(`Turnkey whoami rejected the stamp (status ${res.status})`)
					}
					return (await res.json()) as { organizationId?: string; userId?: string }
				},
				catch: (e) => new UnauthorizedError({ message: `Failed to verify Turnkey session: ${e}` }),
			})

			if (!whoamiResponse.organizationId || whoamiResponse.organizationId !== subOrgId) {
				return yield* Effect.fail(
					new UnauthorizedError({
						message: 'Verified Turnkey session does not control the claimed subOrgId',
					}),
				)
			}

			if (!env.TURNKEY_API_PUBLIC_KEY || !env.TURNKEY_API_PRIVATE_KEY || !env.TURNKEY_ORGANIZATION_ID) {
				return yield* Effect.fail(
					new UnauthorizedError({
						message: 'Signing service not configured; cannot verify wallet ownership',
					}),
				)
			}

			// Independently confirm walletAddress is actually an account under the
			// now-verified subOrgId (not just any address the caller typed in).
			const turnkeyClient = new Turnkey({
				apiBaseUrl: turnkeyBase,
				apiPublicKey: env.TURNKEY_API_PUBLIC_KEY,
				apiPrivateKey: env.TURNKEY_API_PRIVATE_KEY,
				defaultOrganizationId: subOrgId,
			})
			const accountsResult = yield* Effect.tryPromise({
				try: () => turnkeyClient.apiClient().getWalletAccounts({ organizationId: subOrgId }),
				catch: (e) => new UnauthorizedError({ message: `Failed to verify wallet ownership: ${e}` }),
			})
			const ownsAddress = accountsResult.accounts.some(
				(a) => a.address.toLowerCase() === walletAddress.toLowerCase(),
			)
			if (!ownsAddress) {
				return yield* Effect.fail(
					new UnauthorizedError({ message: 'walletAddress does not belong to the verified subOrgId' }),
				)
			}

			// Find existing wallet by address
			const db = yield* requireDb
			const existingWallet = yield* Effect.tryPromise({
				try: () => db.select().from(wallets).where(eq(wallets.address, walletAddress)).limit(1),
				catch: () => new Error('Database query failed'),
			})

			let userId: number

			const existingWalletRow = existingWallet[0]
			if (existingWalletRow) {
				// Defense in depth: the DB row's own subOrgId must agree with the
				// one we just proved control of.
				if (existingWalletRow.turnkeySubOrgId !== subOrgId) {
					return yield* Effect.fail(
						new UnauthorizedError({
							message: 'walletAddress is registered under a different subOrgId',
						}),
					)
				}
				userId = existingWalletRow.userId
			} else {
				// Create new user for showcase passkey auth
				const { user } = yield* userService.getOrCreateUser({
					telegramId: -(Date.now() % 2147483647), // Unique negative ID for passkey users (no telegram ID)
					username: `passkey_${walletAddress.slice(0, 8)}`,
					firstName: 'Passkey',
					lastName: 'User',
				})
				userId = user.id

				// Create wallet record
				yield* walletService.createTurnkeyWallet({
					userId,
					address: walletAddress,
					turnkeySubOrgId: subOrgId,
					turnkeyWalletId: '',
					turnkeyAccountId: '',
				})
			}

			// Generate JWT — only reachable once ownership is verified above.
			if (!env.JWT_SECRET) {
				return yield* Effect.fail(new Error('JWT_SECRET not configured'))
			}
			const jwtSecret = env.JWT_SECRET
			const token = jwt.sign({ userId, walletAddress }, jwtSecret, { expiresIn: '7d' })

			return {
				jwt: token,
				user: { id: userId },
				walletAddress,
			}
		}),
	)

	if (Either.isLeft(result)) {
		const error = result.left
		logger.error({ err: error }, '[PublicSwap] Auth error')
		if (error && typeof error === 'object' && '_tag' in error) {
			const { status, body } = mapErrorToResponse(error as any)
			return c.json(body, status)
		}
		return c.json({ error: (error as Error).message || 'Authentication failed' }, 500)
	}

	return c.json(result.right)
})

export { publicSwapRoutes }
