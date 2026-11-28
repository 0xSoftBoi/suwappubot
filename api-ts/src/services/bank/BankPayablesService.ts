/**
 * BankPayablesService — vendors, bills (payables, scheduled payment via the
 * recurring job `runDueBills`) and collections (receivables ageing + dunning
 * state from `bank_invoices`, owned by the payments module; read defensively).
 */
import { and, asc, eq, inArray, lte, sql } from 'drizzle-orm'
import { Context, Effect, Layer } from 'effect'
import type { EnvService } from '../../config/EnvService'
import { type BankOrgBill, type DrizzleService, bankApprovalPolicies, bankApprovalRequests, bankOrgBills, bankOrgDunning, bankOrgPayees, bankOrgVendors, bankTransfers } from '../../db'
import { findAsset } from './assets'
import { valueInReporting } from './BankBooksService'
import { BankLedgerService } from './BankLedgerService'
import { type Actor, authorize, authorizeActor, nid, orgSecret, writeAudit } from './BankOrgService'
import { performOrgTransfer, releaseApproval } from './BankApprovalService'
import { type BankDeps, type BankTransferService } from './BankTransferService'
import { ageingBucket, AGEING_BUCKETS, DUNNING_SCHEDULE_DAYS, dunningStage, hashPayload, matchPolicy, mintApprovalToken, type PolicyLite } from './bankOrgPure'
import { type BankOwner, bankDb } from './db'
import { type BankError, bankErr } from './errors'
import { assertSpendable } from './systemDebit'

const orgOwner = (id: string): BankOwner => ({ ownerType: 'org', ownerId: id })
const normAddr = (a: string): string => (a.startsWith('0x') ? a.toLowerCase() : a)

const policiesOf = (orgId: string) =>
	bankDb(async (db): Promise<PolicyLite[]> =>
		(await db.select().from(bankApprovalPolicies).where(eq(bankApprovalPolicies.orgId, orgId))).map((p) => ({
			id: p.id, ruleType: p.ruleType, thresholdMinor: p.thresholdMinor === null ? null : BigInt(p.thresholdMinor),
			requiredApprovals: p.requiredApprovals, approverRoles: p.approverRoles, expiryHours: p.expiryHours, enabled: p.enabled === 1,
		})),
	)

const INVOICE_DONE = ['paid', 'void', 'voided', 'cancelled', 'canceled', 'draft', 'refunded']

/** MONEY-PATH. Recurring job: pay due scheduled bills as the scheduling member, reconcile in-flight ones. */
export const runDueBills = (now = new Date()): Effect.Effect<{ paid: number; started: number; failed: number }, BankError, BankDeps | BankTransferService | EnvService> =>
	Effect.gen(function* () {
		let started = 0, paid = 0, failed = 0
		// 1. Settle bills whose transfer finished.
		const inflight = yield* bankDb((db) => db.select().from(bankOrgBills).where(and(eq(bankOrgBills.status, 'paying'), sql`transfer_id is not null`)).limit(100))
		for (const b of inflight) {
			const t = yield* bankDb(async (db) => (await db.select().from(bankTransfers).where(eq(bankTransfers.id, b.transferId!)).limit(1))[0])
			if (t?.status === 'confirmed') { paid++; yield* bankDb((db) => db.update(bankOrgBills).set({ status: 'paid', paidAt: new Date() }).where(and(eq(bankOrgBills.id, b.id), eq(bankOrgBills.status, 'paying')))) }
			else if (t && (t.status === 'failed' || t.status === 'reversed')) { failed++; yield* bankDb((db) => db.update(bankOrgBills).set({ status: 'failed', lastError: t.failureReason ?? t.status }).where(and(eq(bankOrgBills.id, b.id), eq(bankOrgBills.status, 'paying')))) }
		}
		// 2. Approved-but-waiting bills become schedulable; expired approvals fail.
		const waiting = yield* bankDb((db) => db.select().from(bankOrgBills).where(eq(bankOrgBills.status, 'pending_approval')).limit(100))
		for (const b of waiting) {
			const r = b.approvalRequestId ? yield* bankDb(async (db) => (await db.select().from(bankApprovalRequests).where(eq(bankApprovalRequests.id, b.approvalRequestId!)).limit(1))[0]) : undefined
			if (r?.status === 'approved') yield* bankDb((db) => db.update(bankOrgBills).set({ status: 'scheduled' }).where(and(eq(bankOrgBills.id, b.id), eq(bankOrgBills.status, 'pending_approval'))))
			else if (!r || ['rejected', 'expired', 'cancelled'].includes(r.status)) { failed++; yield* bankDb((db) => db.update(bankOrgBills).set({ status: 'failed', lastError: `approval ${r?.status ?? 'missing'}` }).where(and(eq(bankOrgBills.id, b.id), eq(bankOrgBills.status, 'pending_approval')))) }
		}
		// 3. Claim + pay. Claim is an atomic status flip; stale 'paying' rows (no transfer yet, >15 min) are re-claimed (idempotent key).
		const stale = new Date(now.getTime() - 15 * 60_000)
		const due = yield* bankDb((db) => db.select().from(bankOrgBills).where(and(inArray(bankOrgBills.status, ['scheduled', 'paying']), lte(bankOrgBills.scheduledFor, now), sql`transfer_id is null`)).orderBy(asc(bankOrgBills.scheduledFor)).limit(20))
		for (const b of due) {
			const claimed = yield* bankDb((db) =>
				db.update(bankOrgBills).set({ status: 'paying', attempts: sql`attempts + 1`, scheduledFor: b.status === 'paying' ? now : b.scheduledFor })
					.where(and(eq(bankOrgBills.id, b.id), b.status === 'scheduled' ? eq(bankOrgBills.status, 'scheduled') : and(eq(bankOrgBills.status, 'paying'), lte(bankOrgBills.scheduledFor, stale)))).returning({ id: bankOrgBills.id }),
			)
			if (!claimed.length) continue
			started++
			const res = yield* payBill(b).pipe(Effect.either)
			if (res._tag === 'Left') { failed++; yield* bankDb((db) => db.update(bankOrgBills).set({ status: 'failed', lastError: res.left.message }).where(eq(bankOrgBills.id, b.id))) }
		}
		return { paid, started, failed }
	})

const payBill = (b: BankOrgBill): Effect.Effect<void, BankError, BankDeps | BankTransferService | EnvService> =>
	Effect.gen(function* () {
		const vendor = yield* bankDb(async (db) => (await db.select().from(bankOrgVendors).where(and(eq(bankOrgVendors.id, b.vendorId), eq(bankOrgVendors.orgId, b.orgId))).limit(1))[0])
		if (!vendor?.payAddress) return yield* Effect.fail(bankErr('VALIDATION', 'Vendor has no payment address', { missing: 'vendor.payAddress' }))
		if (!b.payFromAccountId || !b.scheduledBy) return yield* Effect.fail(bankErr('VALIDATION', 'Bill has no pay-from account / scheduler'))
		// Re-check authority at execution time: the scheduling member must still hold bills.pay in this org.
		const actor: Actor = { userId: b.scheduledBy, via: 'user' }
		const ctx = yield* authorizeActor(actor, b.orgId, 'bills.pay')
		const payload = { from: b.payFromAccountId, to: null, external: { address: normAddr(vendor.payAddress), chain: b.chain }, amountMinor: BigInt(b.amountMinor).toString() }
		let token: string | undefined
		if (b.approvalRequestId) {
			const secret = yield* orgSecret
			token = mintApprovalToken(secret, { orgId: b.orgId, action: 'transfer', payload, requestId: b.approvalRequestId, nowMs: Date.now(), ttlMs: 5 * 60_000 })
		}
		const r = yield* performOrgTransfer(ctx, { idempotencyKey: `bill-${b.id}`, fromAccountId: b.payFromAccountId, toExternal: { address: vendor.payAddress }, amountMinor: BigInt(b.amountMinor).toString(), memo: `Bill ${b.reference ?? b.id}`, categoryId: b.categoryId ?? vendor.categoryId ?? undefined, approvalToken: token })
		if (r.approvalRequired) {
			yield* bankDb((db) => db.update(bankOrgBills).set({ status: 'pending_approval', approvalRequestId: r.request.id }).where(eq(bankOrgBills.id, b.id)))
			return
		}
		yield* bankDb((db) => db.update(bankOrgBills).set({ transferId: r.transfer.id, lastError: null }).where(eq(bankOrgBills.id, b.id)))
		yield* writeAudit({ orgId: b.orgId, actor, action: 'bill.paid_submitted', targetType: 'bill', targetId: b.id, detail: { transferId: r.transfer.id } })
	}).pipe(Effect.tapError(() => (b.approvalRequestId ? releaseApproval(b.approvalRequestId).pipe(Effect.ignore) : Effect.void)))

const impl = {
	createVendor: (owner: BankOwner, orgId: string, i: { name: string; email?: string | undefined; payAddress?: string | undefined; payChain?: string | undefined; categoryId?: string | undefined }) =>
		Effect.gen(function* () {
			const c = yield* authorize(owner, orgId, 'vendors.manage')
			if (!!i.payAddress !== !!i.payChain) return yield* Effect.fail(bankErr('VALIDATION', 'payAddress and payChain go together'))
			const v = yield* bankDb(async (db) => (await db.insert(bankOrgVendors).values({ id: nid('ven'), orgId, name: i.name, email: i.email ?? null, payAddress: i.payAddress ? normAddr(i.payAddress) : null, payChain: i.payChain ?? null, categoryId: i.categoryId ?? null, createdBy: c.actor.userId }).returning())[0]!)
			yield* writeAudit({ orgId, actor: c.actor, action: 'vendor.create', targetType: 'vendor', targetId: v.id, detail: { name: i.name } })
			return { vendor: v }
		}),
	listVendors: (owner: BankOwner, orgId: string) =>
		Effect.gen(function* () { yield* authorize(owner, orgId, 'bills.view'); return { vendors: yield* bankDb((db) => db.select().from(bankOrgVendors).where(eq(bankOrgVendors.orgId, orgId))) } }),

	createBill: (owner: BankOwner, orgId: string, i: { vendorId: string; reference?: string | undefined; amountMinor: string; asset: string; chain: string; dueDate: Date; categoryId?: string | undefined }) =>
		Effect.gen(function* () {
			const c = yield* authorize(owner, orgId, 'bills.create')
			if (!findAsset(i.asset, i.chain)) return yield* Effect.fail(bankErr('ASSET_UNSUPPORTED', `Unsupported asset ${i.asset} on ${i.chain}`))
			const v = yield* bankDb((db) => db.select({ id: bankOrgVendors.id }).from(bankOrgVendors).where(and(eq(bankOrgVendors.id, i.vendorId), eq(bankOrgVendors.orgId, orgId))).limit(1))
			if (!v.length) return yield* Effect.fail(bankErr('NOT_FOUND', 'Vendor not found in this organisation'))
			const bill = yield* bankDb(async (db) => (await db.insert(bankOrgBills).values({ id: nid('bil'), orgId, vendorId: i.vendorId, reference: i.reference ?? null, amountMinor: i.amountMinor, asset: i.asset, chain: i.chain, dueDate: i.dueDate, categoryId: i.categoryId ?? null, createdBy: c.actor.userId }).returning())[0]!)
			yield* writeAudit({ orgId, actor: c.actor, action: 'bill.create', targetType: 'bill', targetId: bill.id, detail: { amountMinor: i.amountMinor, asset: i.asset } })
			return { bill }
		}),
	listBills: (owner: BankOwner, orgId: string, status?: string) =>
		Effect.gen(function* () {
			yield* authorize(owner, orgId, 'bills.view')
			const conds = [eq(bankOrgBills.orgId, orgId)]
			if (status) conds.push(eq(bankOrgBills.status, status as BankOrgBill['status']))
			return { bills: yield* bankDb((db) => db.select().from(bankOrgBills).where(and(...conds)).orderBy(asc(bankOrgBills.dueDate)).limit(500)) }
		}),

	/** Schedule payment; evaluates approval policy now and parks the bill in pending_approval when required. */
	scheduleBill: (owner: BankOwner, orgId: string, billId: string, i: { payFromAccountId: string; scheduledFor: Date }): Effect.Effect<{ bill: BankOrgBill; approvalRequired: boolean }, BankError, DrizzleService | BankLedgerService | EnvService> =>
		Effect.gen(function* () {
			const c = yield* authorize(owner, orgId, 'bills.pay')
			const bill = yield* bankDb(async (db) => (await db.select().from(bankOrgBills).where(and(eq(bankOrgBills.id, billId), eq(bankOrgBills.orgId, orgId))).limit(1))[0])
			if (!bill) return yield* Effect.fail(bankErr('NOT_FOUND', 'Bill not found'))
			if (!['unpaid', 'failed', 'scheduled', 'pending_approval'].includes(bill.status)) return yield* Effect.fail(bankErr('CONFLICT', `Bill is ${bill.status}`))
			const acct = yield* (yield* BankLedgerService).getAccount(orgOwner(orgId), i.payFromAccountId)
			{ const sysErr = assertSpendable(acct); if (sysErr) return yield* Effect.fail(sysErr) } // MONEY-PATH: system-kind accounts are never user-spendable
			if (acct.asset !== bill.asset || acct.chain !== bill.chain) return yield* Effect.fail(bankErr('VALIDATION', `Pay-from account is ${acct.asset}/${acct.chain}, bill is ${bill.asset}/${bill.chain}`))
			const vendor = yield* bankDb(async (db) => (await db.select().from(bankOrgVendors).where(eq(bankOrgVendors.id, bill.vendorId)).limit(1))[0])
			if (!vendor?.payAddress || vendor.payChain !== bill.chain) return yield* Effect.fail(bankErr('VALIDATION', 'Vendor needs a payment address on the bill chain', { missing: 'vendor.payAddress/payChain' }))
			const addr = normAddr(vendor.payAddress)
			const known = yield* bankDb((db) => db.select({ id: bankOrgPayees.id }).from(bankOrgPayees).where(and(eq(bankOrgPayees.orgId, orgId), eq(bankOrgPayees.chain, bill.chain), eq(bankOrgPayees.address, addr))).limit(1))
			const policies = yield* policiesOf(orgId)
			const amount = BigInt(bill.amountMinor)
			const needValue = policies.some((p) => p.enabled && p.ruleType === 'transfer_over')
			const policy = matchPolicy(policies, { action: 'transfer', newPayee: known.length === 0, ...(needValue ? { amountReportingMinor: (yield* valueInReporting(bill.asset, bill.chain, amount, c.org.reportingCurrency)).reportingMinor } : {}) })
			let approvalRequestId: string | null = null
			if (policy) {
				const payload = { from: acct.id, to: null, external: { address: addr, chain: bill.chain }, amountMinor: amount.toString() }
				const hash = hashPayload(payload)
				approvalRequestId = yield* bankDb(async (db) => {
					const ex = (await db.select().from(bankApprovalRequests).where(and(eq(bankApprovalRequests.orgId, orgId), eq(bankApprovalRequests.action, 'transfer'), eq(bankApprovalRequests.payloadHash, hash), eq(bankApprovalRequests.requestedBy, c.actor.userId), inArray(bankApprovalRequests.status, ['pending', 'approved']))).limit(1))[0]
					if (ex) return ex.id
					const [r] = await db.insert(bankApprovalRequests).values({ id: nid('apr'), orgId, action: 'transfer', payload, payloadHash: hash, requestedBy: c.actor.userId, policyId: policy.id, requiredApprovals: policy.requiredApprovals, approverRoles: policy.approverRoles, expiresAt: new Date(Date.now() + policy.expiryHours * 3_600_000) }).returning()
					return r!.id
				})
			}
			const updated = yield* bankDb(async (db) => (await db.update(bankOrgBills).set({ status: policy ? 'pending_approval' : 'scheduled', payFromAccountId: acct.id, scheduledFor: i.scheduledFor, scheduledBy: c.actor.userId, approvalRequestId, lastError: null }).where(and(eq(bankOrgBills.id, billId), eq(bankOrgBills.orgId, orgId))).returning())[0]!)
			yield* writeAudit({ orgId, actor: c.actor, action: 'bill.schedule', targetType: 'bill', targetId: billId, detail: { at: i.scheduledFor.toISOString(), approvalRequestId } })
			return { bill: updated, approvalRequired: !!policy }
		}),

	cancelBill: (owner: BankOwner, orgId: string, billId: string) =>
		Effect.gen(function* () {
			const c = yield* authorize(owner, orgId, 'bills.pay')
			const r = yield* bankDb((db) => db.update(bankOrgBills).set({ status: 'cancelled' }).where(and(eq(bankOrgBills.id, billId), eq(bankOrgBills.orgId, orgId), inArray(bankOrgBills.status, ['unpaid', 'scheduled', 'pending_approval', 'failed']))).returning({ id: bankOrgBills.id }))
			if (!r.length) return yield* Effect.fail(bankErr('CONFLICT', 'Bill not found or already in flight/paid'))
			yield* writeAudit({ orgId, actor: c.actor, action: 'bill.cancel', targetType: 'bill', targetId: billId })
			return { cancelled: true }
		}),

	/** Receivables ageing from bank_invoices (payments module). Typed error if the table/columns are absent. */
	ageing: (owner: BankOwner, orgId: string, now = new Date()) =>
		Effect.gen(function* () {
			yield* authorize(owner, orgId, 'collections.view')
			return yield* loadInvoices(orgId, now)
		}),

	/** Advance dunning state for overdue invoices. Returns the notices now due (caller delivers them). */
	runDunning: (owner: BankOwner, orgId: string, now = new Date()) =>
		Effect.gen(function* () {
			const c = yield* authorize(owner, orgId, 'collections.manage')
			const inv = yield* loadInvoices(orgId, now)
			const advanced: Array<{ invoiceId: string; stage: number; daysOverdue: number }> = []
			for (const x of inv.invoices) {
				const stage = dunningStage(x.daysOverdue)
				if (stage === 0) continue
				const next = DUNNING_SCHEDULE_DAYS[stage] !== undefined ? new Date(new Date(x.dueDate).getTime() + DUNNING_SCHEDULE_DAYS[stage]! * 86_400_000) : null
				const r = yield* bankDb((db) =>
					db.insert(bankOrgDunning).values({ id: nid('dun'), orgId, invoiceId: x.id, stage, lastStageAt: now, nextStageAt: next })
						.onConflictDoUpdate({ target: [bankOrgDunning.orgId, bankOrgDunning.invoiceId], set: { stage, lastStageAt: now, nextStageAt: next, updatedAt: now }, setWhere: sql`${bankOrgDunning.stage} < ${stage} and ${bankOrgDunning.status} = 'active'` }).returning({ id: bankOrgDunning.id }),
				)
				if (r.length) advanced.push({ invoiceId: x.id, stage, daysOverdue: x.daysOverdue })
			}
			yield* writeAudit({ orgId, actor: c.actor, action: 'dunning.run', detail: { advanced: advanced.length } })
			return { advanced, scheduleDays: DUNNING_SCHEDULE_DAYS }
		}),
	listDunning: (owner: BankOwner, orgId: string) =>
		Effect.gen(function* () { yield* authorize(owner, orgId, 'collections.view'); return { dunning: yield* bankDb((db) => db.select().from(bankOrgDunning).where(eq(bankOrgDunning.orgId, orgId))) } }),
}

const loadInvoices = (orgId: string, now: Date) =>
	Effect.gen(function* () {
		const cols = yield* bankDb(async (db) => {
			const r = await db.execute(sql`select column_name from information_schema.columns where table_name = 'bank_invoices'`)
			return new Set((r as unknown as Array<{ column_name: string }>).map((x) => x.column_name))
		})
		if (cols.size === 0) return yield* Effect.fail(bankErr('NOT_CONFIGURED', 'Invoices table not present', { missing: 'bank_invoices (payments module)' }))
		const pick = (...c: string[]) => c.find((x) => cols.has(x))
		const idC = pick('id'), ownerC = pick('owner_id'), amtC = pick('amount_minor'), dueC = pick('due_date', 'due_at'), stC = pick('status')
		const missing = [['id', idC], ['owner_id', ownerC], ['amount_minor', amtC], ['due_date|due_at', dueC], ['status', stC]].filter(([, v]) => !v).map(([k]) => k)
		if (missing.length) return yield* Effect.fail(bankErr('NOT_CONFIGURED', `bank_invoices lacks required columns: ${missing.join(', ')}`, { missing: `bank_invoices.${missing.join(',')}` }))
		const assetC = pick('asset'), typeC = pick('owner_type'), nameC = pick('customer_name', 'payer_name', 'customer')
		const q = (c: string) => sql.raw(`"${c}"`)
		const rows = yield* bankDb(async (db) => {
			const r = await db.execute(sql`select ${q(idC!)}::text as id, ${q(amtC!)}::text as amount, ${q(dueC!)} as due, ${assetC ? q(assetC) : sql`null`}::text as asset, ${nameC ? q(nameC) : sql`null`}::text as customer
				from bank_invoices where ${q(ownerC!)}::text = ${orgId} ${typeC ? sql`and ${q(typeC)} = 'org'` : sql``} and lower(${q(stC!)}::text) not in (${sql.join(INVOICE_DONE.map((s) => sql`${s}`), sql`, `)})`)
			return r as unknown as Array<{ id: string; amount: string; due: Date | string; asset: string | null; customer: string | null }>
		})
		const buckets: Record<string, Record<string, bigint>> = {}
		const invoices = rows.map((x) => {
			const due = new Date(x.due)
			const bucket = ageingBucket(due.getTime(), now.getTime())
			const a = x.asset ?? 'UNSPECIFIED'
			buckets[bucket] ??= {}
			buckets[bucket]![a] = (buckets[bucket]![a] ?? 0n) + BigInt(x.amount)
			return { id: x.id, customer: x.customer, asset: x.asset, amountMinor: x.amount, dueDate: due.toISOString(), bucket, daysOverdue: Math.max(0, Math.floor((now.getTime() - due.getTime()) / 86_400_000)) }
		})
		const ageing = AGEING_BUCKETS.map((b) => ({ bucket: b, byAsset: Object.fromEntries(Object.entries(buckets[b] ?? {}).map(([k, v]) => [k, v.toString()])) }))
		return { invoices, ageing }
	})

export class BankPayablesService extends Context.Tag('BankPayablesService')<BankPayablesService, typeof impl>() {}
export const BankPayablesServiceLive = Layer.succeed(BankPayablesService, impl)
