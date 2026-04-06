import { Effect, Either, Option } from 'effect'
import { Hono } from 'hono'
import jwt from 'jsonwebtoken'
import { EnvService } from '../config/EnvService'
import { logger } from '../lib/logger'
import { mapErrorToResponse } from '../errors'
import { telegramAuth } from '../middleware'
import { runEffect, runEffectEither } from '../runtime'
import {
	AlertService,
	BalanceService,
	DCAService,
	PointsService,
	SwapService,
	TelegramAuthService,
	TurnkeyService,
	UserService,
	WalletService,
} from '../services'
import type { TelegramUser } from '../services/TelegramAuthService'

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
		}),
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
	logger.info({
		hasBody: !!body,
		hasInitData: !!initData,
		initDataLength: initData?.length,
		initDataPreview: initData?.substring(0, 100),
	}, 'Telegram auth request')

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
					turnkeyService.createSubOrgForTelegramUser(telegramUser.id, telegramUser.username),
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
					logger.error({ err: turnkeyResult.left }, 'Failed to create Turnkey wallet')
				}
			} else {
				walletAddress = existingWallets[0].address
			}

			// 4. Generate JWT
			const jwtSecret = env.JWT_SECRET
			if (!jwtSecret) {
				return yield* Effect.fail(new Error('JWT_SECRET not configured'))
			}
			const token = jwt.sign(
				{
					userId: user.id,
					telegramId: telegramUser.id,
					walletAddress,
				},
				jwtSecret,
				{ expiresIn: '7d' },
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
		}),
	)

	if (Either.isLeft(result)) {
		const error = result.left
		logger.error({ err: error }, 'Telegram auth error')
		return c.json({ success: false, error: error.message || 'Authentication failed' }, 401)
	}

	return c.json(result.right)
})

// POST /webapp/turnkey/oauth-wallet - Create wallet via OAuth provider
webappRoutes.post('/turnkey/oauth-wallet', async (c) => {
	const body = await c.req.json().catch(() => ({}))
	const { provider, oauthToken, telegramUserId } = body

	if (!provider || !oauthToken || !telegramUserId) {
		return c.json({ error: 'Missing required fields: provider, oauthToken, telegramUserId' }, 400)
	}

	const result = await runEffectEither(
		Effect.gen(function* () {
			const turnkeyService = yield* TurnkeyService
			const userService = yield* UserService
			const walletService = yield* WalletService

			// Create sub-org with OAuth authenticator + wallet
			const turnkeyWallet = yield* turnkeyService.createSubOrgWithOAuth(
				provider,
				oauthToken,
				String(telegramUserId)
			)

			// Find user by telegram ID and save wallet
			const userOption = yield* userService.getUserByTelegramId(Number(telegramUserId))

			if (Option.isSome(userOption)) {
				const user = userOption.value
				yield* walletService.createTurnkeyWallet({
					userId: user.id,
					address: turnkeyWallet.address,
					turnkeySubOrgId: turnkeyWallet.subOrgId,
					turnkeyWalletId: turnkeyWallet.walletId,
					turnkeyAccountId: turnkeyWallet.accountId,
				})
			}

			return {
				subOrgId: turnkeyWallet.subOrgId,
				walletId: turnkeyWallet.walletId,
				address: turnkeyWallet.address,
			}
		})
	)

	if (Either.isLeft(result)) {
		logger.error({ err: result.left }, 'OAuth wallet creation error')
		return c.json({ error: result.left.message || 'Failed to create OAuth wallet' }, 500)
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
				logger.error({ err: error }, 'Portfolio fetch error')
				return Effect.succeed(emptyPortfolio)
			}),
		),
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
		}).pipe(Effect.catchAll(() => Effect.succeed({ wallets: [] }))),
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
		}),
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
					gasMode: user.gasMode ?? 'auto',
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
		}),
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
				gasMode: body.gasMode,
			})

			return {
				success: true,
				preferences: {
					defaultSlippage: updatedUser.defaultSlippage ?? 50,
					notificationsEnabled: updatedUser.notificationsEnabled ?? true,
					twoFaEnabled: updatedUser.twoFaEnabled ?? false,
					twoFaThreshold: updatedUser.twoFaThreshold ?? 1000,
					gasMode: updatedUser.gasMode ?? 'auto',
				},
			}
		}),
	)

	if (Either.isLeft(result)) {
		return c.json({ error: result.left.message || 'Failed to update preferences' }, 500)
	}

	return c.json(result.right)
})

// === DCA Routes ===

protectedWebapp.get('/dca', async (c) => {
	const telegramUser = c.get('telegramUser') as TelegramUser
	const status = c.req.query('status')
	const limit = Math.min(Number(c.req.query('limit') || 20), 100)
	const offset = Number(c.req.query('offset') || 0)

	const result = await runEffectEither(
		Effect.gen(function* () {
			const userService = yield* UserService
			const dcaService = yield* DCAService

			const userOption = yield* userService.getUserByTelegramId(telegramUser.id)
			if (Option.isNone(userOption)) {
				return yield* Effect.fail(new Error('User not found'))
			}

			const orders = yield* dcaService.getUserOrders(userOption.value.id, status, limit, offset)
			return orders.map((order) => ({
				id: order.id,
				userId: order.userId,
				fromChain: order.fromChain,
				fromToken: order.fromToken,
				fromTokenSymbol: order.fromTokenSymbol,
				toChain: order.toChain,
				toToken: order.toToken,
				toTokenSymbol: order.toTokenSymbol,
				amountPerExecution: order.amountPerExecution,
				interval: order.interval,
				totalExecutions: order.totalExecutions,
				executionsCompleted: order.executionsCompleted,
				maxSlippage: order.maxSlippage,
				walletAddress: order.walletAddress,
				status: order.status,
				nextExecutionAt: order.nextExecutionAt?.toISOString() ?? null,
				lastExecutedAt: order.lastExecutedAt?.toISOString() ?? null,
				createdAt: order.createdAt?.toISOString() ?? null,
				updatedAt: order.updatedAt?.toISOString() ?? null,
			}))
		}),
	)

	if (Either.isLeft(result)) {
		return c.json({ error: result.left.message }, 500)
	}
	return c.json(result.right)
})

protectedWebapp.post('/dca', async (c) => {
	const telegramUser = c.get('telegramUser') as TelegramUser
	const body = await c.req.json().catch(() => ({}))

	const result = await runEffectEither(
		Effect.gen(function* () {
			const userService = yield* UserService
			const dcaService = yield* DCAService

			const userOption = yield* userService.getUserByTelegramId(telegramUser.id)
			if (Option.isNone(userOption)) {
				return yield* Effect.fail(new Error('User not found'))
			}

			return yield* dcaService.createOrder({
				userId: userOption.value.id,
				fromChain: body.fromChain,
				fromToken: body.fromToken,
				fromTokenSymbol: body.fromTokenSymbol,
				toChain: body.toChain,
				toToken: body.toToken,
				toTokenSymbol: body.toTokenSymbol,
				amountPerExecution: body.amountPerExecution,
				frequency: body.frequency,
				totalExecutions: body.totalExecutions,
				walletAddress: body.walletAddress,
				slippage: body.slippage,
			})
		}),
	)

	if (Either.isLeft(result)) {
		return c.json({ error: result.left.message }, 400)
	}
	return c.json(result.right, 201)
})

protectedWebapp.post('/dca/:orderId/pause', async (c) => {
	const telegramUser = c.get('telegramUser') as TelegramUser
	const orderId = Number(c.req.param('orderId'))
	if (Number.isNaN(orderId)) return c.json({ error: 'Invalid order ID' }, 400)

	const result = await runEffectEither(
		Effect.gen(function* () {
			const userService = yield* UserService
			const dcaService = yield* DCAService
			const userOption = yield* userService.getUserByTelegramId(telegramUser.id)
			if (Option.isNone(userOption)) return yield* Effect.fail(new Error('User not found'))
			return yield* dcaService.pauseOrder(orderId, userOption.value.id)
		}),
	)

	if (Either.isLeft(result)) return c.json({ error: result.left.message }, 400)
	return c.json(result.right)
})

protectedWebapp.post('/dca/:orderId/resume', async (c) => {
	const telegramUser = c.get('telegramUser') as TelegramUser
	const orderId = Number(c.req.param('orderId'))
	if (Number.isNaN(orderId)) return c.json({ error: 'Invalid order ID' }, 400)

	const result = await runEffectEither(
		Effect.gen(function* () {
			const userService = yield* UserService
			const dcaService = yield* DCAService
			const userOption = yield* userService.getUserByTelegramId(telegramUser.id)
			if (Option.isNone(userOption)) return yield* Effect.fail(new Error('User not found'))
			return yield* dcaService.resumeOrder(orderId, userOption.value.id)
		}),
	)

	if (Either.isLeft(result)) return c.json({ error: result.left.message }, 400)
	return c.json(result.right)
})

protectedWebapp.delete('/dca/:orderId', async (c) => {
	const telegramUser = c.get('telegramUser') as TelegramUser
	const orderId = Number(c.req.param('orderId'))
	if (Number.isNaN(orderId)) return c.json({ error: 'Invalid order ID' }, 400)

	const result = await runEffectEither(
		Effect.gen(function* () {
			const userService = yield* UserService
			const dcaService = yield* DCAService
			const userOption = yield* userService.getUserByTelegramId(telegramUser.id)
			if (Option.isNone(userOption)) return yield* Effect.fail(new Error('User not found'))
			return yield* dcaService.cancelOrder(orderId, userOption.value.id)
		}),
	)

	if (Either.isLeft(result)) return c.json({ error: result.left.message }, 400)
	return c.json(result.right)
})

protectedWebapp.get('/dca/:orderId/executions', async (c) => {
	const telegramUser = c.get('telegramUser') as TelegramUser
	const orderId = Number(c.req.param('orderId'))
	if (Number.isNaN(orderId)) return c.json({ error: 'Invalid order ID' }, 400)

	const result = await runEffectEither(
		Effect.gen(function* () {
			const userService = yield* UserService
			const dcaService = yield* DCAService
			const userOption = yield* userService.getUserByTelegramId(telegramUser.id)
			if (Option.isNone(userOption)) return yield* Effect.fail(new Error('User not found'))
			const executions = yield* dcaService.getExecutions(orderId, userOption.value.id)
			return executions.map((execution) => ({
				...execution,
				executedAt: execution.executedAt?.toISOString() ?? null,
			}))
		}),
	)

	if (Either.isLeft(result)) return c.json({ error: result.left.message }, 400)
	return c.json(result.right)
})

protectedWebapp.get('/dca/stats', async (c) => {
	const telegramUser = c.get('telegramUser') as TelegramUser

	const result = await runEffectEither(
		Effect.gen(function* () {
			const userService = yield* UserService
			const dcaService = yield* DCAService
			const userOption = yield* userService.getUserByTelegramId(telegramUser.id)
			if (Option.isNone(userOption)) return yield* Effect.fail(new Error('User not found'))
			return yield* dcaService.getStats(userOption.value.id)
		}),
	)

	if (Either.isLeft(result)) return c.json({ error: result.left.message }, 400)
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
		}),
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
		}),
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
		}),
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
		}),
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
		}),
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
		}),
	)

	if (Either.isLeft(result)) {
		return c.json({ error: result.left.message }, 400)
	}
	return c.json(result.right)
})

// === Limit Order Routes ===
import { LimitOrderService } from '../services'

// GET /webapp/me/limit-orders - Get user's limit orders
protectedWebapp.get('/limit-orders', async (c) => {
	const telegramUser = c.get('telegramUser') as TelegramUser
	const status = c.req.query('status')
	const limit = Math.min(Number(c.req.query('limit') || 20), 100)
	const offset = Number(c.req.query('offset') || 0)

	const result = await runEffectEither(
		Effect.gen(function* () {
			const userService = yield* UserService
			const limitOrderService = yield* LimitOrderService

			const userOption = yield* userService.getUserByTelegramId(telegramUser.id)
			if (Option.isNone(userOption)) {
				return yield* Effect.fail(new Error('User not found'))
			}

			const orders = yield* limitOrderService.getUserOrders(
				userOption.value.id,
				status,
				limit,
				offset,
			)
			return orders.map((order) => ({
				id: order.id,
				fromChain: order.fromChain,
				fromToken: order.fromToken,
				fromTokenSymbol: order.fromTokenSymbol,
				fromAmount: order.fromAmount,
				toChain: order.toChain,
				toToken: order.toToken,
				toTokenSymbol: order.toTokenSymbol,
				targetPrice: order.targetPrice,
				currentPrice: order.currentPrice,
				triggerType: order.triggerType,
				status: order.status,
				createdAt: order.createdAt?.toISOString() ?? null,
				expiresAt: order.expiresAt?.toISOString() ?? null,
				executedAt: order.executedAt?.toISOString() ?? null,
				executedPrice: order.executedPrice,
				executedTxHash: order.executedTxHash,
			}))
		}),
	)

	if (Either.isLeft(result)) {
		return c.json({ error: result.left.message }, 500)
	}
	return c.json(result.right)
})

// POST /webapp/me/limit-orders - Create a limit order
protectedWebapp.post('/limit-orders', async (c) => {
	const telegramUser = c.get('telegramUser') as TelegramUser

	let body: {
		fromChain: string
		fromToken: string
		fromTokenSymbol: string
		fromAmount: string
		toChain: string
		toToken: string
		toTokenSymbol: string
		targetPrice: number
		triggerType?: 'lte' | 'gte'
		slippage?: number
		walletAddress: string
		expiresInHours?: number
	}

	try {
		body = await c.req.json()
	} catch {
		return c.json({ error: 'Invalid JSON body' }, 400)
	}

	const result = await runEffectEither(
		Effect.gen(function* () {
			const userService = yield* UserService
			const limitOrderService = yield* LimitOrderService

			const userOption = yield* userService.getUserByTelegramId(telegramUser.id)
			if (Option.isNone(userOption)) {
				return yield* Effect.fail(new Error('User not found'))
			}

			let expiresAt: Date | undefined
			if (body.expiresInHours && body.expiresInHours > 0) {
				expiresAt = new Date(Date.now() + body.expiresInHours * 60 * 60 * 1000)
			}

			const order = yield* limitOrderService.createOrder({
				userId: userOption.value.id,
				fromChain: body.fromChain,
				fromToken: body.fromToken,
				fromTokenSymbol: body.fromTokenSymbol,
				fromAmount: body.fromAmount,
				toChain: body.toChain,
				toToken: body.toToken,
				toTokenSymbol: body.toTokenSymbol,
				targetPrice: body.targetPrice,
				triggerType: body.triggerType || 'lte',
				slippage: body.slippage,
				walletAddress: body.walletAddress,
				expiresAt,
			})

			return {
				id: order.id,
				status: order.status,
				targetPrice: order.targetPrice,
				createdAt: order.createdAt?.toISOString() ?? null,
			}
		}),
	)

	if (Either.isLeft(result)) {
		return c.json({ error: result.left.message }, 400)
	}
	return c.json(result.right, 201)
})

// DELETE /webapp/me/limit-orders/:orderId - Cancel a limit order
protectedWebapp.delete('/limit-orders/:orderId', async (c) => {
	const telegramUser = c.get('telegramUser') as TelegramUser
	const orderId = Number(c.req.param('orderId'))

	if (Number.isNaN(orderId)) {
		return c.json({ error: 'Invalid order ID' }, 400)
	}

	const result = await runEffectEither(
		Effect.gen(function* () {
			const userService = yield* UserService
			const limitOrderService = yield* LimitOrderService

			const userOption = yield* userService.getUserByTelegramId(telegramUser.id)
			if (Option.isNone(userOption)) {
				return yield* Effect.fail(new Error('User not found'))
			}

			const order = yield* limitOrderService.cancelOrder(orderId, userOption.value.id)
			return {
				id: order.id,
				status: order.status,
				message: 'Order cancelled successfully',
			}
		}),
	)

	if (Either.isLeft(result)) {
		return c.json({ error: result.left.message }, 400)
	}
	return c.json(result.right)
})

// === Price Alert Routes ===

protectedWebapp.get('/price-alerts', async (c) => {
	const telegramUser = c.get('telegramUser') as TelegramUser
	const activeOnly = c.req.query('activeOnly') === 'true'

	const result = await runEffectEither(
		Effect.gen(function* () {
			const userService = yield* UserService
			const alertService = yield* AlertService
			const userOption = yield* userService.getUserByTelegramId(telegramUser.id)
			if (Option.isNone(userOption)) return yield* Effect.fail(new Error('User not found'))
			return yield* alertService.getUserAlerts(userOption.value.id, activeOnly)
		}),
	)

	if (Either.isLeft(result)) return c.json({ error: result.left.message }, 500)
	return c.json(
		result.right.map((alert) => ({
			id: alert.id,
			userId: alert.userId,
			tokenAddress: alert.tokenAddress,
			tokenSymbol: alert.tokenSymbol,
			chain: alert.chain,
			alertType: alert.alertType,
			condition: alert.condition,
			threshold: alert.threshold,
			active: alert.active,
			triggered: alert.triggered,
			triggeredAt: alert.triggeredAt?.toISOString() ?? null,
			createdAt: alert.createdAt?.toISOString() ?? null,
			updatedAt: alert.updatedAt?.toISOString() ?? null,
		})),
	)
})

protectedWebapp.post('/price-alerts', async (c) => {
	const telegramUser = c.get('telegramUser') as TelegramUser
	const body = await c.req.json().catch(() => ({}))

	const result = await runEffectEither(
		Effect.gen(function* () {
			const userService = yield* UserService
			const alertService = yield* AlertService
			const userOption = yield* userService.getUserByTelegramId(telegramUser.id)
			if (Option.isNone(userOption)) return yield* Effect.fail(new Error('User not found'))
			return yield* alertService.createAlert({
				userId: userOption.value.id,
				alertType: body.alertType ?? 'price',
				chain: body.chain,
				tokenAddress: body.tokenAddress,
				tokenSymbol: body.tokenSymbol,
				condition: body.condition,
				threshold: body.threshold,
			})
		}),
	)

	if (Either.isLeft(result)) return c.json({ error: result.left.message }, 400)
	return c.json(result.right, 201)
})

protectedWebapp.post('/price-alerts/:alertId/toggle', async (c) => {
	const telegramUser = c.get('telegramUser') as TelegramUser
	const alertId = Number(c.req.param('alertId'))
	if (Number.isNaN(alertId)) return c.json({ error: 'Invalid alert ID' }, 400)

	const result = await runEffectEither(
		Effect.gen(function* () {
			const userService = yield* UserService
			const alertService = yield* AlertService
			const userOption = yield* userService.getUserByTelegramId(telegramUser.id)
			if (Option.isNone(userOption)) return yield* Effect.fail(new Error('User not found'))
			return yield* alertService.toggleAlert(alertId, userOption.value.id)
		}),
	)

	if (Either.isLeft(result)) return c.json({ error: result.left.message }, 400)
	return c.json(result.right)
})

protectedWebapp.delete('/price-alerts/:alertId', async (c) => {
	const telegramUser = c.get('telegramUser') as TelegramUser
	const alertId = Number(c.req.param('alertId'))
	if (Number.isNaN(alertId)) return c.json({ error: 'Invalid alert ID' }, 400)

	const result = await runEffectEither(
		Effect.gen(function* () {
			const userService = yield* UserService
			const alertService = yield* AlertService
			const userOption = yield* userService.getUserByTelegramId(telegramUser.id)
			if (Option.isNone(userOption)) return yield* Effect.fail(new Error('User not found'))
			yield* alertService.deleteAlert(alertId, userOption.value.id)
			return { success: true }
		}),
	)

	if (Either.isLeft(result)) return c.json({ error: result.left.message }, 400)
	return c.json(result.right)
})

// === Copy Trading Routes ===
import { CopyTradingService } from '../services'

// GET /webapp/copy/top-traders - Public leaderboard (still requires auth)
protectedWebapp.get('/copy/top-traders', async (c) => {
	const limit = Math.min(Number(c.req.query('limit') || 20), 100)
	const minTrades = c.req.query('minTrades') ? Number(c.req.query('minTrades')) : undefined
	const minWinRate = c.req.query('minWinRate') ? Number(c.req.query('minWinRate')) : undefined
	const chain = c.req.query('chain') || undefined
	const sortBy = c.req.query('sortBy') || undefined

	const result = await runEffectEither(
		Effect.gen(function* () {
			const copyService = yield* CopyTradingService
			return yield* copyService.getTopTraders(limit, { minTrades, minWinRate, chain, sortBy })
		}),
	)

	if (Either.isLeft(result)) {
		return c.json({ error: result.left.message }, 500)
	}
	return c.json(result.right)
})

// GET /webapp/copy/trader/:id - Trader profile detail
protectedWebapp.get('/copy/trader/:id', async (c) => {
	const userId = Number(c.req.param('id'))

	if (Number.isNaN(userId)) {
		return c.json({ error: 'Invalid trader ID' }, 400)
	}

	const result = await runEffectEither(
		Effect.gen(function* () {
			const copyService = yield* CopyTradingService
			return yield* copyService.getTraderProfile(userId)
		}),
	)

	if (Either.isLeft(result)) {
		const { status, body } = mapErrorToResponse(result.left)
		return c.json(body, status as 200)
	}
	return c.json(result.right)
})

// GET /webapp/me/copy/following - Traders user follows
protectedWebapp.get('/copy/following', async (c) => {
	const telegramUser = c.get('telegramUser') as TelegramUser

	const result = await runEffectEither(
		Effect.gen(function* () {
			const userService = yield* UserService
			const copyService = yield* CopyTradingService

			const userOption = yield* userService.getUserByTelegramId(telegramUser.id)
			if (Option.isNone(userOption)) {
				return yield* Effect.fail(new Error('User not found'))
			}

			return yield* copyService.getFollowing(userOption.value.id)
		}),
	)

	if (Either.isLeft(result)) {
		return c.json({ error: result.left.message }, 500)
	}
	return c.json(result.right)
})

// GET /webapp/me/copy/trades - Copy trade history
protectedWebapp.get('/copy/trades', async (c) => {
	const telegramUser = c.get('telegramUser') as TelegramUser
	const limit = Math.min(Number(c.req.query('limit') || 20), 100)
	const offset = Number(c.req.query('offset') || 0)

	const result = await runEffectEither(
		Effect.gen(function* () {
			const userService = yield* UserService
			const copyService = yield* CopyTradingService

			const userOption = yield* userService.getUserByTelegramId(telegramUser.id)
			if (Option.isNone(userOption)) {
				return yield* Effect.fail(new Error('User not found'))
			}

			return yield* copyService.getCopyTrades(userOption.value.id, { limit })
		}),
	)

	if (Either.isLeft(result)) {
		return c.json({ error: result.left.message }, 500)
	}
	return c.json(result.right)
})

// POST /webapp/me/copy/follow/:traderId - Follow a trader
protectedWebapp.post('/copy/follow/:traderId', async (c) => {
	const telegramUser = c.get('telegramUser') as TelegramUser
	const traderId = Number(c.req.param('traderId'))

	if (Number.isNaN(traderId)) {
		return c.json({ error: 'Invalid trader ID' }, 400)
	}

	const body = await c.req.json().catch(() => ({}))

	const result = await runEffectEither(
		Effect.gen(function* () {
			const userService = yield* UserService
			const copyService = yield* CopyTradingService

			const userOption = yield* userService.getUserByTelegramId(telegramUser.id)
			if (Option.isNone(userOption)) {
				return yield* Effect.fail(new Error('User not found'))
			}

			return yield* copyService.followTrader({
				followerId: userOption.value.id,
				traderId,
				copyMode: body.copyMode,
				copyAmountUsd: body.copyAmountUsd,
				maxTradeUsd: body.maxTradeUsd,
				dailyLimitUsd: body.dailyLimitUsd,
				autoSellEnabled: body.autoSellEnabled,
				chainsFilter: body.chainsFilter,
			})
		}),
	)

	if (Either.isLeft(result)) {
		const { status, body: errBody } = mapErrorToResponse(result.left)
		return c.json(errBody, status as 200)
	}
	return c.json(result.right, 201)
})

// DELETE /webapp/me/copy/follow/:traderId - Unfollow a trader
protectedWebapp.delete('/copy/follow/:traderId', async (c) => {
	const telegramUser = c.get('telegramUser') as TelegramUser
	const traderId = Number(c.req.param('traderId'))

	if (Number.isNaN(traderId)) {
		return c.json({ error: 'Invalid trader ID' }, 400)
	}

	const result = await runEffectEither(
		Effect.gen(function* () {
			const userService = yield* UserService
			const copyService = yield* CopyTradingService

			const userOption = yield* userService.getUserByTelegramId(telegramUser.id)
			if (Option.isNone(userOption)) {
				return yield* Effect.fail(new Error('User not found'))
			}

			yield* copyService.unfollowTrader(userOption.value.id, traderId)
			return { success: true, message: 'Unfollowed successfully' }
		}),
	)

	if (Either.isLeft(result)) {
		const { status, body: errBody } = mapErrorToResponse(result.left)
		return c.json(errBody, status as 200)
	}
	return c.json(result.right)
})

// PUT /webapp/me/copy/follow/:traderId - Update copy settings
protectedWebapp.put('/copy/follow/:traderId', async (c) => {
	const telegramUser = c.get('telegramUser') as TelegramUser
	const traderId = Number(c.req.param('traderId'))

	if (Number.isNaN(traderId)) {
		return c.json({ error: 'Invalid trader ID' }, 400)
	}

	const body = await c.req.json().catch(() => ({}))

	const result = await runEffectEither(
		Effect.gen(function* () {
			const userService = yield* UserService
			const copyService = yield* CopyTradingService

			const userOption = yield* userService.getUserByTelegramId(telegramUser.id)
			if (Option.isNone(userOption)) {
				return yield* Effect.fail(new Error('User not found'))
			}

			return yield* copyService.updateCopySettings(userOption.value.id, traderId, {
				copyMode: body.copyMode,
				copyAmountUsd: body.copyAmountUsd,
				maxTradeUsd: body.maxTradeUsd,
				dailyLimitUsd: body.dailyLimitUsd,
				autoSellEnabled: body.autoSellEnabled,
				chainsFilter: body.chainsFilter,
			})
		}),
	)

	if (Either.isLeft(result)) {
		const { status, body: errBody } = mapErrorToResponse(result.left)
		return c.json(errBody, status as 200)
	}
	return c.json(result.right)
})

// === Prediction Market Routes ===
import { PolymarketService } from '../services/PolymarketService'

// GET /webapp/me/predict/markets — search/browse markets
protectedWebapp.get('/predict/markets', async (c) => {
	const query = c.req.query('query') || c.req.query('category')
	const limit = Math.min(parseInt(c.req.query('limit') ?? '20', 10), 100)

	const result = await runEffectEither(
		Effect.gen(function* () {
			const pm = yield* PolymarketService
			return yield* pm.getMarkets(query, limit)
		}),
	)

	if (Either.isLeft(result)) {
		const { status, body } = mapErrorToResponse(result.left)
		return c.json(body, status as 200)
	}

	return c.json({ markets: result.right })
})

// GET /webapp/me/predict/events — browse events
protectedWebapp.get('/predict/events', async (c) => {
	const query = c.req.query('query')
	const limit = Math.min(parseInt(c.req.query('limit') ?? '20', 10), 100)

	const result = await runEffectEither(
		Effect.gen(function* () {
			const pm = yield* PolymarketService
			return yield* pm.getEvents(query, limit)
		}),
	)

	if (Either.isLeft(result)) {
		const { status, body } = mapErrorToResponse(result.left)
		return c.json(body, status as 200)
	}

	return c.json({ events: result.right })
})

// GET /webapp/me/predict/market/:id — market detail
protectedWebapp.get('/predict/market/:id', async (c) => {
	const id = c.req.param('id')

	const result = await runEffectEither(
		Effect.gen(function* () {
			const pm = yield* PolymarketService
			return yield* pm.getMarket(id)
		}),
	)

	if (Either.isLeft(result)) {
		const { status, body } = mapErrorToResponse(result.left)
		return c.json(body, status as 200)
	}

	return c.json(result.right)
})

// GET /webapp/me/predict/market/:id/book — orderbook for all outcomes
protectedWebapp.get('/predict/market/:id/book', async (c) => {
	const id = c.req.param('id')

	const result = await runEffectEither(
		Effect.gen(function* () {
			const pm = yield* PolymarketService
			const market = yield* pm.getMarket(id)

			if (market.tokens.length === 0) {
				return { marketId: id, question: market.question, outcomes: [] }
			}

			const books = yield* Effect.all(
				market.tokens.map((t) =>
					Effect.map(pm.getOrderbook(t.tokenId), (book) => ({
						outcome: t.outcome,
						tokenId: t.tokenId,
						...book,
					}))
				),
				{ concurrency: 'unbounded' },
			)

			return { marketId: id, question: market.question, outcomes: books }
		}),
	)

	if (Either.isLeft(result)) {
		const { status, body } = mapErrorToResponse(result.left)
		return c.json(body, status as 200)
	}

	return c.json(result.right)
})

// GET /webapp/me/predict/market/:id/price — live CLOB midpoint prices
protectedWebapp.get('/predict/market/:id/price', async (c) => {
	const id = c.req.param('id')

	const result = await runEffectEither(
		Effect.gen(function* () {
			const pm = yield* PolymarketService
			const market = yield* pm.getMarket(id)

			if (market.tokens.length === 0) {
				return { marketId: id, question: market.question, prices: [] }
			}

			const prices = yield* Effect.all(
				market.tokens.map((t) =>
					Effect.map(pm.getMidpoint(t.tokenId), (midData) => ({
						outcome: t.outcome,
						tokenId: t.tokenId,
						mid: midData.mid,
					}))
				),
				{ concurrency: 'unbounded' },
			)

			return { marketId: id, question: market.question, prices }
		}),
	)

	if (Either.isLeft(result)) {
		const { status, body } = mapErrorToResponse(result.left)
		return c.json(body, status as 200)
	}

	return c.json(result.right)
})

// GET /webapp/me/predict/market/:id/trades — recent trades across outcomes
protectedWebapp.get('/predict/market/:id/trades', async (c) => {
	const id = c.req.param('id')
	const limit = Math.min(parseInt(c.req.query('limit') ?? '20', 10), 100)

	const result = await runEffectEither(
		Effect.gen(function* () {
			const pm = yield* PolymarketService
			const market = yield* pm.getMarket(id)

			if (market.tokens.length === 0) {
				return { marketId: id, question: market.question, trades: [] }
			}

			const allTrades = yield* Effect.all(
				market.tokens.map((t) =>
					Effect.map(pm.getTrades(t.tokenId, limit), (trades) =>
						trades.map((tr) => ({ ...tr, outcome: t.outcome, tokenId: t.tokenId }))
					)
				),
				{ concurrency: 'unbounded' },
			)

			const merged = allTrades
				.flat()
				.sort((a, b) => (b.timestamp > a.timestamp ? 1 : -1))
				.slice(0, limit)

			return { marketId: id, question: market.question, trades: merged }
		}),
	)

	if (Either.isLeft(result)) {
		const { status, body } = mapErrorToResponse(result.left)
		return c.json(body, status as 200)
	}

	return c.json(result.right)
})

// GET /webapp/me/predict/positions — user positions (placeholder)
protectedWebapp.get('/predict/positions', async (c) => {
	// Positions require on-chain state from Polymarket — placeholder until Workstream A
	return c.json({ positions: [] })
})

// POST /webapp/me/predict/order — place order (501 placeholder)
protectedWebapp.post('/predict/order', async (c) => {
	return c.json(
		{ error: 'Order placement not yet implemented. Coming in Workstream A.' },
		501,
	)
})

// === Token Discovery Routes (public) ===

// GET /webapp/tokens/trending - Get trending tokens
webappRoutes.get('/tokens/trending', async (c) => {
	const chain = c.req.query('chain')

	try {
		const url = 'https://api.dexscreener.com/token-boosts/latest/v1'
		const response = await fetch(url)
		if (!response.ok) {
			return c.json({ tokens: [] })
		}
		const data = (await response.json()) as Array<{
			tokenAddress: string
			chainId: string
			icon?: string
		}>

		let tokens = Array.isArray(data) ? data : []
		if (chain) {
			tokens = tokens.filter((t) => t.chainId === chain)
		}

		// Enrich top 20 with price data
		const topTokens = tokens.slice(0, 20)
		const enriched = await Promise.all(
			topTokens.map(async (token) => {
				try {
					const pairRes = await fetch(
						`https://api.dexscreener.com/latest/dex/tokens/${token.tokenAddress}`,
					)
					if (!pairRes.ok) return null
					const pairData = (await pairRes.json()) as {
						pairs?: Array<{
							baseToken?: { name?: string; symbol?: string }
							priceUsd?: string
							priceChange?: { h24?: number }
							volume?: { h24?: number }
						}>
					}
					const pair = pairData.pairs?.[0]
					if (!pair) return null

					return {
						tokenAddress: token.tokenAddress,
						chainId: token.chainId,
						name: pair.baseToken?.name || 'Unknown',
						symbol: pair.baseToken?.symbol || '???',
						priceUsd: pair.priceUsd ? parseFloat(pair.priceUsd) : 0,
						priceChange24h: pair.priceChange?.h24 || 0,
						volume24h: pair.volume?.h24 || 0,
						logoUrl: token.icon || undefined,
					}
				} catch {
					return null
				}
			}),
		)

		return c.json({ tokens: enriched.filter(Boolean) })
	} catch (error) {
		logger.error({ err: error }, 'Trending tokens error')
		return c.json({ tokens: [] })
	}
})

// GET /webapp/tokens/:chain/:address/info - Get token info
webappRoutes.get('/tokens/:chain/:address/info', async (c) => {
	const { address } = c.req.param()

	try {
		const response = await fetch(`https://api.dexscreener.com/latest/dex/tokens/${address}`)
		if (!response.ok) {
			return c.json({ pairs: [] })
		}
		return c.json(await response.json())
	} catch (error) {
		logger.error({ err: error }, 'Token info error')
		return c.json({ pairs: [] })
	}
})

// GET /webapp/tokens/:chain/:address/chart - Get chart data
webappRoutes.get('/tokens/:chain/:address/chart', async (c) => {
	const { address } = c.req.param()

	try {
		const response = await fetch(`https://api.dexscreener.com/latest/dex/tokens/${address}`)
		if (!response.ok) {
			return c.json({ candles: [], pair: null })
		}
		const data = (await response.json()) as {
			pairs?: Array<{
				priceUsd?: string
				priceChange?: { h24?: number; h6?: number; h1?: number; m5?: number }
			}>
		}
		const pair = data.pairs?.[0]

		// Generate synthetic candles from available price change data
		const candles: Array<{ time: number; open: number; high: number; low: number; close: number }> =
			[]
		if (pair?.priceUsd) {
			const currentPrice = parseFloat(pair.priceUsd)
			const now = Math.floor(Date.now() / 1000)
			const changes = [
				pair.priceChange?.h24 || 0,
				pair.priceChange?.h6 || 0,
				pair.priceChange?.h1 || 0,
				pair.priceChange?.m5 || 0,
			]
			const intervals = [86400, 21600, 3600, 300]

			let price = currentPrice
			for (let i = 0; i < changes.length; i++) {
				const change = changes[i] || 0
				const prevPrice = price / (1 + change / 100)
				const high = Math.max(price, prevPrice) * (1 + Math.abs(change) / 200)
				const low = Math.min(price, prevPrice) * (1 - Math.abs(change) / 200)
				candles.unshift({
					time: now - intervals[i],
					open: prevPrice,
					high,
					low,
					close: price,
				})
				price = prevPrice
			}
		}

		return c.json({ candles, pair })
	} catch (error) {
		logger.error({ err: error }, 'Token chart error')
		return c.json({ candles: [], pair: null })
	}
})

// Mount protected routes at both /me and /users/me for backward compatibility
webappRoutes.route('/me', protectedWebapp)
webappRoutes.route('/users/me', protectedWebapp)

export { webappRoutes }
