/**
 * Suwappu Bank cards (M6). Money is integer minor units in numeric(78,0).
 * `amount_minor` = asset minor units (ledger); `provider_amount_minor` = card-currency
 * minor units (e.g. cents). No PAN/CVC/expiry-secret is ever stored: only brand + last4.
 *
 * Co-created by Python database/bank_ddl/cards.py and drizzle 0029_bank_cards.sql (ADR 0003).
 */
import { sql } from 'drizzle-orm'
import {
	boolean,
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

export type BankCardProvider = 'stripe' | 'rain'
export type BankCardStatus = 'pending' | 'active' | 'frozen' | 'canceled'

export const bankCardholders = pgTable(
	'bank_cardholders',
	{
		id: text('id').primaryKey(),
		ownerType: varchar('owner_type', { length: 24 }).notNull(),
		ownerId: varchar('owner_id', { length: 64 }).notNull(),
		memberId: varchar('member_id', { length: 64 }),
		provider: varchar('provider', { length: 16 }).$type<BankCardProvider>().notNull(),
		providerCardholderId: varchar('provider_cardholder_id', { length: 128 }).notNull(),
		createdAt: timestamp('created_at').defaultNow().notNull(),
		updatedAt: timestamp('updated_at').defaultNow().notNull(),
	},
	(t) => ({
		providerUniq: uniqueIndex('ux_bank_cardholders_provider').on(t.provider, t.providerCardholderId),
		ownerUniq: uniqueIndex('ux_bank_cardholders_owner').on(
			t.ownerType,
			t.ownerId,
			t.provider,
			sql`coalesce(${t.memberId}, '')`,
		),
	}),
)

export const bankCards = pgTable(
	'bank_cards',
	{
		id: text('id').primaryKey(),
		ownerType: varchar('owner_type', { length: 24 }).notNull(),
		ownerId: varchar('owner_id', { length: 64 }).notNull(),
		accountId: text('account_id').notNull(),
		provider: varchar('provider', { length: 16 }).$type<BankCardProvider>().notNull(),
		providerCardId: varchar('provider_card_id', { length: 128 }).notNull(),
		cardholderId: text('cardholder_id').notNull(),
		type: varchar('type', { length: 12 }).$type<'virtual' | 'physical'>().notNull(),
		status: varchar('status', { length: 12 }).$type<BankCardStatus>().notNull().default('active'),
		currency: varchar('currency', { length: 8 }).notNull(),
		brand: varchar('brand', { length: 24 }),
		last4: varchar('last4', { length: 4 }),
		expMonth: integer('exp_month'),
		expYear: integer('exp_year'),
		label: varchar('label', { length: 80 }),
		rules: jsonb('rules').$type<Record<string, unknown>>().notNull().default({}),
		singleUse: boolean('single_use').notNull().default(false),
		declineStreak: integer('decline_streak').notNull().default(0),
		orgId: varchar('org_id', { length: 64 }),
		memberId: varchar('member_id', { length: 64 }),
		teamId: varchar('team_id', { length: 64 }),
		expenseCategory: varchar('expense_category', { length: 64 }),
		memo: varchar('memo', { length: 280 }),
		metadata: jsonb('metadata').$type<Record<string, unknown>>().notNull().default({}),
		createdAt: timestamp('created_at').defaultNow().notNull(),
		updatedAt: timestamp('updated_at').defaultNow().notNull(),
	},
	(t) => ({
		providerUniq: uniqueIndex('ux_bank_cards_provider').on(t.provider, t.providerCardId),
		ownerIdx: index('ix_bank_cards_owner').on(t.ownerType, t.ownerId, t.createdAt),
		accountIdx: index('ix_bank_cards_account').on(t.accountId),
		memberIdx: index('ix_bank_cards_member').on(t.ownerType, t.ownerId, t.memberId),
	}),
)

export const bankCardHolds = pgTable(
	'bank_card_holds',
	{
		id: text('id').primaryKey(),
		cardId: text('card_id').notNull(),
		accountId: text('account_id').notNull(),
		authorizationId: text('authorization_id').notNull(),
		amountMinor: numeric('amount_minor', { precision: 78, scale: 0 }).notNull(),
		status: varchar('status', { length: 12 }).$type<'active' | 'captured' | 'released'>().notNull().default('active'),
		releaseReason: varchar('release_reason', { length: 40 }),
		expiresAt: timestamp('expires_at').notNull(),
		createdAt: timestamp('created_at').defaultNow().notNull(),
		updatedAt: timestamp('updated_at').defaultNow().notNull(),
	},
	(t) => ({
		accountIdx: index('ix_bank_card_holds_account').on(t.accountId, t.status),
		authIdx: uniqueIndex('ux_bank_card_holds_auth').on(t.authorizationId),
	}),
)

export const bankCardAuthorizations = pgTable(
	'bank_card_authorizations',
	{
		id: text('id').primaryKey(),
		cardId: text('card_id').notNull(),
		providerAuthorizationId: varchar('provider_authorization_id', { length: 128 }).notNull(),
		amountMinor: numeric('amount_minor', { precision: 78, scale: 0 }).notNull(),
		providerAmountMinor: numeric('provider_amount_minor', { precision: 78, scale: 0 }).notNull(),
		currency: varchar('currency', { length: 8 }).notNull(),
		merchantAmountMinor: numeric('merchant_amount_minor', { precision: 78, scale: 0 }),
		merchantCurrency: varchar('merchant_currency', { length: 8 }),
		merchantName: varchar('merchant_name', { length: 200 }),
		mcc: varchar('mcc', { length: 8 }),
		merchantCountry: varchar('merchant_country', { length: 8 }),
		decision: varchar('decision', { length: 12 }).$type<'approved' | 'declined'>().notNull(),
		/** Which rule decided (e.g. 'window', 'mcc_block', 'daily_cap', 'balance', 'approved'). */
		decidedBy: varchar('decided_by', { length: 40 }).notNull(),
		reason: text('reason'),
		holdId: text('hold_id'),
		status: varchar('status', { length: 12 })
			.$type<'pending' | 'captured' | 'reversed' | 'expired' | 'declined'>()
			.notNull()
			.default('pending'),
		memberId: varchar('member_id', { length: 64 }),
		orgId: varchar('org_id', { length: 64 }),
		teamId: varchar('team_id', { length: 64 }),
		expenseCategory: varchar('expense_category', { length: 64 }),
		memo: varchar('memo', { length: 280 }),
		/** Receipt METADATA only (url/filename/mime/size/sha256/note). */
		receipts: jsonb('receipts').$type<Array<Record<string, unknown>>>().notNull().default([]),
		createdAt: timestamp('created_at').defaultNow().notNull(),
		updatedAt: timestamp('updated_at').defaultNow().notNull(),
	},
	(t) => ({
		providerUniq: uniqueIndex('ux_bank_card_auth_provider').on(t.providerAuthorizationId),
		cardIdx: index('ix_bank_card_auth_card').on(t.cardId, t.createdAt),
	}),
)

export const bankCardTransactions = pgTable(
	'bank_card_transactions',
	{
		id: text('id').primaryKey(),
		cardId: text('card_id').notNull(),
		authorizationId: text('authorization_id'),
		providerTransactionId: varchar('provider_transaction_id', { length: 128 }).notNull(),
		type: varchar('type', { length: 12 }).$type<'capture' | 'refund'>().notNull(),
		amountMinor: numeric('amount_minor', { precision: 78, scale: 0 }).notNull(),
		providerAmountMinor: numeric('provider_amount_minor', { precision: 78, scale: 0 }).notNull(),
		currency: varchar('currency', { length: 8 }).notNull(),
		merchantName: varchar('merchant_name', { length: 200 }),
		mcc: varchar('mcc', { length: 8 }),
		merchantCountry: varchar('merchant_country', { length: 8 }),
		transferId: text('transfer_id'),
		settlementStatus: varchar('settlement_status', { length: 16 }).notNull().default('pending'),
		settlementError: text('settlement_error'),
		memberId: varchar('member_id', { length: 64 }),
		orgId: varchar('org_id', { length: 64 }),
		teamId: varchar('team_id', { length: 64 }),
		expenseCategory: varchar('expense_category', { length: 64 }),
		memo: varchar('memo', { length: 280 }),
		createdAt: timestamp('created_at').defaultNow().notNull(),
	},
	(t) => ({
		providerUniq: uniqueIndex('ux_bank_card_txn_provider').on(t.providerTransactionId),
		cardIdx: index('ix_bank_card_txn_card').on(t.cardId, t.createdAt),
		settleIdx: index('ix_bank_card_txn_settle').on(t.settlementStatus),
	}),
)

export type BankCard = typeof bankCards.$inferSelect
export type BankCardAuthorization = typeof bankCardAuthorizations.$inferSelect
export type BankCardHold = typeof bankCardHolds.$inferSelect
export type BankCardTransaction = typeof bankCardTransactions.$inferSelect
export type BankCardholder = typeof bankCardholders.$inferSelect
