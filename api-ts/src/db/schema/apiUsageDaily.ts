/**
 * API usage metering schema — per-caller, per-route, per-day request counts.
 *
 * Backs /v1/data/* metering (see `callerKeyOf()` in api-ts/src/routes/data.ts
 * and lib/dataUsage.ts). `apiKeyId` is the caller identifier the metering
 * middleware computes — an org API key id (`apikey:<id>`) or agent identity
 * (`agent:<uuid|id>`). `route` is the metered route (e.g.
 * `data.history.ohlcv`). One row per (apiKeyId, route, day); `count`
 * increments on each request and `lastUsedAt` records the most recent hit.
 *
 * Table owned by the Python service and created via runtime migration
 * (`_ensure_schema()`). Drizzle maps it here for type-safe reads from api-ts.
 * Do NOT run `db:push` / generate a Drizzle migration from this def — it
 * mirrors the Python-created columns exactly.
 */

import { bigint, bigserial, date, index, pgTable, text, timestamp, unique } from 'drizzle-orm/pg-core'

export const apiUsageDaily = pgTable(
	'api_usage_daily',
	{
		id: bigserial('id', { mode: 'number' }).primaryKey(),

		// Caller identifier from callerKeyOf(): 'apikey:<id>' | 'agent:<uuid|id>'
		apiKeyId: text('api_key_id').notNull(),

		// Metered route, e.g. 'data.history.ohlcv'
		route: text('route').notNull(),

		day: date('day').notNull(),

		count: bigint('count', { mode: 'number' }).notNull().default(0),

		lastUsedAt: timestamp('last_used_at', { withTimezone: true }),
	},
	(table) => [
		unique('uq_api_usage_daily_key_route_day').on(table.apiKeyId, table.route, table.day),
		index('ix_api_usage_daily_key_day').on(table.apiKeyId, table.day),
	],
)

export type ApiUsageDaily = typeof apiUsageDaily.$inferSelect
export type NewApiUsageDaily = typeof apiUsageDaily.$inferInsert
