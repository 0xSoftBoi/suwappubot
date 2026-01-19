import { Hono } from 'hono'
import { Effect, Either, Option } from 'effect'
import { telegramAuth } from '../middleware'
import { TelegramAuthService, UserService, WalletService, SwapService, BalanceService, QuoteService, PasskeyService } from '../services'
import { runEffect, runEffectEither } from '../runtime'
import type { TelegramUser } from '../services/TelegramAuthService'
import { mapErrorToResponse } from '../errors'

const webappRoutes = new Hono()

// GET /webapp/quote - Get swap quote (public, no auth required)
webappRoutes.get('/quote', async (c) => {
	const fromChain = c.req.query('fromChain')
	const toChain = c.req.query('toChain')
	const fromToken = c.req.query('fromToken')
	const toToken = c.req.query('toToken')
	const fromAmount = c.req.query('fromAmount')
	const slippage = c.req.query('slippage')

	// Validate required params
	if (!fromChain || !toChain || !fromToken || !toToken || !fromAmount) {
		return c.json({
			error: 'Missing required parameters: fromChain, toChain, fromToken, toToken, fromAmount',
		}, 400)
	}

	const result = await runEffectEither(
		Effect.gen(function* () {
			const quoteService = yield* QuoteService

			const quote = yield* quoteService.getQuote({
				fromChain,
				toChain,
				fromToken,
				toToken,
				fromAmount,
				slippage: slippage ? parseFloat(slippage) : 0.5,
			})

			return quote
		})
	)

	if (Either.isLeft(result)) {
		const error = result.left
		return c.json({
			error: 'Quote Error',
			message: error.message || 'Failed to get quote',
		}, 500)
	}

	return c.json(result.right)
})

// GET /webapp/tokens - Get supported tokens for a chain
webappRoutes.get('/tokens', async (c) => {
	const chain = c.req.query('chain')

	// Common tokens per chain
	const tokens: Record<string, Array<{ symbol: string; name: string; decimals: number }>> = {
		ethereum: [
			{ symbol: 'ETH', name: 'Ethereum', decimals: 18 },
			{ symbol: 'USDC', name: 'USD Coin', decimals: 6 },
			{ symbol: 'USDT', name: 'Tether USD', decimals: 6 },
			{ symbol: 'DAI', name: 'Dai Stablecoin', decimals: 18 },
			{ symbol: 'WETH', name: 'Wrapped Ether', decimals: 18 },
		],
		polygon: [
			{ symbol: 'MATIC', name: 'Polygon', decimals: 18 },
			{ symbol: 'USDC', name: 'USD Coin', decimals: 6 },
			{ symbol: 'USDT', name: 'Tether USD', decimals: 6 },
			{ symbol: 'WETH', name: 'Wrapped Ether', decimals: 18 },
		],
		arbitrum: [
			{ symbol: 'ETH', name: 'Ethereum', decimals: 18 },
			{ symbol: 'USDC', name: 'USD Coin', decimals: 6 },
			{ symbol: 'USDT', name: 'Tether USD', decimals: 6 },
			{ symbol: 'WETH', name: 'Wrapped Ether', decimals: 18 },
		],
		optimism: [
			{ symbol: 'ETH', name: 'Ethereum', decimals: 18 },
			{ symbol: 'USDC', name: 'USD Coin', decimals: 6 },
			{ symbol: 'USDT', name: 'Tether USD', decimals: 6 },
			{ symbol: 'WETH', name: 'Wrapped Ether', decimals: 18 },
		],
		base: [
			{ symbol: 'ETH', name: 'Ethereum', decimals: 18 },
			{ symbol: 'USDC', name: 'USD Coin', decimals: 6 },
			{ symbol: 'WETH', name: 'Wrapped Ether', decimals: 18 },
		],
		bsc: [
			{ symbol: 'BNB', name: 'BNB', decimals: 18 },
			{ symbol: 'USDC', name: 'USD Coin', decimals: 18 },
			{ symbol: 'USDT', name: 'Tether USD', decimals: 18 },
			{ symbol: 'WETH', name: 'Wrapped Ether', decimals: 18 },
		],
	}

	if (chain) {
		const chainTokens = tokens[chain.toLowerCase()]
		if (!chainTokens) {
			return c.json({ error: `Unsupported chain: ${chain}` }, 400)
		}
		return c.json({ chain, tokens: chainTokens })
	}

	// Return all chains if no chain specified
	return c.json({ chains: Object.keys(tokens), tokens })
})

// POST /webapp/validate - Validate Telegram auth (no middleware required)
webappRoutes.post('/validate', async (c) => {
	const initData = c.req.header('X-Telegram-Init-Data')

	if (!initData) {
		return c.json({ valid: false })
	}

	const userOption = await runEffect(
		Effect.gen(function* () {
			const authService = yield* TelegramAuthService
			return yield* authService.validateInitData(initData)
		})
	)

	if (Option.isNone(userOption)) {
		return c.json({ valid: false })
	}

	return c.json({
		valid: true,
		user: userOption.value,
	})
})

// =====================
// Passkey Routes
// =====================

// POST /webapp/passkey/register/init - Initialize passkey registration
webappRoutes.post('/passkey/register/init', async (c) => {
	const initData = c.req.header('X-Telegram-Init-Data')

	if (!initData) {
		return c.json({ error: 'Telegram authentication required' }, 401)
	}

	// Validate Telegram auth
	const userOption = await runEffect(
		Effect.gen(function* () {
			const authService = yield* TelegramAuthService
			return yield* authService.validateInitData(initData)
		})
	)

	if (Option.isNone(userOption)) {
		return c.json({ error: 'Invalid Telegram authentication' }, 401)
	}

	const telegramUser = userOption.value

	// Get request body
	const body = await c.req.json().catch(() => ({}))
	const displayName = body.displayName || telegramUser.first_name

	const result = await runEffectEither(
		Effect.gen(function* () {
			const passkeyService = yield* PasskeyService
			return yield* passkeyService.initRegistration(telegramUser.id, displayName)
		})
	)

	if (Either.isLeft(result)) {
		return c.json({ error: result.left.message || 'Failed to initialize registration' }, 500)
	}

	return c.json(result.right)
})

// POST /webapp/passkey/register/complete - Complete passkey registration
webappRoutes.post('/passkey/register/complete', async (c) => {
	const initData = c.req.header('X-Telegram-Init-Data')

	if (!initData) {
		return c.json({ error: 'Telegram authentication required' }, 401)
	}

	// Validate Telegram auth
	const userOption = await runEffect(
		Effect.gen(function* () {
			const authService = yield* TelegramAuthService
			return yield* authService.validateInitData(initData)
		})
	)

	if (Option.isNone(userOption)) {
		return c.json({ error: 'Invalid Telegram authentication' }, 401)
	}

	const telegramUser = userOption.value
	const body = await c.req.json()

	const result = await runEffectEither(
		Effect.gen(function* () {
			const passkeyService = yield* PasskeyService
			return yield* passkeyService.completeRegistration(telegramUser.id, {
				credentialId: body.credentialId,
				attestationObject: body.attestationObject,
				clientDataJSON: body.clientDataJSON,
				transports: body.transports,
			})
		})
	)

	if (Either.isLeft(result)) {
		return c.json({ error: result.left.message || 'Failed to complete registration' }, 500)
	}

	return c.json(result.right)
})

// POST /webapp/passkey/authenticate/init - Initialize passkey authentication
webappRoutes.post('/passkey/authenticate/init', async (c) => {
	const initData = c.req.header('X-Telegram-Init-Data')

	// Telegram auth is optional for authentication (discoverable credentials)
	let telegramId: number | undefined

	if (initData) {
		const userOption = await runEffect(
			Effect.gen(function* () {
				const authService = yield* TelegramAuthService
				return yield* authService.validateInitData(initData)
			})
		)

		if (Option.isSome(userOption)) {
			telegramId = userOption.value.id
		}
	}

	const result = await runEffectEither(
		Effect.gen(function* () {
			const passkeyService = yield* PasskeyService
			return yield* passkeyService.initAuthentication(telegramId)
		})
	)

	if (Either.isLeft(result)) {
		return c.json({ error: result.left.message || 'Failed to initialize authentication' }, 500)
	}

	return c.json(result.right)
})

// POST /webapp/passkey/authenticate/complete - Complete passkey authentication
webappRoutes.post('/passkey/authenticate/complete', async (c) => {
	const body = await c.req.json()

	const result = await runEffectEither(
		Effect.gen(function* () {
			const passkeyService = yield* PasskeyService
			return yield* passkeyService.completeAuthentication({
				credentialId: body.credentialId,
				authenticatorData: body.authenticatorData,
				clientDataJSON: body.clientDataJSON,
				signature: body.signature,
				userHandle: body.userHandle,
			})
		})
	)

	if (Either.isLeft(result)) {
		return c.json({ error: result.left.message || 'Authentication failed' }, 401)
	}

	return c.json(result.right)
})

// GET /webapp/passkey/wallets - Get user's Turnkey wallets
webappRoutes.get('/passkey/wallets', async (c) => {
	const initData = c.req.header('X-Telegram-Init-Data')

	if (!initData) {
		return c.json({ error: 'Telegram authentication required' }, 401)
	}

	// Validate Telegram auth
	const userOption = await runEffect(
		Effect.gen(function* () {
			const authService = yield* TelegramAuthService
			return yield* authService.validateInitData(initData)
		})
	)

	if (Option.isNone(userOption)) {
		return c.json({ error: 'Invalid Telegram authentication' }, 401)
	}

	const telegramUser = userOption.value

	const result = await runEffectEither(
		Effect.gen(function* () {
			const passkeyService = yield* PasskeyService
			return yield* passkeyService.getWallets(telegramUser.id)
		})
	)

	if (Either.isLeft(result)) {
		return c.json({ error: result.left.message || 'Failed to get wallets' }, 500)
	}

	return c.json(result.right)
})

// POST /webapp/passkey/wallets - Create a new Turnkey wallet
webappRoutes.post('/passkey/wallets', async (c) => {
	const initData = c.req.header('X-Telegram-Init-Data')

	if (!initData) {
		return c.json({ error: 'Telegram authentication required' }, 401)
	}

	// Validate Telegram auth
	const userOption = await runEffect(
		Effect.gen(function* () {
			const authService = yield* TelegramAuthService
			return yield* authService.validateInitData(initData)
		})
	)

	if (Option.isNone(userOption)) {
		return c.json({ error: 'Invalid Telegram authentication' }, 401)
	}

	const telegramUser = userOption.value
	const body = await c.req.json()

	const chainType = body.chainType || 'evm'
	if (chainType !== 'evm' && chainType !== 'solana') {
		return c.json({ error: 'Invalid chainType. Must be "evm" or "solana"' }, 400)
	}

	const result = await runEffectEither(
		Effect.gen(function* () {
			const passkeyService = yield* PasskeyService
			return yield* passkeyService.createWallet(telegramUser.id, chainType, body.name)
		})
	)

	if (Either.isLeft(result)) {
		return c.json({ error: result.left.message || 'Failed to create wallet' }, 500)
	}

	return c.json(result.right)
})

// =====================
// Protected webapp routes
// =====================
const protectedWebapp = new Hono()
protectedWebapp.use('*', telegramAuth())

// GET /webapp/users/me/portfolio
protectedWebapp.get('/users/me/portfolio', async (c) => {
	const telegramUser = c.get('telegramUser') as TelegramUser

	const result = await runEffectEither(
		Effect.gen(function* () {
			const userService = yield* UserService
			const walletService = yield* WalletService
			const balanceService = yield* BalanceService

			// Find user by telegram_id
			const userOption = yield* userService.getUserByTelegramId(telegramUser.id)

			if (Option.isNone(userOption)) {
				return {
					totalUsdValue: 0,
					tokens: [],
					lastUpdated: new Date().toISOString(),
				}
			}

			const user = userOption.value

			// Get active wallets
			const wallets = yield* walletService.getActiveWallets(user.id)

			if (wallets.length === 0) {
				return {
					totalUsdValue: 0,
					tokens: [],
					lastUpdated: new Date().toISOString(),
				}
			}

			// Fetch balances for all wallets
			const allTokens: Array<{
				symbol: string
				name: string
				address: string
				chain: string
				balance: string
				usdValue: number
			}> = []

			for (const wallet of wallets) {
				const balances = yield* Effect.either(balanceService.getWalletBalances(wallet))
				if (Either.isRight(balances)) {
					allTokens.push(...balances.right)
				}
			}

			// Calculate total USD value
			const totalUsdValue = allTokens.reduce((sum, token) => sum + token.usdValue, 0)

			return {
				totalUsdValue,
				tokens: allTokens,
				lastUpdated: new Date().toISOString(),
			}
		})
	)

	if (Either.isLeft(result)) {
		const { status, body } = mapErrorToResponse(result.left)
		return c.json(body, status as 200)
	}

	return c.json(result.right)
})

// GET /webapp/users/me/swaps
protectedWebapp.get('/users/me/swaps', async (c) => {
	const telegramUser = c.get('telegramUser') as TelegramUser
	const limit = Number(c.req.query('limit') || 20)
	const offset = Number(c.req.query('offset') || 0)

	const result = await runEffectEither(
		Effect.gen(function* () {
			const userService = yield* UserService
			const swapService = yield* SwapService

			// Find user by telegram_id
			const userOption = yield* userService.getUserByTelegramId(telegramUser.id)

			if (Option.isNone(userOption)) {
				return []
			}

			const user = userOption.value

			// Get swaps
			const swaps = yield* swapService.getUserSwaps(user.id, limit, offset)

			return swaps.map((swap) => ({
				id: String(swap.id),
				fromChain: swap.fromChain,
				toChain: swap.toChain,
				fromToken: swap.fromToken,
				toToken: swap.toToken,
				fromAmount: swap.fromAmount,
				toAmount: swap.toAmount,
				fromAmountUsd: swap.fromAmountUsd,
				toAmountUsd: swap.toAmountUsd,
				status: swap.status,
				txHash: swap.txHash,
				bridgeTxHash: swap.bridgeTxHash,
				destinationTxHash: swap.destinationTxHash,
				createdAt: swap.createdAt?.toISOString() ?? '',
				completedAt: swap.completedAt?.toISOString() ?? null,
				errorMessage: swap.errorMessage,
			}))
		})
	)

	if (Either.isLeft(result)) {
		const { status, body } = mapErrorToResponse(result.left)
		return c.json(body, status as 200)
	}

	return c.json(result.right)
})

// Mount protected routes
webappRoutes.route('/', protectedWebapp)

export { webappRoutes }
