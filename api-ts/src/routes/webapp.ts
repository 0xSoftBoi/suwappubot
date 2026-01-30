import { Hono } from 'hono'
import { Effect, Either, Option } from 'effect'
import jwt from 'jsonwebtoken'
import { telegramAuth } from '../middleware'
import { TelegramAuthService, UserService, WalletService, SwapService, BalanceService, TurnkeyService } from '../services'
import { runEffect, runEffectEither } from '../runtime'
import type { TelegramUser } from '../services/TelegramAuthService'
import { mapErrorToResponse } from '../errors'
import { EnvService } from '../config/EnvService'

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

// POST /webapp/telegram/auth - Authenticate Telegram user and create wallet if needed
webappRoutes.post('/telegram/auth', async (c) => {
	const body = await c.req.json().catch(() => ({}))
	const initData = body.initData || c.req.header('X-Telegram-Init-Data')

	if (!initData) {
		return c.json({ success: false, error: 'Missing initData' }, 400)
	}

	const result = await runEffectEither(
		Effect.gen(function* () {
			const env = yield* EnvService
			const authService = yield* TelegramAuthService
			const userService = yield* UserService
			const walletService = yield* WalletService
			const turnkeyService = yield* TurnkeyService

			// 1. Validate initData
			const telegramUserOption = yield* authService.validateInitData(initData)

			if (Option.isNone(telegramUserOption)) {
				return yield* Effect.fail(new Error('Invalid Telegram initData'))
			}

			const telegramUser = telegramUserOption.value

			// 2. Get or create user
			const { user, isNew } = yield* userService.getOrCreateUser({
				telegramId: telegramUser.id,
				username: telegramUser.username,
				firstName: telegramUser.first_name,
				lastName: telegramUser.last_name,
			})

			// 3. Check if user has a wallet, create one if not
			let walletAddress: string | null = null
			const existingWallets = yield* walletService.getActiveWallets(user.id)

			if (existingWallets.length === 0) {
				// Create Turnkey wallet for new user
				const turnkeyResult = yield* Effect.either(
					turnkeyService.createSubOrgForTelegramUser(telegramUser.id, telegramUser.username)
				)

				if (Either.isRight(turnkeyResult)) {
					const turnkeyWallet = turnkeyResult.right
					// Save wallet to database
					const wallet = yield* walletService.createTurnkeyWallet({
						userId: user.id,
						address: turnkeyWallet.address,
						turnkeySubOrgId: turnkeyWallet.subOrgId,
						turnkeyWalletId: turnkeyWallet.walletId,
						turnkeyAccountId: turnkeyWallet.accountId,
					})
					walletAddress = wallet.address
				} else {
					// Log error but don't fail auth - wallet can be created later
					console.error('Failed to create Turnkey wallet:', turnkeyResult.left)
				}
			} else {
				walletAddress = existingWallets[0].address
			}

			// 4. Generate JWT
			const jwtSecret = env.JWT_SECRET || 'development-secret-change-in-production'
			const token = jwt.sign(
				{
					userId: user.id,
					telegramId: telegramUser.id,
					walletAddress,
				},
				jwtSecret,
				{ expiresIn: '7d' }
			)

			return {
				success: true,
				jwt: token,
				user: {
					id: user.id,
					telegramId: telegramUser.id,
					username: telegramUser.username,
					firstName: telegramUser.first_name,
					lastName: telegramUser.last_name,
				},
				walletAddress,
				isNewUser: isNew,
			}
		})
	)

	if (Either.isLeft(result)) {
		const error = result.left
		console.error('Telegram auth error:', error)
		return c.json({ success: false, error: error.message || 'Authentication failed' }, 401)
	}

	return c.json(result.right)
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
