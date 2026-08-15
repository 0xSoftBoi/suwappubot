/**
 * Perp metrics schema — Databento-parity Round 5 (docs/plans/market-data-parity.md).
 *
 * Persisted perp market snapshots (funding rate, open interest, mark/index
 * price, 24h volume) keyed by (venue, symbol, ts). Captured every 60s from
 * Hyperliquid REST metaAndAssetCtxs (bot/services/hyperliquid_client.py) and
 * served by /v1/data/perps/* (perps/markets, perps/history).
 *
 * Table owned by the Python service and created via runtime migration
 * (`_ensure_schema()`). Drizzle maps it here for type-safe reads from api-ts.
 * Do NOT run `db:push` / generate a Drizzle migration from this def — it
 * mirrors the Python-created columns exactly.
 *
 * Numeric columns use numeric(38, 18) to hold exact decimal values.
 */

import { bigserial, index, numeric, pgTable, text, timestamp, unique } from 'drizzle-orm/pg-core'

export const perpMetrics = pgTable(
	'perp_metrics',
	{
		id: bigserial('id', { mode: 'number' }).primaryKey(),

		// e.g. 'hyperliquid'
		venue: text('venue').notNull(),

		// Perp market symbol, e.g. 'BTC'
		symbol: text('symbol').notNull(),

		// Snapshot time, UTC
		ts: timestamp('ts', { withTimezone: true }).notNull(),

		fundingRate: numeric('funding_rate', { precision: 38, scale: 18 }),
		openInterest: numeric('open_interest', { precision: 38, scale: 18 }),
		markPrice: numeric('mark_price', { precision: 38, scale: 18 }),
		// oraclePx
		indexPrice: numeric('index_price', { precision: 38, scale: 18 }),
		volume24h: numeric('volume_24h', { precision: 38, scale: 18 }),

		createdAt: timestamp('created_at').defaultNow(),
	},
	(table) => [
		unique('uq_perp_metrics_venue_symbol_ts').on(table.venue, table.symbol, table.ts),
		index('ix_perp_metrics_venue_symbol_ts').on(table.venue, table.symbol, table.ts.desc()),
	],
)

export type PerpMetric = typeof perpMetrics.$inferSelect
export type NewPerpMetric = typeof perpMetrics.$inferInsert
