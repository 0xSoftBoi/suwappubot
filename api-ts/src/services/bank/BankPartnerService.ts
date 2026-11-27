/**
 * M11 embedded banking (BaaS). A partner is an org API key (orgId). Partner customers are bank
 * owners of type 'partner_customer'. EVERY query is scoped by partner_id; destination accounts for
 * internal transfers must belong to the same partner. Customer accounts share the partner's
 * a dedicated per-customer custody wallet (bank_org_wallets) with isolated ledger accounts.
 *
 * MONEY-PATH: partnerTransfer / executeFx (fee math, bps integer floor, fee credited to the
 * partner revenue account), webhook signing.
 */
import { createHmac, randomBytes } from 'node:crypto'
import { and, eq, inArray, lte, sql } from 'drizzle-orm'
import { Context, Effect, Layer } from 'effect'
import {
	type BankAccount,
	type BankPartner,
	type BankPartnerCustomer,
	type BankTransfer,
	type DrizzleService,
	bankAccounts,
	bankPartnerCustomers,
	bankPartnerEvents,
	bankPartners,
	bankTransfers,
	organizations,
} from '../../db'
import { logger } from '../../lib/logger'
import { findAsset } from './assets'
import { BankFxService } from './BankFxService'
import { BankLedgerService } from './BankLedgerService'
import { ensureOrgCustodyWallet } from './BankOrgService'
import { BankTransferService, feeKeyFor } from './BankTransferService'
import { type BankOwner, bankDb, newId } from './db'
import { type BankError, bankErr } from './errors'
import { assertSpendable } from './systemDebit'
import { guardedFetch } from './ssrfFetch'
import { type CreditTransferBatch } from './iso20022'

import type { MainLayerContext } from '../MainLayer'
type Fx<A> = Effect.Effect<A, BankError, MainLayerContext>

export interface PartnerConfigInput { feeBpsTransfer?: number; feeBpsFx?: number; webhookUrl?: string | null }
export interface PartnerTransferInput { customerId: string; fromAccountId: string; toAccountId?: string; toExternal?: { address: string }; amountMinor: string; idempotencyKey: string; memo?: string }

export interface BankPartnerServiceInterface {
	readonly configure: (partnerId: string, c: PartnerConfigInput) => Fx<{ partner: Omit<BankPartner, 'webhookSecret'>; webhookSecret?: string }>
	readonly getPartner: (partnerId: string) => Fx<Omit<BankPartner, 'webhookSecret'>>
	readonly createCustomer: (partnerId: string, i: { externalRef: string; displayName?: string; email?: string; country?: string }) => Fx<BankPartnerCustomer>
	readonly listCustomers: (partnerId: string, limit?: number) => Fx<BankPartnerCustomer[]>
	readonly openAccount: (partnerId: string, customerId: string, i: { asset: string; chain: string; kind?: 'checking' | 'savings'; label?: string }) => Fx<BankAccount>
	readonly listAccounts: (partnerId: string, customerId: string) => Fx<BankAccount[]>
	readonly partnerTransfer: (partnerId: string, i: PartnerTransferInput) => Fx<{ transfer: BankTransfer; fee: BankTransfer | null; feeMinor: string }>
	readonly executeFx: (partnerId: string, i: { customerId: string; fromAccountId: string; toAccountId: string; amountMinor: string; idempotencyKey: string; slippage?: number }) => Fx<{ transfer: BankTransfer; fee: BankTransfer | null; feeMinor: string }>
	readonly listTransfers: (partnerId: string, customerId?: string, limit?: number) => Fx<BankTransfer[]>
	readonly usage: (partnerId: string, from: Date, to: Date) => Fx<Record<string, unknown>>
	readonly listEvents: (partnerId: string, limit?: number) => Fx<Array<Record<string, unknown>>>
	readonly deliverDueWebhooks: (limit?: number) => Fx<{ attempted: number; delivered: number; dead: number }>
	readonly importCreditTransfers: (partnerId: string, batch: CreditTransferBatch, customerId: string) => Fx<{ messageId: string; results: Array<{ endToEndId: string; status: 'ACCP' | 'RJCT'; transferId?: string; reason?: string }> }>
	/** Internal: customer-scoped ownership check used by the connector. */
	readonly assertCustomer: (partnerId: string, customerId: string) => Fx<BankPartnerCustomer>
}
export class BankPartnerService extends Context.Tag('BankPartnerService')<BankPartnerService, BankPartnerServiceInterface>() {}

const BPS = /^\d{1,4}$/
const cust = (id: string): BankOwner => ({ ownerType: 'partner_customer', ownerId: id })
const owner = (id: string): BankOwner => ({ ownerType: 'partner_customer', ownerId: id })

const assertCustomer = (partnerId: string, customerId: string) =>
	bankDb(async (db) => {
		const [c] = await db.select().from(bankPartnerCustomers).where(and(eq(bankPartnerCustomers.id, customerId), eq(bankPartnerCustomers.partnerId, partnerId))).limit(1)
		if (!c) throw bankErr('NOT_FOUND', 'Customer not found') // same error for foreign + missing customers
		if (c.status !== 'active') throw bankErr('ACCOUNT_STATE', 'Customer is not active')
		return c
	})

const publicPartner = (p: BankPartner): Omit<BankPartner, 'webhookSecret'> => {
	const { webhookSecret: _s, ...rest } = p
	return rest
}

/** MONEY-PATH: the partner's OWN org custody wallet (bank_org_wallets), never the org owner's personal wallet. Used for revenue only. */
const partnerWallet = (partnerId: string) => ensureOrgCustodyWallet(partnerId, 'evm')

/** MONEY-PATH: one dedicated custody address per partner customer, so a deposit address maps to exactly one customer. */
const customerWallet = (customerId: string) => ensureOrgCustodyWallet(`pcust_${customerId}`, 'evm')

/** Is `accountId` owned by a customer of this partner, or by the partner org itself? */
export const accountInPartner = (partnerId: string, accountId: string) =>
	bankDb(async (db) => {
		const [a] = await db.select().from(bankAccounts).where(eq(bankAccounts.id, accountId)).limit(1)
		if (!a) return false
		if (a.ownerType === 'org') return a.ownerId === partnerId
		if (a.ownerType !== 'partner_customer') return false
		const [c] = await db.select({ id: bankPartnerCustomers.id }).from(bankPartnerCustomers).where(and(eq(bankPartnerCustomers.id, a.ownerId), eq(bankPartnerCustomers.partnerId, partnerId))).limit(1)
		return !!c
	})

const enqueue = (partnerId: string, event: string, payload: Record<string, unknown>) =>
	bankDb(async (db) => {
		const [p] = await db.select({ url: bankPartners.webhookUrl }).from(bankPartners).where(eq(bankPartners.orgId, partnerId)).limit(1)
		if (!p?.url) return
		await db.insert(bankPartnerEvents).values({ id: newId('le').replace('le_', 'evt_'), partnerId, event, payload })
	})

export const signWebhook = (secret: string, timestamp: number, body: string): string =>
	`t=${timestamp},v1=${createHmac('sha256', secret).update(`${timestamp}.${body}`).digest('hex')}`

/**
 * MONEY-PATH: fee is charged FIRST (so no error can surface after principal moved); if the principal then fails, the fee
 * is refunded from the partner revenue account (compensation, idempotent per key). Returns the principal's result.
 */
/**
 * MONEY-PATH: the fee is no longer charged first / refunded. It rides the principal as a `feeLeg`: both rows are inserted in one tx
 * under the source-account lock (available >= amount + fee) and the fee row only moves after the principal confirms; a failed
 * principal voids the fee (never charged). So there is no refund path to swallow and no fee-without-transfer crash window.
 * Fee settlement choice: the fee is a real transfer to the partner revenue wallet (separate on-chain send when the wallet differs;
 * ledger-only settle when it is the same wallet), not a ledger-only credit, so revenue balances stay backed on-chain.
 * Fee = floor(amount * bps / 10000), bps validated integer 0..10000.
 */
const feeLegFor = (partnerId: string, from: BankAccount, amount: bigint, bps: number, key: string, kind: 'transfer' | 'fx') =>
	Effect.gen(function* () {
		if (!Number.isInteger(bps) || bps < 0 || bps > 10_000) return yield* Effect.fail(bankErr('VALIDATION', 'fee bps must be an integer 0..10000'))
		const feeMinor = (amount * BigInt(bps)) / 10_000n
		if (feeMinor <= 0n) return { feeLeg: undefined, feeMinor: '0' }
		// Old-style in-flight rows: a legacy `${key}:fee` that is live and not refunded already collected the fee -> don't charge again;
		// a failed/refunded one must NOT suppress a new fee.
		const legacy = yield* bankDb(async (db) => {
			const rows = await db.select().from(bankTransfers).where(and(eq(bankTransfers.ownerType, 'partner_customer'), inArray(bankTransfers.idempotencyKey, [`${key}:fee`, `${key}:feerefund`])))
			return rows.filter((r) => r.fromAccount === from.id || r.toAccount === from.id)
		})
		const lf = legacy.find((r) => r.idempotencyKey === `${key}:fee`)
		const refunded = legacy.some((r) => r.idempotencyKey === `${key}:feerefund` && r.status !== 'failed')
		if (lf && lf.status !== 'failed' && !refunded) return { feeLeg: undefined, feeMinor: lf.amountMinor }
		const ledger = yield* BankLedgerService
		const wallet = yield* partnerWallet(partnerId)
		const revenue = yield* ledger.openAccount({ owner: { ownerType: 'org', ownerId: partnerId }, kind: 'treasury', asset: from.asset, chain: from.chain, label: 'partner-revenue', wallet })
		return { feeLeg: { toAccountId: revenue.id, amountMinor: feeMinor.toString(), metadata: { partnerId, kind, bps, baseAmountMinor: amount.toString() } }, feeMinor: feeMinor.toString() }
	})

/** The fee row that rides a principal (new-style key, else a still-live legacy `${key}:fee`), or null. Read-only; never errors the caller. */
const feeRowFor = (customerId: string, key: string): Effect.Effect<BankTransfer | null, never, MainLayerContext> =>
	bankDb(async (db) => {
		const rows = await db.select().from(bankTransfers).where(and(eq(bankTransfers.ownerType, owner(customerId).ownerType), eq(bankTransfers.ownerId, owner(customerId).ownerId), inArray(bankTransfers.idempotencyKey, [feeKeyFor(key), `${key}:fee`])))
		return rows.find((r) => r.idempotencyKey === feeKeyFor(key)) ?? rows[0] ?? null
	}).pipe(Effect.orElseSucceed(() => null))

export const BankPartnerServiceLive: Layer.Layer<BankPartnerService> = Layer.succeed(BankPartnerService, {
	assertCustomer,

	configure: (partnerId, c) =>
		Effect.gen(function* () {
			for (const v of [c.feeBpsTransfer, c.feeBpsFx]) if (v !== undefined && (!BPS.test(String(v)) || v > 1000)) return yield* Effect.fail(bankErr('VALIDATION', 'fee bps must be an integer 0..1000'))
			if (c.webhookUrl) {
				if (!c.webhookUrl.startsWith('https://')) return yield* Effect.fail(bankErr('VALIDATION', 'webhookUrl must be https'))
			}
			yield* partnerWallet(partnerId) // fails with a typed error when the partner org has no custodial wallet
			const secret = `whsec_${randomBytes(24).toString('hex')}`
			const res = yield* bankDb(async (db) => {
				const [existing] = await db.select().from(bankPartners).where(eq(bankPartners.orgId, partnerId)).limit(1)
				const rotate = !existing?.webhookSecret && !!c.webhookUrl
				const [row] = await db
					.insert(bankPartners)
					.values({ orgId: partnerId, feeBpsTransfer: c.feeBpsTransfer ?? 0, feeBpsFx: c.feeBpsFx ?? 0, webhookUrl: c.webhookUrl ?? null, webhookSecret: c.webhookUrl ? secret : null })
					.onConflictDoUpdate({ target: bankPartners.orgId, set: { ...(c.feeBpsTransfer !== undefined ? { feeBpsTransfer: c.feeBpsTransfer } : {}), ...(c.feeBpsFx !== undefined ? { feeBpsFx: c.feeBpsFx } : {}), ...(c.webhookUrl !== undefined ? { webhookUrl: c.webhookUrl, webhookSecret: c.webhookUrl ? (existing?.webhookSecret ?? secret) : null } : {}), updatedAt: new Date() } })
					.returning()
				return { row: row!, secret: rotate || (!existing && c.webhookUrl) ? secret : undefined }
			})
			return { partner: publicPartner(res.row), ...(res.secret ? { webhookSecret: res.secret } : {}) }
		}),

	getPartner: (partnerId) =>
		bankDb(async (db) => {
			const [p] = await db.select().from(bankPartners).where(eq(bankPartners.orgId, partnerId)).limit(1)
			if (!p) throw bankErr('NOT_FOUND', 'Partner not configured; PUT /platform/config first')
			return publicPartner(p)
		}),

	createCustomer: (partnerId, i) =>
		Effect.gen(function* () {
			yield* bankDb(async (db) => {
				const [p] = await db.select().from(bankPartners).where(eq(bankPartners.orgId, partnerId)).limit(1)
				if (!p || p.status !== 'active') throw bankErr('NOT_FOUND', 'Partner not configured; PUT /platform/config first')
			})
			const c = yield* bankDb(async (db) => {
				const [row] = await db.insert(bankPartnerCustomers).values({ id: newId('acct').replace('acct_', 'pcus_'), partnerId, externalRef: i.externalRef, displayName: i.displayName ?? null, email: i.email ?? null, country: i.country ?? null }).onConflictDoNothing().returning()
				if (row) return row
				const [ex] = await db.select().from(bankPartnerCustomers).where(and(eq(bankPartnerCustomers.partnerId, partnerId), eq(bankPartnerCustomers.externalRef, i.externalRef))).limit(1)
				return ex!
			})
			yield* enqueue(partnerId, 'customer.created', { customerId: c.id, externalRef: c.externalRef })
			return c
		}),

	listCustomers: (partnerId, limit = 100) => bankDb((db) => db.select().from(bankPartnerCustomers).where(eq(bankPartnerCustomers.partnerId, partnerId)).orderBy(bankPartnerCustomers.createdAt).limit(Math.min(limit, 500))),

	openAccount: (partnerId, customerId, i) =>
		Effect.gen(function* () {
			yield* assertCustomer(partnerId, customerId)
			const asset = findAsset(i.asset, i.chain)
			if (!asset || asset.family !== 'evm') return yield* Effect.fail(bankErr('ASSET_UNSUPPORTED', `Unsupported asset ${i.asset} on ${i.chain} (partner accounts are EVM)`))
			const wallet = yield* customerWallet(customerId)
			const ledger = yield* BankLedgerService
			const a = yield* ledger.openAccount({ owner: owner(customerId), kind: i.kind ?? 'checking', asset: asset.symbol, chain: asset.chain, label: i.label, wallet, metadata: { partnerId, dedicatedWallet: true } })
			yield* enqueue(partnerId, 'account.opened', { customerId, accountId: a.id })
			return a
		}),

	listAccounts: (partnerId, customerId) =>
		Effect.gen(function* () {
			yield* assertCustomer(partnerId, customerId)
			return yield* (yield* BankLedgerService).getAccounts(owner(customerId))
		}),

	// MONEY-PATH
	partnerTransfer: (partnerId, i) =>
		Effect.gen(function* () {
			yield* assertCustomer(partnerId, i.customerId)
			const ledger = yield* BankLedgerService
			const from = yield* ledger.getAccount(owner(i.customerId), i.fromAccountId) // ownership-checked
			{ const sysErr = assertSpendable(from); if (sysErr) return yield* Effect.fail(sysErr) } // MONEY-PATH: system-kind accounts are never user-spendable
			if (i.toAccountId && !(yield* accountInPartner(partnerId, i.toAccountId))) return yield* Effect.fail(bankErr('NOT_FOUND', 'Destination account not found')) // cross-partner isolation
			if (!!i.toAccountId === !!i.toExternal) return yield* Effect.fail(bankErr('VALIDATION', 'provide exactly one of toAccountId or toExternal'))
			if (!/^[1-9][0-9]{0,77}$/.test(i.amountMinor)) return yield* Effect.fail(bankErr('VALIDATION', 'amountMinor must be a positive integer string'))
			const cfg = yield* bankDb(async (db) => (await db.select().from(bankPartners).where(eq(bankPartners.orgId, partnerId)).limit(1))[0])
			const bps = cfg?.feeBpsTransfer ?? 0
			const amount = BigInt(i.amountMinor)
			// MONEY-PATH: the funds check (amount + fee) happens atomically under the source row lock in BankTransferService.
			const { feeLeg, feeMinor } = yield* feeLegFor(partnerId, from, amount, bps, i.idempotencyKey, 'transfer')
			const t = yield* BankTransferService
			const transfer = yield* t.transfer({ owner: owner(i.customerId), idempotencyKey: i.idempotencyKey, type: 'internal', fromAccountId: i.fromAccountId, toAccountId: i.toAccountId, toExternal: i.toExternal, amountMinor: i.amountMinor, memo: i.memo, metadata: { partnerId, partnerCustomerId: i.customerId }, feeLeg })
			const fee = feeLeg ? yield* feeRowFor(i.customerId, i.idempotencyKey) : null
			yield* Effect.ignore(enqueue(partnerId, 'transfer.created', { transferId: transfer.id, customerId: i.customerId, status: transfer.status, amountMinor: i.amountMinor })) // never an error after money moved
			return { transfer, fee, feeMinor }
		}),

	// MONEY-PATH
	executeFx: (partnerId, i) =>
		Effect.gen(function* () {
			yield* assertCustomer(partnerId, i.customerId)
			const ledger = yield* BankLedgerService
			const from = yield* ledger.getAccount(owner(i.customerId), i.fromAccountId)
			{ const sysErr = assertSpendable(from); if (sysErr) return yield* Effect.fail(sysErr) } // MONEY-PATH: system-kind accounts are never user-spendable
			const to = yield* ledger.getAccount(owner(i.customerId), i.toAccountId)
			void to
			const cfg = yield* bankDb(async (db) => (await db.select().from(bankPartners).where(eq(bankPartners.orgId, partnerId)).limit(1))[0])
			const bps = cfg?.feeBpsFx ?? 0
			const amount = BigInt(i.amountMinor)
			const { feeLeg, feeMinor } = yield* feeLegFor(partnerId, from, amount, bps, i.idempotencyKey, 'fx')
			const r = yield* (yield* BankFxService).execute({ owner: owner(i.customerId), fromAccountId: i.fromAccountId, toAccountId: i.toAccountId, amountMinor: i.amountMinor, slippage: i.slippage, idempotencyKey: i.idempotencyKey, feeLeg } as never)
			const fee = feeLeg ? yield* feeRowFor(i.customerId, i.idempotencyKey) : null
			yield* Effect.ignore(enqueue(partnerId, 'fx.executed', { transferId: r.transfer.id, customerId: i.customerId })) // never an error after money moved
			return { transfer: r.transfer, fee, feeMinor }
		}),

	listTransfers: (partnerId, customerId, limit = 50) =>
		Effect.gen(function* () {
			if (customerId) yield* assertCustomer(partnerId, customerId)
			return yield* bankDb((db) => {
				const ids = customerId ? [customerId] : null
				const scope = ids
					? inArray(bankTransfers.ownerId, ids)
					: inArray(bankTransfers.ownerId, db.select({ id: bankPartnerCustomers.id }).from(bankPartnerCustomers).where(eq(bankPartnerCustomers.partnerId, partnerId)))
				return db.select().from(bankTransfers).where(and(eq(bankTransfers.ownerType, 'partner_customer'), scope)).orderBy(sql`${bankTransfers.createdAt} desc`).limit(Math.min(limit, 200))
			})
		}),

	usage: (partnerId, from, to) =>
		bankDb(async (db) => {
			const mine = db.select({ id: bankPartnerCustomers.id }).from(bankPartnerCustomers).where(eq(bankPartnerCustomers.partnerId, partnerId))
			const [cust_] = await db.select({ n: sql<number>`count(*)::int` }).from(bankPartnerCustomers).where(eq(bankPartnerCustomers.partnerId, partnerId))
			const [accts] = await db.select({ n: sql<number>`count(*)::int` }).from(bankAccounts).where(and(eq(bankAccounts.ownerType, 'partner_customer'), inArray(bankAccounts.ownerId, mine)))
			const vol = await db
				.select({ asset: bankTransfers.asset, chain: bankTransfers.chain, n: sql<number>`count(*)::int`, volume: sql<string>`coalesce(sum(${bankTransfers.amountMinor}),0)::text`, fees: sql<string>`coalesce(sum(case when ${bankTransfers.metadata}->>'partnerFee' = 'true' then ${bankTransfers.amountMinor} else 0 end),0)::text` })
				.from(bankTransfers)
				.where(and(eq(bankTransfers.ownerType, 'partner_customer'), inArray(bankTransfers.ownerId, mine), sql`${bankTransfers.createdAt} >= ${from}`, sql`${bankTransfers.createdAt} < ${to}`, inArray(bankTransfers.status, ['pending', 'submitted', 'confirmed'])))
				.groupBy(bankTransfers.asset, bankTransfers.chain)
			return { partnerId, from: from.toISOString(), to: to.toISOString(), customers: cust_?.n ?? 0, accounts: accts?.n ?? 0, byAsset: vol.map((v) => ({ asset: v.asset, chain: v.chain, transfers: v.n, volumeMinor: v.volume, partnerFeesMinor: v.fees })) }
		}),

	listEvents: (partnerId, limit = 50) => bankDb((db) => db.select({ id: bankPartnerEvents.id, event: bankPartnerEvents.event, status: bankPartnerEvents.status, attempts: bankPartnerEvents.attempts, lastError: bankPartnerEvents.lastError, createdAt: bankPartnerEvents.createdAt, deliveredAt: bankPartnerEvents.deliveredAt }).from(bankPartnerEvents).where(eq(bankPartnerEvents.partnerId, partnerId)).orderBy(sql`${bankPartnerEvents.createdAt} desc`).limit(Math.min(limit, 200))),

	deliverDueWebhooks: (limit = 50) =>
		Effect.gen(function* () {
			const due = yield* bankDb((db) => db.select().from(bankPartnerEvents).where(and(eq(bankPartnerEvents.status, 'pending'), lte(bankPartnerEvents.nextAttemptAt, new Date()))).orderBy(bankPartnerEvents.nextAttemptAt).limit(limit))
			let delivered = 0
			let dead = 0
			for (const ev of due) {
				const cfg = yield* bankDb(async (db) => (await db.select().from(bankPartners).where(eq(bankPartners.orgId, ev.partnerId)).limit(1))[0])
				const attempt = ev.attempts + 1
				let err: string | null = null
				if (!cfg?.webhookUrl || !cfg.webhookSecret) err = 'partner has no webhook configured'
				else {
					const body = JSON.stringify({ id: ev.id, type: ev.event, createdAt: ev.createdAt.toISOString(), data: ev.payload })
					const ts = Math.floor(Date.now() / 1000)
					const r = yield* Effect.either(Effect.tryPromise({ try: () => guardedFetch(cfg.webhookUrl!, { method: 'POST', body, timeoutMs: 10_000, headers: { 'content-type': 'application/json', 'x-suwappu-event': ev.event, 'x-suwappu-signature': signWebhook(cfg.webhookSecret!, ts, body) } }), catch: (e) => e as BankError }))
					if (r._tag === 'Left') err = r.left.message
					else if (r.right.status < 200 || r.right.status >= 300) err = `HTTP ${r.right.status}`
				}
				const patch = err === null ? { status: 'delivered' as const, attempts: attempt, deliveredAt: new Date(), lastError: null } : attempt >= 8 ? { status: 'dead' as const, attempts: attempt, lastError: err } : { attempts: attempt, lastError: err, nextAttemptAt: new Date(Date.now() + Math.min(2 ** attempt * 30, 6 * 3600) * 1000) }
				yield* bankDb((db) => db.update(bankPartnerEvents).set(patch).where(eq(bankPartnerEvents.id, ev.id)))
				if (err === null) delivered++
				else if (attempt >= 8) dead++
			}
			return { attempted: due.length, delivered, dead }
		}),

	// MONEY-PATH: each ISO transaction becomes an idempotent partner transfer (key = batch msgId + EndToEndId).
	importCreditTransfers: (partnerId, batch, customerId) =>
		Effect.gen(function* () {
			yield* assertCustomer(partnerId, customerId)
			const self = yield* BankPartnerService
			const results: Array<{ endToEndId: string; status: 'ACCP' | 'RJCT'; transferId?: string; reason?: string }> = []
			for (const t of batch.transfers) {
				const toExternal = /^0x[0-9a-fA-F]{40}$/.test(t.creditorAccountId)
				const r = yield* Effect.either(
					self.partnerTransfer(partnerId, { customerId, fromAccountId: t.debtorAccountId, ...(toExternal ? { toExternal: { address: t.creditorAccountId } } : { toAccountId: t.creditorAccountId }), amountMinor: t.amountMinor, idempotencyKey: `p001:${batch.messageId}:${t.endToEndId}`.slice(0, 128), memo: t.remittanceInfo?.slice(0, 280) }),
				)
				results.push(r._tag === 'Right' ? { endToEndId: t.endToEndId, status: 'ACCP', transferId: r.right.transfer.id } : { endToEndId: t.endToEndId, status: 'RJCT', reason: `${r.left.code}: ${r.left.message}` })
			}
			return { messageId: batch.messageId, results }
		}),
})
void cust
