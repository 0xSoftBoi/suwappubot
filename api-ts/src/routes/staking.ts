import { and, desc, eq, sql } from 'drizzle-orm'
import { Effect, Either, Option } from 'effect'
import { Hono } from 'hono'
import { distributionEpochs, epochRewards, requireDb, stakingPositions, tokenClaims } from '../db'
import { mapErrorToResponse } from '../errors'
import { telegramAuth } from '../middleware'
import { runEffectEither } from '../runtime'
import { UserService } from '../services'

export const stakingRoutes = new Hono()

// GET /staking/overview — dashboard data for webapp
stakingRoutes.get('/overview', telegramAuth(), async (c) => {
	const telegramUser = c.get('telegramUser')
	const result = await runEffectEither(
		Effect.gen(function* () {
			const db = yield* requireDb
			const userService = yield* UserService

			// Resolve the internal DB user ID from the Telegram user
			const userOption = yield* userService.getUserByTelegramId(telegramUser.id)
			const dbUserId = Option.isSome(userOption) ? userOption.value.id : 0

			// Global stats
			const globalStats = yield* Effect.tryPromise({
				try: () =>
					db
						.select({
							totalStaked: sql<string>`coalesce(sum(suwp_staked), 0)`,
							stakerCount: sql<number>`count(*)`,
						})
						.from(stakingPositions)
						.where(and(eq(stakingPositions.isActive, 1), sql`suwp_staked > 0`)),
				catch: (e) => new Error(`Database error: ${e}`),
			})

			// User's position
			const userPosRows = yield* Effect.tryPromise({
				try: () =>
					db
						.select()
						.from(stakingPositions)
						.where(eq(stakingPositions.userId, dbUserId))
						.limit(1),
				catch: (e) => new Error(`Database error: ${e}`),
			})
			const userPos = userPosRows[0]

			// User's pending rewards
			const pendingRewards = yield* Effect.tryPromise({
				try: () =>
					db
						.select()
						.from(epochRewards)
						.where(
							and(
								eq(epochRewards.userId, dbUserId),
								eq(epochRewards.status, 'pending'),
							),
						),
				catch: (e) => new Error(`Database error: ${e}`),
			})

			// User's pending/recent claims
			const claims = yield* Effect.tryPromise({
				try: () =>
					db
						.select()
						.from(tokenClaims)
						.where(eq(tokenClaims.userId, dbUserId))
						.orderBy(desc(tokenClaims.createdAt))
						.limit(10),
				catch: (e) => new Error(`Database error: ${e}`),
			})

			// Recent epochs
			const epochs = yield* Effect.tryPromise({
				try: () =>
					db
						.select()
						.from(distributionEpochs)
						.orderBy(desc(distributionEpochs.epochNumber))
						.limit(4),
				catch: (e) => new Error(`Database error: ${e}`),
			})

			const globalRow = globalStats[0]
			const totalStaked = parseFloat(globalRow?.totalStaked ?? '0')
			const userStaked = parseFloat(userPos?.suwpStaked ?? '0')
			const poolSharePct = totalStaked > 0 ? (userStaked / totalStaked) * 100 : 0

			const pendingUsdc = pendingRewards.reduce((s, r) => s + parseFloat(r.usdcReward), 0)
			const pendingSuwp = pendingRewards.reduce((s, r) => s + parseFloat(r.suwpBonus), 0)

			return {
				global: {
					total_suwp_staked: totalStaked,
					staker_count: globalRow?.stakerCount ?? 0,
				},
				position: userPos
					? {
						suwp_staked: userStaked,
						pool_share_pct: poolSharePct,
						wallet_address: userPos.walletAddress,
						staked_since: userPos.stakedSince,
					}
					: null,
				pending_rewards: { usdc: pendingUsdc, suwp_bonus: pendingSuwp },
				recent_claims: claims,
				recent_epochs: epochs,
			}
		}),
	)
	if (Either.isLeft(result)) {
		const { status, body } = mapErrorToResponse(result.left)
		return c.json(body, status as 200)
	}
	return c.json(result.right)
})

// GET /staking/epochs — distribution history
stakingRoutes.get('/epochs', async (c) => {
	const result = await runEffectEither(
		Effect.gen(function* () {
			const db = yield* requireDb
			return yield* Effect.tryPromise({
				try: () =>
					db
						.select()
						.from(distributionEpochs)
						.orderBy(desc(distributionEpochs.epochNumber))
						.limit(12),
				catch: (e) => new Error(`Database error: ${e}`),
			})
		}),
	)
	if (Either.isLeft(result)) return c.json([], 200)
	return c.json(result.right)
})

// GET /staking/apy — estimated APY based on recent epoch
stakingRoutes.get('/apy', async (c) => {
	const result = await runEffectEither(
		Effect.gen(function* () {
			const db = yield* requireDb
			const rows = yield* Effect.tryPromise({
				try: () =>
					db
						.select()
						.from(distributionEpochs)
						.where(eq(distributionEpochs.status, 'completed'))
						.orderBy(desc(distributionEpochs.epochNumber))
						.limit(1),
				catch: (e) => new Error(`Database error: ${e}`),
			})
			const latestEpoch = rows[0]

			if (!latestEpoch) return { apy_estimate_pct: null, note: 'No completed epochs yet' }

			const totalStaked = parseFloat(latestEpoch.totalSuwpStaked)
			const weeklyUsdc = parseFloat(latestEpoch.stakingPoolUsdc)
			// Annualise: 52 weeks, expressed as % of staked value (assuming $1/SUWP for now)
			const apyPct = totalStaked > 0 ? ((weeklyUsdc * 52) / totalStaked) * 100 : null

			return { apy_estimate_pct: apyPct, weekly_usdc_pool: weeklyUsdc, total_staked: totalStaked }
		}),
	)
	if (Either.isLeft(result)) return c.json({ apy_estimate_pct: null })
	return c.json(result.right)
})
