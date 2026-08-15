/**
 * Lend metrics schema — Databento-parity Round 5 (docs/plans/market-data-parity.md).
 *
 * Persisted lending market snapshots (supply/borrow APY, TVL, utilization)
 * keyed by (venue, market_id, ts). Captured every 10 minutes from Morpho
 * GraphQL (bot/services/morpho_api.py) and served by /v1/data/lend/*
 * (lend/markets, lend/history).
 *
 * Table owned by the Python service and created via runtime migration
 * (`_ensure_schema()`). Drizzle maps it here for type-safe reads from api-ts.
 * Do NOT run `db:push` / generate a Drizzle migration from this def — it
 * mirrors the Python-created columns exactly.
 *
 * Numeric columns use numeric(38, 18) to hold exact decimal values.
 */

import {
	bigserial,
	index,
	integer,
	numeric,
	pgTable,
	text,
	timestamp,
	unique,
} from 'drizzle-orm/pg-core'

export const lendMetrics = pgTable(
	'lend_metrics',
	{
		id: bigserial('id', { mode: 'number' }).primaryKey(),

		// e.g. 'morpho'
		venue: text('venue').notNull(),

		marketId: text('market_id').notNull(),
		chainId: integer('chain_id'),
		loanSymbol: text('loan_symbol'),
		collateralSymbol: text('collateral_symbol'),

		// Snapshot time, UTC
		ts: timestamp('ts', { withTimezone: true }).notNull(),

		supplyApy: numeric('supply_apy', { precision: 38, scale: 18 }),
		borrowApy: numeric('borrow_apy', { precision: 38, scale: 18 }),
		tvl: numeric('tvl', { precision: 38, scale: 18 }),
		utilization: numeric('utilization', { precision: 38, scale: 18 }),

		createdAt: timestamp('created_at').defaultNow(),
	},
	(table) => [
		unique('uq_lend_metrics_venue_market_id_ts').on(table.venue, table.marketId, table.ts),
		index('ix_lend_metrics_venue_market_id_ts').on(table.venue, table.marketId, table.ts.desc()),
	],
)

export type LendMetric = typeof lendMetrics.$inferSelect
export type NewLendMetric = typeof lendMetrics.$inferInsert
