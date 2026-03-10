import {
	boolean,
	integer,
	pgTable,
	serial,
	text,
	timestamp,
	varchar,
} from 'drizzle-orm/pg-core'

export const auditLogs = pgTable('audit_logs', {
	id: serial('id').primaryKey(),
	userId: integer('user_id').notNull(),
	eventType: varchar('event_type', { length: 50 }).notNull(),
	details: text('details'),
	ipAddress: varchar('ip_address', { length: 45 }),
	createdAt: timestamp('created_at').defaultNow(),
})

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
