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
import { organizations } from './organizations'

/**
 * AI Agents table - External agents that can use the Suwappu API
 */
export const agents = pgTable('agents', {
	id: serial('id').primaryKey(),
	uuid: uuid('uuid').defaultRandom().unique().notNull(),

	// Agent identity
	name: varchar('name', { length: 100 }).unique().notNull(),
	description: text('description'),

	// Optional org scope (G2 — agent→org identity bridge). When set, this agent's
	// mutating tool calls (e.g. MCP execute_swap) are evaluated against the org's
	// PolicyService rules. Nullable/additive: unset agents are un-orged (retail),
	// which PolicyService.evaluate() treats as always-allow. See McpPolicyGate.ts.
	organizationId: uuid('organization_id').references(() => organizations.id, {
		onDelete: 'set null',
	}),

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

	// Timestamps
	createdAt: timestamp('created_at').defaultNow().notNull(),
	updatedAt: timestamp('updated_at').defaultNow().notNull(),
	lastActiveAt: timestamp('last_active_at'),
}, (table) => ({
	isActiveIdx: index('ix_agents_is_active').on(table.isActive),
}))

export type Agent = typeof agents.$inferSelect
export type NewAgent = typeof agents.$inferInsert
