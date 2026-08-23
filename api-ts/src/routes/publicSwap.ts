import { createHash } from 'node:crypto'
import { Turnkey } from '@turnkey/sdk-server'
import { eq } from 'drizzle-orm'
import { Effect, Either, Option } from 'effect'
import { Hono } from 'hono'
import type { ContentfulStatusCode } from 'hono/utils/http-status'
import jwt from 'jsonwebtoken'
import { keccak256 } from 'viem'
import { EnvService } from '../config/EnvService'
import { DEFAULT_SLIPPAGE } from '../config/constants'
import { logger } from '../lib/logger'
import { DrizzleService, requireDb, type SwapTransaction, wallets } from '../db'
import { mapErrorToResponse, NotFoundError, UnauthorizedError, ValidationError } from '../errors'
import { fetchWithRetry } from '../lib/retry'
import { withSigningFallback } from '../services/FallbackSigningService'
import { claimSwapExecution } from '../services/swapExecutionClaim'
import { type AuthUser, flexAuth } from '../middleware/flexAuth'
import { ipRateLimit } from '../middleware/ipRateLimit'
import { runEffectEither } from '../runtime'
import {
	cacheKeys,
	QUOTE_TTL,
	type QuoteParams,
	RedisService,
	type RedisServiceInterface,
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
 * without spinning up the Effect/DB/Turnkey stack.
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
 * Public-swap idempotency keys are scoped to the authenticated principal and
 * endpoint. Raw caller keys are hashed before persistence so two users can use
 * the same client key without colliding on the global DB uniqueness index.
 * When a client omits a key, the quote ID becomes the durable operation
 * identity so an HTTP retry cannot silently become a second signing attempt.
 */
export function derivePublicSwapIdempotencyKey(
	userId: number,
	quoteId: string,
	clientKey?: string,
): string {
	const supplied = clientKey?.trim()
	const kind = supplied ? 'key' : 'quote'
	const material = supplied || quoteId
	const digest = createHash('sha256').update(material).digest('hex')
	return `public-swap:${userId}:${kind}:${digest}`
}

export function publicSwapReplayEnvelope(record: SwapTransaction) {
	const status = record.status ?? 'pending'
	const successful = status === 'submitted' || status === 'completed'
	const terminalFailure = status === 'failed' || status === 'cancelled'
	return {
		httpStatus: successful ? 200 : terminalFailure ? 409 : 202,
		body: {
			success: !terminalFailure,
			idempotentReplay: true,
			swapId: record.id,
			status,
			txHash: record.txHash,
			reconcileRequired: !successful && !terminalFailure,
			statusUrl: `/public/swap/status/${record.id}`,
			message: successful
				? 'This operation was already submitted; returning the durable execution record.'
				: terminalFailure
					? 'This idempotency key belongs to a failed terminal operation. Use a new key and new quote for a new execution.'
					: 'This operation is already claimed. Do not create a new execution; reconcile the existing swap status.',
		},
	}
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
					new ValidationError({ message: 'Wallet does not support server-side signing.' }),
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

			const receiverCheck = assertQuoteReceiverMatchesWallet(quote, wallet.address)
			if (!receiverCheck.ok) {
				return yield* Effect.fail(new ValidationError({ message: receiverCheck.reason }))
			}

			const effectiveIdempotencyKey = derivePublicSwapIdempotencyKey(
				authUser.userId,
				quoteId,
				idempotencyKey,
			)
			const executionInput = {
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
				idempotencyKey: effectiveIdempotencyKey,
			}

			const claim = yield* claimSwapExecution(executionInput)
			if (claim.kind === 'conflict') {
				return {
					httpStatus: 409 as const,
					body: {
						success: false,
						error: 'Idempotency Conflict',
						error_code: 'IDEMPOTENCY_CONFLICT',
						message: 'This idempotency key was already used for different swap terms.',
						swapId: claim.record.id,
						status: claim.record.status,
						differingFields: claim.differingFields,
						statusUrl: `/public/swap/status/${claim.record.id}`,
					},
				}
			}
			if (claim.kind === 'replay') return publicSwapReplayEnvelope(claim.record)

			const swapRecord = claim.record
			yield* swapService.updateSwapStatus(swapRecord.id, 'signing')

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

			const signAttempt = yield* Effect.either(
				Effect.tryPromise({
					try: async () => {
						return await withSigningFallback(
							async () => {
								const signed = await turnkeyClient.apiClient().signTransaction({
									organizationId: wallet.turnkeySubOrgId!,
									signWith: wallet.address,
									type: 'TRANSACTION_TYPE_ETHEREUM',
									unsignedTransaction: JSON.stringify(publicSwapUnsignedTx),
								})
								return signed.signedTransaction
							},
							wallet.id,
							authUser.userId,
							publicSwapUnsignedTx,
						)
					},
					catch: (e) => new Error(`Failed to sign transaction: ${e}`),
				}),
			)
			if (Either.isLeft(signAttempt)) {
				yield* swapService.updateSwapStatus(
					swapRecord.id,
					'failed',
					undefined,
					signAttempt.left.message,
				)
				return yield* Effect.fail(signAttempt.left)
			}

			const signedTransaction = signAttempt.right.signedTransaction
			const expectedTxHash = keccak256(signedTransaction as `0x${string}`)
			yield* swapService.updateSwapStatus(swapRecord.id, 'signed', expectedTxHash)

			const rpcUrl = CHAIN_RPC_ENDPOINTS[txRequest.chainId]
			let txHash: string | null = null

			if (rpcUrl) {
				const broadcastAttempt = yield* Effect.either(
					Effect.tryPromise({
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
							if (!data.result) throw new Error('RPC returned no transaction hash')
							return data.result
						},
						catch: (e) => new Error(`Failed to broadcast transaction: ${e}`),
					}),
				)

				if (Either.isLeft(broadcastAttempt)) {
					logger.error(
						{ err: broadcastAttempt.left, swapId: swapRecord.id, expectedTxHash },
						'[PublicSwap] Broadcast outcome unknown; preserving signed identity',
					)
					return {
						httpStatus: 502 as const,
						body: {
							success: false,
							error: 'Broadcast Outcome Unknown',
							error_code: 'UPSTREAM_ERROR',
							message:
								'RPC broadcast did not return a confirmed outcome. Do not request a new execution. Reconcile or rebroadcast these exact signed bytes.',
							swapId: swapRecord.id,
							status: 'signed',
							txHash: expectedTxHash,
							signedTransaction,
							reconcileRequired: true,
							statusUrl: `/public/swap/status/${swapRecord.id}`,
						},
					}
				}

				txHash = broadcastAttempt.right
				if (txHash.toLowerCase() !== expectedTxHash.toLowerCase()) {
					logger.error(
						{ swapId: swapRecord.id, expectedTxHash, rpcTxHash: txHash },
						'[PublicSwap] RPC returned transaction hash different from signed payload hash',
					)
					return {
						httpStatus: 502 as const,
						body: {
							success: false,
							error: 'Transaction Identity Mismatch',
							error_code: 'UPSTREAM_ERROR',
							message: 'RPC transaction identity did not match the signed payload. Reconcile by the locally computed transaction hash.',
							swapId: swapRecord.id,
							status: 'signed',
							txHash: expectedTxHash,
							reconcileRequired: true,
							statusUrl: `/public/swap/status/${swapRecord.id}`,
						},
					}
				}

				logger.info('[PublicSwap] Transaction broadcast, txHash: %s', txHash)
				yield* swapService.updateSwapStatus(swapRecord.id, 'submitted', txHash)
			}

			yield* deleteCachedQuote(redis, quoteId)
			const newStatus = txHash ? 'submitted' : 'signed'
			return {
				httpStatus: 200 as const,
				body: {
					success: true,
					swapId: swapRecord.id,
					status: newStatus,
					txHash: txHash ?? expectedTxHash,
					signedTransaction: txHash ? undefined : signedTransaction,
					reconcileRequired: !txHash,
					statusUrl: `/public/swap/status/${swapRecord.id}`,
					message: txHash
						? 'Transaction submitted to the network.'
						: 'Transaction signed but no RPC is configured. Broadcast these exact signed bytes; do not request a new execution.',
					swap: {
						fromChain: quote.fromChain,
						toChain: quote.toChain,
						fromToken: quote.fromToken.symbol,
						toToken: quote.toToken.symbol,
						fromAmount: quote.fromAmount,
						expectedToAmount: quote.toAmount,
					},
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

	return c.json(result.right.body, result.right.httpStatus as ContentfulStatusCode)
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
				reconcileRequired: swap.status === 'signing' || swap.status === 'signed',
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

			if (whoamiUrl !== expectedWhoamiUrl) {
				return yield* Effect.fail(
					new UnauthorizedError({
						message: 'stampedWhoami.url must target the Turnkey whoami endpoint',
					}),
				)
			}

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

			const db = yield* requireDb
			const existingWallet = yield* Effect.tryPromise({
				try: () => db.select().from(wallets).where(eq(wallets.address, walletAddress)).limit(1),
				catch: () => new Error('Database query failed'),
			})

			let userId: number
			const existingWalletRow = existingWallet[0]
			if (existingWalletRow) {
				if (existingWalletRow.turnkeySubOrgId !== subOrgId) {
					return yield* Effect.fail(
						new UnauthorizedError({
							message: 'walletAddress is registered under a different subOrgId',
						}),
					)
				}
				userId = existingWalletRow.userId
			} else {
				const { user } = yield* userService.getOrCreateUser({
					telegramId: -(Date.now() % 2147483647),
					username: `passkey_${walletAddress.slice(0, 8)}`,
					firstName: 'Passkey',
					lastName: 'User',
				})
				userId = user.id

				yield* walletService.createTurnkeyWallet({
					userId,
					address: walletAddress,
					turnkeySubOrgId: subOrgId,
					turnkeyWalletId: '',
					turnkeyAccountId: '',
				})
			}

			if (!env.JWT_SECRET) {
				return yield* Effect.fail(new Error('JWT_SECRET not configured'))
			}
			const token = jwt.sign({ userId, walletAddress }, env.JWT_SECRET, { expiresIn: '7d' })

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
