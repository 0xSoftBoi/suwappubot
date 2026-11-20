import { bigserial, index, pgTable, text, timestamp, varchar } from 'drizzle-orm/pg-core'

// First-party marketing-site events (page views + funnel steps), written by
// POST /v1/web/event and read by GET /admin/growth.
//
// Mirror of bot/models/web_event.py — Python creates the table at boot
// (Base.metadata.create_all); keep the two definitions in sync.
//
// Holds no personal data by design: no IP, no user agent, no cookie id, no
// user id. `sessionId` is a random per-tab value from sessionStorage.
export const webEvents = pgTable(
	'web_events',
	{
		id: bigserial('id', { mode: 'number' }).primaryKey(),
		name: varchar('name', { length: 48 }).notNull(),
		path: varchar('path', { length: 200 }).notNull().default('/'),
		sessionId: varchar('session_id', { length: 40 }).notNull(),
		referrerHost: varchar('referrer_host', { length: 120 }),
		utmSource: varchar('utm_source', { length: 80 }),
		utmMedium: varchar('utm_medium', { length: 80 }),
		utmCampaign: varchar('utm_campaign', { length: 80 }),
		propsJson: text('props_json'),
		createdAt: timestamp('created_at').notNull().defaultNow(),
	},
	(table) => [
		index('ix_web_events_created_at').on(table.createdAt),
		index('ix_web_events_name_created_at').on(table.name, table.createdAt),
	],
)
