import {
	boolean,
	integer,
	pgTable,
	real,
	serial,
	timestamp,
	uniqueIndex,
	varchar,
} from 'drizzle-orm/pg-core'

export const dailyQuests = pgTable('daily_quests', {
	id: serial('id').primaryKey(),
	date: varchar('date', { length: 10 }).notNull(),
	questType: varchar('quest_type', { length: 50 }).notNull(),
	description: varchar('description', { length: 255 }).notNull(),
	targetValue: integer('target_value').notNull(),
	pointsReward: integer('points_reward').notNull(),
	xpReward: integer('xp_reward').default(0),
	createdAt: timestamp('created_at').defaultNow(),
})

export const userQuests = pgTable(
	'user_quests',
	{
		id: serial('id').primaryKey(),
		userId: integer('user_id').notNull(),
		questId: integer('quest_id').notNull(),
		progress: integer('progress').default(0),
		isCompleted: boolean('is_completed').default(false),
		completedAt: timestamp('completed_at'),
		claimed: boolean('claimed').default(false),
		createdAt: timestamp('created_at').defaultNow(),
	},
	(table) => [uniqueIndex('uq_user_quest').on(table.userId, table.questId)],
)

export const jackpotPools = pgTable('jackpot_pools', {
	id: serial('id').primaryKey(),
	date: varchar('date', { length: 10 }).notNull().unique(),
	totalPoolUsd: real('total_pool_usd').default(0.0),
	winnerUserId: integer('winner_user_id'),
	winnerPayoutUsd: real('winner_payout_usd'),
	isDrawn: boolean('is_drawn').default(false),
	drawnAt: timestamp('drawn_at'),
	createdAt: timestamp('created_at').defaultNow(),
})

export type DailyQuest = typeof dailyQuests.$inferSelect
export type NewDailyQuest = typeof dailyQuests.$inferInsert
export type UserQuest = typeof userQuests.$inferSelect
export type NewUserQuest = typeof userQuests.$inferInsert
export type JackpotPool = typeof jackpotPools.$inferSelect
export type NewJackpotPool = typeof jackpotPools.$inferInsert
