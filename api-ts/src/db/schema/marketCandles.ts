/**
 * Market candles schema — Databento-parity Phase 1 (docs/plans/market-data-parity.md).
 *
 * Normalized OHLCV candles for cross-chain token prices, keyed by
 * (symbol, chain, timeframe, ts). Populated by bot/services/market_data.py
 * (Phase 2 — capture) and served by /v1/data/history/ohlcv (Phase 3 — distribution).
 *
 * Table owned by the Python service and created via runtime migration
 * (`_ensure_schema()`). Drizzle maps it here for type-safe reads from api-ts.
 * Do NOT run `db:push` / generate a Drizzle migration from this def — it
 * mirrors the Python-created columns exactly.
 *
 * Price/volume columns use numeric(38, 18) to hold exact decimal values
 * across chains with wildly different token decimals.
 */

import { index, numeric, pgTable, serial, timestamp, unique, varchar } from 'drizzle-orm/pg-core'

export const marketCandles = pgTable(
	'market_candles',
	{
		id: serial('id').primaryKey(),

		// Uppercase, e.g. ETH
		symbol: varchar('symbol', { length: 20 }).notNull(),

		// Chain slug from bot/config/chains.py
		chain: varchar('chain', { length: 50 }).notNull(),

		// Canonical address on that chain (NULL for chain-native/symbol-only candles)
		tokenAddress: varchar('token_address', { length: 255 }),

		// '1m' | '5m' | '1h' | '1d'
		timeframe: varchar('timeframe', { length: 10 }).notNull(),

		// Candle open time, UTC
		ts: timestamp('ts', { withTimezone: true }).notNull(),

		open: numeric('open', { precision: 38, scale: 18 }).notNull(),
		high: numeric('high', { precision: 38, scale: 18 }).notNull(),
		low: numeric('low', { precision: 38, scale: 18 }).notNull(),
		close: numeric('close', { precision: 38, scale: 18 }).notNull(),
		volume: numeric('volume', { precision: 38, scale: 18 }),

		// 'coingecko' | 'dexscreener' | 'geckoterminal'
		source: varchar('source', { length: 20 }).notNull(),

		createdAt: timestamp('created_at').defaultNow(),
	},
	(table) => [
		unique('uq_market_candles_symbol_chain_timeframe_ts').on(
			table.symbol,
			table.chain,
			table.timeframe,
			table.ts,
		),
		index('ix_market_candles_symbol_chain_timeframe_ts').on(
			table.symbol,
			table.chain,
			table.timeframe,
			table.ts.desc(),
		),
	],
)

export type MarketCandle = typeof marketCandles.$inferSelect
export type NewMarketCandle = typeof marketCandles.$inferInsert
