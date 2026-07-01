/**
 * Battles schema — Bucket 3 (gamified trading).
 *
 * A battle is a directional up/down bet on a market price.  The user picks
 * a direction, stakes USD, optionally sets leverage, and the outcome is
 * settled at expiry against an oracle price.
 *
 * Table owned by the Python service and created via runtime migration
 * (`_ensure_schema()`).  Drizzle maps it here for type-safe reads/writes
 * from api-ts.  Do NOT run `db:push` / generate a Drizzle migration from
 * this def — it mirrors the Python-created columns exactly.
 *
 * Money/price columns use numeric() matching the staking / p2p / morpho
 * convention throughout this codebase.
 */

import { integer, numeric, pgTable, serial, timestamp, varchar } from 'drizzle-orm/pg-core'

export const battles = pgTable('battles', {
	id: serial('id').primaryKey(),

	// References users.id — no hard FK constraint at DB level (matches Battle model)
	userId: integer('user_id').notNull(),

	// e.g. "BTC/USD", "ETH/USD"
	market: varchar('market', { length: 50 }).notNull(),

	// 'up' | 'down'
	direction: varchar('direction', { length: 10 }).notNull(),

	// USD value the user commits at entry (NUMERIC for exact arithmetic)
	stakeUsd: numeric('stake_usd', { precision: 18, scale: 6 }).notNull(),

	// 'perps' | 'prediction'
	backing: varchar('backing', { length: 20 }).notNull().default('perps'),

	// Optional leverage multiplier (NULL = no leverage)
	leverage: numeric('leverage', { precision: 10, scale: 2 }),

	// Oracle price at the moment the battle opens
	entryPrice: numeric('entry_price', { precision: 20, scale: 8 }).notNull(),

	// When the battle expires and settlement is triggered
	expiryAt: timestamp('expiry_at').notNull(),

	// Oracle price at settlement (NULL while open)
	settlePrice: numeric('settle_price', { precision: 20, scale: 8 }),

	// 'win' | 'loss' | 'void' | NULL (while open)
	outcome: varchar('outcome', { length: 10 }),

	// Realised PnL in USD — negative = loss; NULL while open
	pnlUsd: numeric('pnl_usd', { precision: 18, scale: 6 }),

	// Optional link to perp_orders.id when backing='perps'
	perpOrderId: integer('perp_order_id'),

	// 'open' | 'settled' | 'voided'
	status: varchar('status', { length: 20 }).notNull().default('open'),

	createdAt: timestamp('created_at').defaultNow(),
	settledAt: timestamp('settled_at'),
})

export type Battle = typeof battles.$inferSelect
export type NewBattle = typeof battles.$inferInsert
