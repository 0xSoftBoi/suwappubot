import { Turnkey } from '@turnkey/sdk-server'
import { Effect, Either, Option } from 'effect'
import { Hono } from 'hono'
import { EnvService } from '../config/EnvService'
import { logger } from '../lib/logger'
import { DatabaseError, mapErrorToResponse, NotFoundError, ValidationError } from '../errors'
import { fetchWithRetry } from '../lib/retry'
import { telegramAuth } from '../middleware'
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
import type { TelegramUser } from '../services/TelegramAuthService'
import { withSigningFallback } from '../services/FallbackSigningService'

const swapRoutes = new Hono()

// Note: Public routes (tokens, chains) are defined first, before auth middleware
// Protected routes use the telegramAuth middleware explicitly

// Chain ID to RPC endpoint mapping for broadcasting transactions
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

// Cache quote using Redis with in-memory fallback
const cacheQuote = (redis: RedisServiceInterface, quote: SwapQuote): Effect.Effect<void, never> =>
	Effect.gen(function* () {
		const key = cacheKeys.quote(quote.quoteId)
		const result = yield* Effect.either(redis.set(key, quote, QUOTE_TTL))
		if (Either.isLeft(result) || !redis.isConnected()) {
			// Fallback to in-memory
			quoteCacheMemory.set(quote.quoteId, {
				quote,
				expiry: Date.now() + QUOTE_TTL_MS,
			})
		}
	})

// Get cached quote from Redis with in-memory fallback
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
		// Fallback to in-memory
		const cached = quoteCacheMemory.get(quoteId)
		if (!cached) return null
		if (Date.now() > cached.expiry) {
			quoteCacheMemory.delete(quoteId)
			return null
		}
		return cached.quote
	})

// Delete cached quote
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
 * GET /webapp/swap/quote
 * Get a swap quote from Li.Fi
 *
 * Query params:
 * - fromChain: Chain ID or key (e.g., "1" or "ethereum")
 * - toChain: Target chain ID or key
 * - fromToken: Token address (use 0x0...0 for native)
 * - toToken: Token address
 * - fromAmount: Amount in smallest unit (wei)
 * - slippage: Optional, default 0.03 (3%)
 * - order: Optional, "RECOMMENDED" | "FASTEST" | "CHEAPEST" | "SAFEST"
 */
swapRoutes.get('/quote', ipRateLimit(30), telegramAuth(), async (c) => {
	const telegramUser = c.get('telegramUser') as TelegramUser

	// Extract query params
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
			const redis = yield* RedisService
			const userService = yield* UserService
			const walletService = yield* WalletService
			const swapService = yield* SwapService

			// Get user and wallet - use placeholder if not found (for quotes only)
			// Use a real address as placeholder since Li.Fi rejects zero address
			let walletAddress = '0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045' // vitalik.eth as placeholder

			const userResult = yield* Effect.either(userService.getUserByTelegramId(telegramUser.id))
			if (Either.isRight(userResult) && Option.isSome(userResult.right)) {
				const user = userResult.right.value
				const walletsResult = yield* Effect.either(walletService.getActiveWallets(user.id))
				if (Either.isRight(walletsResult) && walletsResult.right.length > 0) {
					walletAddress = walletsResult.right[0].address
				}
			}

			// For backward compat - allow quotes without wallet
			const wallet = { address: walletAddress }

			// Validate required params
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

			// Build quote params
			const quoteParams: QuoteParams = {
				fromChain,
				toChain,
				fromToken,
				toToken,
				fromAmount,
				fromAddress: wallet.address,
				slippage: slippage ? parseFloat(slippage) : 0.03,
				order: order || 'RECOMMENDED',
			}

			// Get quote from Li.Fi
			const quote = yield* swapService.getQuote(quoteParams).pipe(
				Effect.mapError((e) => {
					if (e instanceof ValidationError) return e
					return new ValidationError({ message: e.message })
				}),
			)

			// Cache the quote for execution
			yield* cacheQuote(redis, quote)

			// Return quote without internal data
			const { _rawQuote, transactionRequest, ...publicQuote } = quote

			// Calculate USD amounts from Li.Fi price data
			const fromDecimals = quote.fromToken.decimals
			const toDecimals = quote.toToken.decimals
			const fromAmountHuman = parseFloat(quote.fromAmount) / 10 ** fromDecimals
			const toAmountHuman = parseFloat(quote.toAmount) / 10 ** toDecimals
			const fromPriceUsd = parseFloat(_rawQuote.action.fromToken.priceUSD || '0')
			const toPriceUsd = parseFloat(_rawQuote.action.toToken.priceUSD || '0')

			return {
				...publicQuote,
				// Aliases expected by webapp
				id: quote.quoteId,
				gasUsd: parseFloat(quote.estimatedGasUsd),
				minReceived: quote.toAmountMin,
				exchangeRate: parseFloat(quote.exchangeRate),
				priceImpact: parseFloat(quote.priceImpact),
				fromAmountUsd: fromAmountHuman * fromPriceUsd,
				toAmountUsd: toAmountHuman * toPriceUsd,
				expiresAt: new Date(Date.now() + QUOTE_TTL * 1000).toISOString(),
				route: quote.route || 'lifi',
				// Include transaction data for client-side signing if needed
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
		return c.json(body, status as 200)
	}

	return c.json(result.right)
})

/**
 * POST /webapp/swap/execute
 * Execute a swap using a cached quote
 *
 * Body:
 * - quoteId: The quote ID to execute
 * - idempotencyKey: Optional unique key to prevent duplicate swaps
 */
swapRoutes.post('/execute', ipRateLimit(10), telegramAuth(), async (c) => {
	const telegramUser = c.get('telegramUser') as TelegramUser
	const body = await c.req.json().catch(() => ({}))

	const { quoteId, idempotencyKey } = body as { quoteId?: string; idempotencyKey?: string }

	if (!quoteId) {
		return c.json({ error: 'Validation Error', message: 'quoteId is required' }, 400)
	}

	const result = await runEffectEither(
		Effect.gen(function* () {
			const env = yield* EnvService
			const redis = yield* RedisService
			const userService = yield* UserService
			const walletService = yield* WalletService
			const swapService = yield* SwapService

			// Get user
			const userOption = yield* userService.getUserByTelegramId(telegramUser.id)
			if (Option.isNone(userOption)) {
				return yield* Effect.fail(
					new NotFoundError({ message: 'User not found', resource: 'user' }),
				)
			}
			const user = userOption.value

			// Get user's wallet
			const wallets = yield* walletService.getActiveWallets(user.id)
			if (wallets.length === 0) {
				return yield* Effect.fail(
					new NotFoundError({ message: 'No wallet found', resource: 'wallet' }),
				)
			}
			const wallet = wallets[0]

			// Check if wallet is a Turnkey wallet
			if (wallet.walletProvider !== 'turnkey' || !wallet.turnkeySubOrgId) {
				return yield* Effect.fail(
					new ValidationError({
						message:
							'Wallet does not support server-side signing. Use client-side signing instead.',
					}),
				)
			}

			// Get cached quote
			const quote = yield* getCachedQuote(redis, quoteId)
			if (!quote) {
				return yield* Effect.fail(
					new ValidationError({
						message: 'Quote expired or not found. Please request a new quote.',
					}),
				)
			}

			// Verify quote is for this wallet
			if (quote.transactionRequest.from.toLowerCase() !== wallet.address.toLowerCase()) {
				return yield* Effect.fail(
					new ValidationError({
						message: 'Quote wallet address mismatch',
					}),
				)
			}

			// Create swap record first (pending status)
			const swapRecord = yield* swapService.createSwapRecord({
				userId: user.id,
				fromChain: quote.fromChain,
				toChain: quote.toChain,
				fromToken: quote.fromToken.symbol,
				toToken: quote.toToken.symbol,
				fromAmount: quote.fromAmount,
				toAmount: quote.toAmount,
				fromAmountUsd: parseFloat(quote.estimatedGasUsd) || null,
				toAmountUsd: null,
				status: 'pending',
				routeProvider: 'lifi',
				routeData: JSON.stringify(quote._rawQuote),
				slippage: Math.round(quote.slippage * 10000), // Store as basis points
				gasFee: parseFloat(quote.estimatedGasUsd) || null,
				bridgeFee: parseFloat(quote.bridgeFeeUsd) || null,
				idempotencyKey,
			})

			// Check Turnkey credentials
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

			// Initialize Turnkey client for signing
			const turnkeyClient = new Turnkey({
				apiBaseUrl: env.TURNKEY_BASE_URL || 'https://api.turnkey.com',
				apiPublicKey: env.TURNKEY_API_PUBLIC_KEY,
				apiPrivateKey: env.TURNKEY_API_PRIVATE_KEY,
				defaultOrganizationId: wallet.turnkeySubOrgId!, // Use sub-org ID
			})

			// Sign the transaction
			const txRequest = quote.transactionRequest

			logger.info({
				swapId: swapRecord.id,
				from: txRequest.from,
				to: txRequest.to,
				chainId: txRequest.chainId,
				value: txRequest.value,
			}, '[SwapRoute] Signing transaction')

			// Get RPC URL for this chain
			const rpcUrlForChain = CHAIN_RPC_ENDPOINTS[txRequest.chainId]
			if (!rpcUrlForChain) {
				return yield* Effect.fail(
					new ValidationError({ message: `Unsupported chain ID: ${txRequest.chainId}` }),
				)
			}

			// Fetch current nonce from RPC
			const fetchNonce = async (addr: string): Promise<string> => {
				const res = await fetch(rpcUrlForChain, {
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({
						jsonrpc: '2.0',
						method: 'eth_getTransactionCount',
						params: [addr, 'latest'],
						id: 1,
					}),
				})
				const data = (await res.json()) as { result?: string; error?: { message: string } }
				if (data.error) throw new Error(`Nonce RPC error: ${data.error.message}`)
				return data.result || '0x0'
			}

			// ERC20 approval if fromToken is not native
			const NATIVE_ZERO = '0x0000000000000000000000000000000000000000'
			const fromTokenAddr = quote.fromToken.address.toLowerCase()
			const isNativeToken = fromTokenAddr === NATIVE_ZERO || fromTokenAddr === '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee'

			if (!isNativeToken) {
				// Check ERC20 allowance: allowance(owner, spender)
				const approvalAddress = quote._rawQuote.estimate.approvalAddress
				if (approvalAddress) {
					const allowanceData = '0xdd62ed3e' +
						wallet.address.slice(2).padStart(64, '0') +
						approvalAddress.slice(2).padStart(64, '0')

					const allowanceResult = yield* Effect.tryPromise({
						try: async () => {
							const res = await fetch(rpcUrlForChain, {
								method: 'POST',
								headers: { 'Content-Type': 'application/json' },
								body: JSON.stringify({
									jsonrpc: '2.0',
									method: 'eth_call',
									params: [{ to: quote.fromToken.address, data: allowanceData }, 'latest'],
									id: 1,
								}),
							})
							const data = (await res.json()) as { result?: string }
							return BigInt(data.result || '0x0')
						},
						catch: (e) => new Error(`Failed to check allowance: ${e}`),
					})

					const requiredAmount = BigInt(quote.fromAmount)
					if (allowanceResult < requiredAmount) {
						logger.info('[SwapRoute] Insufficient ERC20 allowance, sending approval tx')
						// Build approve(spender, uint256.max) calldata
						const maxUint256 = '0x' + 'f'.repeat(64)
						const approveData = '0x095ea7b3' +
							approvalAddress.slice(2).padStart(64, '0') +
							maxUint256.slice(2)

						const approvalNonce = yield* Effect.tryPromise({
							try: () => fetchNonce(wallet.address),
							catch: (e) => new Error(`Failed to get nonce for approval: ${e}`),
						})

						const approvalUnsignedTx = {
										type: '0x2',
										chainId: `0x${txRequest.chainId.toString(16)}`,
										nonce: approvalNonce,
										to: quote.fromToken.address,
										value: '0x0',
										data: approveData,
										maxFeePerGas: txRequest.gasPrice || '0x0',
										maxPriorityFeePerGas: '0x0',
										gas: '0x20000', // 131072 — enough for approval
									}
					const approvalSignResult = yield* Effect.tryPromise({
							try: async () => {
								const { signedTransaction } = await withSigningFallback(
									async () => {
										const result = await turnkeyClient.apiClient().signTransaction({
											organizationId: wallet.turnkeySubOrgId!,
											signWith: wallet.address,
											type: 'TRANSACTION_TYPE_ETHEREUM',
											unsignedTransaction: JSON.stringify(approvalUnsignedTx),
										})
										return result.signedTransaction
									},
									wallet.id,
									approvalUnsignedTx,
								)
								return { signedTransaction }
							},
							catch: (e) => new Error(`Failed to sign approval tx: ${e}`),
						})

						// Broadcast approval tx
						yield* Effect.tryPromise({
							try: async () => {
								const res = await fetch(rpcUrlForChain, {
									method: 'POST',
									headers: { 'Content-Type': 'application/json' },
									body: JSON.stringify({
										jsonrpc: '2.0',
										method: 'eth_sendRawTransaction',
										params: [approvalSignResult.signedTransaction],
										id: 1,
									}),
								})
								const data = (await res.json()) as { result?: string; error?: { message: string; code: number } }
								if (data.error) throw new Error(`Approval RPC error: ${data.error.message}`)
								logger.info('[SwapRoute] Approval tx broadcast: %s', data.result)
								// Wait a bit for the approval to be included
								await new Promise((r) => setTimeout(r, 3000))
								return data.result
							},
							catch: (e) => new Error(`Failed to broadcast approval: ${e}`),
						})
					}
				}
			}

			// Fetch nonce for the swap tx (after potential approval)
			const swapNonce = yield* Effect.tryPromise({
				try: () => fetchNonce(wallet.address),
				catch: (e) => new Error(`Failed to get nonce: ${e}`),
			})

			// Sign the swap transaction with Turnkey (with fallback)
			const swapUnsignedTx = {
							type: '0x2', // EIP-1559
							chainId: `0x${txRequest.chainId.toString(16)}`,
							nonce: swapNonce,
							to: txRequest.to,
							value: txRequest.value,
							data: txRequest.data,
							maxFeePerGas: txRequest.gasPrice || '0x0',
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
								unsignedTransaction: JSON.stringify(swapUnsignedTx),
							})
							return result.signedTransaction
						},
						wallet.id,
						swapUnsignedTx,
					)
				},
				catch: (e) => new Error(`Failed to sign transaction: ${e}`),
			})

			const signedTransaction = signResult.signedTransaction

			// Submit to RPC
			// For now, return the signed tx - in production, submit to the chain's RPC
			logger.info('[SwapRoute] Transaction signed successfully')

			// In a full implementation, you would:
			// 1. Get the appropriate RPC endpoint for the chain
			// 2. Send the signed transaction using eth_sendRawTransaction
			// 3. Wait for confirmation
			// 4. Update swap status to 'completed' or 'failed'

			let txHash: string | null = null

			if (rpcUrlForChain) {
				const broadcastResult = yield* Effect.tryPromise({
					try: async () => {
						const res = await fetchWithRetry(rpcUrlForChain, {
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
				logger.info('[SwapRoute] Transaction broadcast, txHash: %s', txHash)
			} else {
				logger.warn(
					`[SwapRoute] No RPC endpoint for chainId ${txRequest.chainId}, transaction signed but not broadcast`,
				)
			}

			const newStatus = txHash ? 'submitted' : 'signed'
			yield* swapService.updateSwapStatus(swapRecord.id, newStatus, txHash || signedTransaction)

			// Clean up cached quote
			yield* deleteCachedQuote(redis, quoteId)

			return {
				success: true,
				swapId: swapRecord.id,
				status: newStatus,
				txHash: txHash || undefined,
				signedTransaction,
				message: txHash ? 'Transaction submitted.' : 'Transaction signed. Submit to chain to complete swap.',
				chain: {
					chainId: txRequest.chainId,
					rpcNeeded: !txHash,
				},
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
		logger.error({ err: error }, '[SwapRoute] Execute error')

		// Map error to response
		if ('status' in error) {
			const { status, body } = mapErrorToResponse(error as any)
			return c.json(body, status as 200)
		}

		return c.json(
			{ error: 'Internal Error', message: error.message || 'Failed to execute swap' },
			500,
		)
	}

	return c.json(result.right)
})

/**
 * GET /webapp/swap/status/:swapId
 * Get the status of a swap
 */
swapRoutes.get('/status/:swapId', telegramAuth(), async (c) => {
	const telegramUser = c.get('telegramUser') as TelegramUser
	const swapId = parseInt(c.req.param('swapId'), 10)

	if (isNaN(swapId)) {
		return c.json({ error: 'Validation Error', message: 'Invalid swap ID' }, 400)
	}

	const result = await runEffectEither(
		Effect.gen(function* () {
			const userService = yield* UserService
			const swapService = yield* SwapService

			// Get user
			const userOption = yield* userService.getUserByTelegramId(telegramUser.id)
			if (Option.isNone(userOption)) {
				return yield* Effect.fail(
					new NotFoundError({ message: 'User not found', resource: 'user' }),
				)
			}
			const user = userOption.value

			// Get swap
			const swap = yield* swapService.getSwapById(swapId)
			if (!swap) {
				return yield* Effect.fail(
					new NotFoundError({ message: 'Swap not found', resource: 'swap' }),
				)
			}

			// Verify ownership
			if (swap.userId !== user.id) {
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
		return c.json(body, status as 200)
	}

	return c.json(result.right)
})

/**
 * GET /webapp/swap/chains
 * Get supported chains for swapping
 */
swapRoutes.get('/chains', async (c) => {
	// Return static list of supported chains
	// In production, this could be fetched from Li.Fi API
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

// Token list response type
interface TokenListResponse {
	chainId: number
	tokens: Array<{
		address: string
		symbol: string
		decimals: number
		name: string
		logoURI?: string
		priceUSD?: string
		balance?: string
	}>
}

// Chain ID to chain key mapping (reverse of CHAIN_IDS in SwapService)
const CHAIN_ID_TO_KEY: Record<string, string> = {
	'1': 'ethereum',
	'10': 'optimism',
	'56': 'bsc',
	'137': 'polygon',
	'42161': 'arbitrum',
	'43114': 'avalanche',
	'8453': 'base',
	'59144': 'linea',
	'324': 'zksync',
}

// Native token addresses (zero address or chain-specific)
const NATIVE_TOKEN_ADDRESS = '0x0000000000000000000000000000000000000000'

/**
 * Fetch native token balance for a wallet on a given chain
 */
async function fetchNativeBalance(address: string, chainId: string): Promise<string | null> {
	const rpcUrl = CHAIN_RPC_ENDPOINTS[parseInt(chainId, 10)]
	if (!rpcUrl) return null

	try {
		const res = await fetch(rpcUrl, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({
				jsonrpc: '2.0',
				method: 'eth_getBalance',
				params: [address, 'latest'],
				id: 1,
			}),
			signal: AbortSignal.timeout(5000),
		})
		const data = (await res.json()) as { result?: string }
		if (data.result) {
			const balanceWei = BigInt(data.result)
			const balance = Number(balanceWei) / 1e18
			return balance.toFixed(6)
		}
	} catch (e) {
		logger.error({ err: e }, `[SwapRoute] Failed to fetch native balance for chain ${chainId}`)
	}
	return null
}


/**
 * GET /webapp/swap/tokens
 * Get popular tokens for a chain
 */
swapRoutes.get('/tokens', async (c) => {
	const chainId = c.req.query('chainId')
	
	if (!chainId) {
		return c.json({ error: 'Validation Error', message: 'chainId is required' }, 400)
	}

	// Try to extract wallet address from auth (optional -- endpoint remains public)
	let walletAddress: string | null = null
	const initData = c.req.header('X-Telegram-Init-Data')
	if (initData) {
		// Try to resolve wallet for authenticated user
		const walletResult = await runEffectEither(
			Effect.gen(function* () {
				const userService = yield* UserService
				const walletService = yield* WalletService
				// Parse telegram user ID from initData
				const params = new URLSearchParams(initData)
				const userParam = params.get('user')
				if (!userParam) return null
				let tgUser: { id: number }
				try {
					tgUser = JSON.parse(decodeURIComponent(userParam))
				} catch {
					return null
				}
				const userOption = yield* userService.getUserByTelegramId(tgUser.id)
				if (Option.isNone(userOption)) return null
				const wallets = yield* walletService.getActiveWallets(userOption.value.id)
				return wallets.length > 0 ? wallets[0].address : null
			}),
		)
		if (Either.isRight(walletResult) && walletResult.right) {
			walletAddress = walletResult.right
		}
	}

	const result = await runEffectEither(
		Effect.gen(function* () {
			const redis = yield* RedisService
			const cacheKey = cacheKeys.tokenList(chainId)

			// Try to get from cache first
			const cached = yield* Effect.either(redis.get<TokenListResponse>(cacheKey))
			if (Either.isRight(cached) && cached.right) {
				return cached.right
			}

			// Fetch tokens from Li.Fi
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

					if (!res.ok) {
						throw new Error(`Failed to fetch tokens: ${res.statusText}`)
					}

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

			// Format response
			const tokens = response.tokens[chainId] || []
			const tokenListResponse: TokenListResponse = {
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

			// Cache for 5 minutes
			yield* Effect.either(redis.set(cacheKey, tokenListResponse, TOKEN_LIST_TTL))

			return tokenListResponse
		}),
	)

	if (Either.isLeft(result)) {
		logger.error({ err: result.left }, '[SwapRoute] Failed to fetch tokens')
		return c.json({ error: 'Failed to fetch tokens' }, 500)
	}

	const tokenList = result.right

	// If authenticated, fetch native balance and attach to matching token
	if (walletAddress) {
		const nativeBalance = await fetchNativeBalance(walletAddress, chainId)
		if (nativeBalance) {
			const nativeToken = tokenList.tokens.find(
				(t) => t.address.toLowerCase() === NATIVE_TOKEN_ADDRESS,
			)
			if (nativeToken) {
				nativeToken.balance = nativeBalance
			}
		}
	}

	return c.json(tokenList)
})

export { swapRoutes }
