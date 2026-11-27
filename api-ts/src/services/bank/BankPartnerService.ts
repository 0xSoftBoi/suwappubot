/**
 * M11 embedded banking (BaaS). A partner is an org API key (orgId). Partner customers are bank
 * owners of type 'partner_customer'. EVERY query is scoped by partner_id; destination accounts for
 * internal transfers must belong to the same partner. Customer accounts share the partner's
 * omnibus custody wallet (org owner's custodial EVM wallet) with isolated ledger accounts.
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
import { BankTransferService } from './BankTransferService'
import { type BankOwner, bankDb, newId } from './db'
import { type BankError, bankErr } from './errors'
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

/** Omnibus custody wallet: the org owner's custodial EVM wallet. */
const partnerWallet = (partnerId: string) =>
	Effect.gen(function* () {
		const orgOwner = yield* bankDb(async (db) => {
			const [o] = await db.select({ ownerId: organizations.ownerId }).from(organizations).where(eq(organizations.id, partnerId)).limit(1)
			if (!o) throw bankErr('NOT_FOUND', 'Partner organization not found')
			return o.ownerId
		})
		const ledger = yield* BankLedgerService
		return yield* ledger.resolveCustodyWallet({ ownerType: 'user', ownerId: String(orgOwner) }, 'evm')
	})

/** Is `accountId` owned by a customer of this partner, or by the partner org itself? */
const accountInPartner = (partnerId: string, accountId: string) =>
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

/** MONEY-PATH: fee = floor(amount * bps / 10000), charged as a separate internal transfer to the partner revenue account. */
const chargeFee = (partnerId: string, customerId: string, fromAccount: BankAccount, amount: bigint, bps: number, key: string, kind: 'transfer' | 'fx') =>
	Effect.gen(function* () {
		const feeMinor = (amount * BigInt(bps)) / 10_000n
		if (feeMinor <= 0n) return { fee: null as BankTransfer | null, feeMinor: '0' }
		const ledger = yield* BankLedgerService
		const wallet = yield* partnerWallet(partnerId)
		const revenue = yield* ledger.openAccount({ owner: { ownerType: 'org', ownerId: partnerId }, kind: 'treasury', asset: fromAccount.asset, chain: fromAccount.chain, label: 'partner-revenue', wallet })
		const t = yield* BankTransferService
		const fee = yield* t.transfer({ owner: owner(customerId), idempotencyKey: `${key}:fee`, type: 'internal', fromAccountId: fromAccount.id, toAccountId: revenue.id, amountMinor: feeMinor.toString(), memo: `partner ${kind} fee`, metadata: { partnerFee: true, partnerId, kind, bps, baseAmountMinor: amount.toString() } })
		return { fee, feeMinor: feeMinor.toString() }
	})

let timer: ReturnType<typeof setInterval> | null = null
/** Recurring webhook retry job (lazy singleton; started when the platform routes register). */
export function startPartnerWebhookJob(seconds = 30): void {
	if (timer) return
	timer = setInterval(() => {
		// lazy import: runtime -> MainLayer -> bank index -> this file would otherwise be a cycle
		void import('../../runtime').then(({ runEffect }) => runEffect(Effect.gen(function* () { return yield* (yield* BankPartnerService).deliverDueWebhooks(50) }))).catch((e) => logger.error({ err: String(e) }, 'bank: partner webhook tick failed'))
	}, seconds * 1000)
	;(timer as { unref?: () => void }).unref?.()
}

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
			const wallet = yield* partnerWallet(partnerId)
			const ledger = yield* BankLedgerService
			const a = yield* ledger.openAccount({ owner: owner(customerId), kind: i.kind ?? 'checking', asset: asset.symbol, chain: asset.chain, label: i.label, wallet, metadata: { partnerId, omnibus: true } })
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
			if (i.toAccountId && !(yield* accountInPartner(partnerId, i.toAccountId))) return yield* Effect.fail(bankErr('NOT_FOUND', 'Destination account not found')) // cross-partner isolation
			if (!!i.toAccountId === !!i.toExternal) return yield* Effect.fail(bankErr('VALIDATION', 'provide exactly one of toAccountId or toExternal'))
			if (!/^[1-9][0-9]{0,77}$/.test(i.amountMinor)) return yield* Effect.fail(bankErr('VALIDATION', 'amountMinor must be a positive integer string'))
			const cfg = yield* bankDb(async (db) => (await db.select().from(bankPartners).where(eq(bankPartners.orgId, partnerId)).limit(1))[0])
			const bps = cfg?.feeBpsTransfer ?? 0
			const amount = BigInt(i.amountMinor)
			const feeMinor = (amount * BigInt(bps)) / 10_000n
			if ((yield* ledger.balance(from.id)) < amount + feeMinor) return yield* Effect.fail(bankErr('INSUFFICIENT_FUNDS', `Balance cannot cover amount plus partner fee (${feeMinor})`))
			const t = yield* BankTransferService
			const transfer = yield* t.transfer({ owner: owner(i.customerId), idempotencyKey: i.idempotencyKey, type: 'internal', fromAccountId: i.fromAccountId, toAccountId: i.toAccountId, toExternal: i.toExternal, amountMinor: i.amountMinor, memo: i.memo, metadata: { partnerId, partnerCustomerId: i.customerId } })
			const { fee } = yield* chargeFee(partnerId, i.customerId, from, amount, bps, i.idempotencyKey, 'transfer')
			yield* enqueue(partnerId, 'transfer.created', { transferId: transfer.id, customerId: i.customerId, status: transfer.status, amountMinor: i.amountMinor })
			return { transfer, fee, feeMinor: feeMinor.toString() }
		}),

	// MONEY-PATH
	executeFx: (partnerId, i) =>
		Effect.gen(function* () {
			yield* assertCustomer(partnerId, i.customerId)
			const ledger = yield* BankLedgerService
			const from = yield* ledger.getAccount(owner(i.customerId), i.fromAccountId)
			const to = yield* ledger.getAccount(owner(i.customerId), i.toAccountId)
			void to
			const cfg = yield* bankDb(async (db) => (await db.select().from(bankPartners).where(eq(bankPartners.orgId, partnerId)).limit(1))[0])
			const bps = cfg?.feeBpsFx ?? 0
			const amount = BigInt(i.amountMinor)
			const feeMinor = (amount * BigInt(bps)) / 10_000n
			if ((yield* ledger.balance(from.id)) < amount + feeMinor) return yield* Effect.fail(bankErr('INSUFFICIENT_FUNDS', `Balance cannot cover amount plus partner fx fee (${feeMinor})`))
			const r = yield* (yield* BankFxService).execute({ owner: owner(i.customerId), fromAccountId: i.fromAccountId, toAccountId: i.toAccountId, amountMinor: i.amountMinor, slippage: i.slippage, idempotencyKey: i.idempotencyKey } as never)
			const { fee } = yield* chargeFee(partnerId, i.customerId, from, amount, bps, i.idempotencyKey, 'fx')
			yield* enqueue(partnerId, 'fx.executed', { transferId: r.transfer.id, customerId: i.customerId })
			return { transfer: r.transfer, fee, feeMinor: feeMinor.toString() }
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
