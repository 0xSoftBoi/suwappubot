/**
 * Suwappu Bank M2 (Earn) + M3 (Credit) tables. Money = integer minor units as
 * numeric(78,0) strings. Mirrors database/bank_ddl/earn_credit.py and
 * drizzle/0027_bank_earn_credit.sql (idempotent, ADR 0003).
 */
import { index, integer, jsonb, numeric, pgTable, text, timestamp, uniqueIndex, varchar } from 'drizzle-orm/pg-core'

const num = (name: string) => numeric(name, { precision: 78, scale: 0 })

/** One savings position per (savings account, vault). Shares are the ERC-4626 shares held by the custody wallet. */
export const bankEarnPositions = pgTable('bank_earn_positions', {
	savingsAccountId: text('savings_account_id').primaryKey(),
	ownerType: varchar('owner_type', { length: 24 }).notNull(),
	ownerId: varchar('owner_id', { length: 64 }).notNull(),
	checkingAccountId: text('checking_account_id').notNull(),
	chain: varchar('chain', { length: 32 }).notNull(),
	asset: varchar('asset', { length: 16 }).notNull(),
	vault: varchar('vault', { length: 64 }).notNull(),
	/** Shares free in the wallet (withdrawable). */
	sharesMinor: num('shares_minor').notNull().default('0'),
	/** Shares currently pledged as Morpho collateral (M3). */
	pledgedSharesMinor: num('pledged_shares_minor').notNull().default('0'),
	realizedYieldMinor: num('realized_yield_minor').notNull().default('0'),
	createdAt: timestamp('created_at').defaultNow().notNull(),
	updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (t) => ({ ownerIdx: index('ix_bank_earn_pos_owner').on(t.ownerType, t.ownerId) }))

/** Every vault operation. Unique (owner, idempotency_key) makes deposit/withdraw/sweep replay-safe. */
export const bankEarnOps = pgTable('bank_earn_ops', {
	id: text('id').primaryKey(),
	ownerType: varchar('owner_type', { length: 24 }).notNull(),
	ownerId: varchar('owner_id', { length: 64 }).notNull(),
	idempotencyKey: varchar('idempotency_key', { length: 160 }).notNull(),
	requestHash: varchar('request_hash', { length: 64 }).notNull(),
	kind: varchar('kind', { length: 12 }).notNull(), // deposit | withdraw
	source: varchar('source', { length: 12 }).notNull().default('manual'), // manual | sweep
	savingsAccountId: text('savings_account_id').notNull(),
	checkingAccountId: text('checking_account_id').notNull(),
	vault: varchar('vault', { length: 64 }).notNull(),
	chain: varchar('chain', { length: 32 }).notNull(),
	assetsMinor: num('assets_minor').notNull(),
	sharesMinor: num('shares_minor'),
	status: varchar('status', { length: 12 }).notNull().default('pending'), // pending | confirmed | failed
	txHash: varchar('tx_hash', { length: 128 }),
	approveTxHash: varchar('approve_tx_hash', { length: 128 }),
	transferId: text('transfer_id'),
	failureReason: text('failure_reason'),
	metadata: jsonb('metadata').$type<Record<string, unknown>>().notNull().default({}),
	createdAt: timestamp('created_at').defaultNow().notNull(),
	updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (t) => ({
	idem: uniqueIndex('ux_bank_earn_ops_idem').on(t.ownerType, t.ownerId, t.idempotencyKey),
	statusIdx: index('ix_bank_earn_ops_status').on(t.status, t.updatedAt),
}))

export const bankEarnSettings = pgTable('bank_earn_settings', {
	accountId: text('account_id').primaryKey(),
	ownerType: varchar('owner_type', { length: 24 }).notNull(),
	ownerId: varchar('owner_id', { length: 64 }).notNull(),
	enabled: integer('enabled').notNull().default(1),
	floorMinor: num('floor_minor').notNull().default('0'),
	vault: varchar('vault', { length: 64 }).notNull(),
	minSweepMinor: num('min_sweep_minor').notNull().default('1000000'),
	lastSweepPeriod: varchar('last_sweep_period', { length: 16 }),
	createdAt: timestamp('created_at').defaultNow().notNull(),
	updatedAt: timestamp('updated_at').defaultNow().notNull(),
})

export const bankEarnSnapshots = pgTable('bank_earn_snapshots', {
	id: text('id').primaryKey(),
	savingsAccountId: text('savings_account_id').notNull(),
	vault: varchar('vault', { length: 64 }).notNull(),
	sharesMinor: num('shares_minor').notNull(),
	principalMinor: num('principal_minor').notNull(),
	valueMinor: num('value_minor').notNull(),
	period: varchar('period', { length: 16 }).notNull(),
	takenAt: timestamp('taken_at').defaultNow().notNull(),
}, (t) => ({ uniq: uniqueIndex('ux_bank_earn_snap_period').on(t.savingsAccountId, t.vault, t.period) }))

/** Credit line. kind: collateralized (Morpho Blue) | undercollateralized (lender pool) | receivable (pool, against an invoice). */
export const bankCreditLines = pgTable('bank_credit_lines', {
	id: text('id').primaryKey(),
	ownerType: varchar('owner_type', { length: 24 }).notNull(),
	ownerId: varchar('owner_id', { length: 64 }).notNull(),
	kind: varchar('kind', { length: 20 }).notNull(),
	status: varchar('status', { length: 12 }).notNull().default('active'), // active | closed
	chain: varchar('chain', { length: 32 }).notNull(),
	loanAsset: varchar('loan_asset', { length: 16 }).notNull(),
	/** Bank account that receives draws and pays repayments. */
	accountId: text('account_id').notNull(),
	/** Morpho market id (collateralized only). */
	marketId: varchar('market_id', { length: 66 }),
	collateralToken: varchar('collateral_token', { length: 64 }),
	collateralDecimals: integer('collateral_decimals'),
	/** When shares of an M2 vault are the collateral: the savings account id. */
	collateralSavingsAccountId: text('collateral_savings_account_id'),
	collateralMinor: num('collateral_minor').notNull().default('0'),
	/** Pool-funded lines. */
	poolAccountId: text('pool_account_id'),
	limitMinor: num('limit_minor').notNull().default('0'),
	principalMinor: num('principal_minor').notNull().default('0'),
	accruedInterestMinor: num('accrued_interest_minor').notNull().default('0'),
	aprBps: integer('apr_bps').notNull().default(0),
	lastAccrualAt: timestamp('last_accrual_at').defaultNow().notNull(),
	receivableId: varchar('receivable_id', { length: 64 }),
	faceMinor: num('face_minor'),
	lastLevel: varchar('last_level', { length: 10 }).notNull().default('ok'),
	metadata: jsonb('metadata').$type<Record<string, unknown>>().notNull().default({}),
	createdAt: timestamp('created_at').defaultNow().notNull(),
	updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (t) => ({
	ownerIdx: index('ix_bank_credit_lines_owner').on(t.ownerType, t.ownerId),
	kindIdx: index('ix_bank_credit_lines_kind').on(t.kind, t.status),
	recvIdx: index('ix_bank_credit_lines_recv').on(t.receivableId),
}))

export const bankCreditEvents = pgTable('bank_credit_events', {
	id: text('id').primaryKey(),
	lineId: text('line_id').notNull(),
	ownerType: varchar('owner_type', { length: 24 }).notNull(),
	ownerId: varchar('owner_id', { length: 64 }).notNull(),
	type: varchar('type', { length: 24 }).notNull(), // ltv_warn | ltv_critical | ltv_recovered | opened | draw | repay | collateral_withdrawn | receivable_settled
	level: varchar('level', { length: 10 }).notNull().default('info'),
	ltvBps: integer('ltv_bps'),
	healthFactorBps: integer('health_factor_bps'),
	data: jsonb('data').$type<Record<string, unknown>>().notNull().default({}),
	createdAt: timestamp('created_at').defaultNow().notNull(),
}, (t) => ({
	ownerIdx: index('ix_bank_credit_events_owner').on(t.ownerType, t.ownerId, t.createdAt),
	lineIdx: index('ix_bank_credit_events_line').on(t.lineId, t.createdAt),
}))

export const bankCreditScores = pgTable('bank_credit_scores', {
	id: text('id').primaryKey(),
	ownerType: varchar('owner_type', { length: 24 }).notNull(),
	ownerId: varchar('owner_id', { length: 64 }).notNull(),
	asset: varchar('asset', { length: 16 }).notNull(),
	chain: varchar('chain', { length: 32 }).notNull(),
	score: integer('score').notNull(), // 0..1000
	tier: varchar('tier', { length: 12 }).notNull(),
	proposedLimitMinor: num('proposed_limit_minor').notNull(),
	aprBps: integer('apr_bps').notNull(),
	factors: jsonb('factors').$type<Record<string, unknown>>().notNull().default({}),
	computedAt: timestamp('computed_at').defaultNow().notNull(),
}, (t) => ({ ownerIdx: index('ix_bank_credit_scores_owner').on(t.ownerType, t.ownerId, t.computedAt) }))

export type BankEarnPosition = typeof bankEarnPositions.$inferSelect
export type BankEarnOp = typeof bankEarnOps.$inferSelect
export type BankEarnSetting = typeof bankEarnSettings.$inferSelect
export type BankCreditLine = typeof bankCreditLines.$inferSelect
export type BankCreditEvent = typeof bankCreditEvents.$inferSelect
export type BankCreditScore = typeof bankCreditScores.$inferSelect
