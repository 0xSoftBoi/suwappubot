/**
 * Suwappu Bank M4 (Remittance) + M5 (Ramps) tables. Money = integer minor units in numeric(78,0).
 * Mirrors drizzle/0028_bank_remit_ramps.sql and database/bank_ddl/remit_ramps.py (ADR 0003).
 */
import { index, jsonb, numeric, pgTable, text, timestamp, uniqueIndex, varchar } from 'drizzle-orm/pg-core'

export const bankRampCustomers = pgTable(
	'bank_ramp_customers',
	{
		id: text('id').primaryKey(),
		ownerType: varchar('owner_type', { length: 24 }).notNull(),
		ownerId: varchar('owner_id', { length: 64 }).notNull(),
		provider: varchar('provider', { length: 24 }).notNull(),
		providerCustomerId: varchar('provider_customer_id', { length: 128 }).notNull(),
		kycStatus: varchar('kyc_status', { length: 24 }).notNull().default('not_started'),
		kycLink: text('kyc_link'),
		tosLink: text('tos_link'),
		metadata: jsonb('metadata').$type<Record<string, unknown>>().notNull().default({}),
		createdAt: timestamp('created_at').defaultNow().notNull(),
		updatedAt: timestamp('updated_at').defaultNow().notNull(),
	},
	(t) => ({
		ownerProv: uniqueIndex('ux_bank_ramp_customers_owner').on(t.ownerType, t.ownerId, t.provider),
		provId: uniqueIndex('ux_bank_ramp_customers_prov').on(t.provider, t.providerCustomerId),
	}),
)

export const bankExternalAccounts = pgTable(
	'bank_external_accounts',
	{
		id: text('id').primaryKey(),
		ownerType: varchar('owner_type', { length: 24 }).notNull(),
		ownerId: varchar('owner_id', { length: 64 }).notNull(),
		provider: varchar('provider', { length: 24 }).notNull(),
		providerId: varchar('provider_id', { length: 128 }).notNull(),
		rail: varchar('rail', { length: 16 }).notNull(),
		currency: varchar('currency', { length: 8 }).notNull(),
		label: varchar('label', { length: 80 }),
		/** Non-sensitive display details only (last4, bank name, holder). */
		details: jsonb('details').$type<Record<string, unknown>>().notNull().default({}),
		createdAt: timestamp('created_at').defaultNow().notNull(),
	},
	(t) => ({
		ownerIdx: index('ix_bank_external_accounts_owner').on(t.ownerType, t.ownerId),
		provUniq: uniqueIndex('ux_bank_external_accounts_prov').on(t.provider, t.providerId),
	}),
)

export const bankVirtualAccounts = pgTable(
	'bank_virtual_accounts',
	{
		id: text('id').primaryKey(),
		ownerType: varchar('owner_type', { length: 24 }).notNull(),
		ownerId: varchar('owner_id', { length: 64 }).notNull(),
		provider: varchar('provider', { length: 24 }).notNull(),
		providerId: varchar('provider_id', { length: 128 }).notNull(),
		sourceCurrency: varchar('source_currency', { length: 8 }).notNull(),
		/** Bank account (bank_accounts.id) credited when funds arrive. */
		destAccountId: text('dest_account_id').notNull(),
		destAsset: varchar('dest_asset', { length: 16 }).notNull(),
		destChain: varchar('dest_chain', { length: 32 }).notNull(),
		destAddress: varchar('dest_address', { length: 128 }).notNull(),
		instructions: jsonb('instructions').$type<Record<string, unknown>>().notNull().default({}),
		status: varchar('status', { length: 16 }).notNull().default('active'),
		createdAt: timestamp('created_at').defaultNow().notNull(),
	},
	(t) => ({
		ownerIdx: index('ix_bank_virtual_accounts_owner').on(t.ownerType, t.ownerId),
		provUniq: uniqueIndex('ux_bank_virtual_accounts_prov').on(t.provider, t.providerId),
	}),
)

export type RampDirection = 'onramp' | 'offramp' | 'deposit'
export type RampStatus = 'pending' | 'processing' | 'completed' | 'failed' | 'returned' | 'refunded'

export const bankRampTransfers = pgTable(
	'bank_ramp_transfers',
	{
		id: text('id').primaryKey(),
		ownerType: varchar('owner_type', { length: 24 }).notNull(),
		ownerId: varchar('owner_id', { length: 64 }).notNull(),
		provider: varchar('provider', { length: 24 }).notNull(),
		providerId: varchar('provider_id', { length: 128 }).notNull(),
		direction: varchar('direction', { length: 12 }).$type<RampDirection>().notNull(),
		/** Raw provider state (e.g. Bridge payment_processed). */
		providerState: varchar('provider_state', { length: 48 }).notNull(),
		status: varchar('status', { length: 16 }).$type<RampStatus>().notNull().default('pending'),
		sourceRail: varchar('source_rail', { length: 24 }).notNull(),
		sourceCurrency: varchar('source_currency', { length: 8 }).notNull(),
		destRail: varchar('dest_rail', { length: 24 }).notNull(),
		destCurrency: varchar('dest_currency', { length: 8 }).notNull(),
		/** Source amount, minor units of the source currency. */
		amountMinor: numeric('amount_minor', { precision: 78, scale: 0 }).notNull(),
		receiveMinor: numeric('receive_minor', { precision: 78, scale: 0 }),
		feeMinor: numeric('fee_minor', { precision: 78, scale: 0 }),
		/** Bank account funded/debited by this ramp transfer. */
		accountId: text('account_id'),
		/** bank_transfers.id holding the ledger legs (offramp: reserve; deposit: credit). */
		bankTransferId: text('bank_transfer_id'),
		externalAccountId: text('external_account_id'),
		virtualAccountId: text('virtual_account_id'),
		clientReferenceId: varchar('client_reference_id', { length: 128 }),
		metadata: jsonb('metadata').$type<Record<string, unknown>>().notNull().default({}),
		createdAt: timestamp('created_at').defaultNow().notNull(),
		updatedAt: timestamp('updated_at').defaultNow().notNull(),
	},
	(t) => ({
		provUniq: uniqueIndex('ux_bank_ramp_transfers_prov').on(t.provider, t.providerId),
		ownerIdx: index('ix_bank_ramp_transfers_owner').on(t.ownerType, t.ownerId, t.createdAt),
		statusIdx: index('ix_bank_ramp_transfers_status').on(t.status),
	}),
)

/** Webhook idempotency: one row per (provider, event id). */
export const bankRampEvents = pgTable(
	'bank_ramp_events',
	{
		id: text('id').primaryKey(),
		provider: varchar('provider', { length: 24 }).notNull(),
		eventId: varchar('event_id', { length: 160 }).notNull(),
		eventType: varchar('event_type', { length: 80 }).notNull(),
		createdAt: timestamp('created_at').defaultNow().notNull(),
	},
	(t) => ({ uniq: uniqueIndex('ux_bank_ramp_events').on(t.provider, t.eventId) }),
)

export type RemittanceMode = 'internal' | 'address' | 'claim' | 'payout'
export type RemittanceStatus =
	| 'pending'
	| 'awaiting_claim'
	| 'awaiting_recipient_choice'
	| 'payout_processing'
	| 'completed'
	| 'refunded'
	| 'failed'

export const bankRemittances = pgTable(
	'bank_remittances',
	{
		id: text('id').primaryKey(),
		senderType: varchar('sender_type', { length: 24 }).notNull(),
		senderId: varchar('sender_id', { length: 64 }).notNull(),
		recipientType: varchar('recipient_type', { length: 24 }),
		recipientId: varchar('recipient_id', { length: 64 }),
		/** Handle / telegram id / address as given by the sender. */
		recipientRef: varchar('recipient_ref', { length: 160 }),
		mode: varchar('mode', { length: 12 }).$type<RemittanceMode>().notNull(),
		status: varchar('status', { length: 28 }).$type<RemittanceStatus>().notNull().default('pending'),
		/** e.g. USD->MXN */
		corridor: varchar('corridor', { length: 16 }).notNull(),
		sendAsset: varchar('send_asset', { length: 16 }).notNull(),
		sendChain: varchar('send_chain', { length: 32 }).notNull(),
		sendCurrency: varchar('send_currency', { length: 8 }).notNull(),
		amountMinor: numeric('amount_minor', { precision: 78, scale: 0 }).notNull(),
		receiveCurrency: varchar('receive_currency', { length: 8 }),
		receiveMinor: numeric('receive_minor', { precision: 78, scale: 0 }),
		feeMinor: numeric('fee_minor', { precision: 78, scale: 0 }),
		fromAccountId: text('from_account_id').notNull(),
		escrowAccountId: text('escrow_account_id'),
		toAccountId: text('to_account_id'),
		bankTransferId: text('bank_transfer_id'),
		rampTransferId: text('ramp_transfer_id'),
		claimTokenHash: varchar('claim_token_hash', { length: 64 }),
		claimExpiresAt: timestamp('claim_expires_at'),
		autoEarn: varchar('auto_earn', { length: 5 }).notNull().default('false'),
		idempotencyKey: varchar('idempotency_key', { length: 128 }).notNull(),
		memo: varchar('memo', { length: 280 }),
		metadata: jsonb('metadata').$type<Record<string, unknown>>().notNull().default({}),
		createdAt: timestamp('created_at').defaultNow().notNull(),
		updatedAt: timestamp('updated_at').defaultNow().notNull(),
		completedAt: timestamp('completed_at'),
	},
	(t) => ({
		idem: uniqueIndex('ux_bank_remittances_idem').on(t.senderType, t.senderId, t.idempotencyKey),
		sender: index('ix_bank_remittances_sender').on(t.senderType, t.senderId, t.createdAt),
		recipient: index('ix_bank_remittances_recipient').on(t.recipientType, t.recipientId, t.createdAt),
		claim: uniqueIndex('ux_bank_remittances_claim').on(t.claimTokenHash),
		corridor: index('ix_bank_remittances_corridor').on(t.corridor, t.status),
	}),
)
