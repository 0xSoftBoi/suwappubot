import {
	index,
	integer,
	pgTable,
	real,
	serial,
	text,
	timestamp,
	unique,
	uniqueIndex,
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
 * Anti-farm guard for the one-time starter-credit grant on POST /v1/agent/register.
 *
 * MONEY-PATH: without this, an attacker can script unlimited registrations to mint
 * free STARTER_CREDITS (AgentService.ts) indefinitely. Keyed by (ip, day) with a
 * per-row counter — cheap, additive, api-ts-exclusive (no python owner). Registration
 * itself is never blocked by this table; only the starter-credit grant is gated on
 * count staying under the daily cap (see AgentService.registerAgent).
 */
export const agentRegistrationGrants = pgTable(
	'agent_registration_grants',
	{
		id: serial('id').primaryKey(),
		ip: varchar('ip', { length: 64 }).notNull(),
		day: varchar('day', { length: 10 }).notNull(), // UTC YYYY-MM-DD
		count: integer('count').default(0).notNull(),
		createdAt: timestamp('created_at').defaultNow().notNull(),
		updatedAt: timestamp('updated_at').defaultNow().notNull(),
	},
	(table) => [uniqueIndex('uq_agent_registration_grants_ip_day').on(table.ip, table.day)],
)

export type AgentRegistrationGrant = typeof agentRegistrationGrants.$inferSelect
export type NewAgentRegistrationGrant = typeof agentRegistrationGrants.$inferInsert

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

/**
 * SHARED consumed-payments ledger — the single global guard against replaying or
 * double-redeeming one on-chain payment (SECURITY: x402 payment replay).
 *
 * Before the ledger existed, three INDEPENDENT unique(tx_hash) constraints
 * (agent_credit_topups, agent_subscriptions, x402_payments) each guarded their
 * OWN table only, so one payment could be redeemed once in EACH table (triple
 * redeem), and mppAuth/internal 402 swap verification had NO persistence at all
 * (unlimited replay). Every redemption path now atomically consumes
 * (chain, tx_hash) here — via INSERT ... ON CONFLICT DO NOTHING inside the same
 * transaction that credits — BEFORE granting anything. A concurrent double-submit
 * loses the race (the unique constraint) instead of double-crediting.
 *
 * api-ts-EXCLUSIVE (no python/SQLAlchemy owner) → registered in drizzle.config
 * tablesFilter so drizzle-kit push creates it.
 */
export const consumedPayments = pgTable(
	'consumed_payments',
	{
		id: serial('id').primaryKey(),
		chain: varchar('chain', { length: 32 }).notNull(),
		txHash: varchar('tx_hash', { length: 128 }).notNull(),
		// Which redemption path consumed it (agent_topup, agent_subscribe,
		// webapp_subscribe, mpp_swap) — audit/debug only; not part of the key.
		purpose: varchar('purpose', { length: 32 }).notNull(),
		// Informational back-reference to the crediting principal (agentId / userId).
		consumedBy: varchar('consumed_by', { length: 64 }),
		createdAt: timestamp('created_at').defaultNow().notNull(),
	},
	(table) => ({
		// The global idempotency key: one payment (chain + txHash) is consumable ONCE.
		chainTxUnique: unique('uq_consumed_payments_chain_tx').on(table.chain, table.txHash),
	}),
)

export type ConsumedPayment = typeof consumedPayments.$inferSelect
export type NewConsumedPayment = typeof consumedPayments.$inferInsert
