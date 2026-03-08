import {
	boolean,
	index,
	integer,
	pgTable,
	real,
	serial,
	text,
	timestamp,
	uniqueIndex,
	varchar,
} from 'drizzle-orm/pg-core'
import { users } from './users'

// Trader profiles (read-only from TypeScript — Python owns these tables)

export const traderProfiles = pgTable(
	'trader_profiles',
	{
		id: serial('id').primaryKey(),
		userId: integer('user_id')
			.notNull()
			.references(() => users.id),

		// Profile settings
		isPublic: boolean('is_public').default(false),
		displayName: varchar('display_name', { length: 50 }),
		bio: varchar('bio', { length: 255 }),
		avatarEmoji: varchar('avatar_emoji', { length: 10 }).default('🦊'),

		// Performance stats
		totalTrades: integer('total_trades').default(0),
		winningTrades: integer('winning_trades').default(0),
		totalPnlUsd: real('total_pnl_usd').default(0),
		totalVolumeUsd: real('total_volume_usd').default(0),

		// Computed metrics
		winRate: real('win_rate').default(0),
		avgTradeSizeUsd: real('avg_trade_size_usd').default(0),
		bestTradePnlUsd: real('best_trade_pnl_usd').default(0),
		worstTradePnlUsd: real('worst_trade_pnl_usd').default(0),

		// Copy stats
		followerCount: integer('follower_count').default(0),
		timesCopied: integer('times_copied').default(0),
		totalCopyVolumeUsd: real('total_copy_volume_usd').default(0),

		// Ranking
		rankScore: real('rank_score').default(0),

		// Timestamps
		createdAt: timestamp('created_at').defaultNow(),
		updatedAt: timestamp('updated_at').defaultNow(),
	},
	(table) => ({
		userIdIdx: uniqueIndex('trader_profiles_user_id_idx').on(table.userId),
		publicIdx: index('trader_profiles_public_idx').on(table.isPublic),
	}),
)

export type TraderProfile = typeof traderProfiles.$inferSelect

export const copyFollows = pgTable(
	'copy_follows',
	{
		id: serial('id').primaryKey(),
		followerId: integer('follower_id')
			.notNull()
			.references(() => users.id),
		traderId: integer('trader_id')
			.notNull()
			.references(() => users.id),

		// Copy settings
		copyMode: varchar('copy_mode', { length: 20 }).default('notify'),
		copyType: varchar('copy_type', { length: 20 }).default('fixed'),
		copyAmountUsd: real('copy_amount_usd').default(10),
		copyPercentage: real('copy_percentage').default(100),

		// Limits
		maxTradeUsd: real('max_trade_usd').default(100),
		dailyLimitUsd: real('daily_limit_usd').default(500),
		dailyCopiedUsd: real('daily_copied_usd').default(0),
		lastDailyReset: timestamp('last_daily_reset'),

		// Slippage
		maxSlippagePercent: real('max_slippage_percent').default(1),

		// Status
		isActive: boolean('is_active').default(true),

		// Enhanced copy settings
		autoSellEnabled: boolean('auto_sell_enabled').default(true),
		chainsFilter: varchar('chains_filter', { length: 200 }),

		// Stats
		totalCopiedTrades: integer('total_copied_trades').default(0),
		totalCopiedVolume: real('total_copied_volume').default(0),
		totalCopyPnl: real('total_copy_pnl').default(0),

		// Timestamps
		createdAt: timestamp('created_at').defaultNow(),
		updatedAt: timestamp('updated_at').defaultNow(),
	},
	(table) => ({
		followerIdx: index('copy_follows_follower_id_idx').on(table.followerId),
		traderIdx: index('copy_follows_trader_id_idx').on(table.traderId),
		uniqueFollowIdx: uniqueIndex('ix_copy_follows_unique').on(table.followerId, table.traderId),
		traderActiveIdx: index('ix_copy_follows_trader_active').on(table.traderId, table.isActive),
	}),
)

export type CopyFollow = typeof copyFollows.$inferSelect

export const copyTrades = pgTable(
	'copy_trades',
	{
		id: serial('id').primaryKey(),

		// Relationships
		originalSwapId: integer('original_swap_id').notNull(),
		copySwapId: integer('copy_swap_id'),
		traderId: integer('trader_id').notNull(),
		copierId: integer('copier_id').notNull(),
		followId: integer('follow_id').notNull(),

		// Trade details
		fromToken: varchar('from_token', { length: 20 }).notNull(),
		toToken: varchar('to_token', { length: 20 }).notNull(),
		fromChain: varchar('from_chain', { length: 20 }).notNull(),
		toChain: varchar('to_chain', { length: 20 }).notNull(),

		// Amounts
		traderAmountUsd: real('trader_amount_usd').notNull(),
		copyAmountUsd: real('copy_amount_usd').notNull(),

		// Status
		status: varchar('status', { length: 20 }).default('pending'),
		failureReason: varchar('failure_reason', { length: 255 }),

		// PnL tracking
		entryPrice: real('entry_price'),
		exitPrice: real('exit_price'),
		pnlUsd: real('pnl_usd'),

		// Timestamps
		createdAt: timestamp('created_at').defaultNow(),
		copiedAt: timestamp('copied_at'),
	},
	(table) => ({
		copierStatusIdx: index('ix_copy_trades_copier_status').on(table.copierId, table.status),
		originalIdx: index('ix_copy_trades_original').on(table.originalSwapId),
	}),
)

export type CopyTrade = typeof copyTrades.$inferSelect

export const traderTrades = pgTable(
	'trader_trades',
	{
		id: serial('id').primaryKey(),
		traderId: integer('trader_id')
			.notNull()
			.references(() => users.id),
		swapId: integer('swap_id').notNull(),

		// Trade details
		fromToken: varchar('from_token', { length: 20 }).notNull(),
		toToken: varchar('to_token', { length: 20 }).notNull(),
		fromChain: varchar('from_chain', { length: 20 }).notNull(),
		toChain: varchar('to_chain', { length: 20 }).notNull(),
		amountUsd: real('amount_usd').notNull(),

		// PnL
		entryPrice: real('entry_price'),
		currentPrice: real('current_price'),
		isClosed: boolean('is_closed').default(false),
		pnlUsd: real('pnl_usd').default(0),
		pnlPercent: real('pnl_percent').default(0),

		// Result
		isWinning: boolean('is_winning'),

		// Timestamps
		createdAt: timestamp('created_at').defaultNow(),
		closedAt: timestamp('closed_at'),
	},
	(table) => ({
		traderDateIdx: index('ix_trader_trades_trader_date').on(table.traderId, table.createdAt),
	}),
)

export type TraderTrade = typeof traderTrades.$inferSelect
