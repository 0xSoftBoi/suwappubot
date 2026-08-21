/**
 * Prediction snapshots schema — Databento-parity Round 5
 * (docs/plans/market-data-parity.md).
 *
 * Persisted prediction market odds snapshots keyed by
 * (venue, market_id, outcome, ts). Captured every 5 minutes for the top
 * ~100 active markets by volume from Polymarket Gamma
 * (bot/services/polymarket_api.py) and served by /v1/data/predictions/*
 * (predictions/markets, predictions/history).
 *
 * Table owned by the Python service and created via runtime migration
 * (`_ensure_schema()`). Drizzle maps it here for type-safe reads from api-ts.
 * Do NOT run `db:push` / generate a Drizzle migration from this def — it
 * mirrors the Python-created columns exactly.
 *
 * Numeric columns use numeric(38, 18) to hold exact decimal values.
 */

import { bigserial, index, numeric, pgTable, text, timestamp, unique } from 'drizzle-orm/pg-core'

export const predictionSnapshots = pgTable(
	'prediction_snapshots',
	{
		id: bigserial('id', { mode: 'number' }).primaryKey(),

		// e.g. 'polymarket'
		venue: text('venue').notNull(),

		marketId: text('market_id').notNull(),
		conditionId: text('condition_id'),
		question: text('question'),

		// e.g. 'YES' / 'NO'
		outcome: text('outcome').notNull(),

		// Snapshot time, UTC
		ts: timestamp('ts', { withTimezone: true }).notNull(),

		// Implied probability
		price: numeric('price', { precision: 38, scale: 18 }),
		volume: numeric('volume', { precision: 38, scale: 18 }),
		liquidity: numeric('liquidity', { precision: 38, scale: 18 }),
		endDate: timestamp('end_date', { withTimezone: true }),

		createdAt: timestamp('created_at').defaultNow(),
	},
	(table) => [
		unique('uq_prediction_snapshots_venue_market_id_outcome_ts').on(
			table.venue,
			table.marketId,
			table.outcome,
			table.ts,
		),
		index('ix_prediction_snapshots_venue_market_id_ts').on(
			table.venue,
			table.marketId,
			table.ts.desc(),
		),
	],
)

export type PredictionSnapshot = typeof predictionSnapshots.$inferSelect
export type NewPredictionSnapshot = typeof predictionSnapshots.$inferInsert
