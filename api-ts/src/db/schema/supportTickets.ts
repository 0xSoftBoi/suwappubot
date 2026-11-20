import { integer, pgTable, serial, text, timestamp, varchar } from 'drizzle-orm/pg-core'

// Read-only mirror of the columns api-ts uses from `support_tickets`
// (bot/models/support.py owns the table and its migrations).
//
// The marketing site's lead forms land here, discriminated by `kind`:
// 'enterprise_lead' | 'mobile_waitlist' | 'newsletter' (plus bot-side
// 'support' / 'bug'). Contact details and attribution live in `contextJson`
// as a JSON string — there are no dedicated email/source columns.
export const supportTickets = pgTable('support_tickets', {
	id: serial('id').primaryKey(),
	userId: integer('user_id'),
	source: varchar('source', { length: 20 }),
	kind: varchar('kind', { length: 20 }),
	category: varchar('category', { length: 50 }),
	message: text('message'),
	contextJson: text('context_json'),
	status: varchar('status', { length: 20 }),
	createdAt: timestamp('created_at'),
})

// Read-only mirror of `waitlist_signups` (bot/models/waitlist.py): handle
// reservations from /reserve.
export const waitlistSignups = pgTable('waitlist_signups', {
	id: serial('id').primaryKey(),
	handle: varchar('handle', { length: 32 }).notNull(),
	email: varchar('email', { length: 320 }).notNull(),
	referredById: integer('referred_by_id'),
	attributionJson: text('attribution_json'),
	createdAt: timestamp('created_at'),
})
