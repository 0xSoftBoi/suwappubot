import {
	boolean,
	index,
	integer,
	pgTable,
	real,
	serial,
	timestamp,
	uniqueIndex,
	varchar,
} from 'drizzle-orm/pg-core'
import { users } from './users'

export const traderStats = pgTable(
	'trader_stats',
	{
		id: serial('id').primaryKey(),
		userId: integer('user_id')
			.notNull()
			.references(() => users.id),

		// Profile
		displayName: varchar('display_name', { length: 50 }),
		isPublic: boolean('is_public').default(false),

		// Performance
		totalTrades: integer('total_trades').default(0),
		winRate: real('win_rate').default(0),
		pnl7d: real('pnl_7d').default(0),
		pnl7dPercent: real('pnl_7d_percent').default(0),
		pnl30d: real('pnl_30d').default(0),
		pnl30dPercent: real('pnl_30d_percent').default(0),

		// Social
		followerCount: integer('follower_count').default(0),
		copierCount: integer('copier_count').default(0),

		// Activity
		lastTradeAt: timestamp('last_trade_at'),

		// Timestamps
		createdAt: timestamp('created_at').defaultNow(),
		updatedAt: timestamp('updated_at').defaultNow(),
	},
	(table) => ({
		userIdIdx: uniqueIndex('trader_stats_user_id_idx').on(table.userId),
		publicIdx: index('trader_stats_public_idx').on(table.isPublic),
	}),
)

export type TraderStats = typeof traderStats.$inferSelect
export type NewTraderStats = typeof traderStats.$inferInsert
