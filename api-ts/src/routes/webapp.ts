import { Hono } from 'hono'
import { Effect, Either, Option } from 'effect'
import jwt from 'jsonwebtoken'
import { telegramAuth } from '../middleware'
import { TelegramAuthService, UserService, WalletService, SwapService, BalanceService, TurnkeyService, PointsService } from '../services'
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

	// Debug logging
	console.log('Telegram auth request:', {
		hasBody: !!body,
		hasInitData: !!initData,
		initDataLength: initData?.length,
		initDataPreview: initData?.substring(0, 100),
	})

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
// Protected routes use /webapp/me/* paths
protectedWebapp.get('/portfolio', async (c) => {
	const telegramUser = c.get('telegramUser') as TelegramUser

	const emptyPortfolio = {
		totalUsdValue: 0,
		tokens: [],
		lastUpdated: new Date().toISOString(),
	}

	const result = await runEffectEither(
		Effect.gen(function* () {
			const userService = yield* UserService
			const walletService = yield* WalletService
			const balanceService = yield* BalanceService

			// Find user by telegram_id
			const userOption = yield* userService.getUserByTelegramId(telegramUser.id)

			if (Option.isNone(userOption)) {
				return emptyPortfolio
			}

			const user = userOption.value

			// Get active wallets
			const wallets = yield* walletService.getActiveWallets(user.id)

			if (wallets.length === 0) {
				return emptyPortfolio
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
		}).pipe(
			// Gracefully handle any errors by returning empty portfolio
			Effect.catchAll((error) => {
				console.error('Portfolio fetch error:', error)
				return Effect.succeed(emptyPortfolio)
			})
		)
	)

	// Result should always be Right now due to catchAll
	if (Either.isLeft(result)) {
		return c.json(emptyPortfolio)
	}

	return c.json(result.right)
})

// GET /webapp/users/me/wallets - Get user's wallets
protectedWebapp.get('/wallets', async (c) => {
	const telegramUser = c.get('telegramUser') as TelegramUser

	const result = await runEffectEither(
		Effect.gen(function* () {
			const userService = yield* UserService
			const walletService = yield* WalletService

			// Find user by telegram_id
			const userOption = yield* Effect.either(userService.getUserByTelegramId(telegramUser.id))

			if (Either.isLeft(userOption) || Option.isNone(userOption.right)) {
				return { wallets: [] }
			}

			const user = userOption.right.value

			// Get active wallets
			const walletsResult = yield* Effect.either(walletService.getActiveWallets(user.id))
			
			if (Either.isLeft(walletsResult)) {
				return { wallets: [] }
			}

			const wallets = walletsResult.right

			return {
				wallets: wallets.map((w) => ({
					address: w.address,
					name: w.name || 'Wallet',
					chainType: w.chainType,
					provider: w.walletProvider,
					isDefault: w.isDefault,
					createdAt: w.createdAt?.toISOString() ?? '',
				})),
			}
		}).pipe(
			Effect.catchAll(() => Effect.succeed({ wallets: [] }))
		)
	)

	if (Either.isLeft(result)) {
		return c.json({ wallets: [] })
	}

	return c.json(result.right)
})

// GET /webapp/me/swaps
protectedWebapp.get('/swaps', async (c) => {
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

// GET /webapp/me/preferences - Get user preferences
protectedWebapp.get('/preferences', async (c) => {
	const telegramUser = c.get('telegramUser') as TelegramUser

	const result = await runEffectEither(
		Effect.gen(function* () {
			const userService = yield* UserService
			const walletService = yield* WalletService

			// Find user by telegram_id
			const userOption = yield* userService.getUserByTelegramId(telegramUser.id)

			if (Option.isNone(userOption)) {
				return yield* Effect.fail(new Error('User not found'))
			}

			const user = userOption.value

			// Get linked wallets
			const wallets = yield* walletService.getActiveWallets(user.id)

			return {
				user: {
					id: user.id,
					telegramId: user.telegramId,
					username: user.username,
					firstName: user.firstName,
					lastName: user.lastName,
				},
				preferences: {
					defaultSlippage: user.defaultSlippage ?? 50, // basis points (50 = 0.5%)
					notificationsEnabled: user.notificationsEnabled ?? true,
					twoFaEnabled: user.twoFaEnabled ?? false,
					twoFaThreshold: user.twoFaThreshold ?? 1000,
				},
				wallets: wallets.map((w) => ({
					address: w.address,
					name: w.name || 'Wallet',
					chainType: w.chainType,
					provider: w.walletProvider,
					isDefault: w.isDefault,
					linkedAt: w.createdAt?.toISOString() ?? '',
				})),
			}
		})
	)

	if (Either.isLeft(result)) {
		return c.json({ error: result.left.message || 'Failed to fetch preferences' }, 500)
	}

	return c.json(result.right)
})

// PUT /webapp/me/preferences - Update user preferences
protectedWebapp.put('/preferences', async (c) => {
	const telegramUser = c.get('telegramUser') as TelegramUser
	const body = await c.req.json().catch(() => ({}))

	const result = await runEffectEither(
		Effect.gen(function* () {
			const userService = yield* UserService

			// Find user by telegram_id
			const userOption = yield* userService.getUserByTelegramId(telegramUser.id)

			if (Option.isNone(userOption)) {
				return yield* Effect.fail(new Error('User not found'))
			}

			const user = userOption.value

			// Update preferences
			const updatedUser = yield* userService.updateUserPreferences(user.id, {
				defaultSlippage: body.defaultSlippage,
				notificationsEnabled: body.notificationsEnabled,
				twoFaEnabled: body.twoFaEnabled,
				twoFaThreshold: body.twoFaThreshold,
			})

			return {
				success: true,
				preferences: {
					defaultSlippage: updatedUser.defaultSlippage ?? 50,
					notificationsEnabled: updatedUser.notificationsEnabled ?? true,
					twoFaEnabled: updatedUser.twoFaEnabled ?? false,
					twoFaThreshold: updatedUser.twoFaThreshold ?? 1000,
				},
			}
		})
	)

	if (Either.isLeft(result)) {
		return c.json({ error: result.left.message || 'Failed to update preferences' }, 500)
	}

	return c.json(result.right)
})

// === Points Routes ===

// GET /webapp/me/points/stats - Get user's points stats
protectedWebapp.get('/points/stats', async (c) => {
	const telegramUser = c.get('telegramUser') as TelegramUser

	const result = await runEffectEither(
		Effect.gen(function* () {
			const userService = yield* UserService
			const pointsService = yield* PointsService

			const userOption = yield* userService.getUserByTelegramId(telegramUser.id)
			if (Option.isNone(userOption)) {
				return yield* Effect.fail(new Error('User not found'))
			}

			const stats = yield* pointsService.getUserStats(userOption.value.id)
			return {
				...stats,
				lastCheckin: stats.lastCheckin?.toISOString() ?? null,
			}
		})
	)

	if (Either.isLeft(result)) {
		return c.json({ error: result.left.message }, 500)
	}
	return c.json(result.right)
})

// POST /webapp/me/points/checkin - Daily check-in
protectedWebapp.post('/points/checkin', async (c) => {
	const telegramUser = c.get('telegramUser') as TelegramUser

	const result = await runEffectEither(
		Effect.gen(function* () {
			const userService = yield* UserService
			const pointsService = yield* PointsService

			const userOption = yield* userService.getUserByTelegramId(telegramUser.id)
			if (Option.isNone(userOption)) {
				return yield* Effect.fail(new Error('User not found'))
			}

			return yield* pointsService.dailyCheckin(userOption.value.id)
		})
	)

	if (Either.isLeft(result)) {
		return c.json({ error: result.left.message }, 400)
	}
	return c.json(result.right)
})

// GET /webapp/me/points/history - Get points history
protectedWebapp.get('/points/history', async (c) => {
	const telegramUser = c.get('telegramUser') as TelegramUser
	const limit = Math.min(Number(c.req.query('limit') || 20), 100)
	const offset = Number(c.req.query('offset') || 0)

	const result = await runEffectEither(
		Effect.gen(function* () {
			const userService = yield* UserService
			const pointsService = yield* PointsService

			const userOption = yield* userService.getUserByTelegramId(telegramUser.id)
			if (Option.isNone(userOption)) {
				return yield* Effect.fail(new Error('User not found'))
			}

			const history = yield* pointsService.getPointHistory(userOption.value.id, limit, offset)
			return history.map((tx) => ({
				id: tx.id,
				amount: tx.amount,
				action: tx.action,
				description: tx.description,
				createdAt: tx.createdAt.toISOString(),
			}))
		})
	)

	if (Either.isLeft(result)) {
		return c.json({ error: result.left.message }, 500)
	}
	return c.json(result.right)
})

// GET /webapp/me/points/leaderboard - Get leaderboard
protectedWebapp.get('/points/leaderboard', async (c) => {
	const limit = Math.min(Number(c.req.query('limit') || 10), 100)

	const result = await runEffectEither(
		Effect.gen(function* () {
			const pointsService = yield* PointsService
			return yield* pointsService.getLeaderboard(limit)
		})
	)

	if (Either.isLeft(result)) {
		return c.json({ error: result.left.message }, 500)
	}
	return c.json(result.right)
})

// GET /webapp/me/points/rewards - Get available rewards
protectedWebapp.get('/points/rewards', async (c) => {
	const result = await runEffectEither(
		Effect.gen(function* () {
			const pointsService = yield* PointsService
			const rewards = yield* pointsService.getAvailableRewards()
			return rewards.map((r) => ({
				id: r.id,
				name: r.name,
				description: r.description,
				emoji: r.emoji,
				pointsCost: r.pointsCost,
				rewardType: r.rewardType,
				rewardValue: r.rewardValue,
				stock: r.stock,
			}))
		})
	)

	if (Either.isLeft(result)) {
		return c.json({ error: result.left.message }, 500)
	}
	return c.json(result.right)
})

// POST /webapp/me/points/redeem/:rewardId - Redeem a reward
protectedWebapp.post('/points/redeem/:rewardId', async (c) => {
	const telegramUser = c.get('telegramUser') as TelegramUser
	const rewardId = Number(c.req.param('rewardId'))

	if (Number.isNaN(rewardId)) {
		return c.json({ error: 'Invalid reward ID' }, 400)
	}

	const result = await runEffectEither(
		Effect.gen(function* () {
			const userService = yield* UserService
			const pointsService = yield* PointsService

			const userOption = yield* userService.getUserByTelegramId(telegramUser.id)
			if (Option.isNone(userOption)) {
				return yield* Effect.fail(new Error('User not found'))
			}

			const redemption = yield* pointsService.redeemReward(userOption.value.id, rewardId)
			return {
				id: redemption.id,
				pointsSpent: redemption.pointsSpent,
				rewardType: redemption.rewardType,
				rewardValue: redemption.rewardValue,
				status: redemption.status,
				expiresAt: redemption.expiresAt?.toISOString() ?? null,
			}
		})
	)

	if (Either.isLeft(result)) {
		return c.json({ error: result.left.message }, 400)
	}
	return c.json(result.right)
})

// Mount protected routes at both /me and /users/me for backward compatibility
webappRoutes.route('/me', protectedWebapp)
webappRoutes.route('/users/me', protectedWebapp)

export { webappRoutes }
