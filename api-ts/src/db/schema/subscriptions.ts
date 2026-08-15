import {
	integer,
	pgTable,
	serial,
	timestamp,
	varchar,
} from 'drizzle-orm/pg-core'

export const subscriptions = pgTable('subscriptions', {
	id: serial('id').primaryKey(),
	userId: integer('user_id').notNull().unique(),
	tier: varchar('tier', { length: 20 }).default('free'),
	startedAt: timestamp('started_at'),
	expiresAt: timestamp('expires_at'),
	// Captured from Stripe checkout so the dashboard can open the billing portal.
	// Column is created by python-api _ensure_schema (subscriptions is python-owned).
	stripeCustomerId: varchar('stripe_customer_id', { length: 64 }),
	apiCallsToday: integer('api_calls_today').default(0),
	apiCallsTotal: integer('api_calls_total').default(0),
	lastResetDate: timestamp('last_reset_date').defaultNow(),
	createdAt: timestamp('created_at').defaultNow(),
	updatedAt: timestamp('updated_at').defaultNow(),
})

export type Subscription = typeof subscriptions.$inferSelect
export type NewSubscription = typeof subscriptions.$inferInsert
