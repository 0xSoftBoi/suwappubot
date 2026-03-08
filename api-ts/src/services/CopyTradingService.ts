import { and, desc, eq, gte, sql } from 'drizzle-orm'
import { Context, Effect, Layer } from 'effect'
import {
	type CopyFollow,
	type CopyTrade,
	copyFollows,
	copyTrades,
	type DrizzleService,
	requireDb,
	type TraderProfile,
	type TraderTrade,
	traderProfiles,
	traderTrades,
	users,
} from '../db'
import { DatabaseError, NotFoundError } from '../errors'

// Response types

export interface TopTraderEntry {
	rank: number
	userId: number
	displayName: string
	avatarEmoji: string
	totalTrades: number
	winRate: number
	totalPnlUsd: number
	totalVolumeUsd: number
	followerCount: number
	timesCopied: number
	rankScore: number
}

export interface TraderProfileDetail {
	profile: {
		userId: number
		displayName: string | null
		avatarEmoji: string | null
		bio: string | null
		isPublic: boolean | null
	}
	stats: {
		totalTrades: number | null
		winningTrades: number | null
		winRate: number | null
		totalPnlUsd: number | null
		totalVolumeUsd: number | null
		avgTradeSizeUsd: number | null
		bestTradePnlUsd: number | null
		worstTradePnlUsd: number | null
	}
	social: {
		followerCount: number | null
		timesCopied: number | null
		totalCopyVolumeUsd: number | null
	}
	recentTrades: {
		fromToken: string
		toToken: string
		fromChain: string
		amountUsd: number
		pnlUsd: number | null
		createdAt: Date | null
	}[]
}

export interface FollowingEntry {
	traderId: number
	displayName: string | null
	avatarEmoji: string | null
	copyMode: string | null
	copyAmountUsd: number | null
	autoSellEnabled: boolean | null
	chainsFilter: string | null
	totalCopiedTrades: number | null
	totalCopyPnl: number | null
	winRate: number | null
	isActive: boolean | null
}

export interface CopyTradeEntry {
	id: number
	traderId: number
	fromToken: string
	toToken: string
	fromChain: string
	toChain: string
	traderAmountUsd: number
	copyAmountUsd: number
	status: string | null
	pnlUsd: number | null
	createdAt: Date | null
}

export interface FollowSettings {
	copyMode?: string
	copyAmountUsd?: number
	maxTradeUsd?: number
	dailyLimitUsd?: number
	autoSellEnabled?: boolean
	chainsFilter?: string | null
}

export interface CopyTradingServiceInterface {
	readonly getTopTraders: (
		limit?: number,
		filters?: { minTrades?: number; minWinRate?: number; chain?: string; sortBy?: string },
	) => Effect.Effect<TopTraderEntry[], DatabaseError, DrizzleService>

	readonly getTraderProfile: (
		userId: number,
	) => Effect.Effect<TraderProfileDetail, DatabaseError | NotFoundError, DrizzleService>

	readonly getFollowing: (
		userId: number,
	) => Effect.Effect<FollowingEntry[], DatabaseError, DrizzleService>

	readonly getCopyTrades: (
		userId: number,
		limit?: number,
		offset?: number,
	) => Effect.Effect<CopyTradeEntry[], DatabaseError, DrizzleService>

	readonly followTrader: (
		followerId: number,
		traderId: number,
		settings: FollowSettings,
	) => Effect.Effect<CopyFollow, DatabaseError | NotFoundError, DrizzleService>

	readonly unfollowTrader: (
		followerId: number,
		traderId: number,
	) => Effect.Effect<void, DatabaseError | NotFoundError, DrizzleService>

	readonly updateCopySettings: (
		followerId: number,
		traderId: number,
		settings: FollowSettings,
	) => Effect.Effect<CopyFollow, DatabaseError | NotFoundError, DrizzleService>
}

export class CopyTradingService extends Context.Tag('CopyTradingService')<
	CopyTradingService,
	CopyTradingServiceInterface
>() {}

export const CopyTradingServiceLive = Layer.succeed(CopyTradingService, {
	getTopTraders: (limit = 10, filters) =>
		Effect.gen(function* () {
			const db = yield* requireDb.pipe(
				Effect.mapError((e) => new DatabaseError({ message: e.message })),
			)

			const conditions = [
				eq(traderProfiles.isPublic, true),
				gte(traderProfiles.totalTrades, filters?.minTrades ?? 5),
			]

			if (filters?.minWinRate != null) {
				conditions.push(gte(traderProfiles.winRate, filters.minWinRate))
			}

			let orderColumn: typeof traderProfiles.rankScore = traderProfiles.rankScore
			if (filters?.sortBy === 'pnl') {
				orderColumn = traderProfiles.totalPnlUsd as unknown as typeof orderColumn
			} else if (filters?.sortBy === 'volume') {
				orderColumn = traderProfiles.totalVolumeUsd as unknown as typeof orderColumn
			} else if (filters?.sortBy === 'followers') {
				orderColumn = traderProfiles.followerCount as unknown as typeof orderColumn
			}

			const result = yield* Effect.tryPromise({
				try: () =>
					db
						.select({
							userId: traderProfiles.userId,
							displayName: traderProfiles.displayName,
							avatarEmoji: traderProfiles.avatarEmoji,
							totalTrades: traderProfiles.totalTrades,
							winRate: traderProfiles.winRate,
							totalPnlUsd: traderProfiles.totalPnlUsd,
							totalVolumeUsd: traderProfiles.totalVolumeUsd,
							followerCount: traderProfiles.followerCount,
							timesCopied: traderProfiles.timesCopied,
							rankScore: traderProfiles.rankScore,
							username: users.username,
						})
						.from(traderProfiles)
						.leftJoin(users, eq(traderProfiles.userId, users.id))
						.where(and(...conditions))
						.orderBy(desc(orderColumn))
						.limit(limit),
				catch: (e) => new DatabaseError({ message: `Failed to get top traders: ${e}`, cause: e }),
			})

			return result.map((row, index) => ({
				rank: index + 1,
				userId: row.userId,
				displayName: row.displayName || row.username || `Trader${row.userId}`,
				avatarEmoji: row.avatarEmoji || '🦊',
				totalTrades: row.totalTrades ?? 0,
				winRate: row.winRate ?? 0,
				totalPnlUsd: row.totalPnlUsd ?? 0,
				totalVolumeUsd: row.totalVolumeUsd ?? 0,
				followerCount: row.followerCount ?? 0,
				timesCopied: row.timesCopied ?? 0,
				rankScore: row.rankScore ?? 0,
			}))
		}),

	getTraderProfile: (userId: number) =>
		Effect.gen(function* () {
			const db = yield* requireDb.pipe(
				Effect.mapError((e) => new DatabaseError({ message: e.message })),
			)

			const profileResult = yield* Effect.tryPromise({
				try: () => db.select().from(traderProfiles).where(eq(traderProfiles.userId, userId)),
				catch: (e) =>
					new DatabaseError({ message: `Failed to get trader profile: ${e}`, cause: e }),
			})

			if (profileResult.length === 0) {
				return yield* Effect.fail(new NotFoundError({ message: 'Trader profile not found' }))
			}

			const p = profileResult[0]

			const recentTradesResult = yield* Effect.tryPromise({
				try: () =>
					db
						.select()
						.from(traderTrades)
						.where(eq(traderTrades.traderId, userId))
						.orderBy(desc(traderTrades.createdAt))
						.limit(5),
				catch: (e) => new DatabaseError({ message: `Failed to get recent trades: ${e}`, cause: e }),
			})

			return {
				profile: {
					userId: p.userId,
					displayName: p.displayName,
					avatarEmoji: p.avatarEmoji,
					bio: p.bio,
					isPublic: p.isPublic,
				},
				stats: {
					totalTrades: p.totalTrades,
					winningTrades: p.winningTrades,
					winRate: p.winRate,
					totalPnlUsd: p.totalPnlUsd,
					totalVolumeUsd: p.totalVolumeUsd,
					avgTradeSizeUsd: p.avgTradeSizeUsd,
					bestTradePnlUsd: p.bestTradePnlUsd,
					worstTradePnlUsd: p.worstTradePnlUsd,
				},
				social: {
					followerCount: p.followerCount,
					timesCopied: p.timesCopied,
					totalCopyVolumeUsd: p.totalCopyVolumeUsd,
				},
				recentTrades: recentTradesResult.map((t) => ({
					fromToken: t.fromToken,
					toToken: t.toToken,
					fromChain: t.fromChain,
					amountUsd: t.amountUsd,
					pnlUsd: t.pnlUsd,
					createdAt: t.createdAt,
				})),
			}
		}),

	getFollowing: (userId: number) =>
		Effect.gen(function* () {
			const db = yield* requireDb.pipe(
				Effect.mapError((e) => new DatabaseError({ message: e.message })),
			)

			const result = yield* Effect.tryPromise({
				try: () =>
					db
						.select({
							traderId: copyFollows.traderId,
							displayName: traderProfiles.displayName,
							avatarEmoji: traderProfiles.avatarEmoji,
							copyMode: copyFollows.copyMode,
							copyAmountUsd: copyFollows.copyAmountUsd,
							autoSellEnabled: copyFollows.autoSellEnabled,
							chainsFilter: copyFollows.chainsFilter,
							totalCopiedTrades: copyFollows.totalCopiedTrades,
							totalCopyPnl: copyFollows.totalCopyPnl,
							winRate: traderProfiles.winRate,
							isActive: copyFollows.isActive,
						})
						.from(copyFollows)
						.innerJoin(traderProfiles, eq(copyFollows.traderId, traderProfiles.userId))
						.where(and(eq(copyFollows.followerId, userId), eq(copyFollows.isActive, true))),
				catch: (e) => new DatabaseError({ message: `Failed to get following: ${e}`, cause: e }),
			})

			return result
		}),

	getCopyTrades: (userId: number, limit = 20, offset = 0) =>
		Effect.gen(function* () {
			const db = yield* requireDb.pipe(
				Effect.mapError((e) => new DatabaseError({ message: e.message })),
			)

			const result = yield* Effect.tryPromise({
				try: () =>
					db
						.select({
							id: copyTrades.id,
							traderId: copyTrades.traderId,
							fromToken: copyTrades.fromToken,
							toToken: copyTrades.toToken,
							fromChain: copyTrades.fromChain,
							toChain: copyTrades.toChain,
							traderAmountUsd: copyTrades.traderAmountUsd,
							copyAmountUsd: copyTrades.copyAmountUsd,
							status: copyTrades.status,
							pnlUsd: copyTrades.pnlUsd,
							createdAt: copyTrades.createdAt,
						})
						.from(copyTrades)
						.where(eq(copyTrades.copierId, userId))
						.orderBy(desc(copyTrades.createdAt))
						.limit(limit)
						.offset(offset),
				catch: (e) => new DatabaseError({ message: `Failed to get copy trades: ${e}`, cause: e }),
			})

			return result
		}),

	followTrader: (followerId: number, traderId: number, settings: FollowSettings) =>
		Effect.gen(function* () {
			const db = yield* requireDb.pipe(
				Effect.mapError((e) => new DatabaseError({ message: e.message })),
			)

			// Check trader has a public profile
			const profileResult = yield* Effect.tryPromise({
				try: () =>
					db
						.select()
						.from(traderProfiles)
						.where(and(eq(traderProfiles.userId, traderId), eq(traderProfiles.isPublic, true))),
				catch: (e) =>
					new DatabaseError({ message: `Failed to check trader profile: ${e}`, cause: e }),
			})

			if (profileResult.length === 0) {
				return yield* Effect.fail(
					new NotFoundError({ message: 'Trader does not have a public profile' }),
				)
			}

			// Check if already following (reactivate if inactive)
			const existingResult = yield* Effect.tryPromise({
				try: () =>
					db
						.select()
						.from(copyFollows)
						.where(and(eq(copyFollows.followerId, followerId), eq(copyFollows.traderId, traderId))),
				catch: (e) =>
					new DatabaseError({ message: `Failed to check existing follow: ${e}`, cause: e }),
			})

			if (existingResult.length > 0) {
				const existing = existingResult[0]
				// Reactivate with new settings
				const updated = yield* Effect.tryPromise({
					try: () =>
						db
							.update(copyFollows)
							.set({
								isActive: true,
								copyMode: settings.copyMode || existing.copyMode,
								copyAmountUsd: settings.copyAmountUsd ?? existing.copyAmountUsd,
								maxTradeUsd: settings.maxTradeUsd ?? existing.maxTradeUsd,
								dailyLimitUsd: settings.dailyLimitUsd ?? existing.dailyLimitUsd,
								autoSellEnabled: settings.autoSellEnabled ?? existing.autoSellEnabled,
								chainsFilter:
									settings.chainsFilter !== undefined
										? settings.chainsFilter
										: existing.chainsFilter,
								updatedAt: new Date(),
							})
							.where(eq(copyFollows.id, existing.id))
							.returning(),
					catch: (e) =>
						new DatabaseError({ message: `Failed to reactivate follow: ${e}`, cause: e }),
				})
				return updated[0]
			}

			// Create new follow
			const created = yield* Effect.tryPromise({
				try: () =>
					db
						.insert(copyFollows)
						.values({
							followerId,
							traderId,
							copyMode: settings.copyMode || 'notify',
							copyAmountUsd: settings.copyAmountUsd ?? 10,
							maxTradeUsd: settings.maxTradeUsd ?? 100,
							dailyLimitUsd: settings.dailyLimitUsd ?? 500,
							autoSellEnabled: settings.autoSellEnabled ?? true,
							chainsFilter: settings.chainsFilter,
						})
						.returning(),
				catch: (e) => new DatabaseError({ message: `Failed to create follow: ${e}`, cause: e }),
			})

			// Increment follower count
			yield* Effect.tryPromise({
				try: () =>
					db
						.update(traderProfiles)
						.set({
							followerCount: sql`${traderProfiles.followerCount} + 1`,
							updatedAt: new Date(),
						})
						.where(eq(traderProfiles.userId, traderId)),
				catch: (e) =>
					new DatabaseError({ message: `Failed to update follower count: ${e}`, cause: e }),
			})

			return created[0]
		}),

	unfollowTrader: (followerId: number, traderId: number) =>
		Effect.gen(function* () {
			const db = yield* requireDb.pipe(
				Effect.mapError((e) => new DatabaseError({ message: e.message })),
			)

			const existingResult = yield* Effect.tryPromise({
				try: () =>
					db
						.select()
						.from(copyFollows)
						.where(
							and(
								eq(copyFollows.followerId, followerId),
								eq(copyFollows.traderId, traderId),
								eq(copyFollows.isActive, true),
							),
						),
				catch: (e) => new DatabaseError({ message: `Failed to check follow: ${e}`, cause: e }),
			})

			if (existingResult.length === 0) {
				return yield* Effect.fail(new NotFoundError({ message: 'Not following this trader' }))
			}

			yield* Effect.tryPromise({
				try: () =>
					db
						.update(copyFollows)
						.set({ isActive: false, updatedAt: new Date() })
						.where(eq(copyFollows.id, existingResult[0].id)),
				catch: (e) => new DatabaseError({ message: `Failed to unfollow: ${e}`, cause: e }),
			})

			// Decrement follower count
			yield* Effect.tryPromise({
				try: () =>
					db
						.update(traderProfiles)
						.set({
							followerCount: sql`GREATEST(${traderProfiles.followerCount} - 1, 0)`,
							updatedAt: new Date(),
						})
						.where(eq(traderProfiles.userId, traderId)),
				catch: (e) =>
					new DatabaseError({ message: `Failed to update follower count: ${e}`, cause: e }),
			})
		}),

	updateCopySettings: (followerId: number, traderId: number, settings: FollowSettings) =>
		Effect.gen(function* () {
			const db = yield* requireDb.pipe(
				Effect.mapError((e) => new DatabaseError({ message: e.message })),
			)

			const existingResult = yield* Effect.tryPromise({
				try: () =>
					db
						.select()
						.from(copyFollows)
						.where(
							and(
								eq(copyFollows.followerId, followerId),
								eq(copyFollows.traderId, traderId),
								eq(copyFollows.isActive, true),
							),
						),
				catch: (e) => new DatabaseError({ message: `Failed to check follow: ${e}`, cause: e }),
			})

			if (existingResult.length === 0) {
				return yield* Effect.fail(new NotFoundError({ message: 'Not following this trader' }))
			}

			const updateData: Record<string, unknown> = { updatedAt: new Date() }
			if (settings.copyMode !== undefined) updateData.copyMode = settings.copyMode
			if (settings.copyAmountUsd !== undefined) updateData.copyAmountUsd = settings.copyAmountUsd
			if (settings.maxTradeUsd !== undefined) updateData.maxTradeUsd = settings.maxTradeUsd
			if (settings.dailyLimitUsd !== undefined) updateData.dailyLimitUsd = settings.dailyLimitUsd
			if (settings.autoSellEnabled !== undefined)
				updateData.autoSellEnabled = settings.autoSellEnabled
			if (settings.chainsFilter !== undefined) updateData.chainsFilter = settings.chainsFilter

			const updated = yield* Effect.tryPromise({
				try: () =>
					db
						.update(copyFollows)
						.set(updateData)
						.where(eq(copyFollows.id, existingResult[0].id))
						.returning(),
				catch: (e) => new DatabaseError({ message: `Failed to update settings: ${e}`, cause: e }),
			})

			return updated[0]
		}),
})
