import {
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
