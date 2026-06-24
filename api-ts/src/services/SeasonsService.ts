import { and, desc, eq, gt, sql } from 'drizzle-orm'
import { Context, Effect, Layer } from 'effect'
import {
	combinedMultiplier,
	DAILY_SEASON_POINT_CAP,
	type DbClient,
	type DrizzleService,
	EMISSION_DECAY_DELTA,
	LEVELS,
	LEVEL_MULTIPLIER,
	type LevelName,
	MIN_SWAP_USD_FOR_SEASON_POINTS,
	PROGRAM_ALLOCATION_PCT,
	REFERRAL_SEASON_ACTIONS,
	REFERRAL_SEASON_POINT_CAP,
	type Season,
	SEASON_COUNT_N,
	SEASON_POINTS_PER_FEE_USD,
	SEASON_POINT_ACTION_ALLOWLIST,
	type SeasonSnapshot,
	TOKEN_MAX_SUPPLY,
	quarterLabelForIndex,
	requireDb,
	seasonInflation,
	seasonPool,
	seasonPoints,
	seasonSnapshots,
	seasons,
	weatherForIndex,
	streakMultiplier,
	userPoints,
	users,
} from '../db'
import { DatabaseError } from '../errors'

// ============================================================================
// Response shapes (camelCase JSON, mirror SEASONS_SPEC.md exactly).
// ============================================================================

export interface SeasonStanding {
	season: {
		id: number
		name: string
		slug: string
		status: string
		seasonIndex: number
		quarter: string
		weather: string
		startsAt: string
		endsAt: string
		tokenPool: number
		tokenSymbol: string
		description: string | null
		daysRemaining: number | null
	} | null
	standing: {
		points: number
		basePoints: number
		rank: number | null
		swapVolumeUsd: number
		referralPoints: number
		feePaidUsd: number
	}
	multiplier: {
		level: number
		streak: number
		combined: number
		levelName: string
	}
	estimatedAllocation: {
		tokens: number
		tokenSymbol: string
		poolShare: number
	}
	emission: {
		seasonIndex: number
		totalSeasons: number
		seasonPoolTokens: number
		poolPctOfSupply: number
		decayPerSeason: number
		programAllocationPct: number
		inflationRate: number | null
		committed: true
	} | null
	totalSeasonPoints: number
}

export interface SeasonLeaderboardEntry {
	rank: number
	userId: number
	username: string | null
	points: number
	estimatedTokens: number
	poolShare: number
}

export interface SeasonHistoryEntry {
	season: {
		id: number
		name: string
		slug: string
		status: string
		seasonIndex: number
		quarter: string
		weather: string
		startsAt: string
		endsAt: string
		tokenPool: number
		tokenSymbol: string
		description: string | null
		daysRemaining: number | null
	}
	snapshot: {
		finalPoints: number
		rank: number | null
		tokenAllocation: number
		tokenSymbol: string
		claimed: boolean
		claimable: boolean
	} | null
}

export interface SeasonsServiceInterface {
	readonly getActiveSeason: () => Effect.Effect<Season | null, DatabaseError, DrizzleService>
	readonly accrueSeasonPoints: (
		userId: number,
		action: string,
		baseAmount: number,
		swapAmountUsd?: number,
		feeUsd?: number,
	) => Effect.Effect<number, DatabaseError, DrizzleService>
	readonly getUserSeasonStanding: (
		userId: number,
	) => Effect.Effect<SeasonStanding, DatabaseError, DrizzleService>
	readonly getSeasonLeaderboard: (
		seasonId: number,
		limit?: number,
	) => Effect.Effect<SeasonLeaderboardEntry[], DatabaseError, DrizzleService>
	readonly settleSeason: (
		seasonId: number,
	) => Effect.Effect<SeasonSnapshot[], DatabaseError, DrizzleService>
	readonly getUserSeasons: (
		userId: number,
	) => Effect.Effect<SeasonHistoryEntry[], DatabaseError, DrizzleService>
}

export class SeasonsService extends Context.Tag('SeasonsService')<
	SeasonsService,
	SeasonsServiceInterface
>() {}

// ============================================================================
// Shared helpers (plain functions on a raw db handle). These are the ONE
// source of truth for the accrual funnel — PointsService imports
// `accrueSeasonPointsRaw` directly to avoid a Layer-level circular dependency
// (PointsService and SeasonsService both live in ServicesLayer with no
// inter-service Tag dependencies).
// ============================================================================

function todayUtc(now: Date = new Date()): string {
	return now.toISOString().slice(0, 10) // 'YYYY-MM-DD'
}

// Resolve the currently active season (status === 'active'), or null.
export async function getActiveSeasonRaw(db: DbClient): Promise<Season | null> {
	const rows = await db
		.select()
		.from(seasons)
		.where(eq(seasons.status, 'active'))
		.orderBy(desc(seasons.startsAt))
		.limit(1)
	return rows[0] ?? null
}

// The accrual funnel — see SEASONS_SPEC.md "Accrual funnel". Returns the float
// season points actually credited (0 if no active season or gated out). This
// NEVER throws for business-rule gating; callers should still wrap the await in
// try/catch (PointsService does via Effect.catchAll) so accrual cannot fail an
// award.
export async function accrueSeasonPointsRaw(
	db: DbClient,
	userId: number,
	action: string,
	baseAmount: number,
	swapAmountUsd?: number,
	feeUsd?: number,
): Promise<number> {
	// 1. active season gate
	const season = await getActiveSeasonRaw(db)
	if (!season || season.status !== 'active') return 0

	// 2. allowlist gate
	if (!SEASON_POINT_ACTION_ALLOWLIST.has(action)) return 0

	// 3. MIN_SWAP gate (only for the volume 'swap' action — still on USD notional)
	const swapUsd = swapAmountUsd ?? 0
	if (action === 'swap' && swapUsd < MIN_SWAP_USD_FOR_SEASON_POINTS) return 0

	// CHANGE 1 — fee-denominated swap points (Tullock-proof). When a fee is known
	// for a swap, base points on FEES PAID, not raw volume. Multiplier still
	// applies afterward. first_swap_daily stays a flat engagement grant.
	let effectiveBase = baseAmount
	if (action === 'swap' && feeUsd != null) {
		effectiveBase = SEASON_POINTS_PER_FEE_USD * feeUsd
	}

	if (effectiveBase <= 0) return 0

	const today = todayUtc()

	// 4. upsert season_points row, reset daily counter on UTC-date rollover.
	// Ensure the row exists first (idempotent on the unique season+user index).
	await db
		.insert(seasonPoints)
		.values({ seasonId: season.id, userId, dailyWindowDate: today })
		.onConflictDoNothing({
			target: [seasonPoints.seasonId, seasonPoints.userId],
		})

	const existingRows = await db
		.select()
		.from(seasonPoints)
		.where(and(eq(seasonPoints.seasonId, season.id), eq(seasonPoints.userId, userId)))
		.limit(1)
	const row = existingRows[0]
	if (!row) return 0

	// Reset daily counter if the stored window date is not today.
	const dailyAwarded = row.dailyWindowDate === today ? row.dailyPointsAwarded : 0

	// 5. multiplier from the user's userPoints level + dailyStreak.
	const upRows = await db
		.select({ level: userPoints.level, dailyStreak: userPoints.dailyStreak })
		.from(userPoints)
		.where(eq(userPoints.userId, userId))
		.limit(1)
	const level = (upRows[0]?.level as LevelName) ?? 'bronze'
	const streak = upRows[0]?.dailyStreak ?? 0
	const multiplier = combinedMultiplier(level, streak)

	// 6. credit = base * multiplier
	let credit = effectiveBase * multiplier

	// 7. daily cap clamp
	credit = Math.min(credit, Math.max(0, DAILY_SEASON_POINT_CAP - dailyAwarded))

	// 8. referral cap clamp
	if (REFERRAL_SEASON_ACTIONS.has(action)) {
		credit = Math.min(credit, Math.max(0, REFERRAL_SEASON_POINT_CAP - row.referralPoints))
	}

	// 9. nothing to credit
	if (credit <= 0) return 0

	// 10. apply accrual atomically via SQL increments (avoids read-modify-write races).
	const newDailyAwarded = dailyAwarded + credit
	const swapVolInc = action === 'swap' ? swapUsd : 0
	const refInc = REFERRAL_SEASON_ACTIONS.has(action) ? credit : 0
	// CHANGE 3 — record realized fees for revenue audit (only on fee-bearing swaps).
	const feeInc = action === 'swap' && feeUsd != null ? feeUsd : 0

	await db
		.update(seasonPoints)
		.set({
			points: sql`${seasonPoints.points} + ${credit}`,
			basePoints: sql`${seasonPoints.basePoints} + ${effectiveBase}`,
			swapVolumeUsd: sql`${seasonPoints.swapVolumeUsd} + ${swapVolInc}`,
			referralPoints: sql`${seasonPoints.referralPoints} + ${refInc}`,
			feePaidUsd: sql`${seasonPoints.feePaidUsd} + ${feeInc}`,
			dailyPointsAwarded: newDailyAwarded,
			dailyWindowDate: today,
			updatedAt: new Date(),
		})
		.where(and(eq(seasonPoints.seasonId, season.id), eq(seasonPoints.userId, userId)))

	// 11. return credited points
	return credit
}

function seasonDto(season: Season) {
	const now = Date.now()
	const ends = season.endsAt.getTime()
	const daysRemaining =
		season.status === 'active' && ends > now
			? Math.ceil((ends - now) / (24 * 60 * 60 * 1000))
			: null
	return {
		id: season.id,
		name: season.name,
		slug: season.slug,
		status: season.status,
		seasonIndex: season.seasonIndex,
		// Official reporting quarter + weather season (Summer/Fall/Winter/Spring).
		quarter: season.quarter ?? quarterLabelForIndex(season.seasonIndex),
		weather: weatherForIndex(season.seasonIndex),
		startsAt: season.startsAt.toISOString(),
		endsAt: season.endsAt.toISOString(),
		tokenPool: season.tokenPool,
		tokenSymbol: season.tokenSymbol,
		description: season.description,
		daysRemaining,
	}
}

// CHANGE 4 — committed emission economics for a given season index.
function emissionBlock(seasonIndex: number): NonNullable<SeasonStanding['emission']> {
	const seasonPoolTokens = seasonPool(seasonIndex)
	// circ_prev = Σ season_pool(1..k-1)
	let circPrev = 0
	for (let j = 1; j < seasonIndex; j++) circPrev += seasonPool(j)
	return {
		seasonIndex,
		totalSeasons: SEASON_COUNT_N,
		seasonPoolTokens,
		poolPctOfSupply: seasonPoolTokens / TOKEN_MAX_SUPPLY,
		decayPerSeason: 1 - EMISSION_DECAY_DELTA,
		programAllocationPct: PROGRAM_ALLOCATION_PCT,
		inflationRate: seasonInflation(seasonIndex, circPrev),
		committed: true,
	}
}

const dbFail = (e: { message: string }) => new DatabaseError({ message: e.message })

export const SeasonsServiceLive = Layer.succeed(SeasonsService, {
	getActiveSeason: () =>
		Effect.gen(function* () {
			const db = yield* requireDb.pipe(Effect.mapError(dbFail))
			return yield* Effect.tryPromise({
				try: () => getActiveSeasonRaw(db),
				catch: (e) => new DatabaseError({ message: `Failed to get active season: ${e}`, cause: e }),
			})
		}),

	accrueSeasonPoints: (userId, action, baseAmount, swapAmountUsd, feeUsd) =>
		Effect.gen(function* () {
			const db = yield* requireDb.pipe(Effect.mapError(dbFail))
			return yield* Effect.tryPromise({
				try: () => accrueSeasonPointsRaw(db, userId, action, baseAmount, swapAmountUsd, feeUsd),
				catch: (e) =>
					new DatabaseError({ message: `Failed to accrue season points: ${e}`, cause: e }),
			})
		}),

	getUserSeasonStanding: (userId) =>
		Effect.gen(function* () {
			const db = yield* requireDb.pipe(Effect.mapError(dbFail))

			const season = yield* Effect.tryPromise({
				try: () => getActiveSeasonRaw(db),
				catch: (e) => new DatabaseError({ message: `Failed to get active season: ${e}`, cause: e }),
			})

			// User's level + streak for the multiplier block (always returned).
			const upRows = yield* Effect.tryPromise({
				try: () =>
					db
						.select({ level: userPoints.level, dailyStreak: userPoints.dailyStreak })
						.from(userPoints)
						.where(eq(userPoints.userId, userId))
						.limit(1),
				catch: (e) => new DatabaseError({ message: `Failed to get user points: ${e}`, cause: e }),
			})
			const level = (upRows[0]?.level as LevelName) ?? 'bronze'
			const streak = upRows[0]?.dailyStreak ?? 0
			const multiplierBlock = {
				level: LEVEL_MULTIPLIER[level] ?? 1.0,
				streak: streakMultiplier(streak),
				combined: combinedMultiplier(level, streak),
				levelName: LEVELS[level].name,
			}

			if (!season) {
				return {
					season: null,
					standing: {
						points: 0,
						basePoints: 0,
						rank: null,
						swapVolumeUsd: 0,
						referralPoints: 0,
						feePaidUsd: 0,
					},
					multiplier: multiplierBlock,
					estimatedAllocation: { tokens: 0, tokenSymbol: 'SUWP', poolShare: 0 },
					emission: null,
					totalSeasonPoints: 0,
				} satisfies SeasonStanding
			}

			// User's standing for this season.
			const spRows = yield* Effect.tryPromise({
				try: () =>
					db
						.select()
						.from(seasonPoints)
						.where(
							and(eq(seasonPoints.seasonId, season.id), eq(seasonPoints.userId, userId)),
						)
						.limit(1),
				catch: (e) =>
					new DatabaseError({ message: `Failed to get season standing: ${e}`, cause: e }),
			})
			const sp = spRows[0]
			const myPoints = sp?.points ?? 0

			// Total season points (denominator) + rank.
			const totalRows = yield* Effect.tryPromise({
				try: () =>
					db
						.select({ total: sql<number>`coalesce(sum(${seasonPoints.points}), 0)` })
						.from(seasonPoints)
						.where(eq(seasonPoints.seasonId, season.id)),
				catch: (e) =>
					new DatabaseError({ message: `Failed to total season points: ${e}`, cause: e }),
			})
			const totalSeasonPoints = Number(totalRows[0]?.total ?? 0)

			let rank: number | null = null
			if (sp && myPoints > 0) {
				const rankRows = yield* Effect.tryPromise({
					try: () =>
						db
							.select({ cnt: sql<number>`count(*)` })
							.from(seasonPoints)
							.where(
								and(
									eq(seasonPoints.seasonId, season.id),
									gt(seasonPoints.points, myPoints),
								),
							),
					catch: (e) => new DatabaseError({ message: `Failed to get rank: ${e}`, cause: e }),
				})
				rank = Number(rankRows[0]?.cnt ?? 0) + 1
			}

			const poolShare = totalSeasonPoints > 0 ? myPoints / totalSeasonPoints : 0
			const tokens = poolShare * season.tokenPool

			return {
				season: seasonDto(season),
				standing: {
					points: myPoints,
					basePoints: sp?.basePoints ?? 0,
					rank,
					swapVolumeUsd: sp?.swapVolumeUsd ?? 0,
					referralPoints: sp?.referralPoints ?? 0,
					feePaidUsd: sp?.feePaidUsd ?? 0,
				},
				multiplier: multiplierBlock,
				estimatedAllocation: {
					tokens,
					tokenSymbol: season.tokenSymbol,
					poolShare,
				},
				emission: emissionBlock(season.seasonIndex),
				totalSeasonPoints,
			} satisfies SeasonStanding
		}),

	getSeasonLeaderboard: (seasonId, limit = 20) =>
		Effect.gen(function* () {
			const db = yield* requireDb.pipe(Effect.mapError(dbFail))

			const seasonRows = yield* Effect.tryPromise({
				try: () => db.select().from(seasons).where(eq(seasons.id, seasonId)).limit(1),
				catch: (e) => new DatabaseError({ message: `Failed to get season: ${e}`, cause: e }),
			})
			const season = seasonRows[0]
			if (!season) return []

			const totalRows = yield* Effect.tryPromise({
				try: () =>
					db
						.select({ total: sql<number>`coalesce(sum(${seasonPoints.points}), 0)` })
						.from(seasonPoints)
						.where(eq(seasonPoints.seasonId, seasonId)),
				catch: (e) =>
					new DatabaseError({ message: `Failed to total season points: ${e}`, cause: e }),
			})
			const total = Number(totalRows[0]?.total ?? 0)

			const rows = yield* Effect.tryPromise({
				try: () =>
					db
						.select({
							userId: seasonPoints.userId,
							points: seasonPoints.points,
							username: users.username,
						})
						.from(seasonPoints)
						.leftJoin(users, eq(seasonPoints.userId, users.id))
						.where(and(eq(seasonPoints.seasonId, seasonId), gt(seasonPoints.points, 0)))
						.orderBy(desc(seasonPoints.points))
						.limit(limit),
				catch: (e) =>
					new DatabaseError({ message: `Failed to get season leaderboard: ${e}`, cause: e }),
			})

			return rows.map((r, idx) => {
				const poolShare = total > 0 ? r.points / total : 0
				return {
					rank: idx + 1,
					userId: r.userId,
					username: r.username,
					points: r.points,
					estimatedTokens: poolShare * season.tokenPool,
					poolShare,
				}
			})
		}),

	settleSeason: (seasonId) =>
		Effect.gen(function* () {
			const db = yield* requireDb.pipe(Effect.mapError(dbFail))

			// 1. Load season; if already settled, return existing snapshots (idempotent).
			const seasonRows = yield* Effect.tryPromise({
				try: () => db.select().from(seasons).where(eq(seasons.id, seasonId)).limit(1),
				catch: (e) => new DatabaseError({ message: `Failed to load season: ${e}`, cause: e }),
			})
			const season = seasonRows[0]
			if (!season) {
				return yield* Effect.fail(new DatabaseError({ message: `Season ${seasonId} not found` }))
			}

			if (season.status === 'settled') {
				return yield* Effect.tryPromise({
					try: () =>
						db
							.select()
							.from(seasonSnapshots)
							.where(eq(seasonSnapshots.seasonId, seasonId))
							.orderBy(seasonSnapshots.rank),
					catch: (e) =>
						new DatabaseError({ message: `Failed to load snapshots: ${e}`, cause: e }),
				})
			}

			// 2. total denominator = SUM(points) where points > 0.
			const standings = yield* Effect.tryPromise({
				try: () =>
					db
						.select({ userId: seasonPoints.userId, points: seasonPoints.points })
						.from(seasonPoints)
						.where(and(eq(seasonPoints.seasonId, seasonId), gt(seasonPoints.points, 0)))
						.orderBy(desc(seasonPoints.points)),
				catch: (e) =>
					new DatabaseError({ message: `Failed to load standings: ${e}`, cause: e }),
			})
			const total = standings.reduce((acc, s) => acc + s.points, 0)

			// 3. set season.total_points_snapshot.
			yield* Effect.tryPromise({
				try: () =>
					db
						.update(seasons)
						.set({ totalPointsSnapshot: total, updatedAt: new Date() })
						.where(eq(seasons.id, seasonId)),
				catch: (e) =>
					new DatabaseError({ message: `Failed to set total snapshot: ${e}`, cause: e }),
			})

			// 4. insert immutable snapshots (idempotent via ON CONFLICT DO NOTHING).
			//    allocations sum to <= token_pool by construction (sum of shares = 1).
			for (let i = 0; i < standings.length; i++) {
				const s = standings[i]
				if (!s) continue
				const allocation = total > 0 ? (s.points / total) * season.tokenPool : 0
				yield* Effect.tryPromise({
					try: () =>
						db
							.insert(seasonSnapshots)
							.values({
								seasonId,
								userId: s.userId,
								finalPoints: s.points,
								rank: i + 1,
								totalPoints: total,
								tokenPool: season.tokenPool,
								tokenAllocation: allocation,
								tokenSymbol: season.tokenSymbol,
							})
							.onConflictDoNothing({
								target: [seasonSnapshots.seasonId, seasonSnapshots.userId],
							}),
					catch: (e) =>
						new DatabaseError({ message: `Failed to insert snapshot: ${e}`, cause: e }),
				})
			}

			// CHANGE 3 — realized fee revenue = SUM(fee_paid_usd) before marking settled.
			const feeRevRows = yield* Effect.tryPromise({
				try: () =>
					db
						.select({ total: sql<number>`coalesce(sum(${seasonPoints.feePaidUsd}), 0)` })
						.from(seasonPoints)
						.where(eq(seasonPoints.seasonId, seasonId)),
				catch: (e) =>
					new DatabaseError({ message: `Failed to total fee revenue: ${e}`, cause: e }),
			})
			const realizedFeeRevenueUsd = Number(feeRevRows[0]?.total ?? 0)

			// 5. mark settled.
			yield* Effect.tryPromise({
				try: () =>
					db
						.update(seasons)
						.set({
							status: 'settled',
							settledAt: new Date(),
							realizedFeeRevenueUsd,
							updatedAt: new Date(),
						})
						.where(eq(seasons.id, seasonId)),
				catch: (e) => new DatabaseError({ message: `Failed to mark settled: ${e}`, cause: e }),
			})

			return yield* Effect.tryPromise({
				try: () =>
					db
						.select()
						.from(seasonSnapshots)
						.where(eq(seasonSnapshots.seasonId, seasonId))
						.orderBy(seasonSnapshots.rank),
				catch: (e) =>
					new DatabaseError({ message: `Failed to load snapshots: ${e}`, cause: e }),
			})
		}),

	getUserSeasons: (userId) =>
		Effect.gen(function* () {
			const db = yield* requireDb.pipe(Effect.mapError(dbFail))

			const allSeasons = yield* Effect.tryPromise({
				try: () => db.select().from(seasons).orderBy(desc(seasons.startsAt)),
				catch: (e) => new DatabaseError({ message: `Failed to list seasons: ${e}`, cause: e }),
			})

			const mySnapshots = yield* Effect.tryPromise({
				try: () =>
					db.select().from(seasonSnapshots).where(eq(seasonSnapshots.userId, userId)),
				catch: (e) =>
					new DatabaseError({ message: `Failed to list my snapshots: ${e}`, cause: e }),
			})
			const snapBySeason = new Map<number, SeasonSnapshot>()
			for (const snap of mySnapshots) snapBySeason.set(snap.seasonId, snap)

			return allSeasons.map((season) => {
				const snap = snapBySeason.get(season.id)
				return {
					season: seasonDto(season),
					snapshot: snap
						? {
								finalPoints: snap.finalPoints,
								rank: snap.rank,
								tokenAllocation: snap.tokenAllocation,
								tokenSymbol: snap.tokenSymbol,
								claimed: snap.claimed,
								// Claim opens post-TGE — always false pre-launch.
								claimable: false,
							}
						: null,
				} satisfies SeasonHistoryEntry
			})
		}),
})
