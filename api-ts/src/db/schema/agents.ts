import {
	boolean,
	integer,
	jsonb,
	pgTable,
	serial,
	text,
	timestamp,
	uuid,
	varchar,
} from 'drizzle-orm/pg-core'

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

	// Usage tracking
	totalRequests: integer('total_requests').default(0),
	totalSwaps: integer('total_swaps').default(0),

	// Timestamps
	createdAt: timestamp('created_at').defaultNow().notNull(),
	updatedAt: timestamp('updated_at').defaultNow().notNull(),
	lastActiveAt: timestamp('last_active_at'),
})

export type Agent = typeof agents.$inferSelect
export type NewAgent = typeof agents.$inferInsert
