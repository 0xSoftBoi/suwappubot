/**
 * Suwappu Bank M9 (Business banking) tables. Money is integer minor units in
 * numeric(78,0), handled as bigint/strings in code. Co-created by Python
 * `database/bank_ddl/business.py` and drizzle `0031_bank_business.sql` (ADR 0003).
 *
 * `bank_orgs.id` is the `owner_id` of org-owned `bank_accounts` (owner_type='org').
 */
import { index, integer, jsonb, numeric, pgTable, text, timestamp, uniqueIndex, varchar } from 'drizzle-orm/pg-core'

export type BankOrgRole = 'owner' | 'admin' | 'approver' | 'accountant' | 'member' | 'viewer'

export const bankOrgs = pgTable('bank_orgs', {
	id: text('id').primaryKey(),
	name: varchar('name', { length: 200 }).notNull(),
	/** ISO currency all books are expressed in. */
	reportingCurrency: varchar('reporting_currency', { length: 8 }).notNull().default('USD'),
	ownerUserId: integer('owner_user_id').notNull(),
	/** users.id whose custodial wallets back the org's accounts. */
	custodyUserId: integer('custody_user_id').notNull(),
	/** Optional link to the enterprise API org (organizations.id, uuid as text). */
	enterpriseOrgId: varchar('enterprise_org_id', { length: 64 }),
	/** Period close lock: books entries with occurred_at <= this are immutable. */
	closedThrough: timestamp('closed_through'),
	createdAt: timestamp('created_at').defaultNow().notNull(),
	updatedAt: timestamp('updated_at').defaultNow().notNull(),
})

export const bankOrgMembers = pgTable(
	'bank_org_members',
	{
		id: text('id').primaryKey(),
		orgId: text('org_id').notNull(),
		userId: integer('user_id').notNull(),
		role: varchar('role', { length: 16 }).$type<BankOrgRole>().notNull(),
		team: varchar('team', { length: 64 }),
		invitedBy: integer('invited_by'),
		createdAt: timestamp('created_at').defaultNow().notNull(),
	},
	(t) => ({
		uniq: uniqueIndex('ux_bank_org_members_org_user').on(t.orgId, t.userId),
		userIdx: index('ix_bank_org_members_user').on(t.userId),
	}),
)

export const bankOrgInvites = pgTable(
	'bank_org_invites',
	{
		id: text('id').primaryKey(),
		orgId: text('org_id').notNull(),
		role: varchar('role', { length: 16 }).$type<BankOrgRole>().notNull(),
		team: varchar('team', { length: 64 }),
		email: varchar('email', { length: 200 }),
		tokenHash: varchar('token_hash', { length: 64 }).notNull(),
		expiresAt: timestamp('expires_at').notNull(),
		createdBy: integer('created_by').notNull(),
		acceptedBy: integer('accepted_by'),
		acceptedAt: timestamp('accepted_at'),
		revokedAt: timestamp('revoked_at'),
		createdAt: timestamp('created_at').defaultNow().notNull(),
	},
	(t) => ({ orgIdx: index('ix_bank_org_invites_org').on(t.orgId) }),
)

export const bankOrgAudit = pgTable(
	'bank_org_audit',
	{
		id: text('id').primaryKey(),
		orgId: text('org_id').notNull(),
		actorUserId: integer('actor_user_id'),
		/** 'user' | 'agent' | 'system' */
		actorKind: varchar('actor_kind', { length: 8 }).notNull(),
		actorAgentId: varchar('actor_agent_id', { length: 64 }),
		action: varchar('action', { length: 64 }).notNull(),
		targetType: varchar('target_type', { length: 32 }),
		targetId: varchar('target_id', { length: 96 }),
		detail: jsonb('detail').$type<Record<string, unknown>>().notNull().default({}),
		createdAt: timestamp('created_at').defaultNow().notNull(),
	},
	(t) => ({ orgIdx: index('ix_bank_org_audit_org').on(t.orgId, t.createdAt) }),
)

export type ApprovalRuleType = 'transfer_over' | 'new_payee' | 'payroll_run'

export const bankApprovalPolicies = pgTable(
	'bank_approval_policies',
	{
		id: text('id').primaryKey(),
		orgId: text('org_id').notNull(),
		ruleType: varchar('rule_type', { length: 24 }).$type<ApprovalRuleType>().notNull(),
		/** transfer_over only: threshold in REPORTING-currency minor units. */
		thresholdMinor: numeric('threshold_minor', { precision: 78, scale: 0 }),
		requiredApprovals: integer('required_approvals').notNull().default(1),
		approverRoles: jsonb('approver_roles').$type<BankOrgRole[]>().notNull(),
		expiryHours: integer('expiry_hours').notNull().default(72),
		enabled: integer('enabled').notNull().default(1),
		createdBy: integer('created_by').notNull(),
		createdAt: timestamp('created_at').defaultNow().notNull(),
	},
	(t) => ({ orgIdx: index('ix_bank_approval_policies_org').on(t.orgId) }),
)

export type ApprovalStatus = 'pending' | 'approved' | 'rejected' | 'expired' | 'cancelled' | 'consumed'

export const bankApprovalRequests = pgTable(
	'bank_approval_requests',
	{
		id: text('id').primaryKey(),
		orgId: text('org_id').notNull(),
		action: varchar('action', { length: 32 }).notNull(),
		payload: jsonb('payload').$type<Record<string, unknown>>().notNull(),
		payloadHash: varchar('payload_hash', { length: 64 }).notNull(),
		requestedBy: integer('requested_by').notNull(),
		status: varchar('status', { length: 12 }).$type<ApprovalStatus>().notNull().default('pending'),
		policyId: text('policy_id'),
		requiredApprovals: integer('required_approvals').notNull(),
		approverRoles: jsonb('approver_roles').$type<BankOrgRole[]>().notNull(),
		expiresAt: timestamp('expires_at').notNull(),
		decidedAt: timestamp('decided_at'),
		consumedAt: timestamp('consumed_at'),
		createdAt: timestamp('created_at').defaultNow().notNull(),
	},
	(t) => ({
		orgIdx: index('ix_bank_approval_requests_org').on(t.orgId, t.status, t.createdAt),
		hashIdx: index('ix_bank_approval_requests_hash').on(t.orgId, t.action, t.payloadHash),
	}),
)

export const bankApprovalDecisions = pgTable(
	'bank_approval_decisions',
	{
		id: text('id').primaryKey(),
		requestId: text('request_id').notNull(),
		userId: integer('user_id').notNull(),
		role: varchar('role', { length: 16 }).$type<BankOrgRole>().notNull(),
		decision: varchar('decision', { length: 8 }).$type<'approve' | 'reject'>().notNull(),
		comment: varchar('comment', { length: 280 }),
		createdAt: timestamp('created_at').defaultNow().notNull(),
	},
	(t) => ({ uniq: uniqueIndex('ux_bank_approval_decisions_req_user').on(t.requestId, t.userId) }),
)

export const bankOrgPayees = pgTable(
	'bank_org_payees',
	{
		id: text('id').primaryKey(),
		orgId: text('org_id').notNull(),
		address: varchar('address', { length: 128 }).notNull(),
		chain: varchar('chain', { length: 32 }).notNull(),
		label: varchar('label', { length: 120 }),
		addedBy: integer('added_by'),
		createdAt: timestamp('created_at').defaultNow().notNull(),
	},
	(t) => ({ uniq: uniqueIndex('ux_bank_org_payees').on(t.orgId, t.chain, t.address) }),
)

export const bankTreasuryPolicies = pgTable(
	'bank_treasury_policies',
	{
		id: text('id').primaryKey(),
		orgId: text('org_id').notNull(),
		accountId: text('account_id').notNull(),
		/** Operating floor: balance that must stay in the account (account minor units). */
		floorMinor: numeric('floor_minor', { precision: 78, scale: 0 }).notNull().default('0'),
		sweepEnabled: integer('sweep_enabled').notNull().default(0),
		/** Earn vault id understood by BankEarnService. */
		sweepVaultId: varchar('sweep_vault_id', { length: 96 }),
		minSweepMinor: numeric('min_sweep_minor', { precision: 78, scale: 0 }).notNull().default('0'),
		updatedBy: integer('updated_by'),
		updatedAt: timestamp('updated_at').defaultNow().notNull(),
	},
	(t) => ({ uniq: uniqueIndex('ux_bank_treasury_policies_acct').on(t.orgId, t.accountId) }),
)

export const bankOrgVendors = pgTable(
	'bank_org_vendors',
	{
		id: text('id').primaryKey(),
		orgId: text('org_id').notNull(),
		name: varchar('name', { length: 200 }).notNull(),
		email: varchar('email', { length: 200 }),
		payAddress: varchar('pay_address', { length: 128 }),
		payChain: varchar('pay_chain', { length: 32 }),
		categoryId: text('category_id'),
		metadata: jsonb('metadata').$type<Record<string, unknown>>().notNull().default({}),
		createdBy: integer('created_by'),
		createdAt: timestamp('created_at').defaultNow().notNull(),
	},
	(t) => ({ orgIdx: index('ix_bank_org_vendors_org').on(t.orgId) }),
)

export type BillStatus = 'unpaid' | 'scheduled' | 'pending_approval' | 'paying' | 'paid' | 'failed' | 'cancelled'

export const bankOrgBills = pgTable(
	'bank_org_bills',
	{
		id: text('id').primaryKey(),
		orgId: text('org_id').notNull(),
		vendorId: text('vendor_id').notNull(),
		reference: varchar('reference', { length: 120 }),
		amountMinor: numeric('amount_minor', { precision: 78, scale: 0 }).notNull(),
		asset: varchar('asset', { length: 16 }).notNull(),
		chain: varchar('chain', { length: 32 }).notNull(),
		dueDate: timestamp('due_date').notNull(),
		status: varchar('status', { length: 20 }).$type<BillStatus>().notNull().default('unpaid'),
		payFromAccountId: text('pay_from_account_id'),
		scheduledFor: timestamp('scheduled_for'),
		categoryId: text('category_id'),
		approvalRequestId: text('approval_request_id'),
		transferId: text('transfer_id'),
		attempts: integer('attempts').notNull().default(0),
		lastError: text('last_error'),
		createdBy: integer('created_by').notNull(),
		scheduledBy: integer('scheduled_by'),
		paidAt: timestamp('paid_at'),
		createdAt: timestamp('created_at').defaultNow().notNull(),
	},
	(t) => ({
		orgIdx: index('ix_bank_org_bills_org').on(t.orgId, t.status, t.dueDate),
		dueIdx: index('ix_bank_org_bills_sched').on(t.status, t.scheduledFor),
	}),
)

export const bankOrgDunning = pgTable(
	'bank_org_dunning',
	{
		id: text('id').primaryKey(),
		orgId: text('org_id').notNull(),
		invoiceId: varchar('invoice_id', { length: 96 }).notNull(),
		stage: integer('stage').notNull().default(0),
		status: varchar('status', { length: 12 }).notNull().default('active'),
		lastStageAt: timestamp('last_stage_at'),
		nextStageAt: timestamp('next_stage_at'),
		updatedAt: timestamp('updated_at').defaultNow().notNull(),
	},
	(t) => ({ uniq: uniqueIndex('ux_bank_org_dunning').on(t.orgId, t.invoiceId) }),
)

export type CategoryKind = 'income' | 'expense' | 'transfer' | 'asset' | 'liability' | 'equity'

export const bankOrgCategories = pgTable(
	'bank_org_categories',
	{
		id: text('id').primaryKey(),
		orgId: text('org_id').notNull(),
		code: varchar('code', { length: 16 }).notNull(),
		name: varchar('name', { length: 120 }).notNull(),
		kind: varchar('kind', { length: 12 }).$type<CategoryKind>().notNull(),
		createdAt: timestamp('created_at').defaultNow().notNull(),
	},
	(t) => ({ uniq: uniqueIndex('ux_bank_org_categories').on(t.orgId, t.code) }),
)

export const bankOrgBooks = pgTable(
	'bank_org_books',
	{
		id: text('id').primaryKey(),
		orgId: text('org_id').notNull(),
		/** bank_ledger_entries.id — one books row per ledger movement. */
		ledgerEntryId: text('ledger_entry_id').notNull(),
		transferId: text('transfer_id').notNull(),
		accountId: text('account_id').notNull(),
		direction: varchar('direction', { length: 6 }).$type<'debit' | 'credit'>().notNull(),
		/** 'external' | 'internal' (between org accounts) */
		scope: varchar('scope', { length: 10 }).notNull(),
		amountMinor: numeric('amount_minor', { precision: 78, scale: 0 }).notNull(),
		asset: varchar('asset', { length: 16 }).notNull(),
		reportingCurrency: varchar('reporting_currency', { length: 8 }).notNull(),
		/** Reporting-currency units per 1 whole asset unit, decimal string, as used. */
		rate: varchar('rate', { length: 40 }).notNull(),
		rateSource: varchar('rate_source', { length: 48 }).notNull(),
		rateAt: timestamp('rate_at').notNull(),
		reportingMinor: numeric('reporting_minor', { precision: 78, scale: 0 }).notNull(),
		categoryId: text('category_id'),
		memo: varchar('memo', { length: 280 }),
		occurredAt: timestamp('occurred_at').notNull(),
		/** Seconds between the ledger entry and the rate fetch (>0 means rate is not exact transaction-time). */
		rateLagSeconds: integer('rate_lag_seconds').notNull().default(0),
		createdAt: timestamp('created_at').defaultNow().notNull(),
	},
	(t) => ({
		uniq: uniqueIndex('ux_bank_org_books_entry').on(t.ledgerEntryId),
		orgIdx: index('ix_bank_org_books_org').on(t.orgId, t.occurredAt),
	}),
)

export const bankOrgCardBudgets = pgTable(
	'bank_org_card_budgets',
	{
		id: text('id').primaryKey(),
		orgId: text('org_id').notNull(),
		/** 'member' (scope_id = users.id) | 'team' (scope_id = team name) */
		scope: varchar('scope', { length: 8 }).notNull(),
		scopeId: varchar('scope_id', { length: 64 }).notNull(),
		/** Reporting-currency minor units. */
		monthlyCapMinor: numeric('monthly_cap_minor', { precision: 78, scale: 0 }),
		perTxCapMinor: numeric('per_tx_cap_minor', { precision: 78, scale: 0 }),
		categoryBudgets: jsonb('category_budgets').$type<Record<string, string>>().notNull().default({}),
		updatedBy: integer('updated_by'),
		updatedAt: timestamp('updated_at').defaultNow().notNull(),
	},
	(t) => ({ uniq: uniqueIndex('ux_bank_org_card_budgets').on(t.orgId, t.scope, t.scopeId) }),
)

/**
 * Dedicated custody wallet per org + chain family. Provisioned via Turnkey (sub-org) and mirrored into
 * Python's users/wallets (synthetic non-person user) so the fallback signer works. Never a member's wallet.
 */
export const bankOrgWallets = pgTable(
	'bank_org_wallets',
	{
		orgId: text('org_id').notNull(),
		family: varchar('family', { length: 8 }).notNull(),
		walletId: integer('wallet_id').notNull(),
		walletUserId: integer('wallet_user_id').notNull(),
		address: text('address').notNull(),
		turnkeySubOrgId: text('turnkey_sub_org_id').notNull(),
		turnkeyWalletId: text('turnkey_wallet_id').notNull(),
		createdAt: timestamp('created_at').defaultNow().notNull(),
	},
	(t) => ({ uniq: uniqueIndex('ux_bank_org_wallets_org_family').on(t.orgId, t.family) }),
)

export type BankOrg = typeof bankOrgs.$inferSelect
export type BankOrgMember = typeof bankOrgMembers.$inferSelect
export type BankApprovalRequest = typeof bankApprovalRequests.$inferSelect
export type BankApprovalPolicy = typeof bankApprovalPolicies.$inferSelect
export type BankOrgBill = typeof bankOrgBills.$inferSelect
export type BankOrgBook = typeof bankOrgBooks.$inferSelect
