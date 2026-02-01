import { integer, pgTable, real, serial, text, timestamp, varchar, pgEnum } from 'drizzle-orm/pg-core'
import { users } from './users'

export const limitOrderStatusEnum = pgEnum('limit_order_status', [
	'active',
	'filled',
	'cancelled',
	'expired',
	'failed',
])

export const limitOrders = pgTable('limit_orders', {
	id: serial('id').primaryKey(),
	userId: integer('user_id')
		.notNull()
		.references(() => users.id),

	// Token pair
	fromChain: varchar('from_chain', { length: 50 }).notNull(),
	fromToken: varchar('from_token', { length: 42 }).notNull(), // contract address
	fromTokenSymbol: varchar('from_token_symbol', { length: 20 }).notNull(),
	fromAmount: varchar('from_amount', { length: 78 }).notNull(), // wei string

	toChain: varchar('to_chain', { length: 50 }).notNull(),
	toToken: varchar('to_token', { length: 42 }).notNull(),
	toTokenSymbol: varchar('to_token_symbol', { length: 20 }).notNull(),

	// Price conditions
	targetPrice: real('target_price').notNull(), // target price in USD
	triggerType: varchar('trigger_type', { length: 10 }).notNull().default('lte'), // 'lte' (<=) or 'gte' (>=)
	
	// Execution settings
	slippage: integer('slippage').default(50), // basis points
	walletAddress: varchar('wallet_address', { length: 42 }).notNull(),

	// Status tracking
	status: limitOrderStatusEnum('status').default('active'),
	currentPrice: real('current_price'), // last checked price
	lastCheckedAt: timestamp('last_checked_at'),

	// Execution details (when filled)
	executedAt: timestamp('executed_at'),
	executedPrice: real('executed_price'),
	executedTxHash: varchar('executed_tx_hash', { length: 255 }),
	swapTransactionId: integer('swap_transaction_id'),

	// Error tracking
	errorMessage: text('error_message'),
	retryCount: integer('retry_count').default(0),

	// Timing
	createdAt: timestamp('created_at').defaultNow(),
	updatedAt: timestamp('updated_at').defaultNow(),
	expiresAt: timestamp('expires_at'), // optional expiration
})

export type LimitOrder = typeof limitOrders.$inferSelect
export type NewLimitOrder = typeof limitOrders.$inferInsert
