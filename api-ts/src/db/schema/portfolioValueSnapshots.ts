/**
 * Portfolio snapshots schema.
 *
 * Table owned by the Python service and created via runtime migration
 * (`_ensure_schema()`), backing GET /webapp/portfolio/history. Drizzle maps
 * it here for type-safe reads from api-ts. Do NOT run `db:generate` /
 * `db:push` from this def — it mirrors the Python-created columns exactly.
 */

import { doublePrecision, index, integer, pgTable, serial, timestamp, varchar } from 'drizzle-orm/pg-core'
import { users } from './users'

export const portfolioValueSnapshots = pgTable(
	'portfolio_value_snapshots',
	{
		id: serial('id').primaryKey(),
		userId: integer('user_id')
			.notNull()
			.references(() => users.id),

		totalUsd: doublePrecision('total_usd').notNull(),
		tokenCount: integer('token_count').notNull().default(0),
		source: varchar('source', { length: 20 }).notNull(),

		capturedAt: timestamp('captured_at').notNull().defaultNow(),
	},
	(table) => [
		index('ix_portfolio_value_snapshots_user_captured').on(table.userId, table.capturedAt),
	],
)

export type PortfolioValueSnapshot = typeof portfolioValueSnapshots.$inferSelect
export type NewPortfolioValueSnapshot = typeof portfolioValueSnapshots.$inferInsert
