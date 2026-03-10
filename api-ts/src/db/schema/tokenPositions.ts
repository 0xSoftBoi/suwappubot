import {
	integer,
	pgTable,
	real,
	serial,
	timestamp,
	uniqueIndex,
	varchar,
} from 'drizzle-orm/pg-core'

export const tokenPositions = pgTable(
	'token_positions',
	{
		id: serial('id').primaryKey(),
		userId: integer('user_id').notNull(),
		chain: varchar('chain', { length: 50 }).notNull(),
		tokenSymbol: varchar('token_symbol', { length: 20 }).notNull(),
		tokenAddress: varchar('token_address', { length: 100 }).notNull(),
		totalBought: real('total_bought').default(0.0),
		totalSold: real('total_sold').default(0.0),
		totalCostUsd: real('total_cost_usd').default(0.0),
		totalProceedsUsd: real('total_proceeds_usd').default(0.0),
		avgBuyPriceUsd: real('avg_buy_price_usd').default(0.0),
		realizedPnlUsd: real('realized_pnl_usd').default(0.0),
		updatedAt: timestamp('updated_at').defaultNow(),
		createdAt: timestamp('created_at').defaultNow(),
	},
	(table) => [uniqueIndex('uq_token_position').on(table.userId, table.chain, table.tokenAddress)],
)

export type TokenPosition = typeof tokenPositions.$inferSelect
export type NewTokenPosition = typeof tokenPositions.$inferInsert
