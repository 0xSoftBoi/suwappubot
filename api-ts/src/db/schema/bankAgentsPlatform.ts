/**
 * Suwappu Bank M10-M13 tables (agents, platform/BaaS, payments-chain privacy).
 * Money = integer minor units in numeric(78,0). Co-created by Python
 * database/bank_ddl/agents_platform.py and drizzle 0032_bank_agents_platform.sql (ADR 0003).
 */
import { bigint, index, integer, jsonb, numeric, pgTable, text, timestamp, uniqueIndex, varchar } from 'drizzle-orm/pg-core'

const money = (n: string) => numeric(n, { precision: 78, scale: 0 })

export const bankAgentMandates = pgTable(
	'bank_agent_mandates',
	{
		id: text('id').primaryKey(),
		agentId: varchar('agent_id', { length: 64 }).notNull(),
		accountId: text('account_id').notNull(),
		perCallMaxMinor: money('per_call_max_minor').notNull(),
		dailyCapMinor: money('daily_cap_minor').notNull(),
		allowedHosts: jsonb('allowed_hosts').$type<string[]>().notNull().default([]),
		allowedPayees: jsonb('allowed_payees').$type<string[]>().notNull().default([]),
		allowedAssets: jsonb('allowed_assets').$type<string[]>().notNull().default([]),
		expiresAt: timestamp('expires_at'),
		status: varchar('status', { length: 16 }).$type<'active' | 'revoked'>().notNull().default('active'),
		createdAt: timestamp('created_at').defaultNow().notNull(),
		updatedAt: timestamp('updated_at').defaultNow().notNull(),
	},
	(t) => ({ agentIdx: index('ix_bank_agent_mandates_agent').on(t.agentId) }),
)

export const bankAgentSpend = pgTable(
	'bank_agent_spend',
	{
		id: text('id').primaryKey(),
		mandateId: text('mandate_id').notNull(),
		agentId: varchar('agent_id', { length: 64 }).notNull(),
		accountId: text('account_id').notNull(),
		host: varchar('host', { length: 255 }).notNull(),
		payee: varchar('payee', { length: 128 }).notNull(),
		asset: varchar('asset', { length: 16 }).notNull(),
		chain: varchar('chain', { length: 32 }).notNull(),
		amountMinor: money('amount_minor').notNull(),
		status: varchar('status', { length: 16 }).$type<'reserved' | 'settled' | 'failed' | 'auth_unsettled'>().notNull().default('reserved'),
		// MONEY-PATH: set once a signed EIP-3009 authorization has left the process (review3).
		authNonce: varchar('auth_nonce', { length: 80 }),
		authValidBefore: bigint('auth_valid_before', { mode: 'number' }),
		transferId: text('transfer_id'),
		txHash: varchar('tx_hash', { length: 128 }),
		resourceUrl: text('resource_url'),
		createdAt: timestamp('created_at').defaultNow().notNull(),
		updatedAt: timestamp('updated_at').defaultNow().notNull(),
	},
	(t) => ({ mandateIdx: index('ix_bank_agent_spend_mandate').on(t.mandateId, t.createdAt) }),
)

export const bankAgentResources = pgTable(
	'bank_agent_resources',
	{
		id: text('id').primaryKey(),
		sellerAgentId: varchar('seller_agent_id', { length: 64 }).notNull(),
		accountId: text('account_id').notNull(),
		slug: varchar('slug', { length: 64 }).notNull(),
		title: varchar('title', { length: 120 }).notNull(),
		description: text('description'),
		upstreamUrl: text('upstream_url').notNull(),
		priceMinor: money('price_minor').notNull(),
		asset: varchar('asset', { length: 16 }).notNull(),
		chain: varchar('chain', { length: 32 }).notNull(),
		status: varchar('status', { length: 16 }).$type<'active' | 'disabled'>().notNull().default('active'),
		createdAt: timestamp('created_at').defaultNow().notNull(),
		updatedAt: timestamp('updated_at').defaultNow().notNull(),
	},
	(t) => ({ slugUniq: uniqueIndex('ux_bank_agent_resources_slug').on(t.slug) }),
)

export const bankAgentResourceSales = pgTable(
	'bank_agent_resource_sales',
	{
		id: text('id').primaryKey(),
		resourceId: text('resource_id').notNull(),
		payer: varchar('payer', { length: 128 }).notNull(),
		txHash: varchar('tx_hash', { length: 128 }).notNull(),
		amountMinor: money('amount_minor').notNull(),
		asset: varchar('asset', { length: 16 }).notNull(),
		chain: varchar('chain', { length: 32 }).notNull(),
		credited: varchar('credited', { length: 5 }).notNull().default('false'),
		authNonce: varchar('auth_nonce', { length: 80 }),
		createdAt: timestamp('created_at').defaultNow().notNull(),
	},
	(t) => ({ txUniq: uniqueIndex('ux_bank_agent_sales_tx').on(t.txHash), nonceUniq: uniqueIndex('ux_bank_agent_sales_nonce').on(t.chain, t.authNonce) }),
)

export const bankPartners = pgTable('bank_partners', {
	orgId: varchar('org_id', { length: 64 }).primaryKey(),
	feeBpsTransfer: integer('fee_bps_transfer').notNull().default(0),
	feeBpsFx: integer('fee_bps_fx').notNull().default(0),
	revenueAccountId: text('revenue_account_id'),
	webhookUrl: text('webhook_url'),
	webhookSecret: varchar('webhook_secret', { length: 128 }),
	status: varchar('status', { length: 16 }).notNull().default('active'),
	createdAt: timestamp('created_at').defaultNow().notNull(),
	updatedAt: timestamp('updated_at').defaultNow().notNull(),
})

export const bankPartnerCustomers = pgTable(
	'bank_partner_customers',
	{
		id: text('id').primaryKey(),
		partnerId: varchar('partner_id', { length: 64 }).notNull(),
		externalRef: varchar('external_ref', { length: 128 }).notNull(),
		displayName: varchar('display_name', { length: 200 }),
		email: varchar('email', { length: 254 }),
		country: varchar('country', { length: 2 }),
		status: varchar('status', { length: 16 }).notNull().default('active'),
		metadata: jsonb('metadata').$type<Record<string, unknown>>().notNull().default({}),
		createdAt: timestamp('created_at').defaultNow().notNull(),
	},
	(t) => ({ refUniq: uniqueIndex('ux_bank_partner_customers_ref').on(t.partnerId, t.externalRef) }),
)

export const bankPartnerEvents = pgTable(
	'bank_partner_events',
	{
		id: text('id').primaryKey(),
		partnerId: varchar('partner_id', { length: 64 }).notNull(),
		event: varchar('event', { length: 64 }).notNull(),
		payload: jsonb('payload').$type<Record<string, unknown>>().notNull().default({}),
		status: varchar('status', { length: 12 }).$type<'pending' | 'delivered' | 'dead'>().notNull().default('pending'),
		attempts: integer('attempts').notNull().default(0),
		nextAttemptAt: timestamp('next_attempt_at').defaultNow().notNull(),
		lastError: text('last_error'),
		deliveredAt: timestamp('delivered_at'),
		createdAt: timestamp('created_at').defaultNow().notNull(),
	},
	(t) => ({ dueIdx: index('ix_bank_partner_events_due').on(t.status, t.nextAttemptAt) }),
)

export const bankPaymentAddresses = pgTable('bank_payment_addresses', {
	handle: varchar('handle', { length: 64 }).primaryKey(),
	ownerType: varchar('owner_type', { length: 24 }).notNull(),
	ownerId: varchar('owner_id', { length: 64 }).notNull(),
	document: jsonb('document').$type<Record<string, unknown>>().notNull(),
	signature: text('signature'),
	signer: varchar('signer', { length: 64 }),
	signatureScheme: varchar('signature_scheme', { length: 16 }),
	createdAt: timestamp('created_at').defaultNow().notNull(),
	updatedAt: timestamp('updated_at').defaultNow().notNull(),
})

export const bankStealthViewKeys = pgTable('bank_stealth_view_keys', {
	id: text('id').primaryKey(),
	ownerType: varchar('owner_type', { length: 24 }).notNull(),
	ownerId: varchar('owner_id', { length: 64 }).notNull(),
	/** Compliance (sender-side) view secret: derives per-payout ephemeral keys. Cannot spend. */
	secret: text('secret').notNull(), // envelope-encrypted ('env1:...'); legacy rows were plaintext 0x+64hex
	createdAt: timestamp('created_at').defaultNow().notNull(),
})

export const bankStealthPayouts = pgTable(
	'bank_stealth_payouts',
	{
		id: text('id').primaryKey(),
		ownerType: varchar('owner_type', { length: 24 }).notNull(),
		ownerId: varchar('owner_id', { length: 64 }).notNull(),
		payoutRef: varchar('payout_ref', { length: 128 }).notNull(),
		stealthAddress: varchar('stealth_address', { length: 42 }).notNull(),
		ephemeralPub: varchar('ephemeral_pub', { length: 68 }).notNull(),
		viewTag: varchar('view_tag', { length: 4 }).notNull(),
		payeeMeta: varchar('payee_meta', { length: 140 }).notNull(),
		chain: varchar('chain', { length: 32 }),
		announceTx: varchar('announce_tx', { length: 128 }),
		createdAt: timestamp('created_at').defaultNow().notNull(),
	},
	(t) => ({ refUniq: uniqueIndex('ux_bank_stealth_payouts_ref').on(t.ownerType, t.ownerId, t.payoutRef) }),
)

export type BankAgentMandate = typeof bankAgentMandates.$inferSelect
export type BankAgentResource = typeof bankAgentResources.$inferSelect
export type BankPartner = typeof bankPartners.$inferSelect
export type BankPartnerCustomer = typeof bankPartnerCustomers.$inferSelect
