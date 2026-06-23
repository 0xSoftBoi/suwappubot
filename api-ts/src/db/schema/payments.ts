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

/**
 * Crypto-native agent subscriptions (USDC → time-bound tier).
 *
 * One active row per agent (agentId UNIQUE, upserted on renew). `txHash` is
 * UNIQUE → idempotent on the funding transaction (no double-grant under
 * concurrent requests). The active window is also denormalized onto
 * agents.subscriptionTier / subscriptionExpiresAt for zero-query tier
 * resolution at auth time.
 */
export const agentSubscriptions = pgTable(
	'agent_subscriptions',
	{
		id: serial('id').primaryKey(),
		agentId: integer('agent_id').notNull().unique(),
		tier: varchar('tier', { length: 20 }).notNull(),
		txHash: varchar('tx_hash', { length: 128 }).notNull().unique(),
		chain: varchar('chain', { length: 32 }).default('base').notNull(),
		amountUsd: real('amount_usd').notNull(),
		startedAt: timestamp('started_at').defaultNow().notNull(),
		expiresAt: timestamp('expires_at').notNull(),
		createdAt: timestamp('created_at').defaultNow().notNull(),
	},
	(table) => ({
		agentIdx: index('ix_agent_subscriptions_agent_id').on(table.agentId),
	}),
)

export type AgentSubscription = typeof agentSubscriptions.$inferSelect
export type NewAgentSubscription = typeof agentSubscriptions.$inferInsert

/**
 * Recurring crypto subscriptions via Base Spend Permissions (true auto-renew).
 *
 * Stores the user-signed SpendPermission + signature so the operator can call
 * spend() each period. Created by python-api _ensure_schema (authoritative for
 * shared tables); api-ts only queries it. uint160/uint256 fields (allowance,
 * salt) are stored as decimal strings to avoid int overflow.
 */
export const recurringSubscriptions = pgTable(
	'recurring_subscriptions',
	{
		id: serial('id').primaryKey(),
		userId: integer('user_id'),
		agentId: integer('agent_id'),
		account: varchar('account', { length: 64 }).notNull(),
		spender: varchar('spender', { length: 64 }).notNull(),
		token: varchar('token', { length: 64 }).notNull(),
		allowance: varchar('allowance', { length: 80 }).notNull(),
		periodSeconds: integer('period_seconds').notNull(),
		startTs: integer('start_ts').notNull(),
		endTs: integer('end_ts').notNull(),
		salt: varchar('salt', { length: 80 }).notNull(),
		signature: text('signature').notNull(),
		tier: varchar('tier', { length: 20 }),
		status: varchar('status', { length: 20 }).default('active').notNull(),
		approvedTx: varchar('approved_tx', { length: 128 }),
		nextChargeAt: timestamp('next_charge_at'),
		lastChargeAt: timestamp('last_charge_at'),
		lastChargeTx: varchar('last_charge_tx', { length: 128 }),
		createdAt: timestamp('created_at').defaultNow().notNull(),
		updatedAt: timestamp('updated_at').defaultNow().notNull(),
	},
	(table) => ({
		dueIdx: index('ix_recurring_subscriptions_due').on(table.status, table.nextChargeAt),
	}),
)

export type RecurringSubscription = typeof recurringSubscriptions.$inferSelect
export type NewRecurringSubscription = typeof recurringSubscriptions.$inferInsert
