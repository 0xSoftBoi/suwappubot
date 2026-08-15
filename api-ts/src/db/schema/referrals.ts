import {
	integer,
	pgTable,
	real,
	serial,
	text,
	timestamp,
	uniqueIndex,
	varchar,
} from 'drizzle-orm/pg-core'
import { users } from './users'

// ---------------------------------------------------------------------------
// referrals
// ---------------------------------------------------------------------------

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

	// Multi-stream additions
	// NULL until the service layer confirms the referee passes fraud/activity checks.
	// Only verified referrals count toward milestone thresholds.
	verifiedAt: timestamp('verified_at'),
	// Rolling 14-day perp trading volume for the referee (updated by perps commission service).
	// Determines the volume-tiered commission rate (20%-80%).
	perpsVolume14dUsd: real('perps_volume_14d_usd').default(0),

	// Timestamps
	createdAt: timestamp('created_at').defaultNow(),
})

export type Referral = typeof referrals.$inferSelect
export type NewReferral = typeof referrals.$inferInsert

// ---------------------------------------------------------------------------
// referral_codes
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// referral_rewards  (legacy per-swap table — retained for backward compat)
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// referral_payouts
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// referral_earnings  (multi-stream commission ledger — new)
// ---------------------------------------------------------------------------
// Append-only.  stream_type: 'swap' | 'perps' | 'milestone'
// Negative amount_usd rows represent clawbacks.
// No cap or expiry columns — the system is open-ended by design.

export const referralEarnings = pgTable('referral_earnings', {
	id: serial('id').primaryKey(),

	// Who earns (always set)
	referrerId: integer('referrer_id')
		.notNull()
		.references(() => users.id),

	// Whose activity triggered the earning (NULL for milestone rows)
	referredId: integer('referred_id'),

	// Commission stream: 'swap' | 'perps' | 'milestone'
	streamType: varchar('stream_type', { length: 20 }).notNull(),

	// Credit in USD (positive = credit, negative = clawback)
	amountUsd: real('amount_usd').notNull(),

	// Optional token denomination (e.g. 'USDC'); NULL = USD accounting only
	token: varchar('token', { length: 20 }),

	// Source-event FKs (at most one will be set per row)
	swapId: integer('swap_id'),
	perpOrderId: integer('perp_order_id'),

	// Milestone context — set only when stream_type == 'milestone'
	milestoneCount: integer('milestone_count'),

	// Decimal rate applied; NULL for milestone rows
	commissionRate: real('commission_rate'),

	// Free-form JSON for extra service-layer context
	metadata: text('metadata'),

	createdAt: timestamp('created_at').defaultNow(),
})

export type ReferralEarning = typeof referralEarnings.$inferSelect
export type NewReferralEarning = typeof referralEarnings.$inferInsert

// ---------------------------------------------------------------------------
// referral_milestones  (one row per milestone threshold unlocked — new)
// ---------------------------------------------------------------------------
// The uniqueIndex on (referrer_id, milestone_count) prevents double-crediting.
// No expiry — milestones are permanent once earned.

export const referralMilestones = pgTable(
	'referral_milestones',
	{
		id: serial('id').primaryKey(),

		referrerId: integer('referrer_id')
			.notNull()
			.references(() => users.id),

		// Threshold crossed: 5 | 10 | 20 | 50 | 100 | ... (open-ended)
		milestoneCount: integer('milestone_count').notNull(),

		// Fixed USD bonus amount
		bonusUsd: real('bonus_usd').notNull(),

		earnedAt: timestamp('earned_at').defaultNow(),

		// FK to referral_earnings.id; briefly NULL during write sequencing
		earningId: integer('earning_id').references(() => referralEarnings.id),
	},
	(table) => [
		uniqueIndex('uq_referral_milestones_referrer_count').on(
			table.referrerId,
			table.milestoneCount,
		),
	],
)

export type ReferralMilestone = typeof referralMilestones.$inferSelect
export type NewReferralMilestone = typeof referralMilestones.$inferInsert
