import { sql } from 'drizzle-orm'
import { index, integer, pgTable, real, serial, text, timestamp, uniqueIndex, varchar } from 'drizzle-orm/pg-core'
import { users } from './users'

export const swapTransactions = pgTable('swap_transactions', {
	id: serial('id').primaryKey(),
	userId: integer('user_id')
		.notNull()
		.references(() => users.id),

	// Source details
	fromChain: varchar('from_chain', { length: 50 }).notNull(),
	fromToken: varchar('from_token', { length: 20 }).notNull(),
	fromAmount: varchar('from_amount', { length: 78 }).notNull(),
	fromAmountUsd: real('from_amount_usd'),

	// Destination details
	toChain: varchar('to_chain', { length: 50 }).notNull(),
	toToken: varchar('to_token', { length: 20 }).notNull(),
	toAmount: varchar('to_amount', { length: 78 }),
	toAmountUsd: real('to_amount_usd'),

	// Transaction details
	status: varchar('status', { length: 30 }).default('pending'),
	txHash: varchar('tx_hash', { length: 255 }),
	bridgeTxHash: varchar('bridge_tx_hash', { length: 255 }),
	destinationTxHash: varchar('destination_tx_hash', { length: 255 }),

	// Idempotency
	idempotencyKey: varchar('idempotency_key', { length: 128 }),

	// Route info
	routeProvider: varchar('route_provider', { length: 50 }),
	routeData: text('route_data'),

	// Fees
	gasFee: real('gas_fee'),
	bridgeFee: real('bridge_fee'),
	slippage: integer('slippage').default(50),

	// Timing
	createdAt: timestamp('created_at').defaultNow(),
	updatedAt: timestamp('updated_at').defaultNow(),
	completedAt: timestamp('completed_at'),

	// Error handling
	errorMessage: text('error_message'),

	// Agent linkage (nullable -- only set for agent-initiated swaps)
	agentId: integer('agent_id'),
	agentUuid: varchar('agent_uuid', { length: 36 }),
}, (table) => ({
	userIdIdx: index('ix_swap_transactions_user_id').on(table.userId),
	userIdCreatedAtIdx: index('ix_swap_transactions_user_id_created_at').on(table.userId, table.createdAt),
	idempotencyKeyIdx: uniqueIndex('ux_swap_transactions_idempotency_key')
		.on(table.idempotencyKey)
		.where(sql`idempotency_key IS NOT NULL`),
}))

export type SwapTransaction = typeof swapTransactions.$inferSelect
export type NewSwapTransaction = typeof swapTransactions.$inferInsert
