import { index, integer, pgTable, serial, timestamp, varchar } from 'drizzle-orm/pg-core'
import { agents } from './agents'

/**
 * Short-lived, single-use codes minted by POST /v1/agent/link/code and
 * redeemed via /claim <code> in the Telegram bot to link an agent to a
 * human owner (agents.ownerUserId). Only the sha256 hash of the code is
 * stored — the raw code is shown to the caller exactly once.
 */
export const agentLinkCodes = pgTable('agent_link_codes', {
	id: serial('id').primaryKey(),
	agentId: integer('agent_id')
		.references(() => agents.id)
		.notNull(),
	codeHash: varchar('code_hash', { length: 128 }).notNull(),
	expiresAt: timestamp('expires_at').notNull(),
	usedAt: timestamp('used_at'),
	createdAt: timestamp('created_at').defaultNow().notNull(),
}, (table) => ({
	codeHashIdx: index('ix_agent_link_codes_code_hash').on(table.codeHash),
	agentIdIdx: index('ix_agent_link_codes_agent_id').on(table.agentId),
}))

export type AgentLinkCode = typeof agentLinkCodes.$inferSelect
export type NewAgentLinkCode = typeof agentLinkCodes.$inferInsert
