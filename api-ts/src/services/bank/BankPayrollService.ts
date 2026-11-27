/**
 * BankPayrollService (M8) — MONEY-PATH. Payee directory, batch + recurring payroll, contractor payouts, receipts,
 * pool-backed instant payouts and earned-wage access against payroll schedules.
 *
 * Idempotency: every fund movement for an item uses `payroll:{runId}:{itemId}` (+ `:fx` for the conversion leg,
 * `:r{n}` suffix only after a definitively failed attempt n). Retries and job re-drives therefore replay the same
 * BankTransferService transfer instead of paying twice. Scheduled runs are unique per (scheduleId, periodKey).
 * Approvals (M9) and local-rail ramps are OPTIONAL sibling services reached through minimal local interfaces.
 */
import { and, desc, eq, inArray, lte, sql } from 'drizzle-orm'
import { Context, Effect, Layer, Option } from 'effect'
import {
	type BankPayee,
	type BankPayrollItem,
	type BankPayrollRun,
	type BankPayrollSchedule,
	bankPayees,
	bankPayrollItems,
	bankPayrollRuns,
	bankPayrollSchedules,
	bankPayoutPools,
	bankWageAdvances,
	type PayeeMethod,
} from '../../db'
import { logger } from '../../lib/logger'
import { type BankAsset, findAsset, listAssets, toMinor } from './assets'
import { consumeApprovalToken } from './BankApprovalService'
import { BankFxService } from './BankFxService'
import { BankRampService } from './BankRampService'
import { BankLedgerService } from './BankLedgerService'
import { BankPayoutPoolService } from './BankPayoutPoolService'
import { BankTransferService } from './BankTransferService'
import { isEvmAddress, isSolanaAddress } from './chain'
import { type BankOwner, bankDb } from './db'
import { type BankError, bankErr } from './errors'
import { guard, idemKey, ownerKey, type PayFx, parseMinor, sameOwner, subErr, toOwner, uid } from './paymentsCommon'
import { firstRun, localDateOf, nextAfter, parseLocalDate, periodBounds, type ScheduleSpec, validateSpec } from './payrollSchedule'

const TRANSIENT = new Set(['UPSTREAM', 'DB', 'SIGNING_UNAVAILABLE', 'WALLET_UNAVAILABLE'])
const running = new Set<string>()

export interface PayeeInput {
	kind: 'worker' | 'contractor'
	name: string
	method: PayeeMethod
	accountId?: string | undefined
	address?: string | undefined
	chain?: string | undefined
	railAccountId?: string | undefined
	rail?: string | undefined
	currency: string
	linkedOwner?: BankOwner | undefined
	tax?: Record<string, unknown> | undefined
	metadata?: Record<string, unknown> | undefined
}

export interface RunItemInput {
	payeeId: string
	amountMinor?: string | undefined
	/** Human decimal in the funding asset (CSV-style). */
	amount?: string | undefined
	memo?: string | undefined
}

export interface RunPreview {
	run: BankPayrollRun
	items: Array<{ item: BankPayrollItem; payee: Pick<BankPayee, 'id' | 'name' | 'method' | 'currency'>; conversion: { needed: boolean; to?: string }; routable: boolean; issue?: string }>
	totalMinor: string
	fundingBalanceMinor: string
	sufficientFunds: boolean
	usesPool: boolean
	approvalRequired: boolean
}

export interface Receipt {
	itemId: string
	runId: string
	payee: string
	status: string
	amountMinor: string
	asset: string
	paidAmountMinor: string | null
	paidAsset: string | null
	transferId: string | null
	fxTransferId: string | null
	txHash: string | null
	paidAt: string | null
	error: string | null
}

export interface ScheduleInput {
	fundingAccountId: string
	name: string
	frequency: 'weekly' | 'biweekly' | 'monthly'
	timezone: string
	dayOfWeek?: number | undefined
	dayOfMonth?: number | undefined
	localTime?: string | undefined
	items: Array<{ payeeId: string; amountMinor: string; memo?: string | undefined; ewaBps?: number | undefined }>
	poolId?: string | undefined
	autoApprove?: boolean | undefined
}

export interface BankPayrollServiceInterface {
	readonly createPayee: (owner: BankOwner, input: PayeeInput) => PayFx<BankPayee>
	readonly listPayees: (owner: BankOwner) => PayFx<BankPayee[]>
	readonly archivePayee: (owner: BankOwner, id: string) => PayFx<BankPayee>
	readonly createRun: (owner: BankOwner, input: { fundingAccountId: string; label?: string | undefined; poolId?: string | undefined; items: RunItemInput[] }) => PayFx<RunPreview>
	readonly previewRun: (owner: BankOwner, runId: string) => PayFx<RunPreview>
	readonly approveRun: (owner: BankOwner, runId: string, approvalToken?: string) => PayFx<BankPayrollRun>
	readonly executeRun: (owner: BankOwner, runId: string) => PayFx<{ run: BankPayrollRun; items: BankPayrollItem[] }>
	/** Re-run ONLY the failed items of a run. */
	readonly retryFailed: (owner: BankOwner, runId: string) => PayFx<{ run: BankPayrollRun; items: BankPayrollItem[] }>
	readonly listRuns: (owner: BankOwner) => PayFx<BankPayrollRun[]>
	readonly getReceipts: (owner: BankOwner, runId: string) => PayFx<Receipt[]>
	/** Payee-side: receipts for payouts to payees linked to this owner. */
	readonly myPayouts: (owner: BankOwner) => PayFx<Receipt[]>
	readonly createSchedule: (owner: BankOwner, input: ScheduleInput) => PayFx<BankPayrollSchedule>
	readonly listSchedules: (owner: BankOwner) => PayFx<BankPayrollSchedule[]>
	readonly setScheduleStatus: (owner: BankOwner, id: string, status: 'active' | 'paused' | 'cancelled') => PayFx<BankPayrollSchedule>
	/** Earned-wage access against a payroll schedule's current-period accrual. */
	readonly advanceScheduleWages: (worker: BankOwner, scheduleId: string, payeeId: string, amountMinor: string, idempotencyKey: string) => PayFx<{ advanceId: string; transferId: string | null; availableAfterMinor: string }>
	readonly scheduleAdvanceAvailable: (worker: BankOwner, scheduleId: string, payeeId: string) => PayFx<{ accruedMinor: string; advancedMinor: string; availableMinor: string; ewaBps: number }>
	readonly runJob: () => PayFx<{ schedulesRun: number; itemsDriven: number }>
}

export class BankPayrollService extends Context.Tag('BankPayrollService')<BankPayrollService, BankPayrollServiceInterface>() {}

// ------------------------------------------------------------------ loaders

const loadRun = (owner: BankOwner, id: string): PayFx<BankPayrollRun> =>
	bankDb(async (db) => {
		const [r] = await db.select().from(bankPayrollRuns).where(and(eq(bankPayrollRuns.id, id), eq(bankPayrollRuns.ownerType, owner.ownerType), eq(bankPayrollRuns.ownerId, owner.ownerId))).limit(1)
		if (!r) throw bankErr('NOT_FOUND', 'Payroll run not found')
		return r
	})

const loadRunById = (id: string) =>
	bankDb(async (db) => {
		const [r] = await db.select().from(bankPayrollRuns).where(eq(bankPayrollRuns.id, id)).limit(1)
		if (!r) throw bankErr('NOT_FOUND', 'Payroll run not found')
		return r
	})

const runItems = (runId: string) => bankDb((db) => db.select().from(bankPayrollItems).where(eq(bankPayrollItems.runId, runId)).orderBy(bankPayrollItems.lineNo))

const loadPayee = (id: string) =>
	bankDb(async (db) => {
		const [p] = await db.select().from(bankPayees).where(eq(bankPayees.id, id)).limit(1)
		if (!p) throw bankErr('NOT_FOUND', `Payee ${id} not found`)
		return p
	})

const runOwner = (r: BankPayrollRun): BankOwner => toOwner(r.ownerType, r.ownerId)

// ------------------------------------------------------------------ routing

interface Target {
	asset: BankAsset | null
	toAccountId?: string
	toExternal?: { address: string }
	convert: boolean
	rail: boolean
}

const resolveTarget = (run: BankPayrollRun, payee: BankPayee): PayFx<Target> =>
	Effect.gen(function* () {
		const ledger = yield* BankLedgerService
		const fa = findAsset(run.asset, run.chain)
		if (!fa) return yield* Effect.fail(bankErr('ASSET_UNSUPPORTED', `Unsupported funding asset ${run.asset} on ${run.chain}`))
		if (payee.method === 'local_rail') return { asset: null, convert: false, rail: true }
		if (payee.method === 'bank_account') {
			if (!payee.accountId) return yield* Effect.fail(bankErr('VALIDATION', 'Payee has no accountId'))
			const acct = yield* ledger.getAccountById(payee.accountId)
			if (acct.status !== 'active') return yield* Effect.fail(bankErr('ACCOUNT_STATE', `Payee account is ${acct.status}`))
			if (acct.chain !== run.chain) return yield* Effect.fail(bankErr('VALIDATION', `Payee account is on ${acct.chain}; payroll funds are on ${run.chain} (cross-chain payout not supported)`))
			const a = findAsset(acct.asset, acct.chain)
			if (!a) return yield* Effect.fail(bankErr('ASSET_UNSUPPORTED', `Unsupported payee asset ${acct.asset}`))
			return { asset: a, toAccountId: acct.id, convert: a.symbol !== fa.symbol, rail: false }
		}
		if (!payee.address || payee.chain !== run.chain) return yield* Effect.fail(bankErr('VALIDATION', `Wallet payee must have an address on ${run.chain}`))
		if (payee.currency === fa.currency) return { asset: fa, toExternal: { address: payee.address }, convert: false, rail: false }
		const target = listAssets({ chain: run.chain, currency: payee.currency })[0]
		if (!target) return yield* Effect.fail(bankErr('ASSET_UNSUPPORTED', `No ${payee.currency} asset on ${run.chain}`))
		return { asset: target, toExternal: { address: payee.address }, convert: true, rail: false }
	})

const payerAccountIn = (run: BankPayrollRun, asset: BankAsset, create: boolean): PayFx<string> =>
	Effect.gen(function* () {
		const ledger = yield* BankLedgerService
		const owner = runOwner(run)
		const mine = (yield* ledger.getAccounts(owner)).find((a) => a.asset === asset.symbol && a.chain === asset.chain && a.status === 'active' && (a.kind === 'checking' || a.label === 'payroll-fx'))
		if (mine) return mine.id
		if (!create) return yield* Effect.fail(bankErr('NOT_FOUND', `No ${asset.symbol} account for payroll conversion`))
		const fund = yield* ledger.getAccountById(run.fundingAccountId)
		if (fund.walletId == null || fund.walletUserId == null || !fund.address) return yield* Effect.fail(bankErr('WALLET_UNAVAILABLE', 'Funding account has no custody wallet'))
		const a = yield* ledger.openAccount({ owner, kind: 'checking', asset: asset.symbol, chain: asset.chain, label: 'payroll-fx', wallet: { walletId: fund.walletId, walletUserId: fund.walletUserId, address: fund.address } })
		return a.id
	})

const itemKey = (run: BankPayrollRun, item: BankPayrollItem, leg?: 'fx') => {
	const base = ['payroll', run.id, item.id]
	if (leg) base.push(leg)
	if (item.attempts > 0) base.push(`r${item.attempts}`)
	return idemKey(...base)
}

// ------------------------------------------------------------------ item state machine

const setItem = (id: string, patch: Partial<typeof bankPayrollItems.$inferInsert>) =>
	bankDb((db) => db.update(bankPayrollItems).set({ ...patch, updatedAt: new Date() }).where(eq(bankPayrollItems.id, id)))

const failItem = (item: BankPayrollItem, message: string, patch: Partial<typeof bankPayrollItems.$inferInsert> = {}) =>
	setItem(item.id, { status: 'failed', error: message.slice(0, 500), attempts: item.attempts + 1, ...patch })

/** MONEY-PATH. Advance one item as far as it can go right now. Never throws for item-level problems. */
const driveItem = (run: BankPayrollRun, item: BankPayrollItem): PayFx<void> =>
	Effect.gen(function* () {
		if (item.status === 'paid' || item.status === 'failed') return
		const xfer = yield* BankTransferService
		const fx = yield* BankFxService
		const owner = runOwner(run)
		const payee = yield* loadPayee(item.payeeId)
		const amount = BigInt(item.amountMinor)
		const pool = run.poolId ? (yield* bankDb((db) => db.select().from(bankPayoutPools).where(eq(bankPayoutPools.id, run.poolId!)).limit(1)))[0] : undefined
		const ownerOfTransfer = pool ? toOwner(pool.operatorOwnerType, pool.operatorOwnerId) : owner

		// In-flight payment leg: settle from the transfer's real state.
		if (item.transferId) {
			const t = yield* xfer.getTransfer(ownerOfTransfer, item.transferId)
			if (t.status === 'confirmed') return yield* setItem(item.id, { status: 'paid', paidAt: new Date(), paidAmountMinor: t.amountMinor, paidAsset: t.asset, error: null })
			if (t.status === 'failed' || t.status === 'reversed') return yield* failItem(item, t.failureReason ?? 'payout transfer failed', { transferId: null })
			return
		}

		const rampId = (item.payout as { rampTransferId?: string } | null)?.rampTransferId
		if (rampId) {
			const ramp = yield* Effect.serviceOption(BankRampService)
			if (Option.isNone(ramp)) return
			const rt = yield* ramp.value.getRampTransfer(owner, rampId)
			if (rt.status === 'completed') return yield* setItem(item.id, { status: 'paid', paidAt: new Date(), paidAmountMinor: item.amountMinor, paidAsset: run.asset, payout: { rampTransferId: rampId, state: rt.status }, error: null })
			if (rt.status === 'failed' || rt.status === 'returned' || rt.status === 'refunded') return yield* failItem(item, `Local payout ${rt.status}`, { payout: null })
			return
		}
		const target = yield* resolveTarget(run, payee)

		// Local rail: ramp module (optional).
		if (target.rail) {
			if (run.poolId) return yield* failItem(item, 'Pool payouts do not support local-rail payees')
			const ramp = yield* Effect.serviceOption(BankRampService)
			if (Option.isNone(ramp)) return yield* Effect.fail(subErr('RAMP_UNAVAILABLE', 'NOT_CONFIGURED', 'Local-rail payouts need the ramp module (BankRampService)', 'BankRampService'))
			if (!payee.railAccountId) return yield* Effect.fail(bankErr('VALIDATION', 'Payee has no registered external account (railAccountId)'))
			const r = yield* ramp.value
				.offramp({ owner, fromAccountId: run.fundingAccountId, externalAccountId: payee.railAccountId, amountMinor: item.amountMinor, idempotencyKey: itemKey(run, item) })
				.pipe(Effect.mapError((e) => (e.code === 'NOT_CONFIGURED' ? subErr('RAMP_UNAVAILABLE', 'NOT_CONFIGURED', e.message, e.missing) : e)))
			yield* setItem(item.id, { status: 'converting', payout: { rampTransferId: r.rampTransfer.id, state: r.rampTransfer.status }, error: null })
			return
		}

		// Conversion leg.
		let sourceAccountId = run.fundingAccountId
		let payAmount = amount
		if (target.convert) {
			if (run.poolId) return yield* failItem(item, 'Pool payouts do not support currency conversion')
			const toAcct = yield* payerAccountIn(run, target.asset!, !item.fxTransferId)
			if (!item.fxTransferId) {
				const out = yield* fx.execute({ owner, idempotencyKey: itemKey(run, item, 'fx'), fromAccountId: run.fundingAccountId, toAccountId: toAcct, amountMinor: item.amountMinor })
				yield* setItem(item.id, { status: 'converting', fxTransferId: out.transfer.id })
				item = { ...item, fxTransferId: out.transfer.id }
			}
			const ft = yield* xfer.getTransfer(owner, item.fxTransferId!)
			if (ft.status === 'failed' || ft.status === 'reversed') return yield* failItem(item, ft.failureReason ?? 'conversion failed', { fxTransferId: null })
			if (ft.status !== 'confirmed') return
			const received = (ft.metadata as { fx?: { receivedMinor?: string } }).fx?.receivedMinor
			if (!received) return yield* setItem(item.id, { error: 'conversion confirmed but received amount not recorded; needs review' })
			payAmount = BigInt(received)
			sourceAccountId = toAcct
		}

		// Payment leg.
		if (run.poolId) {
			const poolSvc = yield* BankPayoutPoolService
			const r = yield* poolSvc.advancePayout({ poolId: run.poolId, payer: owner, payerAccountId: run.fundingAccountId, toAccountId: target.toAccountId, toExternal: target.toExternal, amountMinor: payAmount.toString(), itemKey: item.id, memo: item.memo ?? 'Payroll' })
			yield* setItem(item.id, { status: r.status === 'confirmed' ? 'paid' : 'converting', transferId: r.transferId, poolReceivableId: r.receivable.id, paidAmountMinor: r.status === 'confirmed' ? payAmount.toString() : null, paidAsset: run.asset, paidAt: r.status === 'confirmed' ? new Date() : null, error: null })
			return
		}
		const t = yield* xfer.transfer({
			owner,
			idempotencyKey: itemKey(run, item),
			type: 'payroll',
			fromAccountId: sourceAccountId,
			toAccountId: target.toAccountId,
			toExternal: target.toExternal,
			amountMinor: payAmount.toString(),
			memo: item.memo ?? run.label ?? 'Payroll',
			metadata: { runId: run.id, itemId: item.id, payeeId: item.payeeId, module: 'payroll' },
		})
		if (t.status === 'confirmed') yield* setItem(item.id, { status: 'paid', transferId: t.id, paidAt: new Date(), paidAmountMinor: t.amountMinor, paidAsset: t.asset, error: null })
		else if (t.status === 'failed' || t.status === 'reversed') yield* failItem(item, t.failureReason ?? 'payout failed', { transferId: null })
		else yield* setItem(item.id, { status: 'converting', transferId: t.id, error: null })
	}).pipe(
		Effect.asVoid,
		Effect.catchAll((e: BankError) =>
			TRANSIENT.has(e.code) || e.code === 'NOT_CONFIGURED'
				? setItem(item.id, { error: e.message.slice(0, 500) }) // stays pending/converting; the job re-drives it
				: failItem(item, e.message),
		),
		Effect.asVoid,
	)

const finalizeRun = (runId: string): PayFx<BankPayrollRun> =>
	Effect.gen(function* () {
		const items = yield* runItems(runId)
		const open = items.some((i) => i.status === 'pending' || i.status === 'converting')
		const failed = items.filter((i) => i.status === 'failed').length
		const paid = items.filter((i) => i.status === 'paid').length
		const status = open ? 'executing' : failed === 0 ? 'completed' : paid === 0 ? 'failed' : 'partial'
		const [r] = yield* bankDb((db) =>
			db.update(bankPayrollRuns).set({ status, updatedAt: new Date(), ...(open ? {} : { executedAt: new Date() }) }).where(and(eq(bankPayrollRuns.id, runId), inArray(bankPayrollRuns.status, ['executing', 'approved']))).returning(),
		)
		return r ?? (yield* loadRunById(runId))
	})

/** Drive every open item of a run; single-flight per process. */
const driveRun = (runId: string): PayFx<number> =>
	Effect.gen(function* () {
		if (running.has(runId)) return 0
		running.add(runId)
		try {
			const run = yield* loadRunById(runId)
			let n = 0
			for (const item of yield* runItems(runId)) {
				if (item.status !== 'pending' && item.status !== 'converting') continue
				yield* driveItem(run, item)
				n++
			}
			yield* finalizeRun(runId)
			return n
		} finally {
			running.delete(runId)
		}
	})

// ------------------------------------------------------------------ builders

const buildItems = (run: { fundingAsset: BankAsset }, payees: Map<string, BankPayee>, rows: RunItemInput[]) =>
	guard(() =>
		rows.map((r, i) => {
			const p = payees.get(r.payeeId)
			if (!p || p.status !== 'active') throw bankErr('VALIDATION', `Row ${i + 1}: unknown or archived payee ${r.payeeId}`)
			if ((r.amountMinor ? 1 : 0) + (r.amount ? 1 : 0) !== 1) throw bankErr('VALIDATION', `Row ${i + 1}: provide exactly one of amountMinor or amount`)
			const minor = r.amountMinor ? parseMinor(r.amountMinor) : toMinor(r.amount!, run.fundingAsset.decimals)
			if (minor <= 0n) throw bankErr('VALIDATION', `Row ${i + 1}: amount must be positive`)
			return { payeeId: p.id, amountMinor: minor, memo: r.memo }
		}),
	)

const previewOf = (run: BankPayrollRun): PayFx<RunPreview> =>
	Effect.gen(function* () {
		const ledger = yield* BankLedgerService
		const items = yield* runItems(run.id)
				const balance = yield* ledger.balance(run.fundingAccountId)
		const outItems: RunPreview['items'] = []
		for (const item of items) {
			const payee = yield* loadPayee(item.payeeId)
			const t = yield* resolveTarget(run, payee).pipe(Effect.either)
			outItems.push({
				item,
				payee: { id: payee.id, name: payee.name, method: payee.method, currency: payee.currency },
				conversion: t._tag === 'Right' ? { needed: t.right.convert, ...(t.right.asset ? { to: t.right.asset.symbol } : {}) } : { needed: false },
				routable: t._tag === 'Right',
				...(t._tag === 'Left' ? { issue: t.left.message } : {}),
			})
		}
		const outstanding = items.filter((i) => i.status === 'pending' || i.status === 'failed').reduce((s, i) => s + BigInt(i.amountMinor), 0n)
		return { run, items: outItems, totalMinor: run.totalMinor, fundingBalanceMinor: balance.toString(), sufficientFunds: !!run.poolId || balance >= outstanding, usesPool: !!run.poolId, approvalRequired: run.ownerType === 'org' }
	})

const insertRun = (owner: BankOwner, p: { fundingAccountId: string; asset: string; chain: string; label?: string | undefined; poolId?: string | undefined; scheduleId?: string | undefined; periodKey?: string | undefined; status: 'draft' | 'approved'; approvedBy?: string; rows: Array<{ payeeId: string; amountMinor: bigint; memo?: string | undefined }> }) =>
	bankDb((db) =>
		db.transaction(async (tx) => {
			const total = p.rows.reduce((s, r) => s + r.amountMinor, 0n)
			const [run] = await tx
				.insert(bankPayrollRuns)
				.values({ id: uid('prun'), ownerType: owner.ownerType, ownerId: owner.ownerId, fundingAccountId: p.fundingAccountId, asset: p.asset, chain: p.chain, label: p.label ?? null, status: p.status, totalMinor: total.toString(), poolId: p.poolId ?? null, scheduleId: p.scheduleId ?? null, periodKey: p.periodKey ?? null, approvedBy: p.approvedBy ?? null })
				.onConflictDoNothing()
				.returning()
			if (!run) return null
			if (p.rows.length) await tx.insert(bankPayrollItems).values(p.rows.map((r, i) => ({ id: uid('pitem'), runId: run.id, lineNo: i + 1, payeeId: r.payeeId, amountMinor: r.amountMinor.toString(), memo: r.memo?.slice(0, 140) ?? null })))
			return run
		}),
	)

const accrualFor = (sch: BankPayrollSchedule, item: { amountMinor: string }, now: Date) => {
	const spec: ScheduleSpec = { frequency: sch.frequency, timezone: sch.timezone, dayOfWeek: sch.dayOfWeek, dayOfMonth: sch.dayOfMonth, localTime: sch.localTime }
	const end = localDateOf(sch.nextRunAt, sch.timezone)
	const b = periodBounds(spec, end)
	const span = BigInt(b.end.getTime() - b.start.getTime())
	const el = BigInt(Math.max(0, Math.min(now.getTime(), b.end.getTime()) - b.start.getTime()))
	return { periodKey: `${end.y}-${String(end.m).padStart(2, '0')}-${String(end.d).padStart(2, '0')}`, accrued: span > 0n ? (BigInt(item.amountMinor) * el) / span : 0n }
}

const advancedIn = (scheduleId: string, payeeId: string, periodKey: string) =>
	bankDb(async (db) => {
		const r = await db.execute(sql`select coalesce(sum(amount_minor),0)::text as s from bank_wage_advances where source_type = 'schedule' and source_id = ${scheduleId} and payee_id = ${payeeId} and period_key = ${periodKey}`)
		return BigInt((r as unknown as Array<{ s: string }>)[0]?.s ?? '0')
	})

const specOf = (s: BankPayrollSchedule): ScheduleSpec => ({ frequency: s.frequency, timezone: s.timezone, dayOfWeek: s.dayOfWeek, dayOfMonth: s.dayOfMonth, localTime: s.localTime })

// ------------------------------------------------------------------ service

const scheduleAvail = (worker: BankOwner, scheduleId: string, payeeId: string): PayFx<{ accruedMinor: string; advancedMinor: string; availableMinor: string; ewaBps: number }> =>
	Effect.gen(function* () {
		const [sch] = yield* bankDb((db) => db.select().from(bankPayrollSchedules).where(eq(bankPayrollSchedules.id, scheduleId)).limit(1))
		const payee = yield* loadPayee(payeeId)
		if (!sch || !payee.linkedOwnerType || !sameOwner(worker, toOwner(payee.linkedOwnerType, payee.linkedOwnerId!))) return yield* Effect.fail(bankErr('NOT_FOUND', 'Schedule not found'))
		const item = sch.items.find((i) => i.payeeId === payeeId)
		if (!item || sch.status !== 'active') return yield* Effect.fail(bankErr('NOT_FOUND', 'No active salary for this worker on the schedule'))
		const bps = item.ewaBps ?? 0
		const { periodKey, accrued } = accrualFor(sch, item, new Date())
		const advanced = yield* advancedIn(sch.id, payeeId, periodKey)
		const cap = (accrued * BigInt(bps)) / 10_000n - advanced
		return { accruedMinor: accrued.toString(), advancedMinor: advanced.toString(), availableMinor: (cap > 0n ? cap : 0n).toString(), ewaBps: bps }
	})

export const BankPayrollServiceLive = Layer.succeed(BankPayrollService, {
	createPayee: (owner, input) =>
		Effect.gen(function* () {
			const ledger = yield* BankLedgerService
			const cur = input.currency.toUpperCase()
			if (!/^[A-Z]{3}$/.test(cur)) return yield* Effect.fail(bankErr('VALIDATION', 'currency must be an ISO 4217 code'))
			if (input.method === 'bank_account') {
				if (!input.accountId) return yield* Effect.fail(bankErr('VALIDATION', 'bank_account payees need accountId'))
				const a = yield* ledger.getAccountById(input.accountId)
				if (a.ownerType === 'system') return yield* Effect.fail(bankErr('VALIDATION', 'Cannot pay a system account'))
			} else if (input.method === 'wallet') {
				if (!input.address || !input.chain) return yield* Effect.fail(bankErr('VALIDATION', 'wallet payees need address and chain'))
				const fam = input.chain === 'solana' ? 'solana' : 'evm'
				if (!(fam === 'evm' ? isEvmAddress(input.address) : isSolanaAddress(input.address))) return yield* Effect.fail(bankErr('VALIDATION', `Invalid ${fam} address`))
			} else if (!input.railAccountId) return yield* Effect.fail(bankErr('VALIDATION', 'local_rail payees need railAccountId'))
			const [row] = yield* bankDb((db) =>
				db.insert(bankPayees).values({ id: uid('payee'), ownerType: owner.ownerType, ownerId: owner.ownerId, kind: input.kind, name: input.name, method: input.method, accountId: input.accountId ?? null, address: input.address ?? null, chain: input.chain ?? null, railAccountId: input.railAccountId ?? null, rail: input.rail ?? null, currency: cur, linkedOwnerType: input.linkedOwner?.ownerType ?? null, linkedOwnerId: input.linkedOwner?.ownerId ?? null, tax: input.tax ?? {}, metadata: input.metadata ?? {} }).returning(),
			)
			return row!
		}),

	listPayees: (owner) => bankDb((db) => db.select().from(bankPayees).where(and(eq(bankPayees.ownerType, owner.ownerType), eq(bankPayees.ownerId, owner.ownerId), eq(bankPayees.status, 'active'))).orderBy(desc(bankPayees.createdAt))),

	archivePayee: (owner, id) =>
		bankDb(async (db) => {
			const [r] = await db.update(bankPayees).set({ status: 'archived', updatedAt: new Date() }).where(and(eq(bankPayees.id, id), eq(bankPayees.ownerType, owner.ownerType), eq(bankPayees.ownerId, owner.ownerId))).returning()
			if (!r) throw bankErr('NOT_FOUND', 'Payee not found')
			return r
		}),

	createRun: (owner, input) =>
		Effect.gen(function* () {
			const ledger = yield* BankLedgerService
			const fund = yield* ledger.getAccount(owner, input.fundingAccountId)
			if (fund.status !== 'active') return yield* Effect.fail(bankErr('ACCOUNT_STATE', `Funding account is ${fund.status}`))
			const fa = findAsset(fund.asset, fund.chain)
			if (!fa) return yield* Effect.fail(bankErr('ASSET_UNSUPPORTED', 'Unsupported funding asset'))
			if (input.items.length === 0 || input.items.length > 1000) return yield* Effect.fail(bankErr('VALIDATION', 'A run needs 1-1000 items'))
			if (input.poolId) {
				const [p] = yield* bankDb((db) => db.select().from(bankPayoutPools).where(eq(bankPayoutPools.id, input.poolId!)).limit(1))
				if (!p || p.asset !== fund.asset || p.chain !== fund.chain) return yield* Effect.fail(bankErr('VALIDATION', 'Pool not found or denominated differently from the funding account'))
			}
			const ids = [...new Set(input.items.map((i) => i.payeeId))]
			const payeeRows = yield* bankDb((db) => db.select().from(bankPayees).where(and(inArray(bankPayees.id, ids), eq(bankPayees.ownerType, owner.ownerType), eq(bankPayees.ownerId, owner.ownerId))))
			const rows = yield* buildItems({ fundingAsset: fa }, new Map(payeeRows.map((p) => [p.id, p])), input.items)
			const run = yield* insertRun(owner, { fundingAccountId: fund.id, asset: fund.asset, chain: fund.chain, label: input.label, poolId: input.poolId, status: 'draft', rows })
			return yield* previewOf(run!)
		}),

	previewRun: (owner, runId) => loadRun(owner, runId).pipe(Effect.flatMap(previewOf)),

	approveRun: (owner, runId, approvalToken) =>
		Effect.gen(function* () {
			const run = yield* loadRun(owner, runId)
			if (run.status === 'approved') return run
			if (run.status !== 'draft') return yield* Effect.fail(bankErr('CONFLICT', `Run is ${run.status}`))
			let approvedBy = ownerKey(owner)
			if (run.ownerType === 'org') {
				if (!approvalToken) return yield* Effect.fail(subErr('APPROVAL_REQUIRED', 'FORBIDDEN', 'Organisation payroll requires an approval token bound to {runId, totalMinor}'))
				const r = yield* consumeApprovalToken(approvalToken, { orgId: run.ownerId, action: 'payroll_run', payload: { runId: run.id, totalMinor: run.totalMinor } })
				approvedBy = `approval:${r.requestId}`
			} else if (approvalToken) return yield* Effect.fail(bankErr('VALIDATION', 'approvalToken only applies to organisation payroll'))
			const [r] = yield* bankDb((db) =>
				db.update(bankPayrollRuns).set({ status: 'approved', approvalToken: approvalToken ?? null, approvedBy, updatedAt: new Date() }).where(and(eq(bankPayrollRuns.id, run.id), eq(bankPayrollRuns.status, 'draft'))).returning(),
			)
			return r ?? (yield* loadRun(owner, runId))
		}),

	// MONEY-PATH
	executeRun: (owner, runId) =>
		Effect.gen(function* () {
			const ledger = yield* BankLedgerService
			const run = yield* loadRun(owner, runId)
			if (run.status !== 'approved' && run.status !== 'executing') return yield* Effect.fail(bankErr('CONFLICT', `Run is ${run.status}; approve it first`))
			if (!run.poolId) {
				const items = yield* runItems(run.id)
				const need = items.filter((i) => i.status === 'pending').reduce((s, i) => s + BigInt(i.amountMinor), 0n)
				const bal = yield* ledger.balance(run.fundingAccountId)
				if (bal < need) return yield* Effect.fail(bankErr('INSUFFICIENT_FUNDS', `Funding balance ${bal} is below the ${need} needed for this run`))
			}
			yield* bankDb((db) => db.update(bankPayrollRuns).set({ status: 'executing', updatedAt: new Date() }).where(and(eq(bankPayrollRuns.id, run.id), eq(bankPayrollRuns.status, 'approved'))))
			yield* driveRun(run.id)
			return { run: yield* loadRun(owner, runId), items: yield* runItems(run.id) }
		}),

	retryFailed: (owner, runId) =>
		Effect.gen(function* () {
			const run = yield* loadRun(owner, runId)
			if (run.status !== 'partial' && run.status !== 'failed') return yield* Effect.fail(bankErr('CONFLICT', `Run is ${run.status}; only partial/failed runs can be retried`))
			const reset = yield* bankDb((db) =>
				db.update(bankPayrollItems).set({ status: 'pending', error: null, updatedAt: new Date() }).where(and(eq(bankPayrollItems.runId, run.id), eq(bankPayrollItems.status, 'failed'))).returning({ id: bankPayrollItems.id }),
			)
			if (reset.length === 0) return { run, items: yield* runItems(run.id) }
			yield* bankDb((db) => db.update(bankPayrollRuns).set({ status: 'approved', updatedAt: new Date() }).where(eq(bankPayrollRuns.id, run.id)))
			const ledger = yield* BankLedgerService
			if (!run.poolId) {
				const items = yield* runItems(run.id)
				const need = items.filter((i) => i.status === 'pending' && !i.fxTransferId).reduce((s, i) => s + BigInt(i.amountMinor), 0n)
				const bal = yield* ledger.balance(run.fundingAccountId)
				if (bal < need) {
					yield* bankDb((db) => db.update(bankPayrollRuns).set({ status: 'partial', updatedAt: new Date() }).where(eq(bankPayrollRuns.id, run.id)))
					yield* bankDb((db) => db.update(bankPayrollItems).set({ status: 'failed' }).where(and(eq(bankPayrollItems.runId, run.id), inArray(bankPayrollItems.id, reset.map((r) => r.id)))))
					return yield* Effect.fail(bankErr('INSUFFICIENT_FUNDS', `Funding balance ${bal} is below the ${need} needed to retry`))
				}
			}
			yield* bankDb((db) => db.update(bankPayrollRuns).set({ status: 'executing', updatedAt: new Date() }).where(eq(bankPayrollRuns.id, run.id)))
			yield* driveRun(run.id)
			return { run: yield* loadRun(owner, runId), items: yield* runItems(run.id) }
		}),

	listRuns: (owner) => bankDb((db) => db.select().from(bankPayrollRuns).where(and(eq(bankPayrollRuns.ownerType, owner.ownerType), eq(bankPayrollRuns.ownerId, owner.ownerId))).orderBy(desc(bankPayrollRuns.createdAt)).limit(100)),

	getReceipts: (owner, runId) =>
		Effect.gen(function* () {
			const run = yield* loadRun(owner, runId)
			return yield* receiptsFor(run, yield* runItems(run.id))
		}),

	myPayouts: (owner) =>
		Effect.gen(function* () {
			const mine = yield* bankDb((db) => db.select({ id: bankPayees.id }).from(bankPayees).where(and(eq(bankPayees.linkedOwnerType, owner.ownerType), eq(bankPayees.linkedOwnerId, owner.ownerId))))
			if (mine.length === 0) return []
			const items = yield* bankDb((db) => db.select().from(bankPayrollItems).where(inArray(bankPayrollItems.payeeId, mine.map((m) => m.id))).orderBy(desc(bankPayrollItems.createdAt)).limit(200))
			const out: Receipt[] = []
			for (const it of items) {
				const run = yield* loadRunById(it.runId)
				out.push(...(yield* receiptsFor(run, [it], false)))
			}
			return out
		}),

	createSchedule: (owner, input) =>
		Effect.gen(function* () {
			const ledger = yield* BankLedgerService
			const fund = yield* ledger.getAccount(owner, input.fundingAccountId)
			const spec: ScheduleSpec = { frequency: input.frequency, timezone: input.timezone, dayOfWeek: input.dayOfWeek, dayOfMonth: input.dayOfMonth, localTime: input.localTime ?? '09:00' }
			const first = yield* guard(() => {
				validateSpec(spec)
				if (input.items.length === 0 || input.items.length > 1000) throw bankErr('VALIDATION', 'A schedule needs 1-1000 items')
				for (const i of input.items) {
					parseMinor(i.amountMinor)
					if (i.ewaBps != null && (!Number.isInteger(i.ewaBps) || i.ewaBps < 1 || i.ewaBps > 10_000)) throw bankErr('VALIDATION', 'ewaBps must be 1..10000')
				}
				return firstRun(spec, new Date())
			})
			const payees = yield* bankDb((db) => db.select({ id: bankPayees.id }).from(bankPayees).where(and(inArray(bankPayees.id, [...new Set(input.items.map((i) => i.payeeId))]), eq(bankPayees.ownerType, owner.ownerType), eq(bankPayees.ownerId, owner.ownerId), eq(bankPayees.status, 'active'))))
			if (payees.length !== new Set(input.items.map((i) => i.payeeId)).size) return yield* Effect.fail(bankErr('VALIDATION', 'One or more payees are unknown or archived'))
			if (input.poolId) {
				const [p] = yield* bankDb((db) => db.select().from(bankPayoutPools).where(eq(bankPayoutPools.id, input.poolId!)).limit(1))
				if (!p || p.asset !== fund.asset || p.chain !== fund.chain) return yield* Effect.fail(bankErr('VALIDATION', 'Pool not found or denominated differently from the funding account'))
			}
			const [row] = yield* bankDb((db) =>
				db.insert(bankPayrollSchedules).values({ id: uid('psch'), ownerType: owner.ownerType, ownerId: owner.ownerId, fundingAccountId: fund.id, name: input.name, frequency: input.frequency, timezone: input.timezone, dayOfWeek: input.dayOfWeek ?? null, dayOfMonth: input.dayOfMonth ?? null, localTime: spec.localTime, items: input.items, poolId: input.poolId ?? null, autoApprove: input.autoApprove ?? false, nextRunAt: first.at }).returning(),
			)
			return row!
		}),

	listSchedules: (owner) => bankDb((db) => db.select().from(bankPayrollSchedules).where(and(eq(bankPayrollSchedules.ownerType, owner.ownerType), eq(bankPayrollSchedules.ownerId, owner.ownerId))).orderBy(desc(bankPayrollSchedules.createdAt))),

	setScheduleStatus: (owner, id, status) =>
		bankDb(async (db) => {
			const [r] = await db.update(bankPayrollSchedules).set({ status, updatedAt: new Date() }).where(and(eq(bankPayrollSchedules.id, id), eq(bankPayrollSchedules.ownerType, owner.ownerType), eq(bankPayrollSchedules.ownerId, owner.ownerId))).returning()
			if (!r) throw bankErr('NOT_FOUND', 'Schedule not found')
			return r
		}),

	scheduleAdvanceAvailable: (worker, scheduleId, payeeId) => scheduleAvail(worker, scheduleId, payeeId),

	// MONEY-PATH
	advanceScheduleWages: (worker, scheduleId, payeeId, amountMinor, idempotencyKey) =>
		Effect.gen(function* () {
			const xfer = yield* BankTransferService
			if (!/^[A-Za-z0-9_.:-]{8,128}$/.test(idempotencyKey)) return yield* Effect.fail(bankErr('VALIDATION', 'idempotencyKey must be 8-128 chars of A-Za-z0-9_.:-'))
			const amount = yield* guard(() => parseMinor(amountMinor))
			const avail = yield* scheduleAvail(worker, scheduleId, payeeId)
			const [sch] = yield* bankDb((db) => db.select().from(bankPayrollSchedules).where(eq(bankPayrollSchedules.id, scheduleId)).limit(1))
			const payee = yield* loadPayee(payeeId)
			if (payee.method !== 'bank_account' || !payee.accountId) return yield* Effect.fail(bankErr('VALIDATION', 'Earned-wage access pays into the worker\'s bank account'))
			const { periodKey } = accrualFor(sch!, { amountMinor: '0' }, new Date())
			const adv = yield* bankDb(async (db) =>
				db.transaction(async (tx) => {
					await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`ewa:${scheduleId}:${payeeId}`}))`)
					const [ex] = await tx.select().from(bankWageAdvances).where(and(eq(bankWageAdvances.workerOwnerType, worker.ownerType), eq(bankWageAdvances.workerOwnerId, worker.ownerId), eq(bankWageAdvances.idempotencyKey, idempotencyKey))).limit(1)
					if (ex) {
						if (ex.sourceId !== scheduleId || ex.amountMinor !== amount.toString()) throw bankErr('CONFLICT', 'idempotencyKey was already used with different terms')
						return ex
					}
					const used = BigInt(((await tx.execute(sql`select coalesce(sum(amount_minor),0)::text as s from bank_wage_advances where source_type = 'schedule' and source_id = ${scheduleId} and payee_id = ${payeeId} and period_key = ${periodKey}`)) as unknown as Array<{ s: string }>)[0]?.s ?? '0')
					const cap = BigInt(avail.availableMinor) + BigInt(avail.advancedMinor) - used // advanced may have changed since the read
					if (amount > cap) throw subErr('EWA_LIMIT', 'LIMIT_EXCEEDED', `Requested ${amount} exceeds the available advance of ${cap > 0n ? cap : 0n} (${avail.ewaBps / 100}% of accrued wages)`)
					const [row] = await tx.insert(bankWageAdvances).values({ id: uid('ewa'), sourceType: 'schedule', sourceId: scheduleId, workerOwnerType: worker.ownerType, workerOwnerId: worker.ownerId, payeeId, periodKey, amountMinor: amount.toString(), idempotencyKey }).returning()
					return row!
				}),
			)
			let transferId = adv.transferId
			if (!transferId) {
				const t = yield* xfer.transfer({
					owner: toOwner(sch!.ownerType, sch!.ownerId),
					idempotencyKey: idemKey('ewa', adv.id),
					type: 'payroll',
					fromAccountId: sch!.fundingAccountId,
					toAccountId: payee.accountId,
					amountMinor: amount.toString(),
					memo: 'Earned wage advance',
					metadata: { scheduleId, payeeId, periodKey, advanceId: adv.id, module: 'ewa' },
				})
				if (t.status === 'failed' || t.status === 'reversed') {
					// Release the cap used by this advance so the worker can retry with a new key.
					yield* bankDb((db) => db.update(bankWageAdvances).set({ amountMinor: '0', transferId: t.id }).where(eq(bankWageAdvances.id, adv.id)))
					return yield* Effect.fail(bankErr('UPSTREAM', `Advance failed: ${t.failureReason ?? 'transfer failed'}`))
				}
				transferId = t.id
				yield* bankDb((db) => db.update(bankWageAdvances).set({ transferId: t.id }).where(eq(bankWageAdvances.id, adv.id)))
			}
			const after = yield* scheduleAvail(worker, scheduleId, payeeId)
			return { advanceId: adv.id, transferId, availableAfterMinor: after.availableMinor }
		}),

	runJob: () =>
		Effect.gen(function* () {
			let schedulesRun = 0
			let itemsDriven = 0
			const now = new Date()
			const due = yield* bankDb((db) => db.select().from(bankPayrollSchedules).where(and(eq(bankPayrollSchedules.status, 'active'), lte(bankPayrollSchedules.nextRunAt, now))).limit(50))
			for (const sch of due) {
				yield* Effect.gen(function* () {
					let cur = sch
					for (let guardN = 0; guardN < 12 && cur.nextRunAt.getTime() <= now.getTime(); guardN++) {
						const periodKey = (() => {
							const l = localDateOf(cur.nextRunAt, cur.timezone)
							return `${l.y}-${String(l.m).padStart(2, '0')}-${String(l.d).padStart(2, '0')}`
						})()
						const ledger = yield* BankLedgerService
						const fund = yield* ledger.getAccountById(cur.fundingAccountId)
						const rows: Array<{ payeeId: string; amountMinor: bigint; memo?: string | undefined }> = []
						for (const it of cur.items) {
							// Earned-wage advances already paid this period are netted out of the pay.
							const adv = yield* advancedIn(cur.id, it.payeeId, periodKey)
							const net = BigInt(it.amountMinor) - adv
							if (net > 0n) rows.push({ payeeId: it.payeeId, amountMinor: net, memo: it.memo })
						}
						const run = yield* insertRun(toOwner(cur.ownerType, cur.ownerId), { fundingAccountId: cur.fundingAccountId, asset: fund.asset, chain: fund.chain, label: `${cur.name} ${periodKey}`, poolId: cur.poolId ?? undefined, scheduleId: cur.id, periodKey, status: cur.autoApprove ? 'approved' : 'draft', approvedBy: cur.autoApprove ? `schedule:${cur.id}` : undefined, rows })
						if (run) schedulesRun++
						const nxt = nextAfter(specOf(cur), parseLocalDate(periodKey))
						const [upd] = yield* bankDb((db) => db.update(bankPayrollSchedules).set({ nextRunAt: nxt.at, lastPeriodKey: periodKey, updatedAt: new Date() }).where(and(eq(bankPayrollSchedules.id, cur.id), eq(bankPayrollSchedules.nextRunAt, cur.nextRunAt))).returning())
						if (!upd) break
						cur = upd
					}
				}).pipe(Effect.catchAll((e: BankError) => Effect.sync(() => logger.warn({ scheduleId: sch.id, err: e.message }, 'bank: payroll schedule tick failed'))))
			}
			// Resume auto-approved scheduled runs and anything left mid-flight by a restart / pending fx.
			const live = yield* bankDb((db) =>
				db.select({ id: bankPayrollRuns.id }).from(bankPayrollRuns).where(sql`${bankPayrollRuns.status} = 'executing' or (${bankPayrollRuns.status} = 'approved' and ${bankPayrollRuns.scheduleId} is not null)`).limit(50),
			)
			for (const r of live) {
				yield* bankDb((db) => db.update(bankPayrollRuns).set({ status: 'executing', updatedAt: new Date() }).where(and(eq(bankPayrollRuns.id, r.id), eq(bankPayrollRuns.status, 'approved'))))
				itemsDriven += yield* driveRun(r.id).pipe(Effect.catchAll((e: BankError) => Effect.sync(() => (logger.warn({ runId: r.id, err: e.message }, 'bank: payroll drive failed'), 0))))
			}
			return { schedulesRun, itemsDriven }
		}),
})

const receiptsFor = (run: BankPayrollRun, items: BankPayrollItem[], asOwner = true): PayFx<Receipt[]> =>
	Effect.gen(function* () {
		const xfer = yield* BankTransferService
		const out: Receipt[] = []
		const pool = run.poolId ? (yield* bankDb((db) => db.select().from(bankPayoutPools).where(eq(bankPayoutPools.id, run.poolId!)).limit(1)))[0] : undefined
		const tOwner = pool ? toOwner(pool.operatorOwnerType, pool.operatorOwnerId) : runOwner(run)
		for (const it of items) {
			const payee = yield* loadPayee(it.payeeId)
			const t = it.transferId ? yield* xfer.getTransfer(tOwner, it.transferId).pipe(Effect.option) : Option.none()
			out.push({
				itemId: it.id,
				runId: run.id,
				payee: asOwner ? payee.name : 'you',
				status: it.status,
				amountMinor: it.amountMinor,
				asset: run.asset,
				paidAmountMinor: it.paidAmountMinor,
				paidAsset: it.paidAsset,
				transferId: it.transferId,
				fxTransferId: it.fxTransferId,
				txHash: Option.isSome(t) ? t.value.txHash : null,
				paidAt: it.paidAt ? it.paidAt.toISOString() : null,
				error: it.error,
			})
		}
		return out
	})
