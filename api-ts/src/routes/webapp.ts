import { Hono } from 'hono'
import { Effect, Either, Option } from 'effect'
import { telegramAuth } from '../middleware'
import { TelegramAuthService, UserService, WalletService, SwapService } from '../services'
import { runEffect, runEffectEither } from '../runtime'
import type { TelegramUser } from '../services/TelegramAuthService'
import { mapErrorToResponse } from '../errors'

const webappRoutes = new Hono()

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

			// For now, return placeholder portfolio data
			// In production, you'd fetch actual balances from each wallet
			return {
				totalUsdValue: 0,
				tokens: wallets.map((wallet) => ({
					symbol: wallet.chainType === 'solana' ? 'SOL' : 'ETH',
					name: wallet.chainType === 'solana' ? 'Solana' : 'Ethereum',
					address: wallet.address,
					chain: wallet.chainType,
					balance: '0',
					usdValue: 0,
				})),
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
