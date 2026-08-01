import {
	boolean,
	index,
	integer,
	pgTable,
	serial,
	text,
	timestamp,
	uuid,
	varchar,
} from 'drizzle-orm/pg-core'

export const auditLogs = pgTable(
	'audit_logs',
	{
		id: serial('id').primaryKey(),
		userId: integer('user_id').notNull(),
		// Org-scoped audit trail: nullable so legacy/system events (userId 0,
		// no org) still write. Set for any org-mutating or money-path event so an
		// enterprise admin can query org-wide activity — the institutional gate.
		orgId: uuid('org_id'),
		// Agent-scoped events stamp the agent id here instead of overloading userId.
		agentId: varchar('agent_id', { length: 64 }),
		eventType: varchar('event_type', { length: 50 }).notNull(),
		details: text('details'),
		ipAddress: varchar('ip_address', { length: 45 }),
		createdAt: timestamp('created_at').defaultNow(),
		// Hash-chain (tamper evidence). Chained per-org ('global' chain for
		// org-less entries). Nullable so pre-existing rows (written before this
		// migration) don't need backfill — the chain simply starts fresh from the
		// first row that has these populated. See services/audit.ts for the
		// hashing + locking scheme.
		prevHash: varchar('prev_hash', { length: 64 }),
		entryHash: varchar('entry_hash', { length: 64 }),
	},
	(t) => ({
		orgCreatedIdx: index('audit_logs_org_created_idx').on(t.orgId, t.createdAt),
		agentCreatedIdx: index('audit_logs_agent_created_idx').on(t.agentId, t.createdAt),
	}),
)

export const backupCodes = pgTable('backup_codes', {
	id: serial('id').primaryKey(),
	userId: integer('user_id').notNull(),
	codeHash: varchar('code_hash', { length: 128 }).notNull(),
	isUsed: boolean('is_used').default(false),
	usedAt: timestamp('used_at'),
	createdAt: timestamp('created_at').defaultNow(),
})

export type AuditLog = typeof auditLogs.$inferSelect
export type NewAuditLog = typeof auditLogs.$inferInsert
export type BackupCode = typeof backupCodes.$inferSelect
export type NewBackupCode = typeof backupCodes.$inferInsert

export const withdrawalWhitelist = pgTable('withdrawal_whitelist', {
	id: serial('id').primaryKey(),
	userId: integer('user_id').notNull(),
	chain: varchar('chain', { length: 50 }).notNull(),
	address: varchar('address', { length: 255 }).notNull(),
	label: varchar('label', { length: 100 }),
	cooldownUntil: timestamp('cooldown_until'),
	isActive: boolean('is_active').default(true),
	createdAt: timestamp('created_at').defaultNow(),
})

export type WithdrawalWhitelist = typeof withdrawalWhitelist.$inferSelect
export type NewWithdrawalWhitelist = typeof withdrawalWhitelist.$inferInsert
