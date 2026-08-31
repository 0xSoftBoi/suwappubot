import { boolean, index, integer, jsonb, pgTable, text, timestamp, uuid, varchar } from 'drizzle-orm/pg-core'
import { organizations } from './organizations'
import { users } from './users'

/**
 * `alerts-webhooks` node of the enterprise dashboard parity plan
 * (docs/plans/enterprise-dashboard.md) — org-configured, HMAC-signed webhook
 * dispatch for SIEM-friendly alerting (Fireblocks/Chainalysis-style).
 *
 * `secret` is generated server-side (32 random bytes, hex) at creation time
 * and returned to the caller exactly once (the create response) — every
 * subsequent read masks it (see routes/enterpriseWebhooks.ts). It is the
 * HMAC-SHA256 key used to sign every dispatched payload
 * (services/webhookDispatcher.ts), so a leaked row leaks forgeable
 * signatures for that endpoint only (never a platform-wide secret).
 *
 * `eventTypes` is a jsonb string array rather than a Postgres text[] so the
 * vocabulary can grow without a migration; validated against a fixed enum at
 * the route layer (see WEBHOOK_EVENT_TYPES in enterpriseWebhooks.ts) — never
 * trusted as free-form at write time.
 *
 * `lastDeliveryStatus` is the HTTP status code of the most recent delivery
 * attempt (nullable — no attempt yet); `failureCount` is a running counter
 * of consecutive failures the dispatcher increments/resets, giving the
 * dashboard an "unhealthy webhook" signal without needing a separate
 * delivery-log table for v1.
 */
export const orgWebhooks = pgTable(
	'org_webhooks',
	{
		id: uuid('id').defaultRandom().primaryKey(),
		orgId: uuid('org_id')
			.references(() => organizations.id, { onDelete: 'cascade' })
			.notNull(),
		url: text('url').notNull(),
		// HMAC-SHA256 signing key for this endpoint, 32 random bytes as hex (64
		// chars). Never returned in full after creation — see routes.
		secret: varchar('secret', { length: 64 }).notNull(),
		// See WEBHOOK_EVENT_TYPES vocabulary in enterpriseWebhooks.ts.
		eventTypes: jsonb('event_types').notNull().default([]),
		enabled: boolean('enabled').default(true).notNull(),
		description: varchar('description', { length: 255 }),
		createdBy: integer('created_by').references(() => users.id),
		createdAt: timestamp('created_at').defaultNow().notNull(),
		lastDeliveryAt: timestamp('last_delivery_at'),
		lastDeliveryStatus: integer('last_delivery_status'),
		failureCount: integer('failure_count').default(0).notNull(),
	},
	(t) => ({
		orgIdx: index('org_webhooks_org_idx').on(t.orgId),
		orgEnabledIdx: index('org_webhooks_org_enabled_idx').on(t.orgId, t.enabled),
	}),
)

export type OrgWebhook = typeof orgWebhooks.$inferSelect
export type NewOrgWebhook = typeof orgWebhooks.$inferInsert
