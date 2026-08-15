import {
	boolean,
	integer,
	numeric,
	pgTable,
	serial,
	timestamp,
	text,
	varchar,
} from 'drizzle-orm/pg-core'

export const perpPositions = pgTable('perp_positions', {
	id: serial('id').primaryKey(),
	userId: integer('user_id').notNull(),
	walletId: integer('wallet_id'),
	exchange: varchar('exchange', { length: 50 }).default('hyperliquid'),
	market: varchar('market', { length: 50 }).notNull(),
	side: varchar('side', { length: 10 }).notNull(),
	size: numeric('size', { precision: 20, scale: 8 }).notNull(),
	entryPrice: numeric('entry_price', { precision: 20, scale: 8 }).notNull(),
	markPrice: numeric('mark_price', { precision: 20, scale: 8 }),
	leverage: integer('leverage').default(1),
	margin: numeric('margin', { precision: 20, scale: 8 }),
	unrealizedPnl: numeric('unrealized_pnl', { precision: 20, scale: 8 }).default('0'),
	liquidationPrice: numeric('liquidation_price', { precision: 20, scale: 8 }),
	tpPrice: numeric('tp_price', { precision: 20, scale: 8 }),
	slPrice: numeric('sl_price', { precision: 20, scale: 8 }),
	status: varchar('status', { length: 20 }).default('open'),
	openedAt: timestamp('opened_at').defaultNow(),
	closedAt: timestamp('closed_at'),
	closedPnl: numeric('closed_pnl', { precision: 20, scale: 8 }),
})

export const perpOrders = pgTable('perp_orders', {
	id: serial('id').primaryKey(),
	userId: integer('user_id').notNull(),
	positionId: integer('position_id'),
	exchange: varchar('exchange', { length: 50 }).default('hyperliquid'),
	market: varchar('market', { length: 50 }).notNull(),
	side: varchar('side', { length: 10 }).notNull(),
	orderType: varchar('order_type', { length: 20 }).notNull(),
	size: numeric('size', { precision: 20, scale: 8 }).notNull(),
	price: numeric('price', { precision: 20, scale: 8 }),
	leverage: integer('leverage').default(1),
	status: varchar('status', { length: 20 }).default('pending'),
	hlOrderId: varchar('hl_order_id', { length: 100 }),
	fillPrice: numeric('fill_price', { precision: 20, scale: 8 }),
	filledAt: timestamp('filled_at'),
	createdAt: timestamp('created_at').defaultNow(),
	updatedAt: timestamp('updated_at').defaultNow(),
})

export const hyperliquidAccounts = pgTable('hyperliquid_accounts', {
	id: serial('id').primaryKey(),
	userId: integer('user_id').notNull().unique(),
	hlAddress: varchar('hl_address', { length: 255 }),
	apiKeyEncrypted: text('api_key_encrypted'),
	apiSecretEncrypted: text('api_secret_encrypted'),
	isActive: boolean('is_active').default(true),
	totalEquity: numeric('total_equity', { precision: 20, scale: 8 }).default('0'),
	availableMargin: numeric('available_margin', { precision: 20, scale: 8 }).default('0'),
	createdAt: timestamp('created_at').defaultNow(),
	updatedAt: timestamp('updated_at').defaultNow(),
})

export type PerpPosition = typeof perpPositions.$inferSelect
export type NewPerpPosition = typeof perpPositions.$inferInsert
export type PerpOrder = typeof perpOrders.$inferSelect
export type NewPerpOrder = typeof perpOrders.$inferInsert
export type HyperliquidAccount = typeof hyperliquidAccounts.$inferSelect
export type NewHyperliquidAccount = typeof hyperliquidAccounts.$inferInsert
