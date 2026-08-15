import {
	integer,
	pgEnum,
	pgTable,
	real,
	serial,
	text,
	timestamp,
	varchar,
} from 'drizzle-orm/pg-core'
import { users } from './users'

export const dcaIntervalEnum = pgEnum('dca_interval', ['hourly', 'daily', 'weekly'])

export const dcaOrderStatusEnum = pgEnum('dca_order_status', [
	'active',
	'paused',
	'completed',
	'cancelled',
	'failed',
])

export const dcaOrders = pgTable('dca_orders', {
	id: serial('id').primaryKey(),
	userId: integer('user_id')
		.notNull()
		.references(() => users.id),

	// Token pair
	fromChain: varchar('from_chain', { length: 50 }).notNull(),
	fromToken: varchar('from_token', { length: 42 }).notNull(),
	fromTokenSymbol: varchar('from_token_symbol', { length: 20 }).notNull(),

	toChain: varchar('to_chain', { length: 50 }).notNull(),
	toToken: varchar('to_token', { length: 42 }).notNull(),
	toTokenSymbol: varchar('to_token_symbol', { length: 20 }).notNull(),

	// Execution settings
	amountPerExecution: varchar('amount_per_execution', { length: 78 }).notNull(), // wei string
	interval: dcaIntervalEnum('interval').notNull(),
	totalExecutions: integer('total_executions'), // null = unlimited
	executionsCompleted: integer('executions_completed').default(0),
	maxSlippage: integer('max_slippage').default(50), // basis points
	walletAddress: varchar('wallet_address', { length: 42 }).notNull(),

	// Status tracking
	status: dcaOrderStatusEnum('status').default('active'),
	nextExecutionAt: timestamp('next_execution_at').notNull(),
	lastExecutedAt: timestamp('last_executed_at'),

	// Timestamps
	createdAt: timestamp('created_at').defaultNow(),
	updatedAt: timestamp('updated_at').defaultNow(),
})

export const dcaExecutions = pgTable('dca_executions', {
	id: serial('id').primaryKey(),
	dcaOrderId: integer('dca_order_id')
		.notNull()
		.references(() => dcaOrders.id),
	amountSpent: varchar('amount_spent', { length: 78 }).notNull(),
	amountReceived: varchar('amount_received', { length: 78 }).notNull(),
	price: real('price').notNull(),
	txHash: varchar('tx_hash', { length: 100 }),
	executedAt: timestamp('executed_at').defaultNow(),
})

export type DCAOrder = typeof dcaOrders.$inferSelect
export type NewDCAOrder = typeof dcaOrders.$inferInsert
export type DCAExecution = typeof dcaExecutions.$inferSelect
export type NewDCAExecution = typeof dcaExecutions.$inferInsert
