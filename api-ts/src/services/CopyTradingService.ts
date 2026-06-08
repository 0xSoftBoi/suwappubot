/**
 * Copy Trading Service
 *
 * Manages copy trading - following traders and mirroring their trades.
 */

import { and, desc, eq, gte, sql } from 'drizzle-orm'
import { Context, Effect, Layer, Option } from 'effect'
import {
	type CopyFollow,
	type CopyTrade,
	copyFollows,
	copyTrades,
	type DrizzleService,
	requireDb,
	requireRow,
	type TraderStats,
	type NewTraderStats,
	traderStats,
	users,
} from '../db'
import { DatabaseError, ValidationError, NotFoundError } from '../errors'

// ============================================================================
// Types
// ============================================================================

export interface TraderLeaderboardEntry {
	userId: number
	displayName: string | null
	username: string | null
	totalTrades: number
	winRate: number
	pnl7d: number
	pnl7dPercent: number
	pnl30d: number
	pnl30dPercent: number
	followerCount: number
	copierCount: number
	lastTradeAt: Date | null
}

export interface TopTraderEntry extends TraderLeaderboardEntry {}

export interface TraderProfileDetail {
	profile: {
		userId: number
		displayName: string | null
		isPublic: boolean
	}
	stats: {
		totalTrades: number
		winRate: number
		pnl7d: number
		pnl30d: number
		followerCount: number
		copierCount: number
	}
}

export interface FollowSettings {
	copyMode?: string
	copyAmountUsd?: number
	maxTradeUsd?: number
	dailyLimitUsd?: number
	autoSellEnabled?: boolean
	chainsFilter?: string | null
}

export interface UpdateCopySettingsParams {
	isActive?: boolean
	copyMode?: string
	copyAmountUsd?: number
	maxTradeUsd?: number
	dailyLimitUsd?: number
	autoSellEnabled?: boolean
	chainsFilter?: string | null
}

export interface FollowTraderParams {
	followerId: number
	traderId: number
	copyMode?: string
	copyAmountUsd?: number
	maxTradeUsd?: number
	dailyLimitUsd?: number
	autoSellEnabled?: boolean
	chainsFilter?: string | null
}

// ============================================================================
// Service Interface
// ============================================================================

export interface CopyTradingServiceInterface {
	readonly getTraderLeaderboard: (
		options?: { limit?: number; minTrades?: number; sortBy?: 'pnl7d' | 'pnl30d' | 'winRate' | 'followers' }
	) => Effect.Effect<TraderLeaderboardEntry[], DatabaseError, DrizzleService>

	readonly getTopTraders: (
		limit?: number,
		filters?: {
			minTrades?: number | undefined
			minWinRate?: number | undefined
			chain?: string | undefined
			sortBy?: string | undefined
		},
	) => Effect.Effect<TopTraderEntry[], DatabaseError, DrizzleService>

	readonly getTraderStats: (
		userId: number
	) => Effect.Effect<Option.Option<TraderStats>, DatabaseError, DrizzleService>

	readonly getTraderProfile: (
		userId: number,
	) => Effect.Effect<TraderProfileDetail, DatabaseError | NotFoundError, DrizzleService>

	readonly followTrader: (
		params: FollowTraderParams
	) => Effect.Effect<CopyFollow, ValidationError | DatabaseError, DrizzleService>

	readonly unfollowTrader: (
		followerId: number,
		traderId: number
	) => Effect.Effect<boolean, DatabaseError, DrizzleService>

	readonly getFollowing: (
		userId: number
	) => Effect.Effect<CopyFollow[], DatabaseError, DrizzleService>

	readonly getFollowers: (
		traderId: number
	) => Effect.Effect<CopyFollow[], DatabaseError, DrizzleService>

	readonly getCopySettings: (
		followerId: number,
		traderId: number
	) => Effect.Effect<Option.Option<CopyFollow>, DatabaseError, DrizzleService>

	readonly updateCopySettings: (
		followerId: number,
		traderId: number,
		settings: UpdateCopySettingsParams
	) => Effect.Effect<CopyFollow, NotFoundError | DatabaseError, DrizzleService>

	readonly updateTraderStats: (
		userId: number,
		stats: Partial<NewTraderStats>
	) => Effect.Effect<TraderStats, DatabaseError, DrizzleService>

	readonly setTraderVisibility: (
		userId: number,
		isPublic: boolean,
		displayName?: string
	) => Effect.Effect<TraderStats, DatabaseError, DrizzleService>

	readonly recordCopyTrade: (
		params: {
			followId: number
			copierId: number
			traderId: number
			originalSwapId: number
			fromToken: string
			toToken: string
			fromChain: string
			toChain: string
			traderAmountUsd: number
			copyAmountUsd: number
			status?: string
		}
	) => Effect.Effect<CopyTrade, DatabaseError, DrizzleService>

	readonly getCopyTrades: (
		copierId: number,
		options?: { traderId?: number; limit?: number }
	) => Effect.Effect<CopyTrade[], DatabaseError, DrizzleService>
}

// ============================================================================
// Service Tag
// ============================================================================

export class CopyTradingService extends Context.Tag('CopyTradingService')<
	CopyTradingService,
	CopyTradingServiceInterface
>() {}

// ============================================================================
// Helpers
// ============================================================================

function coalesceLeaderboardRow(row: {
	userId: number
	displayName: string | null
	username: string | null
	totalTrades: number | null
	winRate: number | null
	pnl7d: number | null
	pnl7dPercent: number | null
	pnl30d: number | null
	pnl30dPercent: number | null
	followerCount: number | null
	copierCount: number | null
	lastTradeAt: Date | null
}): TraderLeaderboardEntry {
	return {
		userId: row.userId,
		displayName: row.displayName,
		username: row.username,
		totalTrades: row.totalTrades ?? 0,
		winRate: row.winRate ?? 0,
		pnl7d: row.pnl7d ?? 0,
		pnl7dPercent: row.pnl7dPercent ?? 0,
		pnl30d: row.pnl30d ?? 0,
		pnl30dPercent: row.pnl30dPercent ?? 0,
		followerCount: row.followerCount ?? 0,
		copierCount: row.copierCount ?? 0,
		lastTradeAt: row.lastTradeAt,
	}
}

// ============================================================================
// Service Implementation
// ============================================================================

export const CopyTradingServiceLive = Layer.succeed(
	CopyTradingService,
	CopyTradingService.of({
		getTraderLeaderboard: (options = {}) =>
			Effect.gen(function* () {
				const db = yield* requireDb
				const { limit = 50, minTrades = 5, sortBy = 'pnl7d' } = options

				const orderByColumn = {
					pnl7d: desc(traderStats.pnl7d),
					pnl30d: desc(traderStats.pnl30d),
					winRate: desc(traderStats.winRate),
					followers: desc(traderStats.followerCount),
				}[sortBy]

				const traders = yield* Effect.tryPromise({
					try: () =>
						db
							.select({
								userId: traderStats.userId,
								displayName: traderStats.displayName,
								username: users.username,
								totalTrades: traderStats.totalTrades,
								winRate: traderStats.winRate,
								pnl7d: traderStats.pnl7d,
								pnl7dPercent: traderStats.pnl7dPercent,
								pnl30d: traderStats.pnl30d,
								pnl30dPercent: traderStats.pnl30dPercent,
								followerCount: traderStats.followerCount,
								copierCount: traderStats.copierCount,
								lastTradeAt: traderStats.lastTradeAt,
							})
							.from(traderStats)
							.innerJoin(users, eq(users.id, traderStats.userId))
							.where(
								and(
									eq(traderStats.isPublic, true),
									gte(traderStats.totalTrades, minTrades)
								)
							)
							.orderBy(orderByColumn)
							.limit(limit),
					catch: (e) => new DatabaseError({ message: `Failed to get leaderboard: ${e}` }),
				})

				return traders.map(coalesceLeaderboardRow)
			}),

		getTopTraders: (limit = 10, filters) =>
			Effect.gen(function* () {
				const db = yield* requireDb

				const sortByMap: Record<string, 'pnl7d' | 'pnl30d' | 'winRate' | 'followers'> = {
					pnl: 'pnl7d',
					winRate: 'winRate',
					followers: 'followers',
				}
				const sortBy = filters?.sortBy ? (sortByMap[filters.sortBy] || 'pnl7d') : 'pnl7d'

				const orderByColumn = {
					pnl7d: desc(traderStats.pnl7d),
					pnl30d: desc(traderStats.pnl30d),
					winRate: desc(traderStats.winRate),
					followers: desc(traderStats.followerCount),
				}[sortBy]

				const traders = yield* Effect.tryPromise({
					try: () =>
						db
							.select({
								userId: traderStats.userId,
								displayName: traderStats.displayName,
								username: users.username,
								totalTrades: traderStats.totalTrades,
								winRate: traderStats.winRate,
								pnl7d: traderStats.pnl7d,
								pnl7dPercent: traderStats.pnl7dPercent,
								pnl30d: traderStats.pnl30d,
								pnl30dPercent: traderStats.pnl30dPercent,
								followerCount: traderStats.followerCount,
								copierCount: traderStats.copierCount,
								lastTradeAt: traderStats.lastTradeAt,
							})
							.from(traderStats)
							.innerJoin(users, eq(users.id, traderStats.userId))
							.where(
								and(
									eq(traderStats.isPublic, true),
									gte(traderStats.totalTrades, filters?.minTrades || 5)
								)
							)
							.orderBy(orderByColumn)
							.limit(limit),
					catch: (e) => new DatabaseError({ message: `Failed to get top traders: ${e}` }),
				})

				return traders.map(coalesceLeaderboardRow)
			}),

		getTraderStats: (userId: number) =>
			Effect.gen(function* () {
				const db = yield* requireDb

				const [stats] = yield* Effect.tryPromise({
					try: () =>
						db
							.select()
							.from(traderStats)
							.where(eq(traderStats.userId, userId))
							.limit(1),
					catch: (e) => new DatabaseError({ message: `Failed to get trader stats: ${e}` }),
				})

				return stats ? Option.some(stats) : Option.none()
			}),

		getTraderProfile: (userId: number) =>
			Effect.gen(function* () {
				const db = yield* requireDb

				const [stats] = yield* Effect.tryPromise({
					try: () =>
						db
							.select()
							.from(traderStats)
							.where(eq(traderStats.userId, userId))
							.limit(1),
					catch: (e) => new DatabaseError({ message: `Failed to get trader profile: ${e}` }),
				})

				if (!stats) {
					return yield* Effect.fail(
						new NotFoundError({ message: 'Trader profile not found' }),
					)
				}

				return {
					profile: {
						userId: stats.userId,
						displayName: stats.displayName,
						isPublic: stats.isPublic ?? false,
					},
					stats: {
						totalTrades: stats.totalTrades ?? 0,
						winRate: stats.winRate ?? 0,
						pnl7d: stats.pnl7d ?? 0,
						pnl30d: stats.pnl30d ?? 0,
						followerCount: stats.followerCount ?? 0,
						copierCount: stats.copierCount ?? 0,
					},
				}
			}),

		followTrader: (params: FollowTraderParams) =>
			Effect.gen(function* () {
				const db = yield* requireDb

				if (params.followerId === params.traderId) {
					return yield* Effect.fail(new ValidationError({ message: 'Cannot follow yourself' }))
				}

				const existing = yield* Effect.tryPromise({
					try: () =>
						db
							.select()
							.from(copyFollows)
							.where(
								and(
									eq(copyFollows.followerId, params.followerId),
									eq(copyFollows.traderId, params.traderId)
								)
							)
							.limit(1),
					catch: (e) => new DatabaseError({ message: `Failed to check existing follow: ${e}` }),
				})

				const current = existing[0]
				if (current) {
					if (!current.isActive) {
						const updatedRows = yield* Effect.tryPromise({
							try: () =>
								db
									.update(copyFollows)
									.set({ isActive: true, updatedAt: new Date() })
									.where(eq(copyFollows.id, current.id))
									.returning(),
							catch: (e) => new DatabaseError({ message: `Failed to reactivate follow: ${e}` }),
						})
						return yield* requireRow(updatedRows, 'Failed to reactivate follow: no row returned')
					}
					return yield* Effect.fail(new ValidationError({ message: 'Already following this trader' }))
				}

				const followRows = yield* Effect.tryPromise({
					try: () =>
						db
							.insert(copyFollows)
							.values({
								followerId: params.followerId,
								traderId: params.traderId,
								copyMode: params.copyMode,
								copyAmountUsd: params.copyAmountUsd,
								maxTradeUsd: params.maxTradeUsd,
								dailyLimitUsd: params.dailyLimitUsd,
								autoSellEnabled: params.autoSellEnabled,
								chainsFilter: params.chainsFilter ?? undefined,
							})
							.returning(),
					catch: (e) => new DatabaseError({ message: `Failed to follow trader: ${e}` }),
				})

				yield* Effect.tryPromise({
					try: () =>
						db
							.update(traderStats)
							.set({
								followerCount: sql`${traderStats.followerCount} + 1`,
								copierCount: sql`${traderStats.copierCount} + 1`,
							})
							.where(eq(traderStats.userId, params.traderId)),
					catch: () => new DatabaseError({ message: 'Failed to update follower count' }),
				})

				const follow = yield* requireRow(followRows, 'Failed to follow trader: no row returned')
				return follow
			}),

		unfollowTrader: (followerId: number, traderId: number) =>
			Effect.gen(function* () {
				const db = yield* requireDb

				const result = yield* Effect.tryPromise({
					try: () =>
						db
							.update(copyFollows)
							.set({ isActive: false, updatedAt: new Date() })
							.where(
								and(
									eq(copyFollows.followerId, followerId),
									eq(copyFollows.traderId, traderId)
								)
							)
							.returning(),
					catch: (e) => new DatabaseError({ message: `Failed to unfollow: ${e}` }),
				})

				if (result.length > 0) {
					yield* Effect.tryPromise({
						try: () =>
							db
								.update(traderStats)
								.set({
									copierCount: sql`GREATEST(${traderStats.copierCount} - 1, 0)`,
								})
								.where(eq(traderStats.userId, traderId)),
						catch: () => new DatabaseError({ message: 'Failed to update follower count' }),
					})
				}

				return result.length > 0
			}),

		getFollowing: (userId: number) =>
			Effect.gen(function* () {
				const db = yield* requireDb

				return yield* Effect.tryPromise({
					try: () =>
						db
							.select()
							.from(copyFollows)
							.where(
								and(
									eq(copyFollows.followerId, userId),
									eq(copyFollows.isActive, true)
								)
							)
							.orderBy(desc(copyFollows.createdAt)),
					catch: (e) => new DatabaseError({ message: `Failed to get following: ${e}` }),
				})
			}),

		getFollowers: (traderId: number) =>
			Effect.gen(function* () {
				const db = yield* requireDb

				return yield* Effect.tryPromise({
					try: () =>
						db
							.select()
							.from(copyFollows)
							.where(
								and(
									eq(copyFollows.traderId, traderId),
									eq(copyFollows.isActive, true)
								)
							)
							.orderBy(desc(copyFollows.createdAt)),
					catch: (e) => new DatabaseError({ message: `Failed to get followers: ${e}` }),
				})
			}),

		getCopySettings: (followerId: number, traderId: number) =>
			Effect.gen(function* () {
				const db = yield* requireDb

				const [follow] = yield* Effect.tryPromise({
					try: () =>
						db
							.select()
							.from(copyFollows)
							.where(
								and(
									eq(copyFollows.followerId, followerId),
									eq(copyFollows.traderId, traderId)
								)
							)
							.limit(1),
					catch: (e) => new DatabaseError({ message: `Failed to get copy settings: ${e}` }),
				})

				if (!follow) return Option.none()
				return Option.some(follow)
			}),

		updateCopySettings: (followerId: number, traderId: number, settings: UpdateCopySettingsParams) =>
			Effect.gen(function* () {
				const db = yield* requireDb

				const [updated] = yield* Effect.tryPromise({
					try: () =>
						db
							.update(copyFollows)
							.set({ ...settings, updatedAt: new Date() })
							.where(
								and(
									eq(copyFollows.followerId, followerId),
									eq(copyFollows.traderId, traderId)
								)
							)
							.returning(),
					catch: (e) => new DatabaseError({ message: `Failed to update settings: ${e}` }),
				})

				if (!updated) {
					return yield* Effect.fail(new NotFoundError({ message: 'Copy follow not found' }))
				}

				return updated
			}),

		updateTraderStats: (userId: number, stats: Partial<NewTraderStats>) =>
			Effect.gen(function* () {
				const db = yield* requireDb

				const [result] = yield* Effect.tryPromise({
					try: () =>
						db
							.insert(traderStats)
							.values({ userId, ...stats })
							.onConflictDoUpdate({
								target: traderStats.userId,
								set: { ...stats, updatedAt: new Date() },
							})
							.returning(),
					catch: (e) => new DatabaseError({ message: `Failed to update trader stats: ${e}` }),
				})

				if (!result) {
					return yield* Effect.fail(
						new DatabaseError({ message: 'Failed to update trader stats: no row returned' }),
					)
				}
				return result
			}),

		setTraderVisibility: (userId: number, isPublic: boolean, displayName?: string) =>
			Effect.gen(function* () {
				const db = yield* requireDb

				const [result] = yield* Effect.tryPromise({
					try: () =>
						db
							.insert(traderStats)
							.values({ userId, isPublic, displayName })
							.onConflictDoUpdate({
								target: traderStats.userId,
								set: { isPublic, displayName, updatedAt: new Date() },
							})
							.returning(),
					catch: (e) => new DatabaseError({ message: `Failed to set visibility: ${e}` }),
				})

				if (!result) {
					return yield* Effect.fail(
						new DatabaseError({ message: 'Failed to set visibility: no row returned' }),
					)
				}
				return result
			}),

		recordCopyTrade: (params) =>
			Effect.gen(function* () {
				const db = yield* requireDb

				const [trade] = yield* Effect.tryPromise({
					try: () =>
						db
							.insert(copyTrades)
							.values({
								followId: params.followId,
								copierId: params.copierId,
								traderId: params.traderId,
								originalSwapId: params.originalSwapId,
								fromToken: params.fromToken,
								toToken: params.toToken,
								fromChain: params.fromChain,
								toChain: params.toChain,
								traderAmountUsd: params.traderAmountUsd,
								copyAmountUsd: params.copyAmountUsd,
								status: params.status ?? 'pending',
							})
							.returning(),
					catch: (e) => new DatabaseError({ message: `Failed to record copy trade: ${e}` }),
				})

				if (params.status === 'executed' || params.status === 'completed') {
					yield* Effect.tryPromise({
						try: () =>
							db
								.update(copyFollows)
								.set({
									totalCopiedTrades: sql`${copyFollows.totalCopiedTrades} + 1`,
									updatedAt: new Date(),
								})
								.where(eq(copyFollows.id, params.followId)),
						catch: () => new DatabaseError({ message: 'Failed to update follow stats' }),
					})
				}

				if (!trade) {
					return yield* Effect.fail(
						new DatabaseError({ message: 'Failed to record copy trade: no row returned' }),
					)
				}
				return trade
			}),

		getCopyTrades: (copierId: number, options = {}) =>
			Effect.gen(function* () {
				const db = yield* requireDb
				const { traderId, limit = 50 } = options

				const conditions = [eq(copyTrades.copierId, copierId)]
				if (traderId) {
					conditions.push(eq(copyTrades.traderId, traderId))
				}

				return yield* Effect.tryPromise({
					try: () =>
						db
							.select()
							.from(copyTrades)
							.where(and(...conditions))
							.orderBy(desc(copyTrades.createdAt))
							.limit(limit),
					catch: (e) => new DatabaseError({ message: `Failed to get copy trades: ${e}` }),
				})
			}),
	})
)
