import {
	boolean,
	index,
	integer,
	jsonb,
	pgTable,
	serial,
	text,
	timestamp,
	uuid,
	varchar,
} from 'drizzle-orm/pg-core'
import { users } from './users'

/**
 * AI Agents table - External agents that can use the Suwappu API
 */
export const agents = pgTable('agents', {
	id: serial('id').primaryKey(),
	uuid: uuid('uuid').defaultRandom().unique().notNull(),

	// Agent identity
	name: varchar('name', { length: 100 }).unique().notNull(),
	description: text('description'),

	// Authentication
	apiKey: varchar('api_key', { length: 64 }).unique().notNull(),
	apiKeyHash: varchar('api_key_hash', { length: 128 }).notNull(),

	// Optional webhook for async notifications
	callbackUrl: text('callback_url'),

	// Metadata (for A2A protocol - capabilities, etc.)
	metadata: jsonb('metadata').$type<Record<string, unknown>>(),

	// Status
	isActive: boolean('is_active').default(true).notNull(),

	// Rate limiting
	rateLimitTier: varchar('rate_limit_tier', { length: 20 }).default('free').notNull(),

	// Crypto-native subscription overlay (set by POST /v1/agent/billing/subscribe).
	// When subscriptionExpiresAt is in the future, the agent's *effective* tier is
	// subscriptionTier (resolved at auth time — see middleware/auth.ts). This is a
	// denormalized cache of the active row in agent_subscriptions so auth needs no
	// extra query. Both are additive/nullable.
	subscriptionTier: varchar('subscription_tier', { length: 20 }),
	subscriptionExpiresAt: timestamp('subscription_expires_at'),

	// Usage tracking
	totalRequests: integer('total_requests').default(0),
	totalSwaps: integer('total_swaps').default(0),

	// Human owner link (SUW-approvals-with-no-human gap). Nullable/additive:
	// when set, policyGate's approval-notification resolution prefers this
	// direct agent->user mapping over the org-owner fallback path. Linked via
	// POST /v1/agent/link/code + /claim <code> in the Telegram bot.
	ownerUserId: integer('owner_user_id').references(() => users.id),

	// Timestamps
	createdAt: timestamp('created_at').defaultNow().notNull(),
	updatedAt: timestamp('updated_at').defaultNow().notNull(),
	lastActiveAt: timestamp('last_active_at'),
}, (table) => ({
	isActiveIdx: index('ix_agents_is_active').on(table.isActive),
	ownerUserIdIdx: index('ix_agents_owner_user_id').on(table.ownerUserId),
}))

export type Agent = typeof agents.$inferSelect
export type NewAgent = typeof agents.$inferInsert
