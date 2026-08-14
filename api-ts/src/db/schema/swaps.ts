import { sql } from 'drizzle-orm'
import { boolean, index, integer, numeric, pgTable, real, serial, text, timestamp, uniqueIndex, varchar } from 'drizzle-orm/pg-core'
import { users } from './users'

export const swapTransactions = pgTable('swap_transactions', {
	id: serial('id').primaryKey(),
	userId: integer('user_id')
		.notNull()
		.references(() => users.id),

	// Source details
	fromChain: varchar('from_chain', { length: 50 }).notNull(),
	fromToken: varchar('from_token', { length: 64 }).notNull(),
	fromAmount: varchar('from_amount', { length: 78 }).notNull(),
	fromAmountUsd: real('from_amount_usd'),

	// Destination details
	toChain: varchar('to_chain', { length: 50 }).notNull(),
	toToken: varchar('to_token', { length: 64 }).notNull(),
	toAmount: varchar('to_amount', { length: 78 }),
	toAmountUsd: real('to_amount_usd'),
	// Realized (post-fill) output. Every other amount here is the quote's
	// projection, written before broadcast; these record what actually settled.
	// NULL means "not observed" — never "received nothing". Do not coalesce.
	realizedToAmount: varchar('realized_to_amount', { length: 78 }),
	realizedToAmountUsd: real('realized_to_amount_usd'),

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

	// Cost-basis / PnL columns (nullable — populated at execution time)
	entryPriceUsd: numeric('entry_price_usd', { precision: 20, scale: 8 }),
	toEntryPriceUsd: numeric('to_entry_price_usd', { precision: 20, scale: 8 }),
	gasCostUsd: numeric('gas_cost_usd', { precision: 20, scale: 8 }),
	feeCostUsd: numeric('fee_cost_usd', { precision: 20, scale: 8 }),

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

/**
 * Every route the aggregator offered for a quote — taken or not.
 *
 * EXECUTION INTELLIGENCE (the counterfactual): the quote path previously kept
 * only the executed route (`swapTransactions.routeData`), discarding the
 * alternatives that were in memory at quote time. Without them there is
 * nothing to evaluate a routing decision against — realized cost has no
 * comparison point.
 *
 * Table is created by python-api `_ensure_schema()`
 * (`_create_swap_route_candidates_table`), which is authoritative for tables
 * both stacks write. Drizzle mirrors it for querying and inserts.
 *
 * CAVEAT: any score computed for a route that was NOT taken is a *modeled*
 * counterfactual — the slippage it would really have realized is unknowable.
 * Fine for ranking providers; never surface it as an observed outcome.
 */
export const swapRouteCandidates = pgTable(
	'swap_route_candidates',
	{
		id: serial('id').primaryKey(),

		// Correlates candidates recorded before any swap row exists.
		quoteId: varchar('quote_id', { length: 128 }).notNull(),
		// Backfilled on execution. NULL = quote was never executed.
		swapId: integer('swap_id'),

		userId: integer('user_id'),
		// Set only for agent-originated quotes — the agent-vs-human split.
		agentId: integer('agent_id'),

		// Trade shape, denormalized so cohort queries need no join.
		fromChain: varchar('from_chain', { length: 50 }).notNull(),
		toChain: varchar('to_chain', { length: 50 }).notNull(),
		fromToken: varchar('from_token', { length: 40 }).notNull(),
		toToken: varchar('to_token', { length: 40 }).notNull(),
		fromAmountUsd: real('from_amount_usd'),

		provider: varchar('provider', { length: 50 }),
		tool: varchar('tool', { length: 80 }),
		quotedToAmount: varchar('quoted_to_amount', { length: 78 }),
		quotedToAmountUsd: real('quoted_to_amount_usd'),
		quotedGasUsd: real('quoted_gas_usd'),
		quotedFeeUsd: real('quoted_fee_usd'),
		quotedDurationS: integer('quoted_duration_s'),

		// Rank as the aggregator returned it (0 = its own best).
		rank: integer('rank'),
		wasSelected: boolean('was_selected').default(false).notNull(),
		routeHash: varchar('route_hash', { length: 64 }),

		createdAt: timestamp('created_at').defaultNow().notNull(),
	},
	(table) => ({
		quoteIdx: index('ix_swap_route_candidates_quote_id').on(table.quoteId),
		swapIdx: index('ix_swap_route_candidates_swap_id').on(table.swapId),
		createdIdx: index('ix_swap_route_candidates_created_at').on(table.createdAt),
	}),
)

export type SwapRouteCandidate = typeof swapRouteCandidates.$inferSelect
export type NewSwapRouteCandidate = typeof swapRouteCandidates.$inferInsert
