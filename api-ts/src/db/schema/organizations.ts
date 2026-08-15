import {
	bigserial,
	index,
	integer,
	pgTable,
	text,
	timestamp,
	unique,
	uuid,
	varchar,
} from 'drizzle-orm/pg-core'
import { users } from './users'

export const organizations = pgTable('organizations', {
	id: uuid('id').defaultRandom().primaryKey(),
	name: varchar('name', { length: 200 }).notNull(),
	slug: varchar('slug', { length: 100 }).notNull().unique(),
	tier: varchar('tier', { length: 20 }).default('enterprise').notNull(),
	ownerId: integer('owner_id')
		.references(() => users.id)
		.notNull(),
	seatLimit: integer('seat_limit').default(10).notNull(),
	apiRateLimitPerMin: integer('api_rate_limit_per_min').default(1000).notNull(),
	stripeCustomerId: varchar('stripe_customer_id', { length: 100 }),
	stripeSubscriptionId: varchar('stripe_subscription_id', { length: 100 }),
	createdAt: timestamp('created_at').defaultNow().notNull(),
	updatedAt: timestamp('updated_at').defaultNow().notNull(),
})

export const organizationMembers = pgTable(
	'organization_members',
	{
		id: uuid('id').defaultRandom().primaryKey(),
		organizationId: uuid('organization_id')
			.references(() => organizations.id, { onDelete: 'cascade' })
			.notNull(),
		userId: integer('user_id')
			.references(() => users.id, { onDelete: 'cascade' })
			.notNull(),
		role: varchar('role', { length: 20 }).default('member').notNull(),
		invitedBy: integer('invited_by').references(() => users.id),
		joinedAt: timestamp('joined_at').defaultNow().notNull(),
	},
	(t) => ({ uniq: unique().on(t.organizationId, t.userId) }),
)

export const apiKeys = pgTable('api_keys', {
	id: uuid('id').defaultRandom().primaryKey(),
	organizationId: uuid('organization_id')
		.references(() => organizations.id, { onDelete: 'cascade' })
		.notNull(),
	createdBy: integer('created_by')
		.references(() => users.id)
		.notNull(),
	name: varchar('name', { length: 100 }).notNull(),
	keyHash: varchar('key_hash', { length: 64 }).notNull().unique(),
	keyPrefix: varchar('key_prefix', { length: 16 }).notNull(),
	scopes: text('scopes').array().default([]).notNull(),
	rateLimitPerMin: integer('rate_limit_per_min').default(100),
	// Per-key spend cap in credits (1 credit ≈ $0.001 USD, see x402Payment.ts).
	// Bounds the blast radius of a leaked/buggy key against the shared
	// agentCredits balance — rateLimitPerMin only bounds calls/min, not $.
	//
	// NULL = unlimited (default; existing keys are unaffected until an operator
	// opts a key in). This is a LIFETIME cap on the key, NOT a rolling/monthly
	// window — it is a security control on one credential's blast radius, not a
	// billing period (billing already lives on the subscription). There is
	// deliberately no window rollover, so there is no rollover race condition.
	// Rotating the key (new key, spentCredits starts at 0) is the reset
	// mechanism. Do NOT "fix" this into a monthly window later.
	spendLimitCredits: integer('spend_limit_credits'),
	spentCredits: integer('spent_credits').default(0).notNull(),
	lastUsedAt: timestamp('last_used_at'),
	expiresAt: timestamp('expires_at'),
	revokedAt: timestamp('revoked_at'),
	createdAt: timestamp('created_at').defaultNow().notNull(),
})

export type Organization = typeof organizations.$inferSelect
export type NewOrganization = typeof organizations.$inferInsert
export type OrganizationMember = typeof organizationMembers.$inferSelect
export type NewOrganizationMember = typeof organizationMembers.$inferInsert
export type ApiKey = typeof apiKeys.$inferSelect
export type NewApiKey = typeof apiKeys.$inferInsert

export const apiUsageEvents = pgTable(
	'api_usage_events',
	{
		id: bigserial('id', { mode: 'number' }).primaryKey(),
		keyId: uuid('key_id')
			.references(() => apiKeys.id, { onDelete: 'cascade' })
			.notNull(),
		orgId: uuid('org_id')
			.references(() => organizations.id, { onDelete: 'cascade' })
			.notNull(),
		endpoint: varchar('endpoint', { length: 200 }).notNull(),
		method: varchar('method', { length: 10 }).notNull(),
		statusCode: integer('status_code'),
		durationMs: integer('duration_ms'),
		createdAt: timestamp('created_at').defaultNow().notNull(),
	},
	(t) => ({
		keyIdx: index('api_usage_events_key_idx').on(t.keyId),
		orgCreatedIdx: index('api_usage_events_org_created_idx').on(t.orgId, t.createdAt),
	}),
)

export type ApiUsageEvent = typeof apiUsageEvents.$inferSelect
export type NewApiUsageEvent = typeof apiUsageEvents.$inferInsert
