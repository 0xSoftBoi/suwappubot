/**
 * Community payment-tool schema — Bucket 2.
 *
 * Tables owned by the Python service and created via runtime migration
 * (`_ensure_schema()`).  Drizzle maps them here for type-safe reads/writes
 * from api-ts.  Do NOT run `db:push` / generate a Drizzle migration from
 * these defs — they mirror the Python-created columns exactly.
 *
 * Money amounts use numeric(18, 6) matching the staking / p2p / morpho
 * convention throughout this codebase.
 */

import {
	integer,
	numeric,
	pgTable,
	serial,
	text,
	timestamp,
	uniqueIndex,
	varchar,
} from 'drizzle-orm/pg-core'
import { users } from './users'

// ---------------------------------------------------------------------------
// tips
// ---------------------------------------------------------------------------

export const tips = pgTable('tips', {
	id: serial('id').primaryKey(),

	senderId: integer('sender_id')
		.notNull()
		.references(() => users.id),

	// NULL while tip is unclaimed (recipient not yet registered)
	recipientId: integer('recipient_id').references(() => users.id),
	recipientUsername: varchar('recipient_username', { length: 128 }),

	chatId: varchar('chat_id', { length: 64 }).notNull(),
	token: varchar('token', { length: 20 }).notNull(),
	chain: varchar('chain', { length: 50 }).notNull(),

	// Exact decimal — NUMERIC(18,6) matches money-path convention
	amount: numeric('amount', { precision: 18, scale: 6 }).notNull(),

	txHash: varchar('tx_hash', { length: 128 }),
	// 'pending' | 'claimed' | 'refunded'
	status: varchar('status', { length: 20 }).notNull().default('pending'),

	createdAt: timestamp('created_at').defaultNow(),
	claimedAt: timestamp('claimed_at'),
})

export type Tip = typeof tips.$inferSelect
export type NewTip = typeof tips.$inferInsert

// ---------------------------------------------------------------------------
// lucky_boxes
// ---------------------------------------------------------------------------

export const luckyBoxes = pgTable('lucky_boxes', {
	id: serial('id').primaryKey(),

	creatorId: integer('creator_id')
		.notNull()
		.references(() => users.id),
	chatId: varchar('chat_id', { length: 64 }).notNull(),
	token: varchar('token', { length: 20 }).notNull(),
	chain: varchar('chain', { length: 50 }).notNull(),

	totalAmount: numeric('total_amount', { precision: 18, scale: 6 }).notNull(),
	remainingAmount: numeric('remaining_amount', { precision: 18, scale: 6 }).notNull(),
	totalCount: integer('total_count').notNull(),
	claimedCount: integer('claimed_count').notNull().default(0),

	// 'random' | 'even'
	splitMode: varchar('split_mode', { length: 20 }).notNull().default('random'),
	// 'active' | 'exhausted' | 'expired' | 'refunded'
	status: varchar('status', { length: 20 }).notNull().default('active'),

	expiresAt: timestamp('expires_at').notNull(),
	createdAt: timestamp('created_at').defaultNow(),
})

export type LuckyBox = typeof luckyBoxes.$inferSelect
export type NewLuckyBox = typeof luckyBoxes.$inferInsert

// ---------------------------------------------------------------------------
// lucky_box_claims
// ---------------------------------------------------------------------------
// UNIQUE (lucky_box_id, claimer_id) — nobody claims the same box twice.

export const luckyBoxClaims = pgTable(
	'lucky_box_claims',
	{
		id: serial('id').primaryKey(),

		luckyBoxId: integer('lucky_box_id')
			.notNull()
			.references(() => luckyBoxes.id),
		claimerId: integer('claimer_id')
			.notNull()
			.references(() => users.id),
		amount: numeric('amount', { precision: 18, scale: 6 }).notNull(),
		txHash: varchar('tx_hash', { length: 128 }),
		claimedAt: timestamp('claimed_at').defaultNow(),
	},
	(table) => [
		uniqueIndex('uq_lucky_box_claims_box_claimer').on(table.luckyBoxId, table.claimerId),
	],
)

export type LuckyBoxClaim = typeof luckyBoxClaims.$inferSelect
export type NewLuckyBoxClaim = typeof luckyBoxClaims.$inferInsert

// ---------------------------------------------------------------------------
// split_bills
// ---------------------------------------------------------------------------

export const splitBills = pgTable('split_bills', {
	id: serial('id').primaryKey(),

	creatorId: integer('creator_id')
		.notNull()
		.references(() => users.id),
	chatId: varchar('chat_id', { length: 64 }).notNull(),
	token: varchar('token', { length: 20 }).notNull(),
	chain: varchar('chain', { length: 50 }).notNull(),
	totalAmount: numeric('total_amount', { precision: 18, scale: 6 }).notNull(),
	description: text('description'),
	// 'pending' | 'settled' | 'cancelled'
	status: varchar('status', { length: 20 }).notNull().default('pending'),

	createdAt: timestamp('created_at').defaultNow(),
})

export type SplitBill = typeof splitBills.$inferSelect
export type NewSplitBill = typeof splitBills.$inferInsert

// ---------------------------------------------------------------------------
// split_bill_shares
// ---------------------------------------------------------------------------
// UNIQUE (split_bill_id, debtor_id) — one share entry per debtor per bill.

export const splitBillShares = pgTable(
	'split_bill_shares',
	{
		id: serial('id').primaryKey(),

		splitBillId: integer('split_bill_id')
			.notNull()
			.references(() => splitBills.id),
		debtorId: integer('debtor_id')
			.notNull()
			.references(() => users.id),
		amount: numeric('amount', { precision: 18, scale: 6 }).notNull(),
		// 'pending' | 'paid'
		status: varchar('status', { length: 20 }).notNull().default('pending'),
		paidAt: timestamp('paid_at'),
	},
	(table) => [
		uniqueIndex('uq_split_bill_shares_bill_debtor').on(table.splitBillId, table.debtorId),
	],
)

export type SplitBillShare = typeof splitBillShares.$inferSelect
export type NewSplitBillShare = typeof splitBillShares.$inferInsert

// ---------------------------------------------------------------------------
// airdrop_campaigns
// ---------------------------------------------------------------------------

export const airdropCampaigns = pgTable('airdrop_campaigns', {
	id: serial('id').primaryKey(),

	creatorId: integer('creator_id')
		.notNull()
		.references(() => users.id),
	chatId: varchar('chat_id', { length: 64 }).notNull(),
	token: varchar('token', { length: 20 }).notNull(),
	chain: varchar('chain', { length: 50 }).notNull(),

	totalAmount: numeric('total_amount', { precision: 18, scale: 6 }).notNull(),
	// NULL = variable amount determined at claim time from criteria
	perUserAmount: numeric('per_user_amount', { precision: 18, scale: 6 }),

	// Free-form JSON eligibility rules (e.g. {"min_swaps": 3, "chain": "base"})
	criteria: text('criteria'),
	// 'active' | 'exhausted' | 'expired' | 'cancelled'
	status: varchar('status', { length: 20 }).notNull().default('active'),

	expiresAt: timestamp('expires_at'),
	createdAt: timestamp('created_at').defaultNow(),
})

export type AirdropCampaign = typeof airdropCampaigns.$inferSelect
export type NewAirdropCampaign = typeof airdropCampaigns.$inferInsert

// ---------------------------------------------------------------------------
// airdrop_claims
// ---------------------------------------------------------------------------
// UNIQUE (campaign_id, claimer_id) — nobody claims the same campaign twice.

export const airdropClaims = pgTable(
	'airdrop_claims',
	{
		id: serial('id').primaryKey(),

		campaignId: integer('campaign_id')
			.notNull()
			.references(() => airdropCampaigns.id),
		claimerId: integer('claimer_id')
			.notNull()
			.references(() => users.id),
		amount: numeric('amount', { precision: 18, scale: 6 }).notNull(),
		txHash: varchar('tx_hash', { length: 128 }),
		claimedAt: timestamp('claimed_at').defaultNow(),
	},
	(table) => [
		uniqueIndex('uq_airdrop_claims_campaign_claimer').on(table.campaignId, table.claimerId),
	],
)

export type AirdropClaim = typeof airdropClaims.$inferSelect
export type NewAirdropClaim = typeof airdropClaims.$inferInsert
