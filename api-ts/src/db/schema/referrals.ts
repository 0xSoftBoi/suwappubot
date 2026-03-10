import { integer, pgTable, real, serial, timestamp, varchar } from 'drizzle-orm/pg-core'
import { users } from './users'

export const referrals = pgTable('referrals', {
	id: serial('id').primaryKey(),
	referrerId: integer('referrer_id')
		.notNull()
		.references(() => users.id),
	referredId: integer('referred_id')
		.notNull()
		.references(() => users.id),
	referralCode: varchar('referral_code', { length: 50 }).notNull().unique(),
	status: varchar('status', { length: 20 }).notNull().default('pending'), // 'pending', 'active', 'rewarded'
	rewardAmount: real('reward_amount'),

	// Timestamps
	createdAt: timestamp('created_at').defaultNow(),
})

export type Referral = typeof referrals.$inferSelect
export type NewReferral = typeof referrals.$inferInsert

export const referralCodes = pgTable('referral_codes', {
	id: serial('id').primaryKey(),
	userId: integer('user_id')
		.notNull()
		.unique()
		.references(() => users.id),
	code: varchar('code', { length: 50 }).notNull().unique(),
	totalReferrals: integer('total_referrals').default(0),
	totalRewards: real('total_rewards').default(0),

	// Timestamps
	createdAt: timestamp('created_at').defaultNow(),
})

export type ReferralCode = typeof referralCodes.$inferSelect
export type NewReferralCode = typeof referralCodes.$inferInsert

export const referralRewards = pgTable('referral_rewards', {
	id: serial('id').primaryKey(),
	referralId: integer('referral_id')
		.notNull()
		.references(() => referrals.id),
	swapId: integer('swap_id').notNull().unique(),
	feeAmountUsd: real('fee_amount_usd').notNull(),
	rewardAmountUsd: real('reward_amount_usd').notNull(),
	tier: varchar('tier', { length: 20 }).default('tier_1'),
	rewardPercentage: real('reward_percentage').default(30.0),
	status: varchar('status', { length: 20 }).default('pending'),
	createdAt: timestamp('created_at').defaultNow(),
})

export type ReferralReward = typeof referralRewards.$inferSelect
export type NewReferralReward = typeof referralRewards.$inferInsert

export const referralPayouts = pgTable('referral_payouts', {
	id: serial('id').primaryKey(),
	userId: integer('user_id').notNull(),
	amountUsd: real('amount_usd').notNull(),
	token: varchar('token', { length: 20 }).notNull(),
	tokenAmount: varchar('token_amount', { length: 78 }).notNull(),
	chain: varchar('chain', { length: 50 }).notNull(),
	txHash: varchar('tx_hash', { length: 128 }),
	status: varchar('status', { length: 20 }).default('pending'),
	createdAt: timestamp('created_at').defaultNow(),
	completedAt: timestamp('completed_at'),
	errorMessage: varchar('error_message', { length: 500 }),
})

export type ReferralPayout = typeof referralPayouts.$inferSelect
export type NewReferralPayout = typeof referralPayouts.$inferInsert
