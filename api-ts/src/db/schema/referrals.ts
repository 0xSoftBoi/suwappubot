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
