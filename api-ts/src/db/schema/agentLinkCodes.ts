import { index, integer, pgTable, serial, timestamp, uniqueIndex, varchar } from 'drizzle-orm/pg-core'
import { agents } from './agents'

/**
 * Short-lived, single-use codes minted by POST /v1/agent/link/code and
 * redeemed via /claim <code> in the Telegram bot to link an agent to a
 * human owner (agents.ownerUserId). Only the sha256 hash of the code is
 * stored — the raw code is shown to the caller exactly once.
 *
 * codeHash is a sha256 hex digest, always exactly 64 chars — varchar(64)
 * matches that exactly. The index is UNIQUE: the Python runtime assumes
 * code_hash uniquely identifies a code (a collision would be a critical
 * takeover bug, not just a lookup ambiguity).
 */
export const agentLinkCodes = pgTable('agent_link_codes', {
	id: serial('id').primaryKey(),
	agentId: integer('agent_id')
		.references(() => agents.id)
		.notNull(),
	codeHash: varchar('code_hash', { length: 64 }).notNull(),
	expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
	usedAt: timestamp('used_at', { withTimezone: true }),
	createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => ({
	codeHashIdx: uniqueIndex('ix_agent_link_codes_code_hash').on(table.codeHash),
	agentIdIdx: index('ix_agent_link_codes_agent_id').on(table.agentId),
}))

export type AgentLinkCode = typeof agentLinkCodes.$inferSelect
export type NewAgentLinkCode = typeof agentLinkCodes.$inferInsert
