/**
 * Suwappu Bank M7 (payments) + M8 (payroll & payouts) tables. Integer minor units as numeric(78,0).
 * Co-created by drizzle/0030_bank_payments_payroll.sql and database/bank_ddl/payments_payroll.py (idempotent).
 */
import { index, integer, jsonb, numeric, boolean, pgTable, text, timestamp, uniqueIndex, varchar } from 'drizzle-orm/pg-core'

const num = (n: string) => numeric(n, { precision: 78, scale: 0 })
const ts = (n: string) => timestamp(n)
const meta = () => jsonb('metadata').$type<Record<string, unknown>>().notNull().default({})

export type InvoiceStatus = 'draft' | 'open' | 'paid' | 'partially_paid' | 'void' | 'overdue'
export interface InvoiceLineItem {
	description: string
	quantity: number
	unitAmountMinor: string
}

export const bankInvoices = pgTable(
	'bank_invoices',
	{
		id: text('id').primaryKey(),
		slug: varchar('slug', { length: 32 }).notNull(),
		payeeOwnerType: varchar('payee_owner_type', { length: 24 }).notNull(),
		payeeOwnerId: varchar('payee_owner_id', { length: 64 }).notNull(),
		payeeAccountId: text('payee_account_id').notNull(),
		payerOwnerType: varchar('payer_owner_type', { length: 24 }),
		payerOwnerId: varchar('payer_owner_id', { length: 64 }),
		amountMinor: num('amount_minor').notNull(),
		/** EVM external-payment disambiguator: payer must send amount + tag. 0 when a Solana reference is used. */
		tagMinor: num('tag_minor').notNull().default('0'),
		asset: varchar('asset', { length: 16 }).notNull(),
		chain: varchar('chain', { length: 32 }).notNull(),
		/** Solana Pay reference pubkey (base58). */
		reference: varchar('reference', { length: 64 }),
		lineItems: jsonb('line_items').$type<InvoiceLineItem[]>().notNull().default([]),
		dueAt: ts('due_at'),
		status: varchar('status', { length: 16 }).$type<InvoiceStatus>().notNull().default('draft'),
		paidMinor: num('paid_minor').notNull().default('0'),
		memo: varchar('memo', { length: 280 }),
		metadata: meta(),
		scanCursor: num('scan_cursor'),
		idempotencyKey: varchar('idempotency_key', { length: 128 }),
		createdAt: ts('created_at').defaultNow().notNull(),
		updatedAt: ts('updated_at').defaultNow().notNull(),
		paidAt: ts('paid_at'),
	},
	(t) => ({
		slugUniq: uniqueIndex('ux_bank_invoices_slug').on(t.slug),
		payeeIdx: index('ix_bank_invoices_payee').on(t.payeeOwnerType, t.payeeOwnerId, t.createdAt),
		payerIdx: index('ix_bank_invoices_payer').on(t.payerOwnerType, t.payerOwnerId),
		statusIdx: index('ix_bank_invoices_status').on(t.status, t.dueAt),
		idemUniq: uniqueIndex('ux_bank_invoices_idem').on(t.payeeOwnerType, t.payeeOwnerId, t.idempotencyKey),
	}),
)

export const bankInvoicePayments = pgTable(
	'bank_invoice_payments',
	{
		id: text('id').primaryKey(),
		invoiceId: text('invoice_id').notNull(),
		payerOwnerType: varchar('payer_owner_type', { length: 24 }),
		payerOwnerId: varchar('payer_owner_id', { length: 64 }),
		source: varchar('source', { length: 12 }).$type<'bank' | 'onchain'>().notNull(),
		/** transfer:<id> | <txHash>:<logIndex> | <solana signature> — unique per invoice so detection is idempotent. */
		refKey: varchar('ref_key', { length: 160 }).notNull(),
		amountMinor: num('amount_minor').notNull(),
		transferId: text('transfer_id'),
		txHash: varchar('tx_hash', { length: 128 }),
		status: varchar('status', { length: 12 }).$type<'pending' | 'confirmed' | 'failed'>().notNull().default('pending'),
		createdAt: ts('created_at').defaultNow().notNull(),
		confirmedAt: ts('confirmed_at'),
	},
	(t) => ({
		refUniq: uniqueIndex('ux_bank_invoice_payments_ref').on(t.invoiceId, t.refKey),
		statusIdx: index('ix_bank_invoice_payments_status').on(t.status),
	}),
)

export type EscrowStatus = 'funding' | 'funded' | 'delivered' | 'disputed' | 'released' | 'refunded' | 'failed'
export type MilestoneStatus = 'funded' | 'delivered' | 'disputed' | 'released' | 'refunded'

export const bankEscrows = pgTable(
	'bank_escrows',
	{
		id: text('id').primaryKey(),
		idempotencyKey: varchar('idempotency_key', { length: 128 }).notNull(),
		payerOwnerType: varchar('payer_owner_type', { length: 24 }).notNull(),
		payerOwnerId: varchar('payer_owner_id', { length: 64 }).notNull(),
		payeeOwnerType: varchar('payee_owner_type', { length: 24 }).notNull(),
		payeeOwnerId: varchar('payee_owner_id', { length: 64 }).notNull(),
		arbiterOwnerType: varchar('arbiter_owner_type', { length: 24 }),
		arbiterOwnerId: varchar('arbiter_owner_id', { length: 64 }),
		payerAccountId: text('payer_account_id').notNull(),
		payeeAccountId: text('payee_account_id').notNull(),
		escrowAccountId: text('escrow_account_id'),
		asset: varchar('asset', { length: 16 }).notNull(),
		chain: varchar('chain', { length: 32 }).notNull(),
		amountMinor: num('amount_minor').notNull(),
		releasedMinor: num('released_minor').notNull().default('0'),
		refundedMinor: num('refunded_minor').notNull().default('0'),
		status: varchar('status', { length: 16 }).$type<EscrowStatus>().notNull().default('funding'),
		description: varchar('description', { length: 280 }),
		/** After delivery, payer has this long to confirm/dispute before auto-release to payee. */
		autoReleaseSeconds: integer('auto_release_seconds').notNull().default(604800),
		metadata: meta(),
		createdAt: ts('created_at').defaultNow().notNull(),
		updatedAt: ts('updated_at').defaultNow().notNull(),
	},
	(t) => ({
		idemUniq: uniqueIndex('ux_bank_escrows_idem').on(t.payerOwnerType, t.payerOwnerId, t.idempotencyKey),
		payerIdx: index('ix_bank_escrows_payer').on(t.payerOwnerType, t.payerOwnerId),
		payeeIdx: index('ix_bank_escrows_payee').on(t.payeeOwnerType, t.payeeOwnerId),
	}),
)

export const bankEscrowMilestones = pgTable(
	'bank_escrow_milestones',
	{
		id: text('id').primaryKey(),
		escrowId: text('escrow_id').notNull(),
		seq: integer('seq').notNull(),
		amountMinor: num('amount_minor').notNull(),
		description: varchar('description', { length: 280 }),
		status: varchar('status', { length: 16 }).$type<MilestoneStatus>().notNull().default('funded'),
		deliveryProof: text('delivery_proof'),
		deliveredAt: ts('delivered_at'),
		/** If undelivered by this time the job refunds the payer. */
		deliverBy: ts('deliver_by'),
		/** Set on delivery: payer silence until this time auto-releases to payee. */
		autoReleaseAt: ts('auto_release_at'),
		releasedMinor: num('released_minor').notNull().default('0'),
		refundedMinor: num('refunded_minor').notNull().default('0'),
		/** [{kind, transferId, amountMinor}] fund movements for this milestone. */
		settlement: jsonb('settlement').$type<Array<{ kind: string; transferId: string; amountMinor: string }>>().notNull().default([]),
		updatedAt: ts('updated_at').defaultNow().notNull(),
	},
	(t) => ({
		seqUniq: uniqueIndex('ux_bank_escrow_milestones_seq').on(t.escrowId, t.seq),
		timeoutIdx: index('ix_bank_escrow_milestones_status').on(t.status, t.autoReleaseAt),
	}),
)

export const bankEscrowEvents = pgTable(
	'bank_escrow_events',
	{
		id: text('id').primaryKey(),
		escrowId: text('escrow_id').notNull(),
		milestoneId: text('milestone_id'),
		actor: varchar('actor', { length: 96 }).notNull(),
		action: varchar('action', { length: 24 }).notNull(),
		fromStatus: varchar('from_status', { length: 16 }),
		toStatus: varchar('to_status', { length: 16 }),
		data: jsonb('data').$type<Record<string, unknown>>().notNull().default({}),
		createdAt: ts('created_at').defaultNow().notNull(),
	},
	(t) => ({ escrowIdx: index('ix_bank_escrow_events_escrow').on(t.escrowId, t.createdAt) }),
)

export type StreamStatus = 'active' | 'paused' | 'cancelled' | 'capped'

export const bankStreams = pgTable(
	'bank_streams',
	{
		id: text('id').primaryKey(),
		idempotencyKey: varchar('idempotency_key', { length: 128 }).notNull(),
		payerOwnerType: varchar('payer_owner_type', { length: 24 }).notNull(),
		payerOwnerId: varchar('payer_owner_id', { length: 64 }).notNull(),
		payeeOwnerType: varchar('payee_owner_type', { length: 24 }).notNull(),
		payeeOwnerId: varchar('payee_owner_id', { length: 64 }).notNull(),
		payerAccountId: text('payer_account_id').notNull(),
		payeeAccountId: text('payee_account_id').notNull(),
		asset: varchar('asset', { length: 16 }).notNull(),
		chain: varchar('chain', { length: 32 }).notNull(),
		kind: varchar('kind', { length: 8 }).$type<'rate' | 'metered'>().notNull(),
		/** rate: minor units per `periodSeconds` (exact integer math, no drift). */
		rateMinor: num('rate_minor'),
		periodSeconds: integer('period_seconds'),
		/** metered: minor units per unit. */
		unitPriceMinor: num('unit_price_minor'),
		capMinor: num('cap_minor').notNull(),
		dustMinor: num('dust_minor').notNull().default('0'),
		status: varchar('status', { length: 12 }).$type<StreamStatus>().notNull().default('active'),
		/** Whole seconds accrued up to the last pause/resume checkpoint. */
		activeSeconds: num('active_seconds').notNull().default('0'),
		resumedAt: ts('resumed_at'),
		units: num('units').notNull().default('0'),
		settledMinor: num('settled_minor').notNull().default('0'),
		settleSeq: integer('settle_seq').notNull().default(0),
		/** Settlement intent persisted before the transfer so retries reuse the exact amount + key. */
		pendingMinor: num('pending_minor'),
		lastError: text('last_error'),
		metadata: meta(),
		createdAt: ts('created_at').defaultNow().notNull(),
		updatedAt: ts('updated_at').defaultNow().notNull(),
		endedAt: ts('ended_at'),
	},
	(t) => ({
		idemUniq: uniqueIndex('ux_bank_streams_idem').on(t.payerOwnerType, t.payerOwnerId, t.idempotencyKey),
		payerIdx: index('ix_bank_streams_payer').on(t.payerOwnerType, t.payerOwnerId),
		payeeIdx: index('ix_bank_streams_payee').on(t.payeeOwnerType, t.payeeOwnerId),
		statusIdx: index('ix_bank_streams_status').on(t.status),
	}),
)

export const bankStreamUsage = pgTable(
	'bank_stream_usage',
	{
		id: text('id').primaryKey(),
		streamId: text('stream_id').notNull(),
		units: num('units').notNull(),
		idempotencyKey: varchar('idempotency_key', { length: 128 }).notNull(),
		createdAt: ts('created_at').defaultNow().notNull(),
	},
	(t) => ({ idemUniq: uniqueIndex('ux_bank_stream_usage_idem').on(t.streamId, t.idempotencyKey) }),
)

export type PayeeMethod = 'bank_account' | 'wallet' | 'local_rail'

export const bankPayees = pgTable(
	'bank_payees',
	{
		id: text('id').primaryKey(),
		ownerType: varchar('owner_type', { length: 24 }).notNull(),
		ownerId: varchar('owner_id', { length: 64 }).notNull(),
		kind: varchar('kind', { length: 12 }).$type<'worker' | 'contractor'>().notNull(),
		name: varchar('name', { length: 120 }).notNull(),
		method: varchar('method', { length: 16 }).$type<PayeeMethod>().notNull(),
		accountId: text('account_id'),
		address: varchar('address', { length: 128 }),
		chain: varchar('chain', { length: 32 }),
		railAccountId: varchar('rail_account_id', { length: 128 }),
		rail: varchar('rail', { length: 24 }),
		currency: varchar('currency', { length: 8 }).notNull(),
		/** The payee's own bank owner (enables earned-wage access). */
		linkedOwnerType: varchar('linked_owner_type', { length: 24 }),
		linkedOwnerId: varchar('linked_owner_id', { length: 64 }),
		tax: jsonb('tax').$type<Record<string, unknown>>().notNull().default({}),
		metadata: meta(),
		status: varchar('status', { length: 12 }).notNull().default('active'),
		createdAt: ts('created_at').defaultNow().notNull(),
		updatedAt: ts('updated_at').defaultNow().notNull(),
	},
	(t) => ({ ownerIdx: index('ix_bank_payees_owner').on(t.ownerType, t.ownerId) }),
)

export type PayrollRunStatus = 'draft' | 'approved' | 'executing' | 'completed' | 'partial' | 'failed' | 'cancelled'

export const bankPayrollRuns = pgTable(
	'bank_payroll_runs',
	{
		id: text('id').primaryKey(),
		ownerType: varchar('owner_type', { length: 24 }).notNull(),
		ownerId: varchar('owner_id', { length: 64 }).notNull(),
		fundingAccountId: text('funding_account_id').notNull(),
		asset: varchar('asset', { length: 16 }).notNull(),
		chain: varchar('chain', { length: 32 }).notNull(),
		label: varchar('label', { length: 120 }),
		status: varchar('status', { length: 12 }).$type<PayrollRunStatus>().notNull().default('draft'),
		totalMinor: num('total_minor').notNull(),
		/** Optional payout pool that advances payouts instantly (payer owes the pool). */
		poolId: text('pool_id'),
		approvalToken: varchar('approval_token', { length: 128 }),
		approvedBy: varchar('approved_by', { length: 96 }),
		scheduleId: text('schedule_id'),
		periodKey: varchar('period_key', { length: 32 }),
		createdAt: ts('created_at').defaultNow().notNull(),
		updatedAt: ts('updated_at').defaultNow().notNull(),
		executedAt: ts('executed_at'),
	},
	(t) => ({
		ownerIdx: index('ix_bank_payroll_runs_owner').on(t.ownerType, t.ownerId, t.createdAt),
		periodUniq: uniqueIndex('ux_bank_payroll_runs_period').on(t.scheduleId, t.periodKey),
	}),
)

export type PayrollItemStatus = 'pending' | 'converting' | 'paid' | 'failed'

export const bankPayrollItems = pgTable(
	'bank_payroll_items',
	{
		id: text('id').primaryKey(),
		runId: text('run_id').notNull(),
		lineNo: integer('line_no').notNull(),
		payeeId: text('payee_id').notNull(),
		/** In the run's funding asset. */
		amountMinor: num('amount_minor').notNull(),
		status: varchar('status', { length: 12 }).$type<PayrollItemStatus>().notNull().default('pending'),
		fxTransferId: text('fx_transfer_id'),
		transferId: text('transfer_id'),
		payout: jsonb('payout').$type<Record<string, unknown> | null>(),
		poolReceivableId: text('pool_receivable_id'),
		paidAmountMinor: num('paid_amount_minor'),
		paidAsset: varchar('paid_asset', { length: 16 }),
		error: text('error'),
		attempts: integer('attempts').notNull().default(0),
		memo: varchar('memo', { length: 140 }),
		createdAt: ts('created_at').defaultNow().notNull(),
		updatedAt: ts('updated_at').defaultNow().notNull(),
		paidAt: ts('paid_at'),
	},
	(t) => ({ lineUniq: uniqueIndex('ux_bank_payroll_items_line').on(t.runId, t.lineNo) }),
)

export const bankPayrollSchedules = pgTable(
	'bank_payroll_schedules',
	{
		id: text('id').primaryKey(),
		ownerType: varchar('owner_type', { length: 24 }).notNull(),
		ownerId: varchar('owner_id', { length: 64 }).notNull(),
		fundingAccountId: text('funding_account_id').notNull(),
		name: varchar('name', { length: 120 }).notNull(),
		frequency: varchar('frequency', { length: 12 }).$type<'weekly' | 'biweekly' | 'monthly'>().notNull(),
		timezone: varchar('timezone', { length: 64 }).notNull(),
		/** weekly/biweekly: 0=Sun..6=Sat. monthly: day of month 1-31 (clamped to month end). */
		dayOfWeek: integer('day_of_week'),
		dayOfMonth: integer('day_of_month'),
		localTime: varchar('local_time', { length: 5 }).notNull().default('09:00'),
		items: jsonb('items').$type<Array<{ payeeId: string; amountMinor: string; memo?: string }>>().notNull(),
		poolId: text('pool_id'),
		/** Owner pre-authorises unattended execution of runs from this schedule. */
		autoApprove: boolean('auto_approve').notNull().default(false),
		nextRunAt: ts('next_run_at').notNull(),
		lastPeriodKey: varchar('last_period_key', { length: 32 }),
		status: varchar('status', { length: 12 }).notNull().default('active'),
		createdAt: ts('created_at').defaultNow().notNull(),
		updatedAt: ts('updated_at').defaultNow().notNull(),
	},
	(t) => ({ dueIdx: index('ix_bank_payroll_schedules_due').on(t.status, t.nextRunAt) }),
)

export const bankPayoutPools = pgTable(
	'bank_payout_pools',
	{
		id: text('id').primaryKey(),
		operatorOwnerType: varchar('operator_owner_type', { length: 24 }).notNull(),
		operatorOwnerId: varchar('operator_owner_id', { length: 64 }).notNull(),
		poolAccountId: text('pool_account_id').notNull(),
		asset: varchar('asset', { length: 16 }).notNull(),
		chain: varchar('chain', { length: 32 }).notNull(),
		/** Applied to payers without an explicit entry. '0' = unknown payers get nothing. */
		defaultPayerLimitMinor: num('default_payer_limit_minor').notNull().default('0'),
		/** { "<ownerType>:<ownerId>": "<limitMinor>" } */
		payerLimits: jsonb('payer_limits').$type<Record<string, string>>().notNull().default({}),
		status: varchar('status', { length: 12 }).notNull().default('active'),
		createdAt: ts('created_at').defaultNow().notNull(),
	},
	(t) => ({ opIdx: index('ix_bank_payout_pools_op').on(t.operatorOwnerType, t.operatorOwnerId) }),
)

export const bankPoolReceivables = pgTable(
	'bank_pool_receivables',
	{
		id: text('id').primaryKey(),
		poolId: text('pool_id').notNull(),
		payerOwnerType: varchar('payer_owner_type', { length: 24 }).notNull(),
		payerOwnerId: varchar('payer_owner_id', { length: 64 }).notNull(),
		payerAccountId: text('payer_account_id').notNull(),
		amountMinor: num('amount_minor').notNull(),
		settledMinor: num('settled_minor').notNull().default('0'),
		status: varchar('status', { length: 12 }).$type<'open' | 'settling' | 'settled' | 'void'>().notNull().default('open'),
		payrollItemId: text('payroll_item_id'),
		payoutTransferId: text('payout_transfer_id'),
		settleTransferId: text('settle_transfer_id'),
		createdAt: ts('created_at').defaultNow().notNull(),
		settledAt: ts('settled_at'),
	},
	(t) => ({
		itemUniq: uniqueIndex('ux_bank_pool_receivables_item').on(t.payrollItemId),
		payerIdx: index('ix_bank_pool_receivables_payer').on(t.poolId, t.payerOwnerType, t.payerOwnerId, t.status),
	}),
)

export const bankWageAdvances = pgTable(
	'bank_wage_advances',
	{
		id: text('id').primaryKey(),
		sourceType: varchar('source_type', { length: 12 }).$type<'stream' | 'schedule'>().notNull(),
		sourceId: text('source_id').notNull(),
		workerOwnerType: varchar('worker_owner_type', { length: 24 }).notNull(),
		workerOwnerId: varchar('worker_owner_id', { length: 64 }).notNull(),
		payeeId: text('payee_id'),
		periodKey: varchar('period_key', { length: 32 }),
		amountMinor: num('amount_minor').notNull(),
		transferId: text('transfer_id'),
		idempotencyKey: varchar('idempotency_key', { length: 128 }).notNull(),
		createdAt: ts('created_at').defaultNow().notNull(),
	},
	(t) => ({
		idemUniq: uniqueIndex('ux_bank_wage_advances_idem').on(t.workerOwnerType, t.workerOwnerId, t.idempotencyKey),
		srcIdx: index('ix_bank_wage_advances_src').on(t.sourceType, t.sourceId, t.periodKey),
	}),
)

export type BankInvoice = typeof bankInvoices.$inferSelect
export type BankInvoicePayment = typeof bankInvoicePayments.$inferSelect
export type BankEscrow = typeof bankEscrows.$inferSelect
export type BankEscrowMilestone = typeof bankEscrowMilestones.$inferSelect
export type BankStream = typeof bankStreams.$inferSelect
export type BankPayee = typeof bankPayees.$inferSelect
export type BankPayrollRun = typeof bankPayrollRuns.$inferSelect
export type BankPayrollItem = typeof bankPayrollItems.$inferSelect
export type BankPayrollSchedule = typeof bankPayrollSchedules.$inferSelect
export type BankPayoutPool = typeof bankPayoutPools.$inferSelect
export type BankPoolReceivable = typeof bankPoolReceivables.$inferSelect
