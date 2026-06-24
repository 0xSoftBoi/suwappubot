import {
	boolean,
	index,
	integer,
	json,
	pgTable,
	real,
	serial,
	timestamp,
	uniqueIndex,
	varchar,
} from 'drizzle-orm/pg-core'
import { swapTransactions } from './swaps'
import { users } from './users'

// Level definitions.
//
// IMPORTANT: the per-level `fee` field is an ASPIRATIONAL roadmap target, NOT
// the fee actually charged. The charged swap fee is resolved from the user's
// SUBSCRIPTION TIER (FREE/PRO/PREMIUM/ENTERPRISE — 1% / 0.5% / 0.3% / 0.1%),
// which is independent of the XP level. The XP level is NOT wired into any fee
// calculation. Do not present `fee` to users as their active/current rate — it
// is surfaced via PointsService.getUserStats only as a "coming soon" perk.
// Mirrors bot/models/points.py LEVELS (keep the two in sync).
export const LEVELS = {
	bronze: { xp: 0, fee: 0.8, name: 'Bronze', emoji: '🥉' },
	silver: { xp: 1000, fee: 0.7, name: 'Silver', emoji: '🥈' },
	gold: { xp: 5000, fee: 0.6, name: 'Gold', emoji: '🥇' },
	platinum: { xp: 25000, fee: 0.5, name: 'Platinum', emoji: '💎' },
	diamond: { xp: 100000, fee: 0.4, name: 'Diamond', emoji: '👑' },
} as const

export type LevelName = keyof typeof LEVELS

// Point action types
export const POINT_ACTIONS = {
	checkin: { points: 10, description: 'Daily check-in' },
	swap: { points: 1, description: 'Swap (per $10 volume)' },
	first_swap_daily: { points: 50, description: 'First swap of the day bonus' },
	referral_signup: { points: 500, description: 'Referred user signed up' },
	referral_first_swap: { points: 200, description: 'Referred user first swap' },
	twitter_share: { points: 25, description: 'Shared on Twitter' },
	streak_bonus: { points: 5, description: 'Daily streak bonus' },
	level_up: { points: 100, description: 'Level up bonus' },
	milestone: { points: 0, description: 'Milestone achieved' }, // Variable points
	copy_trade: { points: 10, description: 'Copy trade executed' },
	get_copied: { points: 5, description: 'Trade was copied' },
	redemption: { points: 0, description: 'Points redeemed' }, // Negative
} as const

export type PointAction = keyof typeof POINT_ACTIONS

// User points account
export const userPoints = pgTable(
	'user_points',
	{
		id: serial('id').primaryKey(),
		userId: integer('user_id')
			.notNull()
			.references(() => users.id)
			.unique(),

		// Points balance
		totalPointsEarned: integer('total_points_earned').default(0).notNull(),
		currentPoints: integer('current_points').default(0).notNull(),
		pointsSpent: integer('points_spent').default(0).notNull(),

		// XP and level
		xp: integer('xp').default(0).notNull(),
		level: varchar('level', { length: 20 }).default('bronze').notNull(),

		// Streaks
		dailyStreak: integer('daily_streak').default(0).notNull(),
		longestStreak: integer('longest_streak').default(0).notNull(),
		lastCheckin: timestamp('last_checkin'),
		lastSwapDate: timestamp('last_swap_date'),

		// Lifetime stats
		totalSwaps: integer('total_swaps').default(0).notNull(),
		totalVolumeUsd: real('total_volume_usd').default(0.0).notNull(),

		// Timestamps
		createdAt: timestamp('created_at').defaultNow().notNull(),
		updatedAt: timestamp('updated_at').defaultNow().notNull(),
	},
	(table) => ({
		userIdIdx: index('user_points_user_id_idx').on(table.userId),
	}),
)

export type UserPoints = typeof userPoints.$inferSelect
export type NewUserPoints = typeof userPoints.$inferInsert

// Point transaction ledger
export const pointTransactions = pgTable(
	'point_transactions',
	{
		id: serial('id').primaryKey(),
		userId: integer('user_id')
			.notNull()
			.references(() => users.id),

		// Transaction details
		amount: integer('amount').notNull(), // Positive for earn, negative for spend
		action: varchar('action', { length: 50 }).notNull(),
		description: varchar('description', { length: 255 }),

		// Related entities
		swapId: integer('swap_id').references(() => swapTransactions.id),
		referralId: integer('referral_id'),

		// Active season at the time of earn (nullable; audit for convertible points)
		seasonId: integer('season_id'),

		// Extra data
		metadata: json('metadata'),

		// Timestamps
		createdAt: timestamp('created_at').defaultNow().notNull(),
	},
	(table) => ({
		userIdIdx: index('point_transactions_user_id_idx').on(table.userId),
		createdAtIdx: index('point_transactions_created_at_idx').on(table.createdAt),
		userActionIdx: index('point_transactions_user_action_idx').on(table.userId, table.action),
	}),
)

export type PointTransaction = typeof pointTransactions.$inferSelect
export type NewPointTransaction = typeof pointTransactions.$inferInsert

// Milestone definitions
export const milestones = pgTable('milestones', {
	id: serial('id').primaryKey(),
	name: varchar('name', { length: 100 }).notNull().unique(),
	description: varchar('description', { length: 255 }).notNull(),
	emoji: varchar('emoji', { length: 10 }).default('🏆').notNull(),

	// Requirements
	requirementType: varchar('requirement_type', { length: 50 }).notNull(), // swaps, volume, streak, referrals
	requirementValue: integer('requirement_value').notNull(),

	// Reward
	pointsReward: integer('points_reward').default(100).notNull(),

	// Status
	isActive: boolean('is_active').default(true).notNull(),
})

export type Milestone = typeof milestones.$inferSelect
export type NewMilestone = typeof milestones.$inferInsert

// User milestone achievements
export const userMilestones = pgTable(
	'user_milestones',
	{
		id: serial('id').primaryKey(),
		userId: integer('user_id')
			.notNull()
			.references(() => users.id),
		milestoneId: integer('milestone_id')
			.notNull()
			.references(() => milestones.id),

		achievedAt: timestamp('achieved_at').defaultNow().notNull(),
		pointsAwarded: integer('points_awarded').notNull(),
	},
	(table) => ({
		userIdIdx: index('user_milestones_user_id_idx').on(table.userId),
		userMilestoneIdx: uniqueIndex('user_milestones_user_milestone_idx').on(
			table.userId,
			table.milestoneId,
		),
	}),
)

export type UserMilestone = typeof userMilestones.$inferSelect
export type NewUserMilestone = typeof userMilestones.$inferInsert

// Reward store items
export const rewards = pgTable('rewards', {
	id: serial('id').primaryKey(),
	name: varchar('name', { length: 100 }).notNull(),
	description: varchar('description', { length: 255 }).notNull(),
	emoji: varchar('emoji', { length: 10 }).default('🎁').notNull(),

	// Cost
	pointsCost: integer('points_cost').notNull(),

	// Reward details
	rewardType: varchar('reward_type', { length: 50 }).notNull(), // fee_discount, gas_rebate, raffle
	rewardValue: varchar('reward_value', { length: 50 }).notNull(), // e.g., "0.5" for 0.5% fee, "5" for $5 gas

	// own_product|gift_card|travel|merch|donation|crypto|experience — mirrors the
	// Python Reward.reward_category. Routes redemption to a RewardProvider.
	rewardCategory: varchar('reward_category', { length: 30 }).default('own_product').notNull(),

	// Availability
	isActive: boolean('is_active').default(true).notNull(),
	stock: integer('stock'), // NULL = unlimited
	durationDays: integer('duration_days'), // NULL = permanent
})

export type Reward = typeof rewards.$inferSelect
export type NewReward = typeof rewards.$inferInsert

// User reward redemptions
export const pointRedemptions = pgTable(
	'point_redemptions',
	{
		id: serial('id').primaryKey(),
		userId: integer('user_id')
			.notNull()
			.references(() => users.id),

		// What was redeemed
		rewardId: integer('reward_id').references(() => rewards.id),
		pointsSpent: integer('points_spent').notNull(),
		rewardType: varchar('reward_type', { length: 50 }).notNull(),
		rewardValue: varchar('reward_value', { length: 50 }).notNull(),

		// Status
		status: varchar('status', { length: 20 }).default('completed').notNull(), // pending, completed, failed

		// Timestamps
		createdAt: timestamp('created_at').defaultNow().notNull(),
		completedAt: timestamp('completed_at'),
		expiresAt: timestamp('expires_at'), // For temporary rewards
	},
	(table) => ({
		userIdIdx: index('point_redemptions_user_id_idx').on(table.userId),
	}),
)

export type PointRedemption = typeof pointRedemptions.$inferSelect
export type NewPointRedemption = typeof pointRedemptions.$inferInsert

// Default milestones to seed
export const DEFAULT_MILESTONES: Omit<NewMilestone, 'id'>[] = [
	{
		name: 'First Swap',
		description: 'Complete your first swap',
		emoji: '🎉',
		requirementType: 'swaps',
		requirementValue: 1,
		pointsReward: 100,
	},
	{
		name: 'Swap Apprentice',
		description: 'Complete 10 swaps',
		emoji: '📈',
		requirementType: 'swaps',
		requirementValue: 10,
		pointsReward: 250,
	},
	{
		name: 'Swap Master',
		description: 'Complete 50 swaps',
		emoji: '🔥',
		requirementType: 'swaps',
		requirementValue: 50,
		pointsReward: 500,
	},
	{
		name: 'Swap Legend',
		description: 'Complete 100 swaps',
		emoji: '⚡',
		requirementType: 'swaps',
		requirementValue: 100,
		pointsReward: 1000,
	},
	{
		name: 'Volume $100',
		description: 'Trade $100 total volume',
		emoji: '💵',
		requirementType: 'volume',
		requirementValue: 100,
		pointsReward: 100,
	},
	{
		name: 'Volume $1K',
		description: 'Trade $1,000 total volume',
		emoji: '💰',
		requirementType: 'volume',
		requirementValue: 1000,
		pointsReward: 500,
	},
	{
		name: 'Volume $10K',
		description: 'Trade $10,000 total volume',
		emoji: '🤑',
		requirementType: 'volume',
		requirementValue: 10000,
		pointsReward: 1000,
	},
	{
		name: 'Volume $100K',
		description: 'Trade $100,000 total volume',
		emoji: '🏆',
		requirementType: 'volume',
		requirementValue: 100000,
		pointsReward: 5000,
	},
	{
		name: 'Week Streak',
		description: 'Maintain a 7-day streak',
		emoji: '📅',
		requirementType: 'streak',
		requirementValue: 7,
		pointsReward: 200,
	},
	{
		name: 'Month Streak',
		description: 'Maintain a 30-day streak',
		emoji: '🗓️',
		requirementType: 'streak',
		requirementValue: 30,
		pointsReward: 1000,
	},
	{
		name: 'Century Streak',
		description: 'Maintain a 100-day streak',
		emoji: '💯',
		requirementType: 'streak',
		requirementValue: 100,
		pointsReward: 5000,
	},
	{
		name: 'First Referral',
		description: 'Refer your first user',
		emoji: '👥',
		requirementType: 'referrals',
		requirementValue: 1,
		pointsReward: 200,
	},
]

// Default rewards to seed
export const DEFAULT_REWARDS: Omit<NewReward, 'id'>[] = [
	{
		name: 'Fee Discount 0.1%',
		description: '0.1% fee reduction on next swap',
		emoji: '💸',
		pointsCost: 500,
		rewardType: 'fee_discount',
		rewardValue: '0.1',
		durationDays: 7,
	},
	{
		name: 'Fee Discount 0.2%',
		description: '0.2% fee reduction for a week',
		emoji: '💵',
		pointsCost: 1000,
		rewardType: 'fee_discount',
		rewardValue: '0.2',
		durationDays: 7,
	},
	{
		name: 'Gas Rebate $5',
		description: '$5 gas rebate on next swap',
		emoji: '⛽',
		pointsCost: 750,
		rewardType: 'gas_rebate',
		rewardValue: '5',
	},
	{
		name: 'Gas Rebate $10',
		description: '$10 gas rebate on next swap',
		emoji: '🛢️',
		pointsCost: 1400,
		rewardType: 'gas_rebate',
		rewardValue: '10',
	},
	{
		name: 'Raffle Ticket',
		description: 'Entry into weekly prize draw',
		emoji: '🎟️',
		pointsCost: 100,
		rewardType: 'raffle',
		rewardValue: '1',
	},
	// Subscription redemptions — spend the current_points wallet for a tier grant
	// (loyalty rebate on our OWN product; lowest-regulatory-risk redemption). Priced
	// at REDEMPTION_POINTS_PER_USD against the real monthly price. Never touches
	// season points. See docs/economics/REDEMPTION_AND_PARTNERS.md.
	{
		name: '1 Month PRO',
		description: 'Redeem points for 30 days of PRO (0.5% fees)',
		emoji: '🥈',
		pointsCost: 2000, // $9.99 × 200 pts/$
		rewardType: 'subscription',
		rewardValue: 'pro',
		durationDays: 30,
	},
	{
		name: '1 Month PREMIUM',
		description: 'Redeem points for 30 days of PREMIUM (0.3% fees)',
		emoji: '🥇',
		pointsCost: 6000, // $29.99 × 200 pts/$
		rewardType: 'subscription',
		rewardValue: 'premium',
		durationDays: 30,
	},
	{
		name: '1 Month ENTERPRISE',
		description: 'Redeem points for 30 days of ENTERPRISE (0.1% fees)',
		emoji: '👑',
		pointsCost: 20000, // $99.99 × 200 pts/$
		rewardType: 'subscription',
		rewardValue: 'enterprise',
		durationDays: 30,
	},
]

// Redemption pricing: current_points per $1 of redemption value. 200 pts/$ == 1 point
// ≈ $0.005 (0.5¢), conservative vs the ~1¢/point loyalty baseline to limit breakage
// liability. pointsCost = round(price_usd * this). Keep in sync with the Python
// REDEMPTION_POINTS_PER_USD (bot/models/points.py).
export const REDEMPTION_POINTS_PER_USD = 200
