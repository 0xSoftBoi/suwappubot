/**
 * Suwappu Bank core tables (M0). Money is integer minor units stored as
 * `numeric(78,0)` and handled as bigint/strings in code — never floats.
 *
 * Co-created by Python `_ensure_schema()` (database/bank_ddl/core.py) and the
 * Drizzle migration 0026_bank_core.sql — both idempotent (ADR 0003).
 */
import { sql } from 'drizzle-orm'
import {
	index,
	integer,
	jsonb,
	numeric,
	pgTable,
	text,
	timestamp,
	uniqueIndex,
	varchar,
} from 'drizzle-orm/pg-core'

export type BankOwnerType = 'user' | 'agent' | 'org' | 'partner_customer' | 'system'
export type BankAccountKind =
	| 'checking'
	| 'savings'
	| 'credit'
	| 'escrow'
	| 'pool'
	| 'treasury'
export type BankAccountStatus = 'active' | 'frozen' | 'closed'
export type BankTransferType =
	| 'internal'
	| 'onchain'
	| 'remittance'
	| 'payout'
	| 'card'
	| 'earn'
	| 'credit'
	| 'escrow'
	| 'fx'
	| 'payroll'
	| 'agent'
export type BankTransferStatus = 'pending' | 'submitted' | 'confirmed' | 'failed' | 'reversed'

export const bankAccounts = pgTable(
	'bank_accounts',
	{
		id: text('id').primaryKey(),
		ownerType: varchar('owner_type', { length: 24 }).$type<BankOwnerType>().notNull(),
		ownerId: varchar('owner_id', { length: 64 }).notNull(),
		kind: varchar('kind', { length: 16 }).$type<BankAccountKind>().notNull(),
		currency: varchar('currency', { length: 8 }).notNull(),
		asset: varchar('asset', { length: 16 }).notNull(),
		chain: varchar('chain', { length: 32 }).notNull(),
		/** wallets.id (Python-owned table, no FK) — null for system accounts. */
		walletId: integer('wallet_id'),
		/** wallets.user_id that owns walletId (needed by the signing fallback). */
		walletUserId: integer('wallet_user_id'),
		address: varchar('address', { length: 128 }),
		status: varchar('status', { length: 16 }).$type<BankAccountStatus>().notNull().default('active'),
		segmentProfile: varchar('segment_profile', { length: 32 }),
		/** Ledger balance (credits - debits), integer minor units. */
		balanceMinor: numeric('balance_minor', { precision: 78, scale: 0 }).notNull().default('0'),
		label: varchar('label', { length: 80 }),
		metadata: jsonb('metadata').$type<Record<string, unknown>>().notNull().default({}),
		createdAt: timestamp('created_at').defaultNow().notNull(),
		updatedAt: timestamp('updated_at').defaultNow().notNull(),
	},
	(t) => ({
		ownerIdx: index('ix_bank_accounts_owner').on(t.ownerType, t.ownerId),
		walletIdx: index('ix_bank_accounts_wallet').on(t.chain, t.address, t.asset),
		// One account per (owner, kind, asset, chain, label-or-empty).
		uniq: uniqueIndex('ux_bank_accounts_owner_kind_asset').on(
			t.ownerType,
			t.ownerId,
			t.kind,
			t.asset,
			t.chain,
			sql`coalesce(${t.label}, '')`,
		),
	}),
)

export const bankTransfers = pgTable(
	'bank_transfers',
	{
		id: text('id').primaryKey(),
		ownerType: varchar('owner_type', { length: 24 }).$type<BankOwnerType>().notNull(),
		ownerId: varchar('owner_id', { length: 64 }).notNull(),
		idempotencyKey: varchar('idempotency_key', { length: 128 }).notNull(),
		/** sha256 of the request terms — same key with different terms is rejected. */
		requestHash: varchar('request_hash', { length: 64 }).notNull(),
		type: varchar('type', { length: 16 }).$type<BankTransferType>().notNull(),
		fromAccount: text('from_account'),
		toAccount: text('to_account'),
		toExternal: jsonb('to_external').$type<{ address: string; chain: string } | null>(),
		amountMinor: numeric('amount_minor', { precision: 78, scale: 0 }).notNull(),
		asset: varchar('asset', { length: 16 }).notNull(),
		chain: varchar('chain', { length: 32 }).notNull(),
		status: varchar('status', { length: 16 }).$type<BankTransferStatus>().notNull().default('pending'),
		txHash: varchar('tx_hash', { length: 128 }),
		failureReason: text('failure_reason'),
		memo: varchar('memo', { length: 280 }),
		metadata: jsonb('metadata').$type<Record<string, unknown>>().notNull().default({}),
		createdAt: timestamp('created_at').defaultNow().notNull(),
		updatedAt: timestamp('updated_at').defaultNow().notNull(),
		confirmedAt: timestamp('confirmed_at'),
	},
	(t) => ({
		idemUniq: uniqueIndex('ux_bank_transfers_idem').on(t.ownerType, t.ownerId, t.idempotencyKey),
		ownerIdx: index('ix_bank_transfers_owner').on(t.ownerType, t.ownerId, t.createdAt),
		statusIdx: index('ix_bank_transfers_status').on(t.status, t.updatedAt),
		fromIdx: index('ix_bank_transfers_from').on(t.fromAccount),
		toIdx: index('ix_bank_transfers_to').on(t.toAccount),
		txIdx: index('ix_bank_transfers_tx').on(t.txHash),
	}),
)

export const bankLedgerEntries = pgTable(
	'bank_ledger_entries',
	{
		id: text('id').primaryKey(),
		transferId: text('transfer_id').notNull(),
		accountId: text('account_id').notNull(),
		direction: varchar('direction', { length: 6 }).$type<'debit' | 'credit'>().notNull(),
		amountMinor: numeric('amount_minor', { precision: 78, scale: 0 }).notNull(),
		asset: varchar('asset', { length: 16 }).notNull(),
		balanceAfter: numeric('balance_after', { precision: 78, scale: 0 }),
		/** Distinguishes multiple postings of one transfer: submit|confirm|reverse|... */
		phase: varchar('phase', { length: 24 }).notNull().default('submit'),
		createdAt: timestamp('created_at').defaultNow().notNull(),
	},
	(t) => ({
		accountIdx: index('ix_bank_ledger_account').on(t.accountId, t.createdAt),
		transferIdx: index('ix_bank_ledger_transfer').on(t.transferId),
	}),
)

export type BankAccount = typeof bankAccounts.$inferSelect
export type BankTransfer = typeof bankTransfers.$inferSelect
export type BankLedgerEntry = typeof bankLedgerEntries.$inferSelect
