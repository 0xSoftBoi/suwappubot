import { and, desc, eq, gte, isNull, lt, or, sql } from 'drizzle-orm'
import { Context, Effect, Layer, Option } from 'effect'
import {
	type DbClient,
	DEFAULT_MILESTONES,
	DEFAULT_REWARDS,
	type DrizzleService,
	LEVELS,
	type LevelName,
	milestones,
	POINT_ACTIONS,
	type PointAction,
	type PointRedemption,
	type PointTransaction,
	pointRedemptions,
	pointTransactions,
	type Reward,
	requireDb,
	requireRow,
	rewards,
	subscriptions,
	type UserMilestone,
	type UserPoints,
	userMilestones,
	userPoints,
	users,
} from '../db'
import { DatabaseError, NotFoundError, ValidationError } from '../errors'
import { logger } from '../lib/logger'
import { accrueSeasonPointsRaw, getActiveSeasonRaw } from './SeasonsService'

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
	readonly getUserPoints: (
		userId: number,
	) => Effect.Effect<UserPoints, DatabaseError, DrizzleService>
	readonly getUserStats: (
		userId: number,
	) => Effect.Effect<UserPointsStats, DatabaseError, DrizzleService>
	readonly awardPoints: (
		userId: number,
		action: PointAction,
		amount?: number,
		description?: string,
		metadata?: Record<string, unknown>,
	) => Effect.Effect<{ points: number; newLevel: LevelName | null }, DatabaseError, DrizzleService>
	readonly awardSwapPoints: (
		userId: number,
		swapAmountUsd: number,
		swapId?: number,
		feeUsd?: number,
	) => Effect.Effect<SwapPointsResult, DatabaseError, DrizzleService>
	readonly dailyCheckin: (
		userId: number,
	) => Effect.Effect<CheckinResult, DatabaseError | ValidationError, DrizzleService>
	readonly redeemReward: (
		userId: number,
		rewardId: number,
	) => Effect.Effect<
		PointRedemption,
		DatabaseError | ValidationError | NotFoundError,
		DrizzleService
	>
	readonly getLeaderboard: (
		limit?: number,
	) => Effect.Effect<LeaderboardEntry[], DatabaseError, DrizzleService>
	readonly getUserRank: (
		userId: number,
	) => Effect.Effect<number | null, DatabaseError, DrizzleService>
	readonly getAvailableRewards: () => Effect.Effect<Reward[], DatabaseError, DrizzleService>
	readonly getPointHistory: (
		userId: number,
		limit?: number,
		offset?: number,
		action?: PointAction,
	) => Effect.Effect<PointTransaction[], DatabaseError, DrizzleService>
	readonly checkMilestones: (
		userId: number,
	) => Effect.Effect<UserMilestone[], DatabaseError, DrizzleService>
	readonly seedDefaults: () => Effect.Effect<void, DatabaseError, DrizzleService>
}

export class PointsService extends Context.Tag('PointsService')<
	PointsService,
	PointsServiceInterface
>() {}

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
	return idx < order.length - 1 ? (order[idx + 1] ?? null) : null
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

// Midnight UTC for `d`. Used as the atomic WHERE-clause boundary for the
// once-per-day guards below (checkin, first-swap bonus) so the "already
// happened today" check and the write that marks it happened are the SAME
// statement — see checkinGuardCondition / firstSwapBonusCondition.
function startOfDayUtc(d: Date): Date {
	return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()))
}

// Internal helper: Get or create user points (not exported as service method)
const getOrCreateUserPoints = (
	userId: number,
): Effect.Effect<UserPoints, DatabaseError, DrizzleService> =>
	Effect.gen(function* () {
		const db = yield* requireDb.pipe(
			Effect.mapError((e) => new DatabaseError({ message: e.message })),
		)

		const existing = yield* Effect.tryPromise({
			try: () => db.select().from(userPoints).where(eq(userPoints.userId, userId)),
			catch: (e) => new DatabaseError({ message: `Failed to get user points: ${e}`, cause: e }),
		})

		const existingPoints = existing[0]
		if (existingPoints) {
			return existingPoints
		}

		const created = yield* Effect.tryPromise({
			try: () => db.insert(userPoints).values({ userId }).returning(),
			catch: (e) => new DatabaseError({ message: `Failed to create user points: ${e}`, cause: e }),
		})

		return yield* requireRow(created, 'Failed to create user points: no row returned')
	})

// Internal helper: resolve the active season id for stamping point_transactions.
// Never fails the caller — returns null on any error / no active season.
const activeSeasonId = (db: DbClient): Effect.Effect<number | null> =>
	Effect.tryPromise({
		try: () => getActiveSeasonRaw(db),
		catch: (e) => e,
	}).pipe(
		Effect.map((season) => season?.id ?? null),
		Effect.catchAll(() => Effect.succeed(null)),
	)

// Internal helper: accrue season points for an allowlisted action. This is the
// SINGLE write site into season_points from the points earn path (funnel logic
// lives in SeasonsService.accrueSeasonPointsRaw — one source of truth). Accrual
// must NEVER fail an award, so any error is swallowed and logged.
const accrueSeason = (
	db: DbClient,
	userId: number,
	action: string,
	baseAmount: number,
	swapAmountUsd?: number,
	feeUsd?: number,
): Effect.Effect<void> =>
	Effect.tryPromise({
		try: () => accrueSeasonPointsRaw(db, userId, action, baseAmount, swapAmountUsd, feeUsd),
		catch: (e) => e,
	}).pipe(
		Effect.asVoid,
		Effect.catchAll((e) =>
			Effect.sync(() => {
				logger.warn(`[PointsService] season accrual failed (${action}, user ${userId}): ${e}`)
			}),
		),
	)

// Internal helper: Check and award milestones
const checkAndAwardMilestones = (
	userId: number,
	current: UserPoints,
): Effect.Effect<UserMilestone[], DatabaseError, DrizzleService> =>
	Effect.gen(function* () {
		const db = yield* requireDb.pipe(
			Effect.mapError((e) => new DatabaseError({ message: e.message })),
		)

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
			catch: (e) =>
				new DatabaseError({ message: `Failed to get achieved milestones: ${e}`, cause: e }),
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

				const awardedMilestone = awarded[0]
				if (awardedMilestone) {
					newlyAchieved.push(awardedMilestone)

					yield* Effect.tryPromise({
						try: () =>
							db
								.update(userPoints)
								.set({
									// SQL-relative: a concurrent redemption's debit must not be
									// undone by an award writing an absolute value from a stale read.
									xp: sql`${userPoints.xp} + ${milestone.pointsReward}`,
									totalPointsEarned: sql`${userPoints.totalPointsEarned} + ${milestone.pointsReward}`,
									currentPoints: sql`${userPoints.currentPoints} + ${milestone.pointsReward}`,
									updatedAt: new Date(),
								})
								.where(eq(userPoints.userId, userId)),
						catch: (e) =>
							new DatabaseError({ message: `Failed to add milestone points: ${e}`, cause: e }),
					})

					const seasonId = yield* activeSeasonId(db)
					yield* Effect.tryPromise({
						try: () =>
							db.insert(pointTransactions).values({
								userId,
								amount: milestone.pointsReward,
								action: 'milestone',
								description: `${milestone.emoji} ${milestone.name}`,
								metadata: { milestoneId: milestone.id, milestoneName: milestone.name },
								seasonId,
							}),
						catch: (e) =>
							new DatabaseError({ message: `Failed to record milestone: ${e}`, cause: e }),
					})

					// Accrue season points for the milestone reward (allowlisted).
					yield* accrueSeason(db, userId, 'milestone', milestone.pointsReward)
				}
			}
		}

		return newlyAchieved
	})

/**
 * MONEY-PATH guard for a points debit: match the user's row only while it still
 * holds at least `cost`.
 *
 * Paired with SQL-side arithmetic (`currentPoints - cost`) this makes the
 * balance check and the debit a single statement, so concurrent redemptions
 * contend on the row lock and the loser matches zero rows. Read-then-write is
 * not sufficient even inside a transaction: under Postgres READ COMMITTED (our
 * default — no isolation level is configured) both callers read the same
 * balance and the second write clobbers the first, spending it twice.
 *
 * Exported so the compiled predicate can be asserted directly — the race it
 * prevents cannot be reproduced against SQLite, which has a single writer.
 */
export function pointsDebitCondition(userId: number, cost: number) {
	return and(eq(userPoints.userId, userId), gte(userPoints.currentPoints, cost))
}

/**
 * The debit half, paired with {@link pointsDebitCondition}. Arithmetic is done
 * in SQL against the row's live value — never against a balance read earlier in
 * the request, which is what allowed the same points to be spent twice.
 *
 * Extracted alongside the predicate so BOTH halves of the guarantee are pinned
 * by tests. Pinning only the WHERE clause would let someone revert the `set` to
 * JS arithmetic with every test still green.
 */
/**
 * `level` derived in SQL from the row's post-increment `xp`, so the two can
 * never disagree.
 *
 * Writing `level` from a JS snapshot while `xp` is incremented relatively lets
 * them drift under concurrency: two awards land, `xp` correctly reaches X+a+b,
 * but `level` is written from X+a. The stored tier then lags the real xp, and
 * the NEXT award reads that stale tier as `oldLevel`, computes the real tier as
 * `newLevel`, concludes the user just levelled up, and pays a SECOND level_up
 * bonus for a crossing already paid for. (Before this PR the `xp` write was
 * clobbered too, so the pair stayed wrong-but-consistent and never re-triggered.)
 *
 * Thresholds mirror LEVELS in db/schema/points.ts — descending, so the first
 * matching branch wins.
 */
function levelFromXpSql(xpIncrement: number) {
	return sql`CASE
		WHEN ${userPoints.xp} + ${xpIncrement} >= ${LEVELS.diamond.xp} THEN 'diamond'
		WHEN ${userPoints.xp} + ${xpIncrement} >= ${LEVELS.platinum.xp} THEN 'platinum'
		WHEN ${userPoints.xp} + ${xpIncrement} >= ${LEVELS.gold.xp} THEN 'gold'
		WHEN ${userPoints.xp} + ${xpIncrement} >= ${LEVELS.silver.xp} THEN 'silver'
		ELSE 'bronze'
	END`
}

/**
 * MONEY-PATH guard for the daily check-in: match the user's row only while
 * `lastCheckin` is unset or strictly before the start of `today` (UTC).
 *
 * Paired with a SET that also stamps `lastCheckin: now` in the SAME UPDATE,
 * this makes the "already checked in today" check and the write that marks
 * the check-in the same statement. Read-then-write was not sufficient: two
 * concurrent /checkin calls both read `lastCheckin` from yesterday, both pass
 * the JS guard, and both apply a relative `xp + delta` — double credit. The
 * loser here matches zero rows and the caller maps that to a ValidationError
 * instead of paying out twice.
 */
export function checkinGuardCondition(userId: number, today: Date) {
	return and(
		eq(userPoints.userId, userId),
		or(isNull(userPoints.lastCheckin), lt(userPoints.lastCheckin, today)),
	)
}

/**
 * Same guard shape as {@link checkinGuardCondition}, for the first-swap-of-day
 * bonus. Split into its own conditional UPDATE (separate from the
 * always-applies volume-points update) specifically so the WHERE guard and
 * the `lastSwapDate` write are atomic — the previous code computed
 * `isFirstSwapToday` from a pre-read snapshot while folding the 50-point
 * bonus into the same relative `xp + delta` as the (always-correct) volume
 * points, so two concurrent swaps in the same request window both won the
 * bonus.
 */
export function firstSwapBonusCondition(userId: number, today: Date) {
	return and(
		eq(userPoints.userId, userId),
		or(isNull(userPoints.lastSwapDate), lt(userPoints.lastSwapDate, today)),
	)
}

/** Deterministic idempotency key for the once-per-level level_up bonus. */
export function levelUpReference(level: LevelName): string {
	return `level_up:${level}`
}

/**
 * Pays the one-time level_up bonus for a user reaching `candidateLevel`, and
 * ONLY that bonus — never twice per crossing.
 *
 * `candidateLevel` is derived from a JS-side xp snapshot (may race under
 * concurrency, same as `oldLevel`/`newLevel` elsewhere in this file) so two
 * concurrent awards near a threshold can both believe they are the one that
 * crossed it. Real exactly-once-ness comes from the DB, not the snapshot:
 * the ledger insert below carries a deterministic `reference` key
 * (`level_up:{level}`) under a UNIQUE(user_id, reference) index
 * (point_transactions_user_reference_idx), and `onConflictDoNothing` makes
 * the insert a no-op for whichever caller loses the race. The 100-point
 * bonus is credited to userPoints ONLY when the insert actually landed a
 * row — so the loser's insert being a no-op is what prevents the double pay,
 * not the JS comparison.
 */
const awardLevelUpBonus = (
	db: DbClient,
	userId: number,
	oldLevel: LevelName,
	candidateLevel: LevelName,
	seasonId: number | null,
): Effect.Effect<{ applied: boolean; newLevel: LevelName | null }, DatabaseError> =>
	Effect.gen(function* () {
		if (candidateLevel === oldLevel) {
			return { applied: false, newLevel: null }
		}

		const inserted = yield* Effect.tryPromise({
			try: () =>
				db
					.insert(pointTransactions)
					.values({
						userId,
						amount: POINT_ACTIONS.level_up.points,
						action: 'level_up',
						description: `Leveled up to ${LEVELS[candidateLevel].name}!`,
						metadata: { oldLevel, newLevel: candidateLevel },
						reference: levelUpReference(candidateLevel),
						seasonId,
					})
					.onConflictDoNothing({
						target: [pointTransactions.userId, pointTransactions.reference],
					})
					.returning({ id: pointTransactions.id }),
			catch: (e) => new DatabaseError({ message: `Failed to record level up: ${e}`, cause: e }),
		})

		if (inserted.length === 0) {
			// Already paid — either by a concurrent caller that beat us to the
			// insert, or by an earlier award for the same crossing.
			return { applied: false, newLevel: null }
		}

		yield* Effect.tryPromise({
			try: () =>
				db
					.update(userPoints)
					.set({
						// DELTA ONLY — see the comment at the awardPoints call site: the
						// preceding statement already applied the triggering award
						// relative to the live row, so adding it again here would
						// credit it twice.
						xp: sql`${userPoints.xp} + ${POINT_ACTIONS.level_up.points}`,
						totalPointsEarned: sql`${userPoints.totalPointsEarned} + ${POINT_ACTIONS.level_up.points}`,
						currentPoints: sql`${userPoints.currentPoints} + ${POINT_ACTIONS.level_up.points}`,
						level: levelFromXpSql(POINT_ACTIONS.level_up.points),
						updatedAt: new Date(),
					})
					.where(eq(userPoints.userId, userId)),
			catch: (e) => new DatabaseError({ message: `Failed to add level bonus: ${e}`, cause: e }),
		})

		return { applied: true, newLevel: candidateLevel }
	})

export function pointsDebitSet(cost: number) {
	return {
		currentPoints: sql`${userPoints.currentPoints} - ${cost}`,
		pointsSpent: sql`${userPoints.pointsSpent} + ${cost}`,
		updatedAt: new Date(),
	}
}

// Thrown inside a redemption transaction to roll it back. These are the losers
// of a legitimate race (or a genuinely short balance), NOT database faults — so
// they carry a marker that lets the Effect `catch` map them back to
// ValidationError. Without this, the user who loses a race by microseconds gets
// an opaque 500 and the event lands in error dashboards as a DB fault.
class RedemptionRejected extends Error {
	readonly isRedemptionRejection = true
}
class InsufficientPointsError extends RedemptionRejected {
	constructor() {
		super('Insufficient points')
	}
}
class OutOfStockError extends RedemptionRejected {
	constructor() {
		super('Reward out of stock')
	}
}

/** Map a thrown redemption rejection back to a user-facing ValidationError. */
function redemptionFailure(e: unknown, context: string) {
	if (e instanceof RedemptionRejected) {
		return new ValidationError({ message: e.message })
	}
	return new DatabaseError({ message: `${context}: ${e}`, cause: e })
}

export const PointsServiceLive = Layer.succeed(PointsService, {
	getUserPoints: (userId: number) => getOrCreateUserPoints(userId),

	getUserStats: (userId: number) =>
		Effect.gen(function* () {
			const db = yield* requireDb.pipe(
				Effect.mapError((e) => new DatabaseError({ message: e.message })),
			)
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
				// ROADMAP value, NOT the charged rate. The actual swap fee comes from
				// the user's subscription tier, not their XP level (see LEVELS comment
				// in db/schema/points.ts). `feeRateApplied` tells consumers whether
				// this discount is live — it is not, so surface it as "coming soon".
				feeRate: levelInfo.fee,
				feeRateApplied: false,
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
		metadata?: Record<string, unknown>,
	) =>
		Effect.gen(function* () {
			const db = yield* requireDb.pipe(
				Effect.mapError((e) => new DatabaseError({ message: e.message })),
			)

			const pointAmount = amount ?? POINT_ACTIONS[action].points
			const desc = description ?? POINT_ACTIONS[action].description

			const current = yield* getOrCreateUserPoints(userId)
			const oldLevel = current.level as LevelName

			const newXp = current.xp + pointAmount
			const newLevel = getLevelFromXp(newXp)

			// Active season for transaction stamping (null if none / on error).
			const seasonId = yield* activeSeasonId(db)

			yield* Effect.tryPromise({
				try: () =>
					db
						.update(userPoints)
						.set({
							// SQL-relative for the accumulators (see pointsDebitCondition):
							// an absolute write here would clobber a concurrent debit and hand
							// the user back points they already spent. `level` stays absolute —
							// it is derived state, not an accumulator.
							xp: sql`${userPoints.xp} + ${pointAmount}`,
							totalPointsEarned: sql`${userPoints.totalPointsEarned} + ${pointAmount}`,
							currentPoints: sql`${userPoints.currentPoints} + ${pointAmount}`,
							level: levelFromXpSql(pointAmount),
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
						seasonId,
					}),
				catch: (e) =>
					new DatabaseError({ message: `Failed to record transaction: ${e}`, cause: e }),
			})

			// Accrue season points for allowlisted actions (checkin, referral_*,
			// copy_trade, milestone, streak_bonus). 'swap'/'first_swap_daily' route
			// through awardSwapPoints instead, so don't double count here. Pass
			// swapAmountUsd only if this is a 'swap' action (so the MIN_SWAP gate works).
			const swapUsd =
				action === 'swap' && typeof metadata?.swapAmountUsd === 'number'
					? metadata.swapAmountUsd
					: undefined
			yield* accrueSeason(db, userId, action, pointAmount, swapUsd)

			// MONEY-PATH (bug #3, level-up double pay): the insert-guarded helper is
			// the sole gate on the 100pt bonus. `leveledUp` above is only a JS-side
			// candidate signal — see awardLevelUpBonus doc.
			const levelUpResult = yield* awardLevelUpBonus(db, userId, oldLevel, newLevel, seasonId)

			return {
				points: pointAmount + (levelUpResult.applied ? POINT_ACTIONS.level_up.points : 0),
				newLevel: levelUpResult.newLevel,
			}
		}),

	awardSwapPoints: (userId: number, swapAmountUsd: number, swapId?: number, feeUsd?: number) =>
		Effect.gen(function* () {
			const db = yield* requireDb.pipe(
				Effect.mapError((e) => new DatabaseError({ message: e.message })),
			)

			const now = new Date()
			const today = startOfDayUtc(now)
			const current = yield* getOrCreateUserPoints(userId)

			const volumePoints = Math.floor(swapAmountUsd / 10)
			const oldLevel = current.level as LevelName
			const dailyBonusAmount = POINT_ACTIONS.first_swap_daily.points

			// Active season for transaction stamping (null if none / on error).
			const seasonId = yield* activeSeasonId(db)

			// MONEY-PATH (bug #2, first-swap-of-day double credit): own conditional
			// UPDATE, gated on `lastSwapDate < today` in the SAME statement that
			// stamps `lastSwapDate = now`. Previously `isFirstSwapToday` was computed
			// from the pre-read `current` snapshot while the 50pt bonus was folded
			// into the always-applies relative `xp + delta` alongside volume points —
			// two concurrent swaps both read a stale lastSwapDate and both won the
			// bonus. Atomic guard+write means only the winner's row matches; the
			// loser's UPDATE affects zero rows and isFirstSwapToday is false for it.
			const dailyBonusResult = yield* Effect.tryPromise({
				try: () =>
					db
						.update(userPoints)
						.set({
							xp: sql`${userPoints.xp} + ${dailyBonusAmount}`,
							totalPointsEarned: sql`${userPoints.totalPointsEarned} + ${dailyBonusAmount}`,
							currentPoints: sql`${userPoints.currentPoints} + ${dailyBonusAmount}`,
							level: levelFromXpSql(dailyBonusAmount),
							lastSwapDate: now,
							updatedAt: now,
						})
						.where(firstSwapBonusCondition(userId, today))
						.returning({ id: userPoints.id }),
				catch: (e) =>
					new DatabaseError({ message: `Failed to update first-swap bonus: ${e}`, cause: e }),
			})
			const isFirstSwapToday = dailyBonusResult.length > 0
			const dailyBonus = isFirstSwapToday ? dailyBonusAmount : 0

			// Volume points + lifetime stats always apply, independent of the bonus
			// race above — run as a separate statement so it never needs to touch
			// lastSwapDate (already stamped, or left alone, by the statement above).
			const volumeUpdateResult = yield* Effect.tryPromise({
				try: () =>
					db
						.update(userPoints)
						.set({
							xp: sql`${userPoints.xp} + ${volumePoints}`,
							totalPointsEarned: sql`${userPoints.totalPointsEarned} + ${volumePoints}`,
							currentPoints: sql`${userPoints.currentPoints} + ${volumePoints}`,
							level: levelFromXpSql(volumePoints),
							totalSwaps: sql`${userPoints.totalSwaps} + 1`,
							totalVolumeUsd: sql`${userPoints.totalVolumeUsd} + ${swapAmountUsd}`,
							updatedAt: now,
						})
						.where(eq(userPoints.userId, userId))
						.returning({ xp: userPoints.xp }),
				catch: (e) =>
					new DatabaseError({ message: `Failed to update swap volume points: ${e}`, cause: e }),
			})

			const totalPoints = volumePoints + dailyBonus
			const newXp = volumeUpdateResult[0]?.xp ?? current.xp + totalPoints
			const newLevel = getLevelFromXp(newXp)

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
							seasonId,
						}),
					catch: (e) =>
						new DatabaseError({ message: `Failed to record swap points: ${e}`, cause: e }),
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
							seasonId,
						}),
					catch: (e) =>
						new DatabaseError({ message: `Failed to record daily bonus: ${e}`, cause: e }),
				})
			}

			// MONEY-PATH (bug #3, level-up double pay): insert-guarded helper is the
			// sole gate on the 100pt bonus (see awardLevelUpBonus doc).
			const levelUpResult = yield* awardLevelUpBonus(db, userId, oldLevel, newLevel, seasonId)

			// Accrue season points. Two separate allowlisted actions with their own
			// base amounts (no double counting): 'swap' and 'first_swap_daily'.
			// Season points are FEE-DENOMINATED (Tullock self-funding fix): when
			// feeUsd is provided the accrual funnel overrides the base to
			// SEASON_POINTS_PER_FEE_USD * feeUsd, so even sub-$10 swaps (volumePoints
			// == 0) accrue on fees. volumePoints is only the legacy fallback base when
			// feeUsd is absent. Gate on either having a fee or volume points.
			if (feeUsd != null || volumePoints > 0) {
				yield* accrueSeason(db, userId, 'swap', volumePoints, swapAmountUsd, feeUsd)
			}
			if (isFirstSwapToday && dailyBonus > 0) {
				yield* accrueSeason(db, userId, 'first_swap_daily', dailyBonus)
			}

			// Get updated user points for milestone check
			const updated = yield* getOrCreateUserPoints(userId)
			const milestonesAchieved = yield* checkAndAwardMilestones(userId, updated)
			const milestoneNames = milestonesAchieved.map((m) => `Milestone #${m.milestoneId}`)

			return {
				pointsAwarded: totalPoints + (levelUpResult.applied ? POINT_ACTIONS.level_up.points : 0),
				isFirstSwapToday,
				dailyBonus,
				volumePoints,
				newLevel: levelUpResult.newLevel,
				milestonesAchieved: milestoneNames,
			}
		}),

	dailyCheckin: (userId: number) =>
		Effect.gen(function* () {
			const db = yield* requireDb.pipe(
				Effect.mapError((e) => new DatabaseError({ message: e.message })),
			)

			const now = new Date()
			const today = startOfDayUtc(now)
			const current = yield* getOrCreateUserPoints(userId)

			let newStreak = 1
			let streakContinued = false
			let streakBroken = false

			if (current.lastCheckin) {
				if (isYesterday(current.lastCheckin, now)) {
					newStreak = current.dailyStreak + 1
					streakContinued = true
				} else if (!isSameDay(current.lastCheckin, now)) {
					streakBroken = current.dailyStreak > 0
				}
			}

			const basePoints = POINT_ACTIONS.checkin.points
			const streakBonus = Math.min(newStreak, 30) * POINT_ACTIONS.streak_bonus.points
			const totalPoints = basePoints + streakBonus

			const oldLevel = current.level as LevelName
			const newXp = current.xp + totalPoints
			const newLevel = getLevelFromXp(newXp)

			// MONEY-PATH (bug #1, double check-in credit): the "already checked in
			// today" guard used to be a JS read-then-write — two concurrent /checkin
			// calls both passed it and both applied a relative `xp + delta`. The
			// guard now lives in the WHERE clause (checkinGuardCondition), in the
			// SAME statement that stamps `lastCheckin = now`, so the loser's UPDATE
			// matches zero rows and we fail instead of crediting twice.
			//
			// Bug #4: longestStreak now uses SQL GREATEST against the live column
			// instead of Math.max against the stale `current` snapshot, for the same
			// reason every other accumulator here is SQL-relative.
			const checkinResult = yield* Effect.tryPromise({
				try: () =>
					db
						.update(userPoints)
						.set({
							xp: sql`${userPoints.xp} + ${totalPoints}`,
							totalPointsEarned: sql`${userPoints.totalPointsEarned} + ${totalPoints}`,
							currentPoints: sql`${userPoints.currentPoints} + ${totalPoints}`,
							level: levelFromXpSql(totalPoints),
							dailyStreak: newStreak,
							longestStreak: sql`GREATEST(${userPoints.longestStreak}, ${newStreak})`,
							lastCheckin: now,
							updatedAt: now,
						})
						.where(checkinGuardCondition(userId, today))
						.returning({ id: userPoints.id }),
				catch: (e) => new DatabaseError({ message: `Failed to update checkin: ${e}`, cause: e }),
			})

			if (checkinResult.length === 0) {
				return yield* Effect.fail(new ValidationError({ message: 'Already checked in today' }))
			}

			// Active season for transaction stamping (null if none / on error).
			const seasonId = yield* activeSeasonId(db)

			yield* Effect.tryPromise({
				try: () =>
					db.insert(pointTransactions).values({
						userId,
						amount: basePoints,
						action: 'checkin',
						description: 'Daily check-in',
						metadata: { streak: newStreak },
						seasonId,
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
							seasonId,
						}),
					catch: (e) =>
						new DatabaseError({ message: `Failed to record streak bonus: ${e}`, cause: e }),
				})
			}

			// MONEY-PATH (bug #3, level-up double pay): insert-guarded helper is the
			// sole gate on the 100pt bonus (see awardLevelUpBonus doc).
			const levelUpResult = yield* awardLevelUpBonus(db, userId, oldLevel, newLevel, seasonId)

			// Accrue season points for the check-in. Two allowlisted actions with
			// their own base amounts (no double counting): 'checkin' (base) +
			// 'streak_bonus'. The streak multiplier reads the freshly-updated
			// dailyStreak above, so the multiplier reflects today's streak.
			yield* accrueSeason(db, userId, 'checkin', basePoints)
			if (streakBonus > 0) {
				yield* accrueSeason(db, userId, 'streak_bonus', streakBonus)
			}

			// Check streak milestones
			const updated = yield* getOrCreateUserPoints(userId)
			yield* checkAndAwardMilestones(userId, updated)

			return {
				pointsEarned: totalPoints + (levelUpResult.applied ? POINT_ACTIONS.level_up.points : 0),
				newStreak,
				streakContinued,
				streakBroken,
				newLevel: levelUpResult.newLevel,
			}
		}),

	redeemReward: (userId: number, rewardId: number) =>
		Effect.gen(function* () {
			const db = yield* requireDb.pipe(
				Effect.mapError((e) => new DatabaseError({ message: e.message })),
			)

			const rewardResult = yield* Effect.tryPromise({
				try: () => db.select().from(rewards).where(eq(rewards.id, rewardId)),
				catch: (e) => new DatabaseError({ message: `Failed to get reward: ${e}`, cause: e }),
			})

			const reward = rewardResult[0]
			if (!reward) {
				return yield* Effect.fail(new NotFoundError({ message: 'Reward not found' }))
			}

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
					}),
				)
			}

			// Partner / cash-equivalent redemptions (airline miles, gift cards,
			// stablecoin cash-out) are NOT enabled: they cross the cash-equivalent line
			// and require a partner integration + compliance sign-off (see
			// docs/economics/REDEMPTION_AND_PARTNERS.md). Reject rather than deduct.
			if (
				[
						'partner_transfer',
						'gift_card',
						'miles',
						'cashout',
						'stablecoin',
						'travel',
						'merch',
						'donation',
						'experience',
					].includes(
					reward.rewardType,
				)
			) {
				return yield* Effect.fail(
					new ValidationError({ message: 'Partner redemptions are not available yet.' }),
				)
			}

			// Subscription rewards grant a REAL tier — money path. The points
			// deduction, redemption record, and subscription grant all run in ONE
			// db.transaction so they're atomic (grant failure → no points lost, no
			// free sub). Spends currentPoints (loyalty wallet) ONLY; never touches
			// season points. EXTENDS existing expiry + keeps the higher tier.
			if (reward.rewardType === 'subscription') {
				const TIER_ORDER = ['free', 'pro', 'premium', 'enterprise']
				const targetTier = (reward.rewardValue ?? '').toLowerCase()
				if (!TIER_ORDER.includes(targetTier) || targetTier === 'free') {
					return yield* Effect.fail(
						new ValidationError({ message: 'Unknown subscription tier' }),
					)
				}
				const durationDays = reward.durationDays ?? 30
				const cost = reward.pointsCost
				const rName = reward.name
				const rValue = reward.rewardValue
				const rStock = reward.stock

				const subRedemption = yield* Effect.tryPromise({
					try: () =>
						db.transaction(async (tx) => {
							// MONEY-PATH: debit with a single conditional UPDATE, not
							// read-then-write. Under Postgres READ COMMITTED (our default —
							// no isolation level is configured anywhere) two concurrent
							// redemptions both read currentPoints=N, both pass a JS-side
							// check, and both write N-cost computed from their own stale
							// read. The second write clobbers the first: two rewards, one
							// balance. Being inside a transaction does NOT prevent this;
							// only row-level contention does.
							//
							// `WHERE currentPoints >= cost` makes the check and the debit
							// the same statement, so the row lock serialises concurrent
							// callers and the loser matches zero rows. Arithmetic is done
							// in SQL against the current value rather than a value read
							// earlier in this transaction.
							//
							// NB: this class of bug is invisible on SQLite (single writer),
							// so an integration test there will pass either way.
							const debited = await tx
								.update(userPoints)
								.set(pointsDebitSet(cost))
								.where(pointsDebitCondition(userId, cost))
								.returning({ currentPoints: userPoints.currentPoints })

							if (debited.length === 0) {
								// Either no row, or the balance moved below cost since the
								// pre-check. Throwing rolls the whole transaction back.
								throw new InsufficientPointsError()
							}

							const subRows = await tx
								.select()
								.from(subscriptions)
								.where(eq(subscriptions.userId, userId))
							const sub = subRows[0]
							const now = new Date()
							let base = now
							if (sub?.expiresAt && sub.expiresAt > now) base = sub.expiresAt
							const newExpiry = new Date(base.getTime() + durationDays * 86400000)
							const currentTier = (sub?.tier ?? 'free').toLowerCase()
							const newTier =
								TIER_ORDER.indexOf(targetTier) >= TIER_ORDER.indexOf(currentTier)
									? targetTier
									: currentTier

							await tx
								.insert(subscriptions)
								.values({
									userId,
									tier: newTier,
									startedAt: sub?.startedAt ?? now,
									expiresAt: newExpiry,
								})
								.onConflictDoUpdate({
									target: subscriptions.userId,
									set: {
										tier: newTier,
										startedAt: sub?.startedAt ?? now,
										expiresAt: newExpiry,
										updatedAt: now,
									},
								})

							const red = await tx
								.insert(pointRedemptions)
								.values({
									userId,
									rewardId,
									pointsSpent: cost,
									rewardType: 'subscription',
									rewardValue: rValue,
									status: 'completed',
									completedAt: now,
									expiresAt: newExpiry,
								})
								.returning()

							await tx.insert(pointTransactions).values({
								userId,
								amount: -cost,
								action: 'redemption',
								description: `Redeemed: ${rName}`,
								metadata: {
									rewardId,
									rewardType: 'subscription',
									tier: newTier,
									expiresAt: newExpiry.toISOString(),
								},
							})

							if (rStock !== null) {
								// Same conditional-update treatment as the debit above.
								// `rStock` came from a snapshot read taken before this
								// transaction, so `rStock - 1` let two concurrent
								// redemptions of the last unit both write 0 — two
								// subscriptions from one unit — and could drive stock
								// negative. The userPoints row lock does NOT serialise
								// these: they are different users, hence different rows.
								const stocked = await tx
									.update(rewards)
									.set({ stock: sql`${rewards.stock} - 1` })
									.where(and(eq(rewards.id, rewardId), gte(rewards.stock, 1)))
									.returning({ stock: rewards.stock })

								if (stocked.length === 0) {
									throw new OutOfStockError()
								}
							}
							return red[0]
						}),
					catch: (e) => redemptionFailure(e, 'Subscription redemption failed'),
				})

				if (!subRedemption) {
					return yield* Effect.fail(
						new DatabaseError({ message: 'Subscription redemption: no row returned' }),
					)
				}
				return subRedemption
			}

			const expiresAt = reward.durationDays
				? new Date(Date.now() + reward.durationDays * 24 * 60 * 60 * 1000)
				: null

			// MONEY-PATH: debit, redemption row, ledger entry and stock decrement are
			// ONE transaction, debit first.
			//
			// Previously these were four independent statements with no transaction,
			// and the redemption row was inserted BEFORE the points were deducted —
			// so a crash or a failing debit in between handed out a free reward that
			// nothing rolled back. The debit itself also read the balance earlier in
			// the request and wrote `current.currentPoints - cost` from that stale
			// read, so two concurrent redemptions could each spend the same balance.
			//
			// The conditional UPDATE below does the check and the debit in one
			// statement so the row lock serialises concurrent callers; the loser
			// matches zero rows and the whole transaction rolls back. Same treatment
			// for stock, which had the identical read-then-write race and could go
			// negative. (Both races are invisible on SQLite — single writer.)
			const redemption = yield* Effect.tryPromise({
				try: () =>
					db.transaction(async (tx) => {
						const debited = await tx
							.update(userPoints)
							.set(pointsDebitSet(reward.pointsCost))
							.where(pointsDebitCondition(userId, reward.pointsCost))
							.returning({ currentPoints: userPoints.currentPoints })

						if (debited.length === 0) {
							throw new InsufficientPointsError()
						}

						if (reward.stock !== null) {
							const stocked = await tx
								.update(rewards)
								.set({ stock: sql`${rewards.stock} - 1` })
								.where(and(eq(rewards.id, rewardId), gte(rewards.stock, 1)))
								.returning({ stock: rewards.stock })

							if (stocked.length === 0) {
								throw new OutOfStockError()
							}
						}

						const inserted = await tx
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
							.returning()

						await tx.insert(pointTransactions).values({
							userId,
							amount: -reward.pointsCost,
							action: 'redemption',
							description: `Redeemed: ${reward.name}`,
							metadata: {
								rewardId,
								rewardType: reward.rewardType,
								rewardValue: reward.rewardValue,
							},
						})

						return inserted
					}),
				catch: (e) => redemptionFailure(e, 'Failed to redeem reward'),
			})

			return yield* requireRow(redemption, 'Failed to create redemption: no row returned')
		}),

	getLeaderboard: (limit = 10) =>
		Effect.gen(function* () {
			const db = yield* requireDb.pipe(
				Effect.mapError((e) => new DatabaseError({ message: e.message })),
			)

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
			const db = yield* requireDb.pipe(
				Effect.mapError((e) => new DatabaseError({ message: e.message })),
			)
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
			const db = yield* requireDb.pipe(
				Effect.mapError((e) => new DatabaseError({ message: e.message })),
			)

			const result = yield* Effect.tryPromise({
				try: () => db.select().from(rewards).where(eq(rewards.isActive, true)),
				catch: (e) => new DatabaseError({ message: `Failed to get rewards: ${e}`, cause: e }),
			})

			return result
		}),

	getPointHistory: (userId: number, limit = 20, offset = 0, action?: PointAction) =>
		Effect.gen(function* () {
			const db = yield* requireDb.pipe(
				Effect.mapError((e) => new DatabaseError({ message: e.message })),
			)

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
			const db = yield* requireDb.pipe(
				Effect.mapError((e) => new DatabaseError({ message: e.message })),
			)

			for (const milestone of DEFAULT_MILESTONES) {
				yield* Effect.tryPromise({
					try: () =>
						db
							.insert(milestones)
							.values(milestone)
							.onConflictDoNothing({ target: milestones.name }),
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
