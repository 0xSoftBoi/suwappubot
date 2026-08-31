import { index, integer, jsonb, pgTable, serial, timestamp, varchar } from 'drizzle-orm/pg-core'

/**
 * KYT/compliance screening decision log (enterprise-dashboard compliance-api
 * node, docs/plans/enterprise-dashboard.md). PYTHON-OWNED table — this is a
 * read-only Drizzle mirror of bot/models/compliance.py (`ScreeningEvent`),
 * created via database/db.py `_add_compliance_tables` (ADR 0003, no
 * Alembic). Do NOT run `drizzle-kit push`/`generate` against this table; it
 * is intentionally excluded from drizzle.config.ts's `tablesFilter`, same as
 * `audit_logs` and `swap_transactions`.
 *
 * Written by bot.services.compliance.screening_events.record_screening_event
 * at the two money-movement gates (SwapEngine.execute_swap, the withdrawal
 * path in hot_wallet.py) right after AddressComplianceService.screen()
 * returns its verdict. Read by routes/enterpriseCompliance.ts.
 */
export const screeningEvents = pgTable(
	'screening_events',
	{
		id: serial('id').primaryKey(),
		createdAt: timestamp('created_at').defaultNow(),
		// Nullable: the withdrawal call site screens through a pooled custodial
		// hot wallet with no user in scope at that layer — see
		// screening_events.py's module docstring.
		userId: integer('user_id'),
		// Nullable: individual (non-org) users have no organization. Org-scoped
		// dashboard queries fall back to joining organizationMembers on userId
		// for rows where this is null — see enterpriseCompliance.ts.
		orgId: varchar('org_id', { length: 36 }),
		chain: varchar('chain', { length: 50 }),
		direction: varchar('direction', { length: 16 }).notNull(), // 'outbound' | 'inbound'
		address: varchar('address', { length: 255 }),
		decision: varchar('decision', { length: 16 }).notNull(), // 'allowed' | 'blocked' | 'flagged'
		// 'ofac_match' | 'not_allowlisted' | 'custom_blocklist' | 'unscreenable' | 'degraded_list' | ...
		reason: varchar('reason', { length: 64 }),
		mode: varchar('mode', { length: 16 }).notNull(), // 'enforce' | 'monitor'
		txContext: jsonb('tx_context'),
	},
	(t) => ({
		orgCreatedIdx: index('screening_events_org_created_idx').on(t.orgId, t.createdAt),
		userCreatedIdx: index('screening_events_user_created_idx').on(t.userId, t.createdAt),
	}),
)

export type ScreeningEvent = typeof screeningEvents.$inferSelect
export type NewScreeningEvent = typeof screeningEvents.$inferInsert
