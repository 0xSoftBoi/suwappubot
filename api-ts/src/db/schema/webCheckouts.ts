import {
	index,
	integer,
	pgEnum,
	pgTable,
	serial,
	timestamp,
	varchar,
} from 'drizzle-orm/pg-core'
import { users } from './users'

export const webCheckoutTierEnum = pgEnum('web_checkout_tier', ['pro', 'premium', 'enterprise'])

export const webCheckoutStatusEnum = pgEnum('web_checkout_status', [
	'pending',
	'active',
	'linked',
	'canceled',
])

// Records a Stripe Checkout session started by an anonymous showcase
// visitor (no Suwappu account yet). The Stripe webhook writes/updates a row
// here on `checkout.session.completed` instead of `subscriptions` because
// that table's `user_id` is NOT NULL/unique and a web visitor has no user
// row. The webhook is the source of truth for `status`/`stripeCustomerId`/
// `customerEmail` — it upserts on `stripeSessionId` so it self-heals even if
// the pre-checkout insert in the route was missed (e.g. request aborted
// after Stripe session creation but before the DB write).
//
// ACCOUNT-LINKING GAP (not built yet): nothing currently promotes an
// `active` row here into `subscriptions`. The intended flow is: when the
// visitor later creates/logs into a Telegram or webapp account with the
// SAME email (or verifies the email some other way), a linking step should
// look up an unclaimed row by `customerEmail`, create/update the matching
// `subscriptions` row for that user's id, and mark this row `linked` +
// `linkedUserId`. That linking endpoint/job does not exist yet.
export const webCheckouts = pgTable(
	'web_checkouts',
	{
		id: serial('id').primaryKey(),
		stripeSessionId: varchar('stripe_session_id', { length: 255 }).notNull().unique(),
		stripeCustomerId: varchar('stripe_customer_id', { length: 255 }),
		customerEmail: varchar('customer_email', { length: 255 }),
		tier: webCheckoutTierEnum('tier').notNull(),
		status: webCheckoutStatusEnum('status').notNull().default('pending'),
		linkedUserId: integer('linked_user_id').references(() => users.id),
		createdAt: timestamp('created_at').defaultNow(),
		updatedAt: timestamp('updated_at').defaultNow(),
	},
	(table) => [index('web_checkouts_customer_email_idx').on(table.customerEmail)],
)

export type WebCheckout = typeof webCheckouts.$inferSelect
export type NewWebCheckout = typeof webCheckouts.$inferInsert
