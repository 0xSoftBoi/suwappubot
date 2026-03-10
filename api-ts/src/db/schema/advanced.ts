import {
	boolean,
	integer,
	pgTable,
	real,
	serial,
	timestamp,
	varchar,
} from 'drizzle-orm/pg-core'

export const swapTemplates = pgTable('swap_templates', {
	id: serial('id').primaryKey(),
	userId: integer('user_id').notNull(),
	name: varchar('name', { length: 50 }).notNull(),
	fromChain: varchar('from_chain', { length: 50 }).notNull(),
	fromToken: varchar('from_token', { length: 20 }).notNull(),
	toChain: varchar('to_chain', { length: 50 }).notNull(),
	toToken: varchar('to_token', { length: 20 }).notNull(),
	defaultAmount: varchar('default_amount', { length: 78 }),
	slippage: real('slippage').default(0.5),
	useCount: integer('use_count').default(0),
	lastUsedAt: timestamp('last_used_at'),
	createdAt: timestamp('created_at').defaultNow(),
})

export const rugMonitors = pgTable('rug_monitors', {
	id: serial('id').primaryKey(),
	userId: integer('user_id').notNull(),
	tokenAddress: varchar('token_address', { length: 255 }).notNull(),
	chain: varchar('chain', { length: 50 }).notNull(),
	tokenSymbol: varchar('token_symbol', { length: 20 }),
	isActive: boolean('is_active').default(true),
	autoSellEnabled: boolean('auto_sell_enabled').default(true),
	createdAt: timestamp('created_at').defaultNow(),
})

export type SwapTemplate = typeof swapTemplates.$inferSelect
export type NewSwapTemplate = typeof swapTemplates.$inferInsert
export type RugMonitor = typeof rugMonitors.$inferSelect
export type NewRugMonitor = typeof rugMonitors.$inferInsert
