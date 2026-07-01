import { integer, pgTable, real, serial, text, timestamp, varchar } from 'drizzle-orm/pg-core'

// On-chain fee-cashback rewards (Rewards v1). These tables are OWNED BY PYTHON —
// created/migrated by database/db.py _create_onchain_rewards_tables(); this file
// is type-only for the read API (never `db:push` them from Drizzle).
//
// Status machines are documented in bot/models/onchain_rewards.py. The read API
// treats them as opaque strings; only Python transitions them.

export const rewardEpochs = pgTable('reward_epochs', {
	id: serial('id').primaryKey(),
	epochIndex: integer('epoch_index').notNull().unique(),
	startsAt: timestamp('starts_at').notNull(),
	endsAt: timestamp('ends_at').notNull(),
	status: varchar('status', { length: 20 }).notNull().default('accruing'),
	totalAmountUsd: real('total_amount_usd').notNull().default(0),
	entryCount: integer('entry_count').notNull().default(0),
	merkleRoot: varchar('merkle_root', { length: 66 }),
	publishedTxHash: varchar('published_tx_hash', { length: 80 }),
	claimDeadline: timestamp('claim_deadline'),
	createdAt: timestamp('created_at').defaultNow(),
	finalizedAt: timestamp('finalized_at'),
	publishedAt: timestamp('published_at'),
})

export const rewardEntries = pgTable('reward_entries', {
	id: serial('id').primaryKey(),
	epochId: integer('epoch_id').notNull(),
	userId: integer('user_id').notNull(),
	cashbackUsd: real('cashback_usd').notNull().default(0),
	carryoverUsd: real('carryover_usd').notNull().default(0),
	amountUsd: real('amount_usd').notNull().default(0),
	feeBasisUsd: real('fee_basis_usd').notNull().default(0),
	claimAddress: varchar('claim_address', { length: 64 }),
	leafIndex: integer('leaf_index'),
	amountBaseUnits: varchar('amount_base_units', { length: 40 }),
	merkleProof: text('merkle_proof'),
	status: varchar('status', { length: 20 }).notNull().default('claimable'),
	claimedTxHash: varchar('claimed_tx_hash', { length: 80 }),
	settledAt: timestamp('settled_at'),
	createdAt: timestamp('created_at').defaultNow(),
})

export type RewardEpoch = typeof rewardEpochs.$inferSelect
export type RewardEntry = typeof rewardEntries.$inferSelect
