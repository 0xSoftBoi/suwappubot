/**
 * Copy Trading Service
 * 
 * Manages copy trading - following traders and mirroring their trades.
 */

import { Context, Effect, Layer, Option } from 'effect'
import { eq, and, desc, sql, gte } from 'drizzle-orm'
import { 
	DrizzleService, 
	requireDb, 
	traderStats,
	copyFollows,
	copyTrades,
	users,
	type TraderStats, 
	type NewTraderStats,
	type CopyFollow,
	type NewCopyFollow,
	type CopyTrade,
	type NewCopyTrade
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

export interface CopySettings {
	traderId: number
	walletId: number
	isActive: boolean
	maxAmountPerTrade: number | null
	totalBudget: number | null
	usedBudget: number
	stopLossPercent: number | null
	takeProfitPercent: number | null
	minTradeSize: number | null
	copyBuysOnly: boolean
	copySellsOnly: boolean
	totalCopiedTrades: number
	totalPnl: number
}

export interface FollowTraderParams {
	followerId: number
	traderId: number
	walletId: number
	maxAmountPerTrade?: number
	totalBudget?: number
	stopLossPercent?: number
	takeProfitPercent?: number
	minTradeSize?: number
	copyBuysOnly?: boolean
	copySellsOnly?: boolean
}

export interface UpdateCopySettingsParams {
	isActive?: boolean
	maxAmountPerTrade?: number | null
	totalBudget?: number | null
	stopLossPercent?: number | null
	takeProfitPercent?: number | null
	minTradeSize?: number | null
	copyBuysOnly?: boolean
	copySellsOnly?: boolean
}

// ============================================================================
// Service Interface
// ============================================================================

export interface CopyTradingServiceInterface {
	// Leaderboard
	readonly getTraderLeaderboard: (
		options?: { limit?: number; minTrades?: number; sortBy?: 'pnl7d' | 'pnl30d' | 'winRate' | 'followers' }
	) => Effect.Effect<TraderLeaderboardEntry[], DatabaseError, DrizzleService>

	readonly getTraderStats: (
		userId: number
	) => Effect.Effect<Option.Option<TraderStats>, DatabaseError, DrizzleService>

	// Following
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
	) => Effect.Effect<Option.Option<CopySettings>, DatabaseError, DrizzleService>

	readonly updateCopySettings: (
		followerId: number,
		traderId: number,
		settings: UpdateCopySettingsParams
	) => Effect.Effect<CopyFollow, NotFoundError | DatabaseError, DrizzleService>

	// Stats management
	readonly updateTraderStats: (
		userId: number,
		stats: Partial<NewTraderStats>
	) => Effect.Effect<TraderStats, DatabaseError, DrizzleService>

	readonly setTraderVisibility: (
		userId: number,
		isPublic: boolean,
		displayName?: string
	) => Effect.Effect<TraderStats, DatabaseError, DrizzleService>

	// Copy execution
	readonly recordCopyTrade: (
		params: {
			copyFollowId: number
			followerId: number
			traderId: number
			originalSwapId?: number
			fromToken: string
			toToken: string
			fromAmount: string
			toAmount?: string
			status: string
			txHash?: string
			traderPrice?: number
			copierPrice?: number
			slippage?: number
		}
	) => Effect.Effect<CopyTrade, DatabaseError, DrizzleService>

	readonly getCopyTrades: (
		followerId: number,
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

				return traders
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

		followTrader: (params: FollowTraderParams) =>
			Effect.gen(function* () {
				const db = yield* requireDb

				// Can't follow yourself
				if (params.followerId === params.traderId) {
					throw new ValidationError({ message: 'Cannot follow yourself' })
				}

				// Check if already following
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

				if (existing.length > 0) {
					// Reactivate if inactive
					if (!existing[0].isActive) {
						const [updated] = yield* Effect.tryPromise({
							try: () =>
								db
									.update(copyFollows)
									.set({ isActive: true, updatedAt: new Date() })
									.where(eq(copyFollows.id, existing[0].id))
									.returning(),
							catch: (e) => new DatabaseError({ message: `Failed to reactivate follow: ${e}` }),
						})
						return updated
					}
					throw new ValidationError({ message: 'Already following this trader' })
				}

				const [follow] = yield* Effect.tryPromise({
					try: () =>
						db
							.insert(copyFollows)
							.values({
								followerId: params.followerId,
								traderId: params.traderId,
								walletId: params.walletId,
								maxAmountPerTrade: params.maxAmountPerTrade,
								totalBudget: params.totalBudget,
								stopLossPercent: params.stopLossPercent,
								takeProfitPercent: params.takeProfitPercent,
								minTradeSize: params.minTradeSize,
								copyBuysOnly: params.copyBuysOnly ?? false,
								copySellsOnly: params.copySellsOnly ?? false,
							})
							.returning(),
					catch: (e) => new DatabaseError({ message: `Failed to follow trader: ${e}` }),
				})

				// Update follower count
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
					// Update follower count
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

				return Option.some({
					traderId: follow.traderId,
					walletId: follow.walletId,
					isActive: follow.isActive ?? true,
					maxAmountPerTrade: follow.maxAmountPerTrade,
					totalBudget: follow.totalBudget,
					usedBudget: follow.usedBudget ?? 0,
					stopLossPercent: follow.stopLossPercent,
					takeProfitPercent: follow.takeProfitPercent,
					minTradeSize: follow.minTradeSize,
					copyBuysOnly: follow.copyBuysOnly ?? false,
					copySellsOnly: follow.copySellsOnly ?? false,
					totalCopiedTrades: follow.totalCopiedTrades ?? 0,
					totalPnl: follow.totalPnl ?? 0,
				})
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
					throw new NotFoundError({ message: 'Copy follow not found' })
				}

				return updated
			}),

		updateTraderStats: (userId: number, stats: Partial<NewTraderStats>) =>
			Effect.gen(function* () {
				const db = yield* requireDb

				// Upsert trader stats
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
								copyFollowId: params.copyFollowId,
								followerId: params.followerId,
								traderId: params.traderId,
								originalSwapId: params.originalSwapId,
								fromToken: params.fromToken,
								toToken: params.toToken,
								fromAmount: params.fromAmount,
								toAmount: params.toAmount,
								status: params.status,
								txHash: params.txHash,
								traderPrice: params.traderPrice,
								copierPrice: params.copierPrice,
								slippage: params.slippage,
								executedAt: params.status === 'executed' ? new Date() : undefined,
							})
							.returning(),
					catch: (e) => new DatabaseError({ message: `Failed to record copy trade: ${e}` }),
				})

				// Update follow stats
				if (params.status === 'executed') {
					yield* Effect.tryPromise({
						try: () =>
							db
								.update(copyFollows)
								.set({
									totalCopiedTrades: sql`${copyFollows.totalCopiedTrades} + 1`,
									updatedAt: new Date(),
								})
								.where(eq(copyFollows.id, params.copyFollowId)),
						catch: () => new DatabaseError({ message: 'Failed to update follow stats' }),
					})
				}

				return trade
			}),

		getCopyTrades: (followerId: number, options = {}) =>
			Effect.gen(function* () {
				const db = yield* requireDb
				const { traderId, limit = 50 } = options

				const conditions = [eq(copyTrades.followerId, followerId)]
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
