import { Hono } from 'hono'
import { Effect, Either, Option } from 'effect'
import { Turnkey } from '@turnkey/sdk-server'
import { eq } from 'drizzle-orm'
import jwt from 'jsonwebtoken'
import { flexAuth, type AuthUser } from '../middleware/flexAuth'
import { ipRateLimit } from '../middleware/ipRateLimit'
import { SwapService, UserService, WalletService, RedisService, cacheKeys, QUOTE_TTL, TOKEN_LIST_TTL, type QuoteParams, type SwapQuote, type RedisServiceInterface } from '../services'
import { runEffectEither } from '../runtime'
import { mapErrorToResponse, ValidationError, NotFoundError } from '../errors'
import { EnvService } from '../config/EnvService'
import { DrizzleService, requireDb, wallets } from '../db'

const publicSwapRoutes = new Hono()

// Chain ID to RPC endpoint mapping (shared with swap.ts)
const alchemyKey = process.env.ALCHEMY_API_KEY || ''
const CHAIN_RPC_ENDPOINTS: Record<number, string> = {
	1: process.env.ETH_RPC_URL || (alchemyKey ? `https://eth-mainnet.g.alchemy.com/v2/${alchemyKey}` : 'https://eth.llamarpc.com'),
	10: process.env.OPTIMISM_RPC_URL || (alchemyKey ? `https://opt-mainnet.g.alchemy.com/v2/${alchemyKey}` : 'https://optimism.llamarpc.com'),
	56: process.env.BSC_RPC_URL || 'https://bsc.llamarpc.com',
	137: process.env.POLYGON_RPC_URL || (alchemyKey ? `https://polygon-mainnet.g.alchemy.com/v2/${alchemyKey}` : 'https://polygon.llamarpc.com'),
	8453: process.env.BASE_RPC_URL || (alchemyKey ? `https://base-mainnet.g.alchemy.com/v2/${alchemyKey}` : 'https://base.llamarpc.com'),
	42161: process.env.ARBITRUM_RPC_URL || (alchemyKey ? `https://arb-mainnet.g.alchemy.com/v2/${alchemyKey}` : 'https://arbitrum.llamarpc.com'),
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

const getCachedQuote = (redis: RedisServiceInterface, quoteId: string): Effect.Effect<SwapQuote | null, never> =>
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

const deleteCachedQuote = (redis: RedisServiceInterface, quoteId: string): Effect.Effect<void, never> =>
	Effect.gen(function* () {
		const key = cacheKeys.quote(quoteId)
		yield* Effect.either(redis.del(key))
		quoteCacheMemory.delete(quoteId)
	})

// ─── Public Routes (IP rate-limited, no auth) ───

/**
 * GET /public/swap/chains
 */
publicSwapRoutes.get('/chains', ipRateLimit(), async (c) => {
	const chains = [
		{ id: 1, key: 'ethereum', name: 'Ethereum', logoURI: 'https://raw.githubusercontent.com/lifinance/types/main/src/assets/icons/chains/ethereum.svg' },
		{ id: 10, key: 'optimism', name: 'Optimism', logoURI: 'https://raw.githubusercontent.com/lifinance/types/main/src/assets/icons/chains/optimism.svg' },
		{ id: 56, key: 'bsc', name: 'BNB Chain', logoURI: 'https://raw.githubusercontent.com/lifinance/types/main/src/assets/icons/chains/bsc.svg' },
		{ id: 137, key: 'polygon', name: 'Polygon', logoURI: 'https://raw.githubusercontent.com/lifinance/types/main/src/assets/icons/chains/polygon.svg' },
		{ id: 42161, key: 'arbitrum', name: 'Arbitrum', logoURI: 'https://raw.githubusercontent.com/lifinance/types/main/src/assets/icons/chains/arbitrum.svg' },
		{ id: 43114, key: 'avalanche', name: 'Avalanche', logoURI: 'https://raw.githubusercontent.com/lifinance/types/main/src/assets/icons/chains/avalanche.svg' },
		{ id: 8453, key: 'base', name: 'Base', logoURI: 'https://raw.githubusercontent.com/lifinance/types/main/src/assets/icons/chains/base.svg' },
		{ id: 59144, key: 'linea', name: 'Linea', logoURI: 'https://raw.githubusercontent.com/lifinance/types/main/src/assets/icons/chains/linea.svg' },
		{ id: 324, key: 'zksync', name: 'zkSync Era', logoURI: 'https://raw.githubusercontent.com/lifinance/types/main/src/assets/icons/chains/zksync.svg' },
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

			const cached = yield* Effect.either(redis.get<{ chainId: number; tokens: Array<{ address: string; symbol: string; decimals: number; name: string; logoURI?: string; priceUSD?: string }> }>(cacheKey))
			if (Either.isRight(cached) && cached.right) {
				return cached.right
			}

			const response = yield* Effect.tryPromise({
				try: async () => {
					const res = await fetch(`https://li.quest/v1/tokens?chains=${chainId}`, {
						headers: {
							'Accept': 'application/json',
							...(process.env.LIFI_API_KEY && {
								'x-lifi-api-key': process.env.LIFI_API_KEY,
							}),
						},
					})
					if (!res.ok) throw new Error(`Failed to fetch tokens: ${res.statusText}`)
					return await res.json() as { tokens: Record<string, Array<{ address: string; symbol: string; decimals: number; name: string; logoURI?: string; priceUSD?: string }>> }
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
		})
	)

	if (Either.isLeft(result)) {
		console.error('[PublicSwap] Failed to fetch tokens:', result.left)
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
	const order = c.req.query('order') as 'RECOMMENDED' | 'FASTEST' | 'CHEAPEST' | 'SAFEST' | undefined

	const result = await runEffectEither(
		Effect.gen(function* () {
			const swapService = yield* SwapService
			const redis = yield* RedisService

			// Use auth user's wallet or vitalik.eth placeholder
			const walletAddress = authUser.walletAddress || '0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045'

			if (!fromChain || !toChain || !fromToken || !toToken || !fromAmount) {
				return yield* Effect.fail(new ValidationError({
					message: 'Missing required parameters',
					fields: {
						...(fromChain ? {} : { fromChain: 'required' }),
						...(toChain ? {} : { toChain: 'required' }),
						...(fromToken ? {} : { fromToken: 'required' }),
						...(toToken ? {} : { toToken: 'required' }),
						...(fromAmount ? {} : { fromAmount: 'required' }),
					}
				}))
			}

			const quoteParams: QuoteParams = {
				fromChain,
				toChain,
				fromToken,
				toToken,
				fromAmount,
				fromAddress: walletAddress,
				slippage: slippage ? parseFloat(slippage) : 0.03,
				order: order || 'RECOMMENDED',
			}

			const quote = yield* swapService.getQuote(quoteParams).pipe(
				Effect.mapError((e) => {
					if (e instanceof ValidationError) return e
					return new ValidationError({ message: e.message })
				})
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
		})
	)

	if (Either.isLeft(result)) {
		const { status, body } = mapErrorToResponse(result.left as any)
		return c.json(body, status as 200)
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

			// Get user's wallet
			const wallets = yield* walletService.getActiveWallets(authUser.userId)
			if (wallets.length === 0) {
				return yield* Effect.fail(new NotFoundError({ message: 'No wallet found', resource: 'wallet' }))
			}
			const wallet = wallets[0]

			if (wallet.walletProvider !== 'turnkey' || !wallet.turnkeySubOrgId) {
				return yield* Effect.fail(new ValidationError({
					message: 'Wallet does not support server-side signing.',
				}))
			}

			const quote = yield* getCachedQuote(redis, quoteId)
			if (!quote) {
				return yield* Effect.fail(new ValidationError({
					message: 'Quote expired or not found. Please request a new quote.',
				}))
			}

			if (quote.transactionRequest.from.toLowerCase() !== wallet.address.toLowerCase()) {
				return yield* Effect.fail(new ValidationError({
					message: 'Quote wallet address mismatch',
				}))
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

			if (!env.TURNKEY_API_PUBLIC_KEY || !env.TURNKEY_API_PRIVATE_KEY || !env.TURNKEY_ORGANIZATION_ID) {
				yield* swapService.updateSwapStatus(swapRecord.id, 'failed', undefined, 'Turnkey not configured')
				return yield* Effect.fail(new ValidationError({ message: 'Signing service not configured' }))
			}

			const turnkeyClient = new Turnkey({
				apiBaseUrl: env.TURNKEY_BASE_URL || 'https://api.turnkey.com',
				apiPublicKey: env.TURNKEY_API_PUBLIC_KEY,
				apiPrivateKey: env.TURNKEY_API_PRIVATE_KEY,
				defaultOrganizationId: wallet.turnkeySubOrgId!,
			})

			const txRequest = quote.transactionRequest

			console.log('[PublicSwap] Signing transaction:', {
				swapId: swapRecord.id,
				from: txRequest.from,
				to: txRequest.to,
				chainId: txRequest.chainId,
			})

			const signResult = yield* Effect.tryPromise({
				try: async () => {
					const signedTx = await turnkeyClient.apiClient().signTransaction({
						organizationId: wallet.turnkeySubOrgId!,
						signWith: wallet.address,
						type: 'TRANSACTION_TYPE_ETHEREUM',
						unsignedTransaction: JSON.stringify({
							type: '0x2',
							chainId: `0x${txRequest.chainId.toString(16)}`,
							nonce: '0x0',
							to: txRequest.to,
							value: txRequest.value,
							data: txRequest.data,
							maxFeePerGas: txRequest.gasPrice || '0x0',
							maxPriorityFeePerGas: '0x0',
							gas: txRequest.gasLimit || '0x0',
						}),
					})
					return signedTx
				},
				catch: (e) => new Error(`Failed to sign transaction: ${e}`),
			})

			const signedTransaction = signResult.signedTransaction

			const rpcUrl = CHAIN_RPC_ENDPOINTS[txRequest.chainId]
			let txHash: string | null = null

			if (rpcUrl) {
				const broadcastResult = yield* Effect.tryPromise({
					try: async () => {
						const res = await fetch(rpcUrl, {
							method: 'POST',
							headers: { 'Content-Type': 'application/json' },
							body: JSON.stringify({
								jsonrpc: '2.0',
								method: 'eth_sendRawTransaction',
								params: [signedTransaction],
								id: 1,
							}),
						})
						const data = await res.json() as { result?: string; error?: { message: string; code: number } }
						if (data.error) {
							throw new Error(`RPC error: ${data.error.message} (code ${data.error.code})`)
						}
						return data.result as string
					},
					catch: (e) => new Error(`Failed to broadcast transaction: ${e}`),
				})
				txHash = broadcastResult
				console.log('[PublicSwap] Transaction broadcast, txHash:', txHash)
			}

			const newStatus = txHash ? 'submitted' : 'signed'
			yield* swapService.updateSwapStatus(swapRecord.id, newStatus, txHash || signedTransaction)
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
		})
	)

	if (Either.isLeft(result)) {
		const error = result.left
		console.error('[PublicSwap] Execute error:', error)
		if ('status' in error) {
			const { status, body } = mapErrorToResponse(error as any)
			return c.json(body, status as 200)
		}
		return c.json({ error: 'Internal Error', message: (error as Error).message || 'Failed to execute swap' }, 500)
	}

	return c.json(result.right)
})

/**
 * GET /public/swap/status/:swapId
 */
publicSwapRoutes.get('/status/:swapId', flexAuth(), async (c) => {
	const authUser = c.get('authUser') as AuthUser
	const swapId = parseInt(c.req.param('swapId'), 10)

	if (isNaN(swapId)) {
		return c.json({ error: 'Validation Error', message: 'Invalid swap ID' }, 400)
	}

	const result = await runEffectEither(
		Effect.gen(function* () {
			const swapService = yield* SwapService

			const swap = yield* swapService.getSwapById(swapId)
			if (!swap) {
				return yield* Effect.fail(new NotFoundError({ message: 'Swap not found', resource: 'swap' }))
			}

			if (swap.userId !== authUser.userId) {
				return yield* Effect.fail(new NotFoundError({ message: 'Swap not found', resource: 'swap' }))
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
		})
	)

	if (Either.isLeft(result)) {
		const { status, body } = mapErrorToResponse(result.left as any)
		return c.json(body, status as 200)
	}

	return c.json(result.right)
})

// ─── Passkey Auth Endpoint ───

/**
 * POST /public/swap/auth
 * Authenticate a passkey user from the showcase site.
 * Receives Turnkey session data, finds or creates a user, returns JWT.
 */
publicSwapRoutes.post('/auth', ipRateLimit(), async (c) => {
	const body = await c.req.json().catch(() => ({}))
	const { subOrgId, walletAddress } = body as { subOrgId?: string; walletAddress?: string }

	if (!subOrgId || !walletAddress) {
		return c.json({ error: 'subOrgId and walletAddress are required' }, 400)
	}

	const result = await runEffectEither(
		Effect.gen(function* () {
			const env = yield* EnvService
			const userService = yield* UserService
			const walletService = yield* WalletService

			// Find existing wallet by address
			const db = yield* requireDb
			const existingWallet = yield* Effect.tryPromise({
				try: () =>
					db.select().from(wallets).where(eq(wallets.address, walletAddress)).limit(1),
				catch: () => new Error('Database query failed'),
			})

			let userId: number

			if (existingWallet.length > 0) {
				userId = existingWallet[0].userId
			} else {
				// Create new user for showcase passkey auth
				const { user } = yield* userService.getOrCreateUser({
					telegramId: 0, // No telegram ID for passkey users
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

			// Generate JWT
			const jwtSecret = env.JWT_SECRET || 'development-secret-change-in-production'
			const token = jwt.sign(
				{ userId, walletAddress },
				jwtSecret,
				{ expiresIn: '7d' }
			)

			return {
				jwt: token,
				user: { id: userId },
				walletAddress,
			}
		})
	)

	if (Either.isLeft(result)) {
		const error = result.left
		console.error('[PublicSwap] Auth error:', error)
		return c.json({ error: (error as Error).message || 'Authentication failed' }, 500)
	}

	return c.json(result.right)
})

export { publicSwapRoutes }
