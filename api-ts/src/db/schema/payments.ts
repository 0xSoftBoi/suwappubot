import {
	index,
	integer,
	pgTable,
	real,
	serial,
	text,
	timestamp,
	varchar,
} from 'drizzle-orm/pg-core'

export const x402Payments = pgTable('x402_payments', {
	id: serial('id').primaryKey(),
	userId: integer('user_id').notNull(),
	paymentId: varchar('payment_id', { length: 128 }).notNull().unique(),
	amount: real('amount').notNull(),
	tokenSymbol: varchar('token_symbol', { length: 16 }).default('USDC'),
	tokenAddress: varchar('token_address', { length: 64 }),
	chain: varchar('chain', { length: 32 }).default('base'),
	txHash: varchar('tx_hash', { length: 128 }),
	status: varchar('status', { length: 20 }).default('pending'),
	productType: varchar('product_type', { length: 32 }).notNull(),
	productId: varchar('product_id', { length: 64 }),
	createdAt: timestamp('created_at').defaultNow(),
	completedAt: timestamp('completed_at'),
	receipt: text('receipt'),
	paymentMethod: varchar('payment_method', { length: 32 }).default('crypto'),
	starsAmount: integer('stars_amount'),
})

export const apiCredits = pgTable('api_credits', {
	id: serial('id').primaryKey(),
	userId: integer('user_id').notNull().unique(),
	balance: real('balance').default(0),
	lifetimePurchased: real('lifetime_purchased').default(0),
	lifetimeUsed: real('lifetime_used').default(0),
	createdAt: timestamp('created_at').defaultNow(),
	updatedAt: timestamp('updated_at').defaultNow(),
})

export type X402Payment = typeof x402Payments.$inferSelect
export type NewX402Payment = typeof x402Payments.$inferInsert
export type ApiCredit = typeof apiCredits.$inferSelect
export type NewApiCredit = typeof apiCredits.$inferInsert

/**
 * Agent prepaid API credits (pay-per-call metering for /v1/agent/*).
 *
 * Parallel to `api_credits` (which is keyed by human user_id) — agents have no
 * user_id, so credits are keyed by agent_id. Balance is denominated in CREDITS,
 * where 1 credit ≈ $0.001 USD (see COST_WEIGHTS / CREDIT_USD_VALUE in
 * middleware/x402Payment.ts). Fully additive table; nothing else reads it.
 */
export const agentCredits = pgTable('agent_credits', {
	id: serial('id').primaryKey(),
	agentId: integer('agent_id').notNull().unique(),
	balance: real('balance').default(0).notNull(),
	lifetimePurchased: real('lifetime_purchased').default(0).notNull(),
	lifetimeUsed: real('lifetime_used').default(0).notNull(),
	createdAt: timestamp('created_at').defaultNow().notNull(),
	updatedAt: timestamp('updated_at').defaultNow().notNull(),
})

/**
 * Ledger of on-chain USDC topups that funded agent credits.
 *
 * `txHash` is UNIQUE → enforces idempotency: a topup with a tx hash already
 * present is rejected (no double-credit), even under concurrent requests, via
 * an INSERT ... ON CONFLICT DO NOTHING guard inside a transaction.
 */
export const agentCreditTopups = pgTable(
	'agent_credit_topups',
	{
		id: serial('id').primaryKey(),
		agentId: integer('agent_id').notNull(),
		txHash: varchar('tx_hash', { length: 128 }).notNull().unique(),
		chain: varchar('chain', { length: 32 }).default('base').notNull(),
		amountUsd: real('amount_usd').notNull(),
		creditsAdded: real('credits_added').notNull(),
		createdAt: timestamp('created_at').defaultNow().notNull(),
	},
	(table) => ({
		agentIdx: index('ix_agent_credit_topups_agent_id').on(table.agentId),
	}),
)

export type AgentCredit = typeof agentCredits.$inferSelect
export type NewAgentCredit = typeof agentCredits.$inferInsert
export type AgentCreditTopup = typeof agentCreditTopups.$inferSelect
export type NewAgentCreditTopup = typeof agentCreditTopups.$inferInsert
