import { boolean, index, integer, jsonb, pgTable, serial, text, timestamp, varchar } from 'drizzle-orm/pg-core'

/**
 * APPEND-ONLY tables backing a future fine-tuning / model-training dataset.
 * No update/delete path exists for either table and none should be added.
 *
 * Table is created by python-api `_ensure_schema()`
 * (`_create_data_capture_tables`), which is authoritative for tables both
 * stacks write. Drizzle mirrors it for querying and inserts.
 */

/** One (input -> output) training pair captured from a user turn. */
export const userIntents = pgTable(
	'user_intents',
	{
		id: serial('id').primaryKey(),
		userId: integer('user_id'),

		// 'telegram' | 'webapp' | 'terminal' | 'api' | 'mcp' | 'whatsapp'
		surface: varchar('surface', { length: 20 }).notNull(),

		// Verbatim user input. Nullable — withheld when redacted.
		rawText: text('raw_text'),
		redacted: boolean('redacted').default(false).notNull(),
		// 'secret_detected' | 'denylisted_state' | ...
		redactionReason: varchar('redaction_reason', { length: 40 }),

		// Resolved verb: swap/bridge/limit/perp_open/...
		intentType: varchar('intent_type', { length: 40 }),
		// The structured action we actually derived.
		resolvedAction: jsonb('resolved_action'),
		// 'resolved' | 'clarified' | 'abandoned' | 'failed'
		resolutionStatus: varchar('resolution_status', { length: 20 }).default('resolved').notNull(),

		// Position within a multi-turn conversation.
		turnIndex: integer('turn_index').default(0).notNull(),
		// Groups turns of one conversation.
		sessionKey: varchar('session_key', { length: 128 }).notNull(),

		// Links the intent to the trade it produced, if any.
		swapId: integer('swap_id'),

		modelVersion: varchar('model_version', { length: 40 }),
		parserVersion: varchar('parser_version', { length: 40 }),

		createdAt: timestamp('created_at').defaultNow().notNull(),
	},
	(table) => ({
		userIdIdx: index('ix_user_intents_user_id').on(table.userId),
		swapIdIdx: index('ix_user_intents_swap_id').on(table.swapId),
		intentTypeIdx: index('ix_user_intents_intent_type').on(table.intentType),
		sessionKeyIdx: index('ix_user_intents_session_key').on(table.sessionKey),
		createdAtIdx: index('ix_user_intents_created_at').on(table.createdAt),
		userIdCreatedAtIdx: index('ix_user_intents_user_id_created_at').on(table.userId, table.createdAt),
	}),
)

export type UserIntent = typeof userIntents.$inferSelect
export type NewUserIntent = typeof userIntents.$inferInsert

/** Broad append-only telemetry for anything not intent-shaped. */
export const interactionEvents = pgTable(
	'interaction_events',
	{
		id: serial('id').primaryKey(),
		userId: integer('user_id'),

		surface: varchar('surface', { length: 20 }).notNull(),
		eventType: varchar('event_type', { length: 60 }).notNull(),
		payload: jsonb('payload'),
		sessionKey: varchar('session_key', { length: 128 }),

		createdAt: timestamp('created_at').defaultNow().notNull(),
	},
	(table) => ({
		userIdIdx: index('ix_interaction_events_user_id').on(table.userId),
		eventTypeIdx: index('ix_interaction_events_event_type').on(table.eventType),
		sessionKeyIdx: index('ix_interaction_events_session_key').on(table.sessionKey),
		createdAtIdx: index('ix_interaction_events_created_at').on(table.createdAt),
		userIdCreatedAtIdx: index('ix_interaction_events_user_id_created_at').on(table.userId, table.createdAt),
	}),
)

export type InteractionEvent = typeof interactionEvents.$inferSelect
export type NewInteractionEvent = typeof interactionEvents.$inferInsert
