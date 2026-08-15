import {
	integer,
	index,
	json,
	pgTable,
	serial,
	timestamp,
	uniqueIndex,
	varchar,
} from 'drizzle-orm/pg-core'
import { rewards } from './points'
import { users } from './users'

// Async marketplace redemption order — mirrors the Python RedemptionOrder
// (bot/models/rewards_marketplace.py) EXACTLY (shared Postgres; Python create_all
// owns the DDL). Gift cards / travel / merch / donations fulfill asynchronously via
// an external RewardProvider, so each redemption records an order + lifecycle.
export const redemptionOrders = pgTable(
	'redemption_orders',
	{
		id: serial('id').primaryKey(),
		userId: integer('user_id')
			.notNull()
			.references(() => users.id),
		rewardId: integer('reward_id').references(() => rewards.id),
		// own_product|gift_card|travel|merch|donation|crypto|experience
		category: varchar('category', { length: 30 }).notNull(),
		pointsSpent: integer('points_spent').notNull(),
		// pending|fulfilled|failed|refunded
		status: varchar('status', { length: 20 }).default('pending').notNull(),
		provider: varchar('provider', { length: 40 }),
		providerRef: varchar('provider_ref', { length: 120 }),
		payload: json('payload'),
		idempotencyKey: varchar('idempotency_key', { length: 120 }),
		error: varchar('error', { length: 255 }),
		createdAt: timestamp('created_at').defaultNow().notNull(),
		fulfilledAt: timestamp('fulfilled_at'),
	},
	(table) => ({
		userIdIdx: index('ix_redemption_orders_user_id').on(table.userId),
		idemIdx: uniqueIndex('ux_redemption_orders_idem').on(table.idempotencyKey),
	}),
)

export type RedemptionOrder = typeof redemptionOrders.$inferSelect
export type NewRedemptionOrder = typeof redemptionOrders.$inferInsert
