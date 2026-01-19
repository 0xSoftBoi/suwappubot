import { Hono } from 'hono'
import { Effect, Either, Option } from 'effect'
import { telegramAuth } from '../middleware'
import { TelegramAuthService, UserService, WalletService, SwapService, BalanceService, QuoteService } from '../services'
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

// Protected webapp routes
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
