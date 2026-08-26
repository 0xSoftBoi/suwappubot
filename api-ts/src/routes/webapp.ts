import crypto from 'node:crypto'
import { and, eq, gte, sql as drizzleSql } from 'drizzle-orm'
import { Effect, Either, Option } from 'effect'
import { Hono } from 'hono'
import jwt from 'jsonwebtoken'
import { EnvService } from '../config/EnvService'
import { requireDb } from '../db'
import { passkeyCredentials, pointRedemptions, rewards, swapTransactions, users, wallets } from '../db/schema'
import { walletTrackAlerts } from '../db/schema/walletTrackAlerts'
import { logger } from '../lib/logger'
import { mapErrorToResponse } from '../errors'
import { requireTier, telegramAuth } from '../middleware'
import { runEffect, runEffectEither } from '../runtime'
import { getVipStatusRaw } from '../services/VipService'
import {
	BalanceService,
	PointsService,
	SeasonsService,
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
				walletAddress = existingWallets[0]?.address ?? null
			}

			// 4. Generate JWT
			const jwtSecret = env.JWT_SECRET
			if (!jwtSecret) {
				return yield* Effect.fail(new Error('JWT_SECRET not configured'))
			}
			// `src: 'telegram'` marks this token as backed by a verified Telegram
			// initData signature (proof of possession of the Telegram session).
			// This is the claim that distinguishes it from the JWT minted by
			// POST /public/swap/auth (src/routes/publicSwap.ts), which trusts a
			// bare `{subOrgId, walletAddress}` body with NO proof of possession —
			// any known wallet address mints a valid 7-day token for that
			// wallet's victim there. Endpoints that authorize spend-affecting
			// actions (agent approvals) must require this claim; see
			// requireProofOfPossession() in middleware/flexAuth.ts.
			const token = jwt.sign(
				{
					userId: user.id,
					telegramId: telegramUser.id,
					walletAddress,
					src: 'telegram',
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

// Protected webapp routes
const protectedWebapp = new Hono()
protectedWebapp.use('*', telegramAuth())

// POST /webapp/turnkey/oauth-wallet - Create wallet via OAuth provider
// SECURITY: Mounted on the protected router. The wallet owner is the
// authenticated Telegram user — any body-supplied telegramUserId is ignored
// so a caller cannot attach a wallet to a victim's account.
protectedWebapp.post('/turnkey/oauth-wallet', async (c) => {
	const telegramUser = c.get('telegramUser') as TelegramUser
	const body = await c.req.json().catch(() => ({}))
	const { provider, oauthToken } = body

	if (!provider || !oauthToken) {
		return c.json({ error: 'Missing required fields: provider, oauthToken' }, 400)
	}

	const result = await runEffectEither(
		Effect.gen(function* () {
			const turnkeyService = yield* TurnkeyService
			const userService = yield* UserService
			const walletService = yield* WalletService

			// Create sub-org with OAuth authenticator + wallet, keyed to the
			// authenticated Telegram user (never a caller-supplied id).
			const turnkeyWallet = yield* turnkeyService.createSubOrgWithOAuth(
				provider,
				oauthToken,
				String(telegramUser.id)
			)

			// Resolve the authenticated user and save wallet
			const userOption = yield* userService.getUserByTelegramId(telegramUser.id)

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

// GET /webapp/me/portfolio/pnl - PnL analytics for the authenticated user
protectedWebapp.get('/portfolio/pnl', async (c) => {
	const telegramUser = c.get('telegramUser') as TelegramUser

	// Parse query params
	const periodParam = (c.req.query('period') ?? '30d') as '7d' | '30d' | '90d' | 'all'
	const chainParam = c.req.query('chain') ?? 'all'

	const periodDays: Record<string, number | null> = { '7d': 7, '30d': 30, '90d': 90, all: null }
	const cutoffDays = periodDays[periodParam] ?? 30

	const result = await runEffectEither(
		Effect.gen(function* () {
			const userService = yield* UserService
			const userOption = yield* userService.getUserByTelegramId(telegramUser.id)
			if (Option.isNone(userOption)) {
				return yield* Effect.fail(new Error('User not found'))
			}
			const userId = userOption.value.id
			const db = yield* requireDb

			const cutoffDate = cutoffDays !== null ? new Date(Date.now() - cutoffDays * 86400_000) : null

			// Build where conditions
			const conditions = [
				eq(swapTransactions.userId, userId),
				eq(swapTransactions.status, 'completed'),
			]
			if (cutoffDate) conditions.push(gte(swapTransactions.createdAt, cutoffDate))
			if (chainParam !== 'all') conditions.push(eq(swapTransactions.fromChain, chainParam))

			const rows = yield* Effect.tryPromise({
				try: () =>
					db
						.select()
						.from(swapTransactions)
						.where(and(...conditions))
						.orderBy(swapTransactions.createdAt),
				catch: (e) => new Error(`pnl query failed: ${e}`),
			})

			// Fee-credit redemptions saved (gas_rebate + fee_discount)
			const feeRedemptions = yield* Effect.tryPromise({
				try: () =>
					db
						.select({
							rewardValue: rewards.rewardValue,
							rewardType: rewards.rewardType,
							count: drizzleSql<number>`count(*)`,
						})
						.from(pointRedemptions)
						.leftJoin(rewards, eq(pointRedemptions.rewardId, rewards.id))
						.where(
							and(
								eq(pointRedemptions.userId, userId),
								eq(pointRedemptions.status, 'completed'),
								cutoffDate ? gte(pointRedemptions.createdAt, cutoffDate) : drizzleSql`1=1`,
							),
						)
						.groupBy(rewards.rewardValue, rewards.rewardType),
				catch: (e) => new Error(`redemptions query failed: ${e}`),
			})

			// Compute KPIs
			let totalRealizedPnlUsd = 0
			let winCount = 0
			let lossCount = 0
			let totalGasPaidUsd = 0
			let totalFeesPaidUsd = 0
			let bestTrade: { fromToken: string; toToken: string; pnlUsd: number; date: string } | null =
				null
			let worstTrade: { fromToken: string; toToken: string; pnlUsd: number; date: string } | null =
				null

			// Daily buckets for equity curve and heatmap
			const dailyPnl: Record<string, number> = {}
			const chainPnl: Record<string, { pnlUsd: number; tradeCount: number }> = {}

			for (const row of rows) {
				const toUsd = row.toAmountUsd ?? 0
				const fromUsd = row.fromAmountUsd ?? 0
				const gas = row.gasCostUsd !== null ? parseFloat(row.gasCostUsd) : (row.gasFee ?? 0)
				const fee = row.feeCostUsd !== null ? parseFloat(row.feeCostUsd) : (row.bridgeFee ?? 0)
				const pnl = toUsd - fromUsd - gas - fee

				totalRealizedPnlUsd += pnl
				totalGasPaidUsd += gas
				totalFeesPaidUsd += fee

				if (pnl >= 0) winCount++
				else lossCount++

				if (bestTrade === null || pnl > bestTrade.pnlUsd) {
					bestTrade = {
						fromToken: row.fromToken,
						toToken: row.toToken,
						pnlUsd: pnl,
						date: (row.completedAt ?? row.createdAt ?? new Date()).toISOString().slice(0, 10),
					}
				}
				if (worstTrade === null || pnl < worstTrade.pnlUsd) {
					worstTrade = {
						fromToken: row.fromToken,
						toToken: row.toToken,
						pnlUsd: pnl,
						date: (row.completedAt ?? row.createdAt ?? new Date()).toISOString().slice(0, 10),
					}
				}

				const dayKey = (row.completedAt ?? row.createdAt ?? new Date())
					.toISOString()
					.slice(0, 10)
				dailyPnl[dayKey] = (dailyPnl[dayKey] ?? 0) + pnl

				const chain = row.fromChain
				if (!chainPnl[chain]) chainPnl[chain] = { pnlUsd: 0, tradeCount: 0 }
				chainPnl[chain].pnlUsd += pnl
				chainPnl[chain].tradeCount += 1
			}

			const totalTrades = rows.length
			const avgTradeUsd =
				totalTrades > 0
					? rows.reduce((s, r) => s + (r.fromAmountUsd ?? 0), 0) / totalTrades
					: 0

			// Build equity curve (sorted daily cumulative)
			const sortedDays = Object.keys(dailyPnl).sort()
			let running = 0
			const equityCurve = sortedDays.map((date) => {
				running += dailyPnl[date]
				return { date, cumulativePnlUsd: running }
			})
			const pnlCalendar = sortedDays.map((date) => ({ date, pnlUsd: dailyPnl[date] }))

			// totalPointsSavedUsd: sum gas_rebate rewardValues × count + fee_discount is usage-based
			// We conservatively sum gas rebate redemptions (each rewardValue is in USD)
			let totalPointsSavedUsd = 0
			for (const r of feeRedemptions) {
				if (r.rewardType === 'gas_rebate' && r.rewardValue) {
					totalPointsSavedUsd += parseFloat(r.rewardValue) * Number(r.count)
				}
			}

			return {
				totalRealizedPnlUsd,
				totalUnrealizedPnlUsd: 0, // best-effort: requires live prices per position, future work
				winRate: totalTrades > 0 ? winCount / totalTrades : 0,
				totalTrades,
				winCount,
				lossCount,
				avgTradeUsd,
				totalGasPaidUsd,
				totalFeesPaidUsd,
				totalPointsSavedUsd,
				bestTrade,
				worstTrade,
				equityCurve,
				pnlCalendar,
				chainBreakdown: Object.entries(chainPnl).map(([chain, v]) => ({
					chain,
					pnlUsd: v.pnlUsd,
					tradeCount: v.tradeCount,
				})),
			}
		}),
	)

	if (Either.isLeft(result)) {
		return c.json({ error: result.left.message }, 500)
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
		return c.json(body, status)
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

			// Determine language: stored preference → Accept-Language header → 'en'
			const acceptLang = c.req.header('Accept-Language')
			const headerLang = acceptLang ? acceptLang.split(',')[0]?.split('-')[0]?.trim() : undefined
			const SUPPORTED_LANGS = ['en', 'es', 'fr', 'zh'] as const
			type SupportedLang = (typeof SUPPORTED_LANGS)[number]
			const resolvedLang: SupportedLang =
				(SUPPORTED_LANGS as readonly string[]).includes(user.languagePreference ?? '')
					? (user.languagePreference as SupportedLang)
					: (SUPPORTED_LANGS as readonly string[]).includes(headerLang ?? '')
						? (headerLang as SupportedLang)
						: 'en'

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
					languagePreference: resolvedLang,
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

// PATCH /webapp/me/language - Update language preference
const SUPPORTED_LANGUAGES = ['en', 'es', 'fr', 'zh'] as const
type SupportedLanguage = (typeof SUPPORTED_LANGUAGES)[number]

protectedWebapp.patch('/language', async (c) => {
	const telegramUser = c.get('telegramUser') as TelegramUser
	const body = await c.req.json().catch(() => ({})) as { language?: unknown }

	if (!body.language || !(SUPPORTED_LANGUAGES as readonly unknown[]).includes(body.language)) {
		return c.json(
			{ error: `Invalid language. Supported values: ${SUPPORTED_LANGUAGES.join(', ')}` },
			400,
		)
	}

	const language = body.language as SupportedLanguage

	const result = await runEffectEither(
		Effect.gen(function* () {
			const userService = yield* UserService

			const userOption = yield* userService.getUserByTelegramId(telegramUser.id)
			if (Option.isNone(userOption)) {
				return yield* Effect.fail(new Error('User not found'))
			}

			yield* userService.updateUserPreferences(userOption.value.id, {
				languagePreference: language,
			})

			return { success: true, language }
		}),
	)

	if (Either.isLeft(result)) {
		return c.json({ error: result.left.message || 'Failed to update language' }, 500)
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
		}),
	)

	if (Either.isLeft(result)) {
		return c.json({ error: result.left.message }, 500)
	}
	return c.json(result.right)
})

// GET /webapp/me/vip - Cross-line VIP status (effective tier, season volume,
// loyalty multiplier, progress to next band).
protectedWebapp.get('/vip', async (c) => {
	const telegramUser = c.get('telegramUser') as TelegramUser

	const result = await runEffectEither(
		Effect.gen(function* () {
			const userService = yield* UserService
			const userOption = yield* userService.getUserByTelegramId(telegramUser.id)
			if (Option.isNone(userOption)) {
				return yield* Effect.fail(new Error('User not found'))
			}
			const db = yield* requireDb
			return yield* Effect.tryPromise({
				try: () => getVipStatusRaw(db, userOption.value.id),
				catch: (e) => new Error(`vip status failed: ${e}`),
			})
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

// === Season (Convertible Points) Routes ===

// GET /webapp/users/me/points/season - Current season standing + estimated allocation
protectedWebapp.get('/points/season', async (c) => {
	const telegramUser = c.get('telegramUser') as TelegramUser

	const result = await runEffectEither(
		Effect.gen(function* () {
			const userService = yield* UserService
			const seasonsService = yield* SeasonsService

			const userOption = yield* userService.getUserByTelegramId(telegramUser.id)
			if (Option.isNone(userOption)) {
				return yield* Effect.fail(new Error('User not found'))
			}

			return yield* seasonsService.getUserSeasonStanding(userOption.value.id)
		}),
	)

	if (Either.isLeft(result)) {
		return c.json({ error: result.left.message }, 500)
	}
	return c.json(result.right)
})

// GET /webapp/users/me/points/season/leaderboard - Top season-point earners
protectedWebapp.get('/points/season/leaderboard', async (c) => {
	const limit = Math.min(Number(c.req.query('limit') || 20), 100)

	const result = await runEffectEither(
		Effect.gen(function* () {
			const seasonsService = yield* SeasonsService

			const season = yield* seasonsService.getActiveSeason()
			if (!season) {
				return []
			}
			return yield* seasonsService.getSeasonLeaderboard(season.id, limit)
		}),
	)

	if (Either.isLeft(result)) {
		return c.json({ error: result.left.message }, 500)
	}
	return c.json(result.right)
})

// GET /webapp/users/me/seasons - Season history + my snapshots
protectedWebapp.get('/seasons', async (c) => {
	const telegramUser = c.get('telegramUser') as TelegramUser

	const result = await runEffectEither(
		Effect.gen(function* () {
			const userService = yield* UserService
			const seasonsService = yield* SeasonsService

			const userOption = yield* userService.getUserByTelegramId(telegramUser.id)
			if (Option.isNone(userOption)) {
				return yield* Effect.fail(new Error('User not found'))
			}

			return yield* seasonsService.getUserSeasons(userOption.value.id)
		}),
	)

	if (Either.isLeft(result)) {
		return c.json({ error: result.left.message }, 500)
	}
	return c.json(result.right)
})

// POST /webapp/users/me/seasons/:seasonId/claim - Intentional STUB (pre-TGE).
// Claim is NOT live before the public token launch. Returns 425 Too Early.
// Do NOT touch chain.
protectedWebapp.post('/seasons/:seasonId/claim', (c) => {
	return c.json(
		{
			error: 'claim_not_open',
			message: 'Token claims open after the public token launch.',
		},
		425,
	)
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

// POST /webapp/me/limit-orders - Create a limit order (PRO+)
protectedWebapp.post('/limit-orders', requireTier('pro'), async (c) => {
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
		return c.json(body, status)
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

// POST /webapp/me/copy/follow/:traderId - Follow a trader (PRO+, decision D1a: copy_trading = Pro)
protectedWebapp.post('/copy/follow/:traderId', requireTier('pro'), async (c) => {
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
		return c.json(errBody, status)
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
		return c.json(errBody, status)
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
		return c.json(errBody, status)
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
		return c.json(body, status)
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
		return c.json(body, status)
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
		return c.json(body, status)
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
		return c.json(body, status)
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
		return c.json(body, status)
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
		return c.json(body, status)
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
					time: now - (intervals[i] ?? 0),
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

// ---------------------------------------------------------------------------
// Wallet-track alerts — smart money / KOL wallet monitoring
//
// CRUD only. The actual on-chain monitoring is handled by an external service
// (e.g. a Helius/DexScreener WebSocket poller). When that service detects a
// qualifying trade it should call POST /internal/wallet-track/trigger with the
// walletTrackAlertId so the notification fan-out can run.
// ---------------------------------------------------------------------------

// POST /webapp/alerts/wallet-track  — subscribe to a wallet
protectedWebapp.post('/alerts/wallet-track', async (c) => {
	const telegramUser = c.get('telegramUser') as TelegramUser

	const body = await c.req.json().catch(() => ({})) as {
		wallet_address?: string
		label?: string
		min_usd?: number
		chains?: string[]
	}

	if (!body.wallet_address) {
		return c.json({ error: 'wallet_address is required' }, 400)
	}

	const result = await runEffectEither(
		Effect.gen(function* () {
			const userService = yield* UserService
			const db = yield* requireDb

			const userOption = yield* userService.getUserByTelegramId(telegramUser.id)
			if (Option.isNone(userOption)) return yield* Effect.fail(new Error('User not found'))

			const userId = userOption.value.id
			const [row] = yield* Effect.tryPromise(() =>
				db
					.insert(walletTrackAlerts)
					.values({
						userId,
						walletAddress: body.wallet_address!,
						label: body.label ?? null,
						minUsd: body.min_usd ?? 10000,
						chains: body.chains ? JSON.stringify(body.chains) : null,
					})
					.returning(),
			)
			return row
		}),
	)

	if (Either.isLeft(result)) {
		logger.error({ err: result.left }, 'Failed to create wallet-track alert')
		return c.json({ error: 'Failed to create alert' }, 500)
	}

	const row = result.right
	return c.json({
		id: row?.id,
		wallet_address: row?.walletAddress,
		label: row?.label,
		min_usd: row?.minUsd,
		chains: row?.chains ? (JSON.parse(row.chains) as string[]) : null,
		created_at: row?.createdAt,
	}, 201)
})

// GET /webapp/alerts/wallet-track  — list all tracked wallets for the user
protectedWebapp.get('/alerts/wallet-track', async (c) => {
	const telegramUser = c.get('telegramUser') as TelegramUser

	const result = await runEffectEither(
		Effect.gen(function* () {
			const userService = yield* UserService
			const db = yield* requireDb

			const userOption = yield* userService.getUserByTelegramId(telegramUser.id)
			if (Option.isNone(userOption)) return []

			const userId = userOption.value.id
			return yield* Effect.tryPromise(() =>
				db
					.select()
					.from(walletTrackAlerts)
					.where(and(eq(walletTrackAlerts.userId, userId), eq(walletTrackAlerts.isActive, true))),
			)
		}),
	)

	if (Either.isLeft(result)) {
		logger.error({ err: result.left }, 'Failed to list wallet-track alerts')
		return c.json({ error: 'Failed to fetch alerts' }, 500)
	}

	const rows = result.right.map((row) => ({
		id: row.id,
		wallet_address: row.walletAddress,
		label: row.label,
		min_usd: row.minUsd,
		chains: row.chains ? (JSON.parse(row.chains) as string[]) : null,
		created_at: row.createdAt,
	}))

	return c.json({ alerts: rows })
})

// DELETE /webapp/alerts/wallet-track/:id  — remove a tracked wallet
protectedWebapp.delete('/alerts/wallet-track/:id', async (c) => {
	const telegramUser = c.get('telegramUser') as TelegramUser

	const id = Number(c.req.param('id'))
	if (!Number.isFinite(id)) return c.json({ error: 'Invalid id' }, 400)

	const result = await runEffectEither(
		Effect.gen(function* () {
			const userService = yield* UserService
			const db = yield* requireDb

			const userOption = yield* userService.getUserByTelegramId(telegramUser.id)
			if (Option.isNone(userOption)) return null

			const userId = userOption.value.id
			const [deleted] = yield* Effect.tryPromise(() =>
				db
					.delete(walletTrackAlerts)
					.where(and(eq(walletTrackAlerts.id, id), eq(walletTrackAlerts.userId, userId)))
					.returning({ id: walletTrackAlerts.id }),
			)
			return deleted ?? null
		}),
	)

	if (Either.isLeft(result)) {
		logger.error({ err: result.left }, 'Failed to delete wallet-track alert')
		return c.json({ error: 'Failed to delete alert' }, 500)
	}

	if (!result.right) {
		return c.json({ error: 'Not found' }, 404)
	}

	return c.json({ success: true, id: result.right.id })
})

// === Recovery / Passkey Routes ===
//
// Dead-button recovery feature: webapp/src/pages/Recovery.tsx and
// webapp/src/lib/turnkey-passkey.ts call these. Passkey registration accepts
// EITHER a normal Telegram session OR a short-lived recovery JWT (minted by
// /recovery/initiate) so a locked-out user can re-enroll a passkey.

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

// In-memory challenge stores. SECURITY/OPS NOTE: single-instance only — if
// api-ts ever runs multiple replicas, a register/init and register/complete
// pair can land on different instances and fail. Move to Redis before that.
const passkeyRegChallenges = new Map<number, { challenge: string; expiresAt: number }>()
const passkeyAuthChallenges = new Map<string, { expiresAt: number }>()

const CHALLENGE_TTL_MS = 5 * 60 * 1000

// Recovery tokens are single-use: without this, one 15min token could be
// replayed repeatedly, each pass minting a fresh Turnkey sub-org + wallet
// (real cost, wallet-list pollution) and a fresh 7-day session. Consumed on
// successful /passkey/register/complete, not on /register/init — the same
// token is presented to both steps of one registration attempt.
const usedRecoveryJtis = new Map<string, number>() // jti -> expiresAt, for periodic pruning
const RECOVERY_TOKEN_TTL_MS = 15 * 60 * 1000

function pruneUsedRecoveryJtis() {
	const now = Date.now()
	for (const [jti, expiresAt] of usedRecoveryJtis) {
		if (expiresAt <= now) usedRecoveryJtis.delete(jti)
	}
}

// Resolve the acting user via EITHER a live Telegram session (X-Telegram-Init-Data)
// OR a short-lived recovery JWT (Authorization: Bearer <token>, purpose:'recovery').
const resolveDualAuthUser = (c: any) =>
	Effect.gen(function* () {
		const initData = c.req.header('X-Telegram-Init-Data')

		if (initData) {
			const authService = yield* TelegramAuthService
			const userService = yield* UserService

			const telegramUserOption = yield* authService.validateInitData(initData)
			if (Option.isNone(telegramUserOption)) {
				return yield* Effect.fail(new Error('Invalid Telegram authentication'))
			}
			const telegramUser = telegramUserOption.value

			const userOption = yield* userService.getUserByTelegramId(telegramUser.id)
			if (Option.isNone(userOption)) {
				return yield* Effect.fail(new Error('User not found'))
			}

			return {
				userId: userOption.value.id,
				telegramId: telegramUser.id as number | null,
				userName: telegramUser.username ?? `user-${telegramUser.id}`,
				recoveryJti: null as string | null,
			}
		}

		const authHeader = c.req.header('Authorization')
		if (authHeader?.startsWith('Bearer ')) {
			const env = yield* EnvService
			const jwtSecret = env.JWT_SECRET
			if (!jwtSecret) {
				return yield* Effect.fail(new Error('JWT_SECRET not configured'))
			}
			const token = authHeader.slice('Bearer '.length)

			const decoded = yield* Effect.try({
				try: () =>
					jwt.verify(token, jwtSecret) as { purpose?: string; userId?: number; jti?: string },
				catch: () => new Error('Invalid or expired recovery token'),
			})

			if (decoded.purpose !== 'recovery' || !decoded.userId || !decoded.jti) {
				return yield* Effect.fail(new Error('Invalid recovery token'))
			}

			if (usedRecoveryJtis.has(decoded.jti)) {
				return yield* Effect.fail(new Error('Recovery token already used'))
			}

			return {
				userId: decoded.userId,
				telegramId: null as number | null,
				userName: `user-${decoded.userId}`,
				recoveryJti: decoded.jti as string | null,
			}
		}

		return yield* Effect.fail(new Error('Missing authentication'))
	})

// GET /webapp/recovery/status
webappRoutes.get('/recovery/status', telegramAuth(), async (c) => {
	const telegramUser = c.get('telegramUser') as TelegramUser

	const result = await runEffectEither(
		Effect.gen(function* () {
			const userService = yield* UserService
			const walletService = yield* WalletService

			const userOption = yield* userService.getUserByTelegramId(telegramUser.id)
			if (Option.isNone(userOption)) {
				return yield* Effect.fail(new Error('User not found'))
			}
			const user = userOption.value

			const activeWallets = yield* walletService.getActiveWallets(user.id)
			const hasTurnkeyWallet = activeWallets.some((w) => w.walletProvider === 'turnkey')

			return {
				has_recovery: !!user.recoveryEmail,
				recovery_email: user.recoveryEmail ?? null,
				setup_at: user.recoveryEmailSetAt?.toISOString() ?? null,
				has_turnkey_wallet: hasTurnkeyWallet,
			}
		}),
	)

	if (Either.isLeft(result)) {
		return c.json({ error: result.left.message }, 500)
	}
	return c.json(result.right)
})

// POST /webapp/recovery/setup
webappRoutes.post('/recovery/setup', telegramAuth(), async (c) => {
	const telegramUser = c.get('telegramUser') as TelegramUser
	const body = (await c.req.json().catch(() => ({}))) as { email?: string }

	if (!body.email || !EMAIL_RE.test(body.email)) {
		return c.json({ error: 'A valid email is required' }, 400)
	}

	const result = await runEffectEither(
		Effect.gen(function* () {
			const userService = yield* UserService
			const db = yield* requireDb

			const userOption = yield* userService.getUserByTelegramId(telegramUser.id)
			if (Option.isNone(userOption)) {
				return yield* Effect.fail(new Error('User not found'))
			}

			yield* Effect.tryPromise({
				try: () =>
					db
						.update(users)
						.set({ recoveryEmail: body.email, recoveryEmailSetAt: new Date() })
						.where(eq(users.id, userOption.value.id)),
				catch: (e) => new Error(`Failed to save recovery email: ${e}`),
			})

			return { success: true }
		}),
	)

	if (Either.isLeft(result)) {
		return c.json({ error: result.left.message }, 500)
	}
	return c.json(result.right)
})

// POST /webapp/recovery/initiate - UNAUTHENTICATED. Never reveals whether the
// email matched an account (no user enumeration).
webappRoutes.post('/recovery/initiate', async (c) => {
	const body = (await c.req.json().catch(() => ({}))) as { email?: string }
	const genericResponse = {
		success: true,
		message: 'If that email is on file, check your inbox for a recovery link.',
	}

	if (!body.email || !EMAIL_RE.test(body.email)) {
		return c.json(genericResponse)
	}

	await runEffectEither(
		Effect.gen(function* () {
			const env = yield* EnvService
			const db = yield* requireDb

			const rows = yield* Effect.tryPromise({
				try: () => db.select().from(users).where(eq(users.recoveryEmail, body.email!)).limit(1),
				catch: (e) => new Error(`Recovery lookup failed: ${e}`),
			})
			const user = rows[0]
			if (!user) return

			const jwtSecret = env.JWT_SECRET
			if (!jwtSecret) return

			const jti = crypto.randomUUID()
			const recoveryToken = jwt.sign(
				{ purpose: 'recovery', userId: user.id, jti },
				jwtSecret,
				{ expiresIn: '15m' },
			)

			// TODO(email): send recoveryToken via email once an email service exists.
			// Never log the token itself — it is a bearer credential (15min TTL,
			// scoped by `purpose:'recovery'`) and this log line is the only place
			// it currently surfaces, so anyone with log/Sentry read access could
			// replay it. Log only the fact that one was minted.
			logger.info(
				{ userId: user.id },
				'Recovery token generated (email delivery not yet wired)',
			)
		}),
	)

	return c.json(genericResponse)
})

// POST /webapp/passkey/register/init - dual auth (telegram session OR recovery JWT)
webappRoutes.post('/passkey/register/init', async (c) => {
	const body = (await c.req.json().catch(() => ({}))) as { displayName?: string }

	const result = await runEffectEither(
		Effect.gen(function* () {
			const env = yield* EnvService
			const identity = yield* resolveDualAuthUser(c)

			const challenge = crypto.randomBytes(32).toString('base64url')
			passkeyRegChallenges.set(identity.userId, {
				challenge,
				expiresAt: Date.now() + CHALLENGE_TTL_MS,
			})

			return {
				challenge,
				userId: String(identity.userId),
				userName: body.displayName || identity.userName,
				rpId: env.WEBAPP_RP_ID,
				rpName: env.WEBAPP_RP_NAME,
				attestation: 'none' as const,
			}
		}),
	)

	if (Either.isLeft(result)) {
		return c.json({ error: result.left.message }, 401)
	}
	return c.json(result.right)
})

// POST /webapp/passkey/register/complete - dual auth
webappRoutes.post('/passkey/register/complete', async (c) => {
	const body = (await c.req.json().catch(() => ({}))) as {
		credentialId?: string
		attestationObject?: string
		clientDataJSON?: string
		transports?: string[]
	}

	if (!body.credentialId || !body.attestationObject || !body.clientDataJSON) {
		return c.json({ error: 'Missing required fields' }, 400)
	}

	const result = await runEffectEither(
		Effect.gen(function* () {
			const env = yield* EnvService
			const identity = yield* resolveDualAuthUser(c)
			const turnkeyService = yield* TurnkeyService
			const walletService = yield* WalletService
			const db = yield* requireDb

			const stored = passkeyRegChallenges.get(identity.userId)
			if (!stored || stored.expiresAt < Date.now()) {
				return yield* Effect.fail(new Error('Registration challenge expired or missing — call register/init again'))
			}
			passkeyRegChallenges.delete(identity.userId)

			const turnkeyWallet = yield* turnkeyService.createSubOrgWithPasskey(
				identity.userName,
				identity.telegramId ?? identity.userId,
				{
					credentialId: body.credentialId!,
					attestationObject: body.attestationObject!,
					clientDataJson: body.clientDataJSON!,
					transports: body.transports ?? [],
				},
				stored.challenge,
			)

			const wallet = yield* walletService.createTurnkeyWallet({
				userId: identity.userId,
				address: turnkeyWallet.address,
				turnkeySubOrgId: turnkeyWallet.subOrgId,
				turnkeyWalletId: turnkeyWallet.walletId,
				turnkeyAccountId: turnkeyWallet.accountId,
				chainType: 'evm',
			})

			yield* Effect.tryPromise({
				try: () =>
					db.insert(passkeyCredentials).values({
						credentialId: body.credentialId!,
						userId: identity.userId,
						subOrgId: turnkeyWallet.subOrgId,
					}),
				catch: (e) => new Error(`Failed to save passkey credential: ${e}`),
			})

			if (identity.recoveryJti) {
				usedRecoveryJtis.set(identity.recoveryJti, Date.now() + RECOVERY_TOKEN_TTL_MS)
				pruneUsedRecoveryJtis()
			}

			const jwtSecret = env.JWT_SECRET
			if (!jwtSecret) {
				return yield* Effect.fail(new Error('JWT_SECRET not configured'))
			}
			const token = jwt.sign(
				{
					userId: identity.userId,
					telegramId: identity.telegramId ?? 0,
					walletAddress: wallet.address,
				},
				jwtSecret,
				{ expiresIn: '7d' },
			)

			return {
				userId: identity.userId,
				walletAddress: wallet.address,
				subOrgId: turnkeyWallet.subOrgId,
				jwt: token,
			}
		}),
	)

	if (Either.isLeft(result)) {
		logger.error({ err: result.left }, 'Passkey registration error')
		return c.json({ error: result.left.message || 'Passkey registration failed' }, 400)
	}
	return c.json(result.right)
})

// POST /webapp/passkey/authenticate/init - unauthenticated
webappRoutes.post('/passkey/authenticate/init', async (c) => {
	const payload = await runEffect(
		Effect.gen(function* () {
			const env = yield* EnvService
			const now = Date.now()
			for (const [key, v] of passkeyAuthChallenges) {
				if (v.expiresAt <= now) passkeyAuthChallenges.delete(key)
			}
			const challenge = crypto.randomBytes(32).toString('base64url')
			passkeyAuthChallenges.set(challenge, { expiresAt: now + CHALLENGE_TTL_MS })
			return { challenge, rpId: env.WEBAPP_RP_ID, allowCredentials: [] as string[] }
		}),
	)

	return c.json(payload)
})

// POST /webapp/passkey/authenticate/complete - unauthenticated
// TODO(turnkey-verify): needs Turnkey's actual passkey/oauth login activity call —
// do not hand-roll WebAuthn crypto verification here.
//
// Deliberately does NOT look up `credentialId` against the DB before that
// verification exists: a 404-vs-501 split on an unauthenticated route would
// let anyone enumerate which credential IDs are registered. Every request
// gets the same response until real verification is wired.
webappRoutes.post('/passkey/authenticate/complete', async (c) => {
	const body = (await c.req.json().catch(() => ({}))) as { credentialId?: string }

	if (!body.credentialId) {
		return c.json({ error: 'credentialId is required' }, 400)
	}

	return c.json(
		{
			error: 'passkey_login_not_implemented',
			message: 'Turnkey passkey-login assertion verification is not wired yet.',
		},
		501,
	)
})

// GET /webapp/passkey/wallets - protected
webappRoutes.get('/passkey/wallets', telegramAuth(), async (c) => {
	const telegramUser = c.get('telegramUser') as TelegramUser

	const result = await runEffectEither(
		Effect.gen(function* () {
			const userService = yield* UserService
			const walletService = yield* WalletService

			const userOption = yield* userService.getUserByTelegramId(telegramUser.id)
			if (Option.isNone(userOption)) {
				return yield* Effect.fail(new Error('User not found'))
			}

			const allWallets = yield* walletService.getActiveWallets(userOption.value.id)
			return allWallets
				.filter((w) => w.walletProvider === 'turnkey')
				.map((w) => ({
					id: w.id,
					address: w.address,
					chainType: w.chainType,
					name: w.name,
				}))
		}),
	)

	if (Either.isLeft(result)) {
		return c.json({ error: result.left.message }, 500)
	}
	return c.json(result.right)
})

// POST /webapp/passkey/wallets - protected. Never trusts a client-supplied subOrgId.
webappRoutes.post('/passkey/wallets', telegramAuth(), async (c) => {
	const telegramUser = c.get('telegramUser') as TelegramUser
	const body = (await c.req.json().catch(() => ({}))) as {
		chainType?: 'evm' | 'solana'
		name?: string
	}
	const chainType = body.chainType === 'solana' ? 'solana' : 'evm'

	const result = await runEffectEither(
		Effect.gen(function* () {
			const userService = yield* UserService
			const walletService = yield* WalletService
			const turnkeyService = yield* TurnkeyService
			const db = yield* requireDb

			const userOption = yield* userService.getUserByTelegramId(telegramUser.id)
			if (Option.isNone(userOption)) {
				return yield* Effect.fail(new Error('User not found'))
			}
			const userId = userOption.value.id

			// Resolve subOrgId strictly from the caller's own existing turnkey wallet —
			// never accept a client-supplied subOrgId (would let a caller attach a
			// wallet to another sub-org).
			const existingRows = yield* Effect.tryPromise({
				try: () =>
					db
						.select()
						.from(wallets)
						.where(and(eq(wallets.userId, userId), eq(wallets.walletProvider, 'turnkey')))
						.limit(1),
				catch: (e) => new Error(`Failed to look up existing wallet: ${e}`),
			})
			const existing = existingRows[0]
			if (!existing || !existing.turnkeySubOrgId) {
				return yield* Effect.fail(new Error('No existing Turnkey wallet found for this account'))
			}

			const turnkeyWallet = yield* turnkeyService.createWalletInSubOrg(
				existing.turnkeySubOrgId,
				chainType,
			)

			const wallet = yield* walletService.createTurnkeyWallet({
				userId,
				address: turnkeyWallet.address,
				turnkeySubOrgId: turnkeyWallet.subOrgId,
				turnkeyWalletId: turnkeyWallet.walletId,
				turnkeyAccountId: turnkeyWallet.accountId,
				chainType,
			})

			return { success: true, address: wallet.address, walletId: wallet.id }
		}),
	)

	if (Either.isLeft(result)) {
		return c.json({ error: result.left.message }, 400)
	}
	return c.json(result.right)
})

// === zkPass (zkpass.org) Identity Verification Routes ===
// Native, standalone feature. Stores the server-verified RESULT of a
// client-side zkPass TransGate proof. Informational/profile-level only —
// NOT wired to gate swap, withdrawal, fee, or subscription logic.
import {
	DEFAULT_ZKPASS_ALLOCATOR_ADDRESS,
	getZkPassStatus,
	parseZkPassProofBody,
	saveZkPassVerification,
	verifyZkPassProof,
} from '../services/ZkPassService'

// POST /webapp/me/zkpass/verify - Verify a client-generated TransGate proof
protectedWebapp.post('/zkpass/verify', async (c) => {
	const telegramUser = c.get('telegramUser') as TelegramUser
	const body = await c.req.json().catch(() => null)

	const proof = parseZkPassProofBody(body)
	if (!proof) {
		return c.json(
			{ error: 'Malformed zkPass proof: missing required fields' },
			400,
		)
	}

	const result = await runEffectEither(
		Effect.gen(function* () {
			const env = yield* EnvService
			const userService = yield* UserService

			const userOption = yield* userService.getUserByTelegramId(telegramUser.id)
			if (Option.isNone(userOption)) {
				return yield* Effect.fail(new Error('User not found'))
			}
			const db = yield* requireDb

			const allocatorAddress = env.ZKPASS_ALLOCATOR_ADDRESS || DEFAULT_ZKPASS_ALLOCATOR_ADDRESS

			const outcome = yield* Effect.tryPromise({
				try: () => verifyZkPassProof(proof, allocatorAddress),
				catch: (e) => new Error(`zkPass verification failed: ${e}`),
			})

			yield* Effect.tryPromise({
				try: () => saveZkPassVerification(db, userOption.value.id, proof, outcome.isValid),
				catch: (e) => new Error(`Failed to save zkPass verification: ${e}`),
			})

			return { isValid: outcome.isValid, taskId: proof.taskId }
		}),
	)

	if (Either.isLeft(result)) {
		return c.json({ error: result.left.message }, 500)
	}
	return c.json(result.right)
})

// GET /webapp/me/zkpass/status - Current user's zkPass verification status
protectedWebapp.get('/zkpass/status', async (c) => {
	const telegramUser = c.get('telegramUser') as TelegramUser

	const result = await runEffectEither(
		Effect.gen(function* () {
			const userService = yield* UserService
			const userOption = yield* userService.getUserByTelegramId(telegramUser.id)
			if (Option.isNone(userOption)) {
				return yield* Effect.fail(new Error('User not found'))
			}
			const db = yield* requireDb

			const row = yield* Effect.tryPromise({
				try: () => getZkPassStatus(db, userOption.value.id),
				catch: (e) => new Error(`zkPass status lookup failed: ${e}`),
			})

			return {
				verified: row?.isValid ?? false,
				verifiedAt: row?.verifiedAt?.toISOString() ?? null,
				schemaId: row?.schemaId ?? null,
			}
		}),
	)

	if (Either.isLeft(result)) {
		return c.json({ error: result.left.message }, 500)
	}
	return c.json(result.right)
})

// GET /webapp/me/zkpass/config - App/schema IDs for the frontend TransGate SDK
protectedWebapp.get('/zkpass/config', async (c) => {
	const result = await runEffect(
		Effect.gen(function* () {
			const env = yield* EnvService
			return {
				appId: env.ZKPASS_APP_ID ?? null,
				schemaId: env.ZKPASS_SCHEMA_ID ?? null,
			}
		}),
	)

	return c.json(result)
})

// Mount protected routes at both /me and /users/me for backward compatibility
webappRoutes.route('/me', protectedWebapp)
webappRoutes.route('/users/me', protectedWebapp)

export { webappRoutes }
