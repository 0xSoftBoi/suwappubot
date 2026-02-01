import { integer, pgTable, serial, text, timestamp, varchar } from 'drizzle-orm/pg-core'

export const webhookEvents = pgTable('webhook_events', {
	id: serial('id').primaryKey(),
	agentId: integer('agent_id').notNull(),

	eventType: varchar('event_type', { length: 50 }).notNull(),
	payload: text('payload').notNull(),
	callbackUrl: varchar('callback_url', { length: 1024 }).notNull(),

	status: varchar('status', { length: 20 }).default('pending'),
	attempts: integer('attempts').default(0),
	nextRetryAt: timestamp('next_retry_at'),
	lastError: text('last_error'),
	responseStatus: integer('response_status'),

	createdAt: timestamp('created_at').defaultNow(),
	deliveredAt: timestamp('delivered_at'),
})

export type WebhookEvent = typeof webhookEvents.$inferSelect
export type NewWebhookEvent = typeof webhookEvents.$inferInsert
