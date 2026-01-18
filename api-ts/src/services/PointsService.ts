import { Context, Effect, Layer, Option } from 'effect'
import { eq, desc, and, gte, sql } from 'drizzle-orm'
import {
	DrizzleService,
	requireDb,
	userPoints,
	pointTransactions,
	milestones,
	userMilestones,
	rewards,
	pointRedemptions,
	users,
	LEVELS,
	POINT_ACTIONS,
	DEFAULT_MILESTONES,
	DEFAULT_REWARDS,
	type UserPoints,
	type PointTransaction,
	type UserMilestone,
	type Reward,
	type PointRedemption,
	type LevelName,
	type PointAction,
} from '../db'
import { DatabaseError, NotFoundError, ValidationError } from '../errors'

// Stats response type
export interface UserPointsStats {
	currentPoints: number
	totalPointsEarned: number
	pointsSpent: number
	xp: number
	level: LevelName
	levelName: string
	levelEmoji: string
	feeRate: number
	xpToNextLevel: number | null
	nextLevel: LevelName | null
	dailyStreak: number
	longestStreak: number
	totalSwaps: number
	totalVolumeUsd: number
	rank: number | null
	lastCheckin: Date | null
}

// Leaderboard entry type
export interface LeaderboardEntry {
	rank: number
	userId: number
	username: string | null
	xp: number
	level: LevelName
	levelEmoji: string
	totalVolumeUsd: number
}

// Check-in result type
export interface CheckinResult {
	pointsEarned: number
	newStreak: number
	streakContinued: boolean
	streakBroken: boolean
	newLevel: LevelName | null
}

// Swap points result type
export interface SwapPointsResult {
	pointsAwarded: number
	isFirstSwapToday: boolean
	dailyBonus: number
	volumePoints: number
	newLevel: LevelName | null
	milestonesAchieved: string[]
}

export interface PointsServiceInterface {
	readonly getUserPoints: (userId: number) => Effect.Effect<UserPoints, DatabaseError, DrizzleService>
	readonly getUserStats: (userId: number) => Effect.Effect<UserPointsStats, DatabaseError, DrizzleService>
	readonly awardPoints: (
		userId: number,
		action: PointAction,
		amount?: number,
		description?: string,
		metadata?: Record<string, unknown>
	) => Effect.Effect<{ points: number; newLevel: LevelName | null }, DatabaseError, DrizzleService>
	readonly awardSwapPoints: (
		userId: number,
		swapAmountUsd: number,
		swapId?: number
	) => Effect.Effect<SwapPointsResult, DatabaseError, DrizzleService>
	readonly dailyCheckin: (
		userId: number
	) => Effect.Effect<CheckinResult, DatabaseError | ValidationError, DrizzleService>
	readonly redeemReward: (
		userId: number,
		rewardId: number
	) => Effect.Effect<PointRedemption, DatabaseError | ValidationError | NotFoundError, DrizzleService>
	readonly getLeaderboard: (limit?: number) => Effect.Effect<LeaderboardEntry[], DatabaseError, DrizzleService>
	readonly getUserRank: (userId: number) => Effect.Effect<number | null, DatabaseError, DrizzleService>
	readonly getAvailableRewards: () => Effect.Effect<Reward[], DatabaseError, DrizzleService>
	readonly getPointHistory: (
		userId: number,
		limit?: number,
		offset?: number,
		action?: PointAction
	) => Effect.Effect<PointTransaction[], DatabaseError, DrizzleService>
	readonly checkMilestones: (userId: number) => Effect.Effect<UserMilestone[], DatabaseError, DrizzleService>
	readonly seedDefaults: () => Effect.Effect<void, DatabaseError, DrizzleService>
}

export class PointsService extends Context.Tag('PointsService')<PointsService, PointsServiceInterface>() {}

// Helper functions
function getLevelFromXp(xp: number): LevelName {
	if (xp >= LEVELS.diamond.xp) return 'diamond'
	if (xp >= LEVELS.platinum.xp) return 'platinum'
	if (xp >= LEVELS.gold.xp) return 'gold'
	if (xp >= LEVELS.silver.xp) return 'silver'
	return 'bronze'
}

function getNextLevel(currentLevel: LevelName): LevelName | null {
	const order: LevelName[] = ['bronze', 'silver', 'gold', 'platinum', 'diamond']
	const idx = order.indexOf(currentLevel)
	return idx < order.length - 1 ? order[idx + 1] : null
}

function getXpToNextLevel(currentXp: number, currentLevel: LevelName): number | null {
	const nextLevel = getNextLevel(currentLevel)
	if (!nextLevel) return null
	return LEVELS[nextLevel].xp - currentXp
}

function isSameDay(d1: Date, d2: Date): boolean {
	return (
		d1.getUTCFullYear() === d2.getUTCFullYear() &&
		d1.getUTCMonth() === d2.getUTCMonth() &&
		d1.getUTCDate() === d2.getUTCDate()
	)
}

function isYesterday(d1: Date, d2: Date): boolean {
	const yesterday = new Date(d2)
	yesterday.setUTCDate(yesterday.getUTCDate() - 1)
	return isSameDay(d1, yesterday)
}

// Internal helper: Get or create user points (not exported as service method)
const getOrCreateUserPoints = (userId: number): Effect.Effect<UserPoints, DatabaseError, DrizzleService> =>
	Effect.gen(function* () {
		const db = yield* requireDb.pipe(Effect.mapError((e) => new DatabaseError({ message: e.message })))

		const existing = yield* Effect.tryPromise({
			try: () => db.select().from(userPoints).where(eq(userPoints.userId, userId)),
			catch: (e) => new DatabaseError({ message: `Failed to get user points: ${e}`, cause: e }),
		})

		if (existing.length > 0) {
			return existing[0]
		}

		const created = yield* Effect.tryPromise({
			try: () => db.insert(userPoints).values({ userId }).returning(),
			catch: (e) => new DatabaseError({ message: `Failed to create user points: ${e}`, cause: e }),
		})

		return created[0]
	})

// Internal helper: Check and award milestones
const checkAndAwardMilestones = (
	userId: number,
	current: UserPoints
): Effect.Effect<UserMilestone[], DatabaseError, DrizzleService> =>
	Effect.gen(function* () {
		const db = yield* requireDb.pipe(Effect.mapError((e) => new DatabaseError({ message: e.message })))

		const allMilestones = yield* Effect.tryPromise({
			try: () => db.select().from(milestones).where(eq(milestones.isActive, true)),
			catch: (e) => new DatabaseError({ message: `Failed to get milestones: ${e}`, cause: e }),
		})

		const achieved = yield* Effect.tryPromise({
			try: () =>
				db
					.select({ milestoneId: userMilestones.milestoneId })
					.from(userMilestones)
					.where(eq(userMilestones.userId, userId)),
			catch: (e) => new DatabaseError({ message: `Failed to get achieved milestones: ${e}`, cause: e }),
		})

		const achievedIds = new Set(achieved.map((a) => a.milestoneId))
		const newlyAchieved: UserMilestone[] = []

		for (const milestone of allMilestones) {
			if (achievedIds.has(milestone.id)) continue

			let qualifies = false
			switch (milestone.requirementType) {
				case 'swaps':
					qualifies = current.totalSwaps >= milestone.requirementValue
					break
				case 'volume':
					qualifies = current.totalVolumeUsd >= milestone.requirementValue
					break
				case 'streak':
					qualifies = current.longestStreak >= milestone.requirementValue
					break
			}

			if (qualifies) {
				const awarded = yield* Effect.tryPromise({
					try: () =>
						db
							.insert(userMilestones)
							.values({
								userId,
								milestoneId: milestone.id,
								pointsAwarded: milestone.pointsReward,
							})
							.returning(),
					catch: (e) => new DatabaseError({ message: `Failed to award milestone: ${e}`, cause: e }),
				})

				if (awarded.length > 0) {
					newlyAchieved.push(awarded[0])

					yield* Effect.tryPromise({
						try: () =>
							db
								.update(userPoints)
								.set({
									xp: current.xp + milestone.pointsReward,
									totalPointsEarned: current.totalPointsEarned + milestone.pointsReward,
									currentPoints: current.currentPoints + milestone.pointsReward,
									updatedAt: new Date(),
								})
								.where(eq(userPoints.userId, userId)),
						catch: (e) => new DatabaseError({ message: `Failed to add milestone points: ${e}`, cause: e }),
					})

					yield* Effect.tryPromise({
						try: () =>
							db.insert(pointTransactions).values({
								userId,
								amount: milestone.pointsReward,
								action: 'milestone',
								description: `${milestone.emoji} ${milestone.name}`,
								metadata: { milestoneId: milestone.id, milestoneName: milestone.name },
							}),
						catch: (e) => new DatabaseError({ message: `Failed to record milestone: ${e}`, cause: e }),
					})
				}
			}
		}

		return newlyAchieved
	})

export const PointsServiceLive = Layer.succeed(PointsService, {
	getUserPoints: (userId: number) => getOrCreateUserPoints(userId),

	getUserStats: (userId: number) =>
		Effect.gen(function* () {
			const db = yield* requireDb.pipe(Effect.mapError((e) => new DatabaseError({ message: e.message })))
			const points = yield* getOrCreateUserPoints(userId)
			const level = points.level as LevelName
			const levelInfo = LEVELS[level]

			const rankResult = yield* Effect.tryPromise({
				try: () =>
					db
						.select({ count: sql<number>`count(*)` })
						.from(userPoints)
						.where(gte(userPoints.xp, points.xp)),
				catch: (e) => new DatabaseError({ message: `Failed to get rank: ${e}`, cause: e }),
			})

			const rank = rankResult[0]?.count ?? null

			return {
				currentPoints: points.currentPoints,
				totalPointsEarned: points.totalPointsEarned,
				pointsSpent: points.pointsSpent,
				xp: points.xp,
				level,
				levelName: levelInfo.name,
				levelEmoji: levelInfo.emoji,
				feeRate: levelInfo.fee,
				xpToNextLevel: getXpToNextLevel(points.xp, level),
				nextLevel: getNextLevel(level),
				dailyStreak: points.dailyStreak,
				longestStreak: points.longestStreak,
				totalSwaps: points.totalSwaps,
				totalVolumeUsd: points.totalVolumeUsd,
				rank,
				lastCheckin: points.lastCheckin,
			}
		}),

	awardPoints: (
		userId: number,
		action: PointAction,
		amount?: number,
		description?: string,
		metadata?: Record<string, unknown>
	) =>
		Effect.gen(function* () {
			const db = yield* requireDb.pipe(Effect.mapError((e) => new DatabaseError({ message: e.message })))

			const pointAmount = amount ?? POINT_ACTIONS[action].points
			const desc = description ?? POINT_ACTIONS[action].description

			const current = yield* getOrCreateUserPoints(userId)
			const oldLevel = current.level as LevelName

			const newXp = current.xp + pointAmount
			const newLevel = getLevelFromXp(newXp)
			const leveledUp = newLevel !== oldLevel

			yield* Effect.tryPromise({
				try: () =>
					db
						.update(userPoints)
						.set({
							xp: newXp,
							totalPointsEarned: current.totalPointsEarned + pointAmount,
							currentPoints: current.currentPoints + pointAmount,
							level: newLevel,
							updatedAt: new Date(),
						})
						.where(eq(userPoints.userId, userId)),
				catch: (e) => new DatabaseError({ message: `Failed to update points: ${e}`, cause: e }),
			})

			yield* Effect.tryPromise({
				try: () =>
					db.insert(pointTransactions).values({
						userId,
						amount: pointAmount,
						action,
						description: desc,
						metadata,
					}),
				catch: (e) => new DatabaseError({ message: `Failed to record transaction: ${e}`, cause: e }),
			})

			if (leveledUp) {
				yield* Effect.tryPromise({
					try: () =>
						db.insert(pointTransactions).values({
							userId,
							amount: POINT_ACTIONS.level_up.points,
							action: 'level_up',
							description: `Leveled up to ${LEVELS[newLevel].name}!`,
							metadata: { oldLevel, newLevel },
						}),
					catch: (e) => new DatabaseError({ message: `Failed to record level up: ${e}`, cause: e }),
				})

				yield* Effect.tryPromise({
					try: () =>
						db
							.update(userPoints)
							.set({
								xp: newXp + POINT_ACTIONS.level_up.points,
								totalPointsEarned: current.totalPointsEarned + pointAmount + POINT_ACTIONS.level_up.points,
								currentPoints: current.currentPoints + pointAmount + POINT_ACTIONS.level_up.points,
							})
							.where(eq(userPoints.userId, userId)),
					catch: (e) => new DatabaseError({ message: `Failed to add level bonus: ${e}`, cause: e }),
				})
			}

			return {
				points: pointAmount + (leveledUp ? POINT_ACTIONS.level_up.points : 0),
				newLevel: leveledUp ? newLevel : null,
			}
		}),

	awardSwapPoints: (userId: number, swapAmountUsd: number, swapId?: number) =>
		Effect.gen(function* () {
			const db = yield* requireDb.pipe(Effect.mapError((e) => new DatabaseError({ message: e.message })))

			const now = new Date()
			const current = yield* getOrCreateUserPoints(userId)

			const volumePoints = Math.floor(swapAmountUsd / 10)
			const isFirstSwapToday = !current.lastSwapDate || !isSameDay(current.lastSwapDate, now)
			const dailyBonus = isFirstSwapToday ? POINT_ACTIONS.first_swap_daily.points : 0
			const totalPoints = volumePoints + dailyBonus

			const oldLevel = current.level as LevelName
			const newXp = current.xp + totalPoints
			const newLevel = getLevelFromXp(newXp)
			const leveledUp = newLevel !== oldLevel
			const levelBonus = leveledUp ? POINT_ACTIONS.level_up.points : 0

			yield* Effect.tryPromise({
				try: () =>
					db
						.update(userPoints)
						.set({
							xp: newXp + levelBonus,
							totalPointsEarned: current.totalPointsEarned + totalPoints + levelBonus,
							currentPoints: current.currentPoints + totalPoints + levelBonus,
							level: newLevel,
							lastSwapDate: now,
							totalSwaps: current.totalSwaps + 1,
							totalVolumeUsd: current.totalVolumeUsd + swapAmountUsd,
							updatedAt: now,
						})
						.where(eq(userPoints.userId, userId)),
				catch: (e) => new DatabaseError({ message: `Failed to update swap points: ${e}`, cause: e }),
			})

			if (volumePoints > 0) {
				yield* Effect.tryPromise({
					try: () =>
						db.insert(pointTransactions).values({
							userId,
							amount: volumePoints,
							action: 'swap',
							description: `Swap volume: $${swapAmountUsd.toFixed(2)}`,
							swapId,
							metadata: { swapAmountUsd },
						}),
					catch: (e) => new DatabaseError({ message: `Failed to record swap points: ${e}`, cause: e }),
				})
			}

			if (isFirstSwapToday) {
				yield* Effect.tryPromise({
					try: () =>
						db.insert(pointTransactions).values({
							userId,
							amount: dailyBonus,
							action: 'first_swap_daily',
							description: 'First swap of the day bonus',
							swapId,
						}),
					catch: (e) => new DatabaseError({ message: `Failed to record daily bonus: ${e}`, cause: e }),
				})
			}

			if (leveledUp) {
				yield* Effect.tryPromise({
					try: () =>
						db.insert(pointTransactions).values({
							userId,
							amount: POINT_ACTIONS.level_up.points,
							action: 'level_up',
							description: `Leveled up to ${LEVELS[newLevel].name}!`,
							metadata: { oldLevel, newLevel },
						}),
					catch: (e) => new DatabaseError({ message: `Failed to record level up: ${e}`, cause: e }),
				})
			}

			// Get updated user points for milestone check
			const updated = yield* getOrCreateUserPoints(userId)
			const milestonesAchieved = yield* checkAndAwardMilestones(userId, updated)
			const milestoneNames = milestonesAchieved.map((m) => `Milestone #${m.milestoneId}`)

			return {
				pointsAwarded: totalPoints + levelBonus,
				isFirstSwapToday,
				dailyBonus,
				volumePoints,
				newLevel: leveledUp ? newLevel : null,
				milestonesAchieved: milestoneNames,
			}
		}),

	dailyCheckin: (userId: number) =>
		Effect.gen(function* () {
			const db = yield* requireDb.pipe(Effect.mapError((e) => new DatabaseError({ message: e.message })))

			const now = new Date()
			const current = yield* getOrCreateUserPoints(userId)

			if (current.lastCheckin && isSameDay(current.lastCheckin, now)) {
				return yield* Effect.fail(new ValidationError({ message: 'Already checked in today' }))
			}

			let newStreak = 1
			let streakContinued = false
			let streakBroken = false

			if (current.lastCheckin) {
				if (isYesterday(current.lastCheckin, now)) {
					newStreak = current.dailyStreak + 1
					streakContinued = true
				} else {
					streakBroken = current.dailyStreak > 0
				}
			}

			const basePoints = POINT_ACTIONS.checkin.points
			const streakBonus = Math.min(newStreak, 30) * POINT_ACTIONS.streak_bonus.points
			const totalPoints = basePoints + streakBonus

			const oldLevel = current.level as LevelName
			const newXp = current.xp + totalPoints
			const newLevel = getLevelFromXp(newXp)
			const leveledUp = newLevel !== oldLevel
			const levelBonus = leveledUp ? POINT_ACTIONS.level_up.points : 0

			yield* Effect.tryPromise({
				try: () =>
					db
						.update(userPoints)
						.set({
							xp: newXp + levelBonus,
							totalPointsEarned: current.totalPointsEarned + totalPoints + levelBonus,
							currentPoints: current.currentPoints + totalPoints + levelBonus,
							level: newLevel,
							dailyStreak: newStreak,
							longestStreak: Math.max(current.longestStreak, newStreak),
							lastCheckin: now,
							updatedAt: now,
						})
						.where(eq(userPoints.userId, userId)),
				catch: (e) => new DatabaseError({ message: `Failed to update checkin: ${e}`, cause: e }),
			})

			yield* Effect.tryPromise({
				try: () =>
					db.insert(pointTransactions).values({
						userId,
						amount: basePoints,
						action: 'checkin',
						description: 'Daily check-in',
						metadata: { streak: newStreak },
					}),
				catch: (e) => new DatabaseError({ message: `Failed to record checkin: ${e}`, cause: e }),
			})

			if (streakBonus > 0) {
				yield* Effect.tryPromise({
					try: () =>
						db.insert(pointTransactions).values({
							userId,
							amount: streakBonus,
							action: 'streak_bonus',
							description: `${newStreak}-day streak bonus`,
							metadata: { streak: newStreak },
						}),
					catch: (e) => new DatabaseError({ message: `Failed to record streak bonus: ${e}`, cause: e }),
				})
			}

			if (leveledUp) {
				yield* Effect.tryPromise({
					try: () =>
						db.insert(pointTransactions).values({
							userId,
							amount: POINT_ACTIONS.level_up.points,
							action: 'level_up',
							description: `Leveled up to ${LEVELS[newLevel].name}!`,
							metadata: { oldLevel, newLevel },
						}),
					catch: (e) => new DatabaseError({ message: `Failed to record level up: ${e}`, cause: e }),
				})
			}

			// Check streak milestones
			const updated = yield* getOrCreateUserPoints(userId)
			yield* checkAndAwardMilestones(userId, updated)

			return {
				pointsEarned: totalPoints + levelBonus,
				newStreak,
				streakContinued,
				streakBroken,
				newLevel: leveledUp ? newLevel : null,
			}
		}),

	redeemReward: (userId: number, rewardId: number) =>
		Effect.gen(function* () {
			const db = yield* requireDb.pipe(Effect.mapError((e) => new DatabaseError({ message: e.message })))

			const rewardResult = yield* Effect.tryPromise({
				try: () => db.select().from(rewards).where(eq(rewards.id, rewardId)),
				catch: (e) => new DatabaseError({ message: `Failed to get reward: ${e}`, cause: e }),
			})

			if (rewardResult.length === 0) {
				return yield* Effect.fail(new NotFoundError({ message: 'Reward not found' }))
			}

			const reward = rewardResult[0]

			if (!reward.isActive) {
				return yield* Effect.fail(new ValidationError({ message: 'Reward is not available' }))
			}

			if (reward.stock !== null && reward.stock <= 0) {
				return yield* Effect.fail(new ValidationError({ message: 'Reward is out of stock' }))
			}

			const current = yield* getOrCreateUserPoints(userId)

			if (current.currentPoints < reward.pointsCost) {
				return yield* Effect.fail(
					new ValidationError({
						message: `Insufficient points. Need ${reward.pointsCost}, have ${current.currentPoints}`,
					})
				)
			}

			const expiresAt = reward.durationDays
				? new Date(Date.now() + reward.durationDays * 24 * 60 * 60 * 1000)
				: null

			const redemption = yield* Effect.tryPromise({
				try: () =>
					db
						.insert(pointRedemptions)
						.values({
							userId,
							rewardId,
							pointsSpent: reward.pointsCost,
							rewardType: reward.rewardType,
							rewardValue: reward.rewardValue,
							status: 'completed',
							completedAt: new Date(),
							expiresAt,
						})
						.returning(),
				catch: (e) => new DatabaseError({ message: `Failed to create redemption: ${e}`, cause: e }),
			})

			yield* Effect.tryPromise({
				try: () =>
					db
						.update(userPoints)
						.set({
							currentPoints: current.currentPoints - reward.pointsCost,
							pointsSpent: current.pointsSpent + reward.pointsCost,
							updatedAt: new Date(),
						})
						.where(eq(userPoints.userId, userId)),
				catch: (e) => new DatabaseError({ message: `Failed to deduct points: ${e}`, cause: e }),
			})

			yield* Effect.tryPromise({
				try: () =>
					db.insert(pointTransactions).values({
						userId,
						amount: -reward.pointsCost,
						action: 'redemption',
						description: `Redeemed: ${reward.name}`,
						metadata: { rewardId, rewardType: reward.rewardType, rewardValue: reward.rewardValue },
					}),
				catch: (e) => new DatabaseError({ message: `Failed to record redemption: ${e}`, cause: e }),
			})

			if (reward.stock !== null) {
				yield* Effect.tryPromise({
					try: () =>
						db
							.update(rewards)
							.set({ stock: reward.stock! - 1 })
							.where(eq(rewards.id, rewardId)),
					catch: (e) => new DatabaseError({ message: `Failed to update stock: ${e}`, cause: e }),
				})
			}

			return redemption[0]
		}),

	getLeaderboard: (limit = 10) =>
		Effect.gen(function* () {
			const db = yield* requireDb.pipe(Effect.mapError((e) => new DatabaseError({ message: e.message })))

			const result = yield* Effect.tryPromise({
				try: () =>
					db
						.select({
							userId: userPoints.userId,
							xp: userPoints.xp,
							level: userPoints.level,
							totalVolumeUsd: userPoints.totalVolumeUsd,
							username: users.username,
						})
						.from(userPoints)
						.leftJoin(users, eq(userPoints.userId, users.id))
						.orderBy(desc(userPoints.xp))
						.limit(limit),
				catch: (e) => new DatabaseError({ message: `Failed to get leaderboard: ${e}`, cause: e }),
			})

			return result.map((row, index) => ({
				rank: index + 1,
				userId: row.userId,
				username: row.username,
				xp: row.xp,
				level: row.level as LevelName,
				levelEmoji: LEVELS[row.level as LevelName].emoji,
				totalVolumeUsd: row.totalVolumeUsd,
			}))
		}),

	getUserRank: (userId: number) =>
		Effect.gen(function* () {
			const db = yield* requireDb.pipe(Effect.mapError((e) => new DatabaseError({ message: e.message })))
			const current = yield* getOrCreateUserPoints(userId)

			const result = yield* Effect.tryPromise({
				try: () =>
					db
						.select({ count: sql<number>`count(*)` })
						.from(userPoints)
						.where(gte(userPoints.xp, current.xp)),
				catch: (e) => new DatabaseError({ message: `Failed to get rank: ${e}`, cause: e }),
			})

			return result[0]?.count ?? null
		}),

	getAvailableRewards: () =>
		Effect.gen(function* () {
			const db = yield* requireDb.pipe(Effect.mapError((e) => new DatabaseError({ message: e.message })))

			const result = yield* Effect.tryPromise({
				try: () => db.select().from(rewards).where(eq(rewards.isActive, true)),
				catch: (e) => new DatabaseError({ message: `Failed to get rewards: ${e}`, cause: e }),
			})

			return result
		}),

	getPointHistory: (userId: number, limit = 20, offset = 0, action?: PointAction) =>
		Effect.gen(function* () {
			const db = yield* requireDb.pipe(Effect.mapError((e) => new DatabaseError({ message: e.message })))

			const conditions = [eq(pointTransactions.userId, userId)]
			if (action) {
				conditions.push(eq(pointTransactions.action, action))
			}

			const result = yield* Effect.tryPromise({
				try: () =>
					db
						.select()
						.from(pointTransactions)
						.where(and(...conditions))
						.orderBy(desc(pointTransactions.createdAt))
						.limit(limit)
						.offset(offset),
				catch: (e) => new DatabaseError({ message: `Failed to get history: ${e}`, cause: e }),
			})

			return result
		}),

	checkMilestones: (userId: number) =>
		Effect.gen(function* () {
			const current = yield* getOrCreateUserPoints(userId)
			return yield* checkAndAwardMilestones(userId, current)
		}),

	seedDefaults: () =>
		Effect.gen(function* () {
			const db = yield* requireDb.pipe(Effect.mapError((e) => new DatabaseError({ message: e.message })))

			for (const milestone of DEFAULT_MILESTONES) {
				yield* Effect.tryPromise({
					try: () => db.insert(milestones).values(milestone).onConflictDoNothing({ target: milestones.name }),
					catch: () => new DatabaseError({ message: 'Failed to seed milestone' }),
				})
			}

			for (const reward of DEFAULT_REWARDS) {
				yield* Effect.tryPromise({
					try: () => db.insert(rewards).values(reward).onConflictDoNothing(),
					catch: () => new DatabaseError({ message: 'Failed to seed reward' }),
				})
			}
		}),
})
