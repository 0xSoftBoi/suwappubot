import {
	boolean,
	integer,
	numeric,
	pgTable,
	real,
	serial,
	timestamp,
	varchar,
} from 'drizzle-orm/pg-core'

export const feeConfig = pgTable('fee_config', {
	id: serial('id').primaryKey(),
	swapFeePercentage: real('swap_fee_percentage').default(1.0),
	minFeeUsd: real('min_fee_usd').default(0.0),
	maxFeeUsd: real('max_fee_usd').default(1000.0),
	feeCollectorChain: varchar('fee_collector_chain', { length: 50 }).default('ethereum'),
	feeCollectorAddress: varchar('fee_collector_address', { length: 100 }),
	isActive: boolean('is_active').default(true),
	createdAt: timestamp('created_at').defaultNow(),
	updatedAt: timestamp('updated_at').defaultNow(),
})

export const feeTransactions = pgTable('fee_transactions', {
	id: serial('id').primaryKey(),
	userId: integer('user_id').notNull(),
	swapId: integer('swap_id'),
	chain: varchar('chain', { length: 50 }).notNull(),
	tokenSymbol: varchar('token_symbol', { length: 20 }).notNull(),
	swapAmount: real('swap_amount').notNull(),
	feePercentage: real('fee_percentage').notNull(),
	feeAmount: real('fee_amount').notNull(),
	feeAmountUsd: real('fee_amount_usd'),
	collected: boolean('collected').default(false),
	createdAt: timestamp('created_at').defaultNow(),
})

export type FeeConfig = typeof feeConfig.$inferSelect
export type NewFeeConfig = typeof feeConfig.$inferInsert
export type FeeTransaction = typeof feeTransactions.$inferSelect
export type NewFeeTransaction = typeof feeTransactions.$inferInsert

export const pointsTiers = pgTable('points_tiers', {
	id: serial('id').primaryKey(),
	userId: integer('user_id').notNull().unique(),
	tier: varchar('tier', { length: 20 }).default('none'),
	qualifyingXp: integer('qualifying_xp').default(0),
	qualifyingVolumeUsd: numeric('qualifying_volume_usd', { precision: 20, scale: 2 }).default('0'),
	accumulatedRewards: numeric('accumulated_rewards', { precision: 20, scale: 8 }).default('0'),
	lastClaimAt: timestamp('last_claim_at'),
	createdAt: timestamp('created_at').defaultNow(),
	updatedAt: timestamp('updated_at').defaultNow(),
})

export const feeDiscounts = pgTable('fee_discounts', {
	id: serial('id').primaryKey(),
	userId: integer('user_id').notNull(),
	discountTier: varchar('discount_tier', { length: 20 }).default('none'),
	discountPercent: real('discount_percent').default(0.0),
	validUntil: timestamp('valid_until'),
	source: varchar('source', { length: 20 }).default('points'),
	createdAt: timestamp('created_at').defaultNow(),
	updatedAt: timestamp('updated_at').defaultNow(),
})

export type PointsTier = typeof pointsTiers.$inferSelect
export type NewPointsTier = typeof pointsTiers.$inferInsert
export type FeeDiscount = typeof feeDiscounts.$inferSelect
export type NewFeeDiscount = typeof feeDiscounts.$inferInsert

export const feeSummaries = pgTable('fee_summaries', {
	id: serial('id').primaryKey(),
	periodType: varchar('period_type', { length: 10 }).notNull(),
	periodDate: varchar('period_date', { length: 10 }).notNull(),
	totalSwaps: integer('total_swaps').default(0),
	totalVolumeUsd: real('total_volume_usd').default(0.0),
	totalFeesUsd: real('total_fees_usd').default(0.0),
	chainBreakdown: varchar('chain_breakdown', { length: 2000 }),
	createdAt: timestamp('created_at').defaultNow(),
	updatedAt: timestamp('updated_at').defaultNow(),
})

export type FeeSummary = typeof feeSummaries.$inferSelect
export type NewFeeSummary = typeof feeSummaries.$inferInsert
