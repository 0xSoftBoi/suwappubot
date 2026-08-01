import { bigint, integer, jsonb, numeric, pgTable, text, timestamp, varchar } from 'drizzle-orm/pg-core'

/**
 * agent_approvals — human-in-the-loop approval queue (SUW-204).
 *
 * OWNED BY THE PYTHON SIDE: `database/db.py` (_create_agent_approvals_table)
 * creates the table (and its indexes) defensively at startup; the SQLAlchemy
 * model lives at `bot/models/agent_approval.py`. This Drizzle definition is a
 * read-mostly mirror so api-ts can insert pending rows and poll status — it
 * must match the existing columns exactly. `notified_at`, `notify_chat_id`,
 * and `notify_message_id` are Python-owned (Telegram notifier bookkeeping) —
 * api-ts must NEVER write to them.
 *
 * `consumed_at` is new/additive from the api-ts side (redemption bookkeeping
 * for SUW-204 task 4) — see the hand-guarded migration SQL.
 */
export const agentApprovals = pgTable('agent_approvals', {
	id: varchar('id', { length: 36 }).primaryKey(),
	orgId: varchar('org_id', { length: 36 }),
	agentId: text('agent_id').notNull(),
	agentName: text('agent_name'),
	userTelegramId: bigint('user_telegram_id', { mode: 'number' }),
	intentJson: jsonb('intent_json'),
	intentHash: varchar('intent_hash', { length: 128 }),
	valueUsd: numeric('value_usd', { mode: 'number' }),
	chain: varchar('chain', { length: 50 }),
	// 'pending' | 'approved' | 'denied' | 'expired'
	status: varchar('status', { length: 20 }).notNull().default('pending'),
	channel: varchar('channel', { length: 20 }),
	decidedBy: varchar('decided_by', { length: 64 }),
	decidedAt: timestamp('decided_at'),
	expiresAt: timestamp('expires_at'),
	createdAt: timestamp('created_at').defaultNow().notNull(),
	// Python-owned — read-only from api-ts.
	notifiedAt: timestamp('notified_at'),
	notifyChatId: bigint('notify_chat_id', { mode: 'number' }),
	notifyMessageId: integer('notify_message_id'),
	// api-ts-owned (task 4): set atomically on successful redemption to prevent reuse.
	consumedAt: timestamp('consumed_at'),
})

export type AgentApproval = typeof agentApprovals.$inferSelect
export type NewAgentApproval = typeof agentApprovals.$inferInsert
