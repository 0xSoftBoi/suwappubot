import { index, integer, numeric, pgTable, serial, timestamp, varchar } from 'drizzle-orm/pg-core'
import { users } from './users'

export const tokenClaims = pgTable('token_claims', {
	id: serial('id').primaryKey(),
	userId: integer('user_id').notNull().references(() => users.id),
	walletAddress: varchar('wallet_address', { length: 42 }).notNull(),
	pointsBurned: integer('points_burned').notNull(),
	suwpAmount: numeric('suwp_amount', { precision: 18, scale: 6 }).notNull(),
	status: varchar('status', { length: 20 }).default('pending'), // pending/processing/completed/failed
	txHash: varchar('tx_hash', { length: 255 }),
	errorMessage: varchar('error_message', { length: 500 }),
	createdAt: timestamp('created_at').defaultNow(),
	completedAt: timestamp('completed_at'),
}, (table) => ({
	userIdIdx: index('ix_token_claims_user_id').on(table.userId),
	statusIdx: index('ix_token_claims_status').on(table.status),
}))

export type TokenClaim = typeof tokenClaims.$inferSelect
export type NewTokenClaim = typeof tokenClaims.$inferInsert

export const stakingPositions = pgTable('staking_positions', {
	id: serial('id').primaryKey(),
	userId: integer('user_id').notNull().unique().references(() => users.id),
	walletAddress: varchar('wallet_address', { length: 42 }).notNull(),
	suwpStaked: numeric('suwp_staked', { precision: 18, scale: 6 }).notNull().default('0'),
	stakedSince: timestamp('staked_since'),
	lastRewardEpoch: integer('last_reward_epoch'),
	totalUsdcClaimed: numeric('total_usdc_claimed', { precision: 18, scale: 6 }).default('0'),
	totalSuwpBonusClaimed: numeric('total_suwp_bonus_claimed', { precision: 18, scale: 6 }).default('0'),
	isActive: integer('is_active').default(1),
	createdAt: timestamp('created_at').defaultNow(),
	updatedAt: timestamp('updated_at').defaultNow(),
})

export type StakingPosition = typeof stakingPositions.$inferSelect
export type NewStakingPosition = typeof stakingPositions.$inferInsert

export const distributionEpochs = pgTable('distribution_epochs', {
	id: serial('id').primaryKey(),
	epochNumber: integer('epoch_number').notNull().unique(),
	periodStart: timestamp('period_start').notNull(),
	periodEnd: timestamp('period_end').notNull(),
	totalFeesUsdc: numeric('total_fees_usdc', { precision: 18, scale: 6 }).notNull().default('0'),
	stakingPoolUsdc: numeric('staking_pool_usdc', { precision: 18, scale: 6 }).notNull().default('0'),
	protocolUsdc: numeric('protocol_usdc', { precision: 18, scale: 6 }).notNull().default('0'),
	totalSuwpStaked: numeric('total_suwp_staked', { precision: 18, scale: 6 }).notNull().default('0'),
	suwpEmission: numeric('suwp_emission', { precision: 18, scale: 6 }).notNull().default('10000'),
	status: varchar('status', { length: 20 }).default('pending'),
	createdAt: timestamp('created_at').defaultNow(),
	distributedAt: timestamp('distributed_at'),
})

export type DistributionEpoch = typeof distributionEpochs.$inferSelect
export type NewDistributionEpoch = typeof distributionEpochs.$inferInsert

export const epochRewards = pgTable('epoch_rewards', {
	id: serial('id').primaryKey(),
	epochId: integer('epoch_id').notNull().references(() => distributionEpochs.id),
	userId: integer('user_id').notNull().references(() => users.id),
	suwpStakedSnapshot: numeric('suwp_staked_snapshot', { precision: 18, scale: 6 }).notNull(),
	usdcReward: numeric('usdc_reward', { precision: 18, scale: 6 }).notNull(),
	suwpBonus: numeric('suwp_bonus', { precision: 18, scale: 6 }).notNull(),
	status: varchar('status', { length: 20 }).default('pending'),
	txHash: varchar('tx_hash', { length: 255 }),
	createdAt: timestamp('created_at').defaultNow(),
	paidAt: timestamp('paid_at'),
}, (table) => ({
	epochIdIdx: index('ix_epoch_rewards_epoch_id').on(table.epochId),
	userIdIdx: index('ix_epoch_rewards_user_id').on(table.userId),
}))

export type EpochReward = typeof epochRewards.$inferSelect
export type NewEpochReward = typeof epochRewards.$inferInsert
