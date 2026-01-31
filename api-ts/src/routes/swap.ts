import { Hono } from 'hono'
import { Effect, Either, Option } from 'effect'
import { Turnkey } from '@turnkey/sdk-server'
import { telegramAuth } from '../middleware'
import { SwapService, UserService, WalletService, type QuoteParams, type SwapQuote } from '../services'
import { runEffectEither } from '../runtime'
import type { TelegramUser } from '../services/TelegramAuthService'
import { mapErrorToResponse, ValidationError, NotFoundError, DatabaseError } from '../errors'
import { EnvService } from '../config/EnvService'

const swapRoutes = new Hono()

// Note: Public routes (tokens, chains) are defined first, before auth middleware
// Protected routes use the telegramAuth middleware explicitly

// In-memory quote cache (in production, use Redis)
const quoteCache = new Map<string, { quote: SwapQuote; expiry: number }>()
const QUOTE_TTL = 30_000 // 30 seconds

function cacheQuote(quote: SwapQuote): void {
	quoteCache.set(quote.quoteId, {
		quote,
		expiry: Date.now() + QUOTE_TTL,
	})
}

function getCachedQuote(quoteId: string): SwapQuote | null {
	const cached = quoteCache.get(quoteId)
	if (!cached) return null
	if (Date.now() > cached.expiry) {
		quoteCache.delete(quoteId)
		return null
	}
	return cached.quote
}

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
swapRoutes.get('/quote', telegramAuth(), async (c) => {
	const telegramUser = c.get('telegramUser') as TelegramUser
	
	// Extract query params
	const fromChain = c.req.query('fromChain')
	const toChain = c.req.query('toChain')
	const fromToken = c.req.query('fromToken')
	const toToken = c.req.query('toToken')
	const fromAmount = c.req.query('fromAmount')
	const slippage = c.req.query('slippage')
	const order = c.req.query('order') as 'RECOMMENDED' | 'FASTEST' | 'CHEAPEST' | 'SAFEST' | undefined

	const result = await runEffectEither(
		Effect.gen(function* () {
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
				})
			)

			// Cache the quote for execution
			cacheQuote(quote)

			// Return quote without internal data
			const { _rawQuote, transactionRequest, ...publicQuote } = quote
			return {
				...publicQuote,
				// Include transaction data for client-side signing if needed
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
 * POST /webapp/swap/execute
 * Execute a swap using a cached quote
 * 
 * Body:
 * - quoteId: The quote ID to execute
 * - idempotencyKey: Optional unique key to prevent duplicate swaps
 */
swapRoutes.post('/execute', telegramAuth(), async (c) => {
	const telegramUser = c.get('telegramUser') as TelegramUser
	const body = await c.req.json().catch(() => ({}))
	
	const { quoteId, idempotencyKey } = body as { quoteId?: string; idempotencyKey?: string }

	if (!quoteId) {
		return c.json({ error: 'Validation Error', message: 'quoteId is required' }, 400)
	}

	const result = await runEffectEither(
		Effect.gen(function* () {
			const env = yield* EnvService
			const userService = yield* UserService
			const walletService = yield* WalletService
			const swapService = yield* SwapService

			// Get user
			const userOption = yield* userService.getUserByTelegramId(telegramUser.id)
			if (Option.isNone(userOption)) {
				return yield* Effect.fail(new NotFoundError({ message: 'User not found', resource: 'user' }))
			}
			const user = userOption.value

			// Get user's wallet
			const wallets = yield* walletService.getActiveWallets(user.id)
			if (wallets.length === 0) {
				return yield* Effect.fail(new NotFoundError({ message: 'No wallet found', resource: 'wallet' }))
			}
			const wallet = wallets[0]

			// Check if wallet is a Turnkey wallet
			if (wallet.walletProvider !== 'turnkey' || !wallet.turnkeySubOrgId) {
				return yield* Effect.fail(new ValidationError({ 
					message: 'Wallet does not support server-side signing. Use client-side signing instead.',
				}))
			}

			// Get cached quote
			const quote = getCachedQuote(quoteId)
			if (!quote) {
				return yield* Effect.fail(new ValidationError({ 
					message: 'Quote expired or not found. Please request a new quote.',
				}))
			}

			// Verify quote is for this wallet
			if (quote.transactionRequest.from.toLowerCase() !== wallet.address.toLowerCase()) {
				return yield* Effect.fail(new ValidationError({ 
					message: 'Quote wallet address mismatch',
				}))
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
			if (!env.TURNKEY_API_PUBLIC_KEY || !env.TURNKEY_API_PRIVATE_KEY || !env.TURNKEY_ORGANIZATION_ID) {
				yield* swapService.updateSwapStatus(swapRecord.id, 'failed', undefined, 'Turnkey not configured')
				return yield* Effect.fail(new ValidationError({ message: 'Signing service not configured' }))
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
			
			console.log('[SwapRoute] Signing transaction:', {
				swapId: swapRecord.id,
				from: txRequest.from,
				to: txRequest.to,
				chainId: txRequest.chainId,
				value: txRequest.value,
			})

			// Sign the transaction with Turnkey
			const signResult = yield* Effect.tryPromise({
				try: async () => {
					const signedTx = await turnkeyClient.apiClient().signTransaction({
						organizationId: wallet.turnkeySubOrgId!,
						signWith: wallet.address,
						type: 'TRANSACTION_TYPE_ETHEREUM',
						unsignedTransaction: JSON.stringify({
							type: '0x2', // EIP-1559
							chainId: `0x${txRequest.chainId.toString(16)}`,
							nonce: '0x0', // Will be filled by RPC
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

			// Submit to RPC
			// For now, return the signed tx - in production, submit to the chain's RPC
			console.log('[SwapRoute] Transaction signed successfully')

			// In a full implementation, you would:
			// 1. Get the appropriate RPC endpoint for the chain
			// 2. Send the signed transaction using eth_sendRawTransaction
			// 3. Wait for confirmation
			// 4. Update swap status to 'completed' or 'failed'

			// For now, update status to 'signed' and return
			yield* swapService.updateSwapStatus(swapRecord.id, 'signed', signedTransaction)

			// Clear the quote from cache
			quoteCache.delete(quoteId)

			return {
				success: true,
				swapId: swapRecord.id,
				status: 'signed',
				signedTransaction,
				message: 'Transaction signed. Submit to chain to complete swap.',
				chain: {
					chainId: txRequest.chainId,
					rpcNeeded: true,
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
		})
	)

	if (Either.isLeft(result)) {
		const error = result.left
		console.error('[SwapRoute] Execute error:', error)
		
		// Map error to response
		if ('status' in error) {
			const { status, body } = mapErrorToResponse(error as any)
			return c.json(body, status as 200)
		}
		
		return c.json({ error: 'Internal Error', message: error.message || 'Failed to execute swap' }, 500)
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
				return yield* Effect.fail(new NotFoundError({ message: 'User not found', resource: 'user' }))
			}
			const user = userOption.value

			// Get swap
			const swap = yield* swapService.getSwapById(swapId)
			if (!swap) {
				return yield* Effect.fail(new NotFoundError({ message: 'Swap not found', resource: 'swap' }))
			}

			// Verify ownership
			if (swap.userId !== user.id) {
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

/**
 * GET /webapp/swap/chains
 * Get supported chains for swapping
 */
swapRoutes.get('/chains', async (c) => {
	// Return static list of supported chains
	// In production, this could be fetched from Li.Fi API
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
 * GET /webapp/swap/tokens
 * Get popular tokens for a chain
 */
swapRoutes.get('/tokens', async (c) => {
	const chainId = c.req.query('chainId')
	
	if (!chainId) {
		return c.json({ error: 'Validation Error', message: 'chainId is required' }, 400)
	}

	// Fetch tokens from Li.Fi
	try {
		const response = await fetch(`https://li.quest/v1/tokens?chains=${chainId}`, {
			headers: {
				'Accept': 'application/json',
				...(process.env.LIFI_API_KEY && {
					'x-lifi-api-key': process.env.LIFI_API_KEY,
				}),
			},
		})

		if (!response.ok) {
			throw new Error(`Failed to fetch tokens: ${response.statusText}`)
		}

		const data = await response.json() as { tokens: Record<string, Array<{ address: string; symbol: string; decimals: number; name: string; logoURI?: string; priceUSD?: string }>> }
		
		// Return tokens for the requested chain
		const tokens = data.tokens[chainId] || []
		
		return c.json({ 
			chainId: parseInt(chainId, 10),
			tokens: tokens.slice(0, 50).map((t) => ({
				address: t.address,
				symbol: t.symbol,
				decimals: t.decimals,
				name: t.name,
				logoURI: t.logoURI,
				priceUSD: t.priceUSD,
			})),
		})
	} catch (error) {
		console.error('[SwapRoute] Failed to fetch tokens:', error)
		return c.json({ error: 'Failed to fetch tokens' }, 500)
	}
})

export { swapRoutes }
