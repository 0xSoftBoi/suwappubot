/**
 * BankPaymentsService (M7) — MONEY-PATH. Invoices + payment links.
 *  - Pay from a bank account: BankTransferService with key `inv:{invoiceId}:{sha(clientKey)}`; the invoice is only
 *    credited when the transfer is `confirmed` (settlePayment is a conditional pending->confirmed + invoice
 *    increment in ONE db transaction, so a retry can never credit twice).
 *  - Pay externally: payer sends `amount + tag` (EVM; tag unique among the payee account's live invoices) or includes
 *    the Solana Pay `reference`. The recurring job credits the invoice ONLY from a Transfer log / finalized signature
 *    at the required confirmation depth; (invoiceId, refKey) is unique so rescans are idempotent.
 */
import { createHash, randomBytes } from 'node:crypto'
import { and, desc, eq, inArray, sql } from 'drizzle-orm'
import { Context, Effect, Layer, Option } from 'effect'
import {
	type BankInvoice,
	type BankInvoicePayment,
	bankInvoicePayments,
	bankInvoiceAcceptances,
	bankInvoices,
	type InvoiceLineItem,
	type InvoiceStatus,
} from '../../db'
import { logger } from '../../lib/logger'
import { type BankAsset, findAsset } from './assets'
import { BankLedgerService } from './BankLedgerService'
import { BankTransferService } from './BankTransferService'
import { b58encode } from './chain'
import { type BankOwner, bankDb } from './db'
import { bankErr } from './errors'
import { assertSpendable } from './systemDebit'
import { evmHead, evmTransferLogs, MAX_LOG_RANGE, solReceivedBy, solReferenceSignatures } from './onchainScan'
import { buildEip681Erc20, buildSolanaPay, qrPayload } from './paymentRequest'
import { BankCreditLookup, guard, idemKey, newSlug, type PayFx, optional, parseMinor, sameOwner, toOwner, uid } from './paymentsCommon'

const LIVE: InvoiceStatus[] = ['open', 'partially_paid', 'overdue']
const TAG_MAX = 999
const CONFIRMATIONS: Record<string, bigint> = { ethereum: 3n }
const confirmationsFor = (c: string) => CONFIRMATIONS[c] ?? 1n

export interface CreateInvoiceInput {
	payeeAccountId: string
	payer?: BankOwner | undefined
	amountMinor?: string | undefined
	lineItems?: InvoiceLineItem[] | undefined
	dueAt?: Date | undefined
	memo?: string | undefined
	metadata?: Record<string, unknown> | undefined
	idempotencyKey?: string | undefined
	/** Default true: invoice is created `open`. false creates a `draft`. */
	publish?: boolean | undefined
}

export interface PaymentRequest {
	family: 'evm' | 'solana'
	/** EIP-681 / Solana Pay URI. */
	uri: string
	qrPayload: string
	payTo: string
	/** What an external payer must send (EVM includes the unique tag). */
	payAmountMinor: string
	asset: string
	chain: string
	reference: string | null
}

export interface InvoiceView {
	invoice: BankInvoice
	paymentRequest: PaymentRequest
	payments: BankInvoicePayment[]
	/** Payer acceptance (receivables financing). required = the invoice names a payer. */
	acceptance: InvoiceAcceptance
}

export interface InvoiceAcceptance {
	required: boolean
	acceptedAt: string | null
}

export interface PayInvoiceResult {
	invoice: BankInvoice
	payment: BankInvoicePayment
	transferStatus: string
	/** The bank transfer that carries this payment. */
	transferId: string
}

/** Public, unauthenticated projection: only what the payee put on the invoice plus public pay-to details. */
export interface PublicInvoiceView {
	slug: string
	status: InvoiceStatus
	amountMinor: string
	paidMinor: string
	asset: string
	/** Display helpers so a signed-out payer sees a human amount: asset symbol, its decimals, the chain's display name. */
	symbol: string
	decimals: number
	chainName: string
	chain: string
	acceptance: InvoiceAcceptance
	lineItems: InvoiceLineItem[]
	memo: string | null
	dueAt: string | null
	paymentRequest: PaymentRequest
}

export interface BankPaymentsServiceInterface {
	readonly createInvoice: (owner: BankOwner, input: CreateInvoiceInput) => PayFx<InvoiceView>
	readonly publishInvoice: (owner: BankOwner, invoiceId: string) => PayFx<InvoiceView>
	readonly voidInvoice: (owner: BankOwner, invoiceId: string) => PayFx<InvoiceView>
	readonly getInvoice: (owner: BankOwner, invoiceId: string) => PayFx<InvoiceView>
	readonly listInvoices: (owner: BankOwner, opts?: { role?: 'payee' | 'payer'; status?: string; limit?: number }) => PayFx<BankInvoice[]>
	readonly getPublicInvoice: (slug: string) => PayFx<PublicInvoiceView>
	/** Pay an invoice (by id or slug) from one of the caller's bank accounts. */
	readonly payInvoice: (
		owner: BankOwner,
		input: { invoiceId?: string | undefined; slug?: string | undefined; fromAccountId: string; amountMinor?: string | undefined; idempotencyKey: string },
	) => PayFx<PayInvoiceResult>
	/** Recurring job step: detect external payments, confirm pending bank payments, mark overdue. */
	readonly runJob: () => PayFx<{ credited: number; confirmed: number; overdue: number }>
}

export class BankPaymentsService extends Context.Tag('BankPaymentsService')<BankPaymentsService, BankPaymentsServiceInterface>() {}

// ------------------------------------------------------------------ helpers

const assetOf = (symbol: string, chain: string): BankAsset => {
	const a = findAsset(symbol, chain)
	if (!a) throw bankErr('ASSET_UNSUPPORTED', `Unsupported asset ${symbol} on ${chain}`)
	return a
}

export function buildPaymentRequest(inv: Pick<BankInvoice, 'amountMinor' | 'tagMinor' | 'asset' | 'chain' | 'reference' | 'memo' | 'slug'>, payTo: string): PaymentRequest {
	const a = assetOf(inv.asset, inv.chain)
	const pay = BigInt(inv.amountMinor) + BigInt(inv.tagMinor)
	const uri =
		a.family === 'evm'
			? buildEip681Erc20({ tokenAddress: a.address, chainId: a.chainId!, recipient: payTo, amountMinor: pay })
			: buildSolanaPay({
					recipient: payTo,
					amountMinor: pay,
					decimals: a.decimals,
					splToken: a.address,
					...(inv.reference ? { reference: inv.reference } : {}),
					label: 'Suwappu invoice',
					...(inv.memo ? { message: inv.memo.slice(0, 120) } : {}),
					memo: `inv:${inv.slug}`,
				})
	return { family: a.family, uri, qrPayload: qrPayload(uri), payTo, payAmountMinor: pay.toString(), asset: inv.asset, chain: inv.chain, reference: inv.reference ?? null }
}

const lineTotal = (items: InvoiceLineItem[]): bigint =>
	items.reduce((s, i) => {
		if (!Number.isInteger(i.quantity) || i.quantity <= 0) throw bankErr('VALIDATION', 'line item quantity must be a positive integer')
		return s + BigInt(i.unitAmountMinor) * BigInt(i.quantity)
	}, 0n)

const sha = (s: string) => createHash('sha256').update(s).digest('hex').slice(0, 32)

/** Credit `amount` to the invoice inside the caller's transaction. */
const creditInvoiceSql = (invoiceId: string, amount: bigint) => sql`
	update bank_invoices set
		paid_minor = paid_minor + ${amount.toString()}::numeric,
		status = case when status = 'void' then status when paid_minor + ${amount.toString()}::numeric >= amount_minor then 'paid' else 'partially_paid' end,
		paid_at = case when status <> 'void' and paid_minor + ${amount.toString()}::numeric >= amount_minor then now() else paid_at end,
		updated_at = now()
	where id = ${invoiceId} and status <> 'draft'`

// ------------------------------------------------------------------ implementation

const loadInvoice = (where: { id?: string; slug?: string }) =>
	bankDb(async (db) => {
		const cond = where.id ? eq(bankInvoices.id, where.id) : eq(bankInvoices.slug, where.slug ?? '')
		const [r] = await db.select().from(bankInvoices).where(cond).limit(1)
		if (!r) throw bankErr('NOT_FOUND', 'Invoice not found')
		return r
	})

const payToOf = (inv: BankInvoice): PayFx<string> =>
	Effect.gen(function* () {
		const ledger = yield* BankLedgerService
		const acct = yield* ledger.getAccountById(inv.payeeAccountId)
		if (!acct.address) return yield* Effect.fail(bankErr('WALLET_UNAVAILABLE', 'Payee account has no wallet address'))
		return acct.address
	})

const CHAIN_DISPLAY: Record<string, string> = { ethereum: 'Ethereum', base: 'Base', arbitrum: 'Arbitrum', optimism: 'Optimism', polygon: 'Polygon', bsc: 'BNB Chain', avalanche: 'Avalanche', solana: 'Solana', tempo: 'Tempo' }
const chainName = (k: string): string => CHAIN_DISPLAY[k.toLowerCase()] ?? k.charAt(0).toUpperCase() + k.slice(1)

const acceptanceOf = (inv: BankInvoice): PayFx<InvoiceAcceptance> =>
	bankDb(async (db) => {
		const [a] = await db.select({ at: bankInvoiceAcceptances.acceptedAt }).from(bankInvoiceAcceptances).where(eq(bankInvoiceAcceptances.invoiceId, inv.id)).limit(1)
		return { required: inv.payerOwnerType != null, acceptedAt: a ? a.at.toISOString() : null }
	})

const view = (inv: BankInvoice): PayFx<InvoiceView> =>
	Effect.gen(function* () {
		const payTo = yield* payToOf(inv)
		const payments = yield* bankDb((db) => db.select().from(bankInvoicePayments).where(eq(bankInvoicePayments.invoiceId, inv.id)).orderBy(desc(bankInvoicePayments.createdAt)))
		const paymentRequest = yield* guard(() => buildPaymentRequest(inv, payTo))
		return { invoice: inv, paymentRequest, payments, acceptance: yield* acceptanceOf(inv) }
	})

const ownedAsPayee = (owner: BankOwner, id: string): PayFx<BankInvoice> =>
	Effect.gen(function* () {
		const inv = yield* loadInvoice({ id })
		if (inv.payeeOwnerType !== owner.ownerType || inv.payeeOwnerId !== owner.ownerId) return yield* Effect.fail(bankErr('NOT_FOUND', 'Invoice not found'))
		return inv
	})

/** After a credit commits: notify the credit module (receivables financing) if it is deployed. Never fails. */
const notifyCredit = (invoiceId: string, amount: bigint, paymentRef?: string): PayFx<void> =>
	Effect.gen(function* () {
		const credit = yield* optional(BankCreditLookup)
		if (Option.isNone(credit)) return
		yield* credit.value.settleReceivable(invoiceId, amount.toString(), paymentRef).pipe(
			Effect.catchAll((e) => Effect.sync(() => logger.warn({ invoiceId, err: String(e) }, 'bank: settleReceivable failed (will not block payment)'))),
		)
	}).pipe(Effect.catchAllDefect(() => Effect.void))

/** pending -> confirmed + invoice credit, atomically. Returns the credited amount or null if already settled. */
const settlePayment = (paymentId: string): PayFx<{ invoiceId: string; amount: bigint; ref: string } | null> =>
	Effect.gen(function* () {
		const r = yield* bankDb((db) =>
			db.transaction(async (tx) => {
				const [p] = await tx
					.update(bankInvoicePayments)
					.set({ status: 'confirmed', confirmedAt: new Date() })
					.where(and(eq(bankInvoicePayments.id, paymentId), eq(bankInvoicePayments.status, 'pending')))
					.returning()
				if (!p) return null
				await tx.execute(creditInvoiceSql(p.invoiceId, BigInt(p.amountMinor)))
				return { invoiceId: p.invoiceId, amount: BigInt(p.amountMinor), ref: p.id }
			}),
		)
		if (r) yield* notifyCredit(r.invoiceId, r.amount, r.ref)
		return r
	})

/**
 * MONEY-PATH: credit one onchain payment to ONE invoice. The receipt key (payee account + chain + tx ref, with log index for EVM)
 * is globally unique, so a tx/log that carries several invoices' references (or matches several invoices) settles only the first
 * invoice that claims it. Partial payments: the full received amount is credited once (invoice becomes partially_paid until
 * paid_minor >= amount); the same receipt can never be counted twice.
 */
const creditOnchain = (inv: BankInvoice, refKey: string, amount: bigint, txHash: string): PayFx<boolean> =>
	Effect.gen(function* () {
		const invoiceId = inv.id
		const receiptKey = `${inv.payeeAccountId}:${inv.chain}:${refKey}`
		const done = yield* bankDb((db) =>
			db.transaction(async (tx) => {
				const ins = await tx
					.insert(bankInvoicePayments)
					.values({ id: uid('ipay'), invoiceId, source: 'onchain', refKey, receiptKey, amountMinor: amount.toString(), txHash, status: 'confirmed', confirmedAt: new Date() })
					.onConflictDoNothing()
					.returning({ id: bankInvoicePayments.id })
				if (ins.length === 0) return false
				await tx.execute(creditInvoiceSql(invoiceId, amount))
				return true
			}),
		)
		if (done) yield* notifyCredit(invoiceId, amount, refKey)
		return done
	})

const scanEvmGroup = (invs0: BankInvoice[], token: string, payTo: string, chain: string): PayFx<number> =>
	Effect.gen(function* () {
		let invs = invs0
		const head = yield* Effect.tryPromise({ try: () => evmHead(chain), catch: (e) => bankErr('UPSTREAM', `rpc: ${String(e)}`) })
		const safeTo = head - confirmationsFor(chain) + 1n
		// MONEY-PATH: legacy invoices without a start block are never auto-credited (they could match earlier same-value transfers).
		const unscannable = invs.filter((i) => i.scanCursor == null)
		if (unscannable.length) logger.warn({ invoices: unscannable.map((i) => i.id) }, 'bank: invoices without scan start block skipped')
		invs = invs.filter((i) => i.scanCursor != null)
		if (invs.length === 0) return 0
		const starts = invs.map((i) => (i.scanCursor != null ? BigInt(i.scanCursor) : (safeTo > MAX_LOG_RANGE ? safeTo - MAX_LOG_RANGE : 0n)))
		let from = starts.reduce((a, b) => (a < b ? a : b))
		let credited = 0
		if (safeTo < from) return 0
		// Bounded work per tick; the cursor only advances over ranges that were fully scanned.
		for (let n = 0; n < 5 && from <= safeTo; n++) {
			const to = from + MAX_LOG_RANGE - 1n < safeTo ? from + MAX_LOG_RANGE - 1n : safeTo
			const logs = yield* Effect.tryPromise({ try: () => evmTransferLogs({ chain, token, to: payTo, fromBlock: from, toBlock: to }), catch: (e) => bankErr('UPSTREAM', `getLogs: ${String(e)}`) })
			for (const inv of invs) {
				const invFrom = BigInt(inv.scanCursor!) // never below the invoice's creation block (cursor is monotonic, see update below)
				const want = BigInt(inv.amountMinor) + BigInt(inv.tagMinor)
				for (const l of logs) {
					if (l.blockNumber < invFrom || l.value !== want) continue
					if (yield* creditOnchain(inv, `${l.txHash}:${l.logIndex}`, l.value, l.txHash)) credited++
				}
			}
			from = to + 1n
			yield* bankDb((db) =>
				// MONEY-PATH: monotonic per invoice; a group scan that starts below a newer invoice's creation block must not drag its cursor back.
				db.update(bankInvoices).set({ scanCursor: sql`greatest(${bankInvoices.scanCursor}, ${from.toString()}::numeric)` }).where(inArray(bankInvoices.id, invs.map((i) => i.id))),
			)
		}
		return credited
	})

const scanSolana = (inv: BankInvoice, owner: string, mint: string): PayFx<number> =>
	Effect.gen(function* () {
		if (!inv.reference) return 0
		const sigs = yield* Effect.tryPromise({ try: () => solReferenceSignatures(inv.reference!), catch: (e) => bankErr('UPSTREAM', `solana rpc: ${String(e)}`) })
		let credited = 0
		for (const sig of sigs) {
			const got = yield* Effect.tryPromise({ try: () => solReceivedBy(sig, owner, mint), catch: (e) => bankErr('UPSTREAM', `solana rpc: ${String(e)}`) })
			if (got > 0n && (yield* creditOnchain(inv, sig, got, sig))) credited++
		}
		return credited
	})

export const BankPaymentsServiceLive = Layer.succeed(BankPaymentsService, {
	createInvoice: (owner, input) =>
		Effect.gen(function* () {
			const ledger = yield* BankLedgerService
			const acct = yield* ledger.getAccount(owner, input.payeeAccountId)
			if (acct.status !== 'active') return yield* Effect.fail(bankErr('ACCOUNT_STATE', `Payee account is ${acct.status}`))
			if (!acct.address) return yield* Effect.fail(bankErr('WALLET_UNAVAILABLE', 'Payee account has no wallet address'))
			const asset = yield* guard(() => assetOf(acct.asset, acct.chain))
			const items = input.lineItems ?? []
			const total = yield* guard(() => {
				const lt = items.length ? lineTotal(items) : null
				if (input.amountMinor) {
					const a = parseMinor(input.amountMinor)
					if (lt != null && lt !== a) throw bankErr('VALIDATION', `amountMinor ${a} does not equal line items total ${lt}`)
					return a
				}
				if (lt == null || lt <= 0n) throw bankErr('VALIDATION', 'Provide amountMinor or line items')
				return lt
			})
			if (input.dueAt && input.dueAt.getTime() < Date.now() - 60_000) return yield* Effect.fail(bankErr('VALIDATION', 'dueAt is in the past'))
			const head =
				asset.family === 'evm'
					? yield* Effect.tryPromise({ try: () => evmHead(acct.chain), catch: () => null }).pipe(Effect.catchAll(() => Effect.succeed(null)))
					: null
			// MONEY-PATH: an onchain-payable EVM invoice needs a start block, else the scan could credit older same-value transfers.
			if (asset.family === 'evm' && head == null) return yield* Effect.fail(bankErr('UPSTREAM', 'RETRYABLE: could not read the chain head to anchor the invoice scan; retry shortly'))
			const slug = newSlug()
			const inv = yield* bankDb((db) =>
				db.transaction(async (tx) => {
					await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${acct.id}))`)
					if (input.idempotencyKey) {
						const [ex] = await tx
							.select()
							.from(bankInvoices)
							.where(and(eq(bankInvoices.payeeOwnerType, owner.ownerType), eq(bankInvoices.payeeOwnerId, owner.ownerId), eq(bankInvoices.idempotencyKey, input.idempotencyKey)))
							.limit(1)
						if (ex) {
							if (ex.payeeAccountId !== acct.id || BigInt(ex.amountMinor) !== total) throw bankErr('CONFLICT', 'idempotencyKey was already used with different invoice terms')
							return ex
						}
					}
					let tag = 0n
					let reference: string | null = null
					if (asset.family === 'evm') {
						const used = (
							(
								await tx
									.select({ t: bankInvoices.tagMinor, a: bankInvoices.amountMinor })
									.from(bankInvoices)
									.where(and(eq(bankInvoices.payeeAccountId, acct.id), inArray(bankInvoices.status, ['draft', ...LIVE])))
							)
						)
						// MONEY-PATH: the tagged total (amount + tag) must be unique among the account's live invoices (same chain+asset), not just the tag.
						const usedTags = new Set(used.map((u) => u.t))
						const usedTotals = new Set(used.map((u) => (BigInt(u.a) + BigInt(u.t)).toString()))
						const start = (randomBytes(2).readUInt16BE() % TAG_MAX) + 1
						for (let i = 0; i < TAG_MAX; i++) {
							const cand = ((start + i - 1) % TAG_MAX) + 1
							if (!usedTags.has(String(cand)) && !usedTotals.has((total + BigInt(cand)).toString())) {
								tag = BigInt(cand)
								break
							}
						}
						if (tag === 0n) throw bankErr('LIMIT_EXCEEDED', 'Too many open invoices on this account; settle or void some first')
					} else {
						reference = b58encode(randomBytes(32))
					}
					const [row] = await tx
						.insert(bankInvoices)
						.values({
							id: uid('inv'),
							slug,
							ownerType: owner.ownerType,
							ownerId: owner.ownerId,
							payeeOwnerType: owner.ownerType,
							payeeOwnerId: owner.ownerId,
							payeeAccountId: acct.id,
							payerOwnerType: input.payer?.ownerType ?? null,
							payerOwnerId: input.payer?.ownerId ?? null,
							amountMinor: total.toString(),
							tagMinor: tag.toString(),
							asset: acct.asset,
							chain: acct.chain,
							reference,
							lineItems: items,
							dueAt: input.dueAt ?? null,
							status: input.publish === false ? 'draft' : 'open',
							memo: input.memo ?? null,
							metadata: input.metadata ?? {},
							scanCursor: head != null ? (head + 1n).toString() : null,
							idempotencyKey: input.idempotencyKey ?? null,
						})
						.returning()
					return row!
				}),
			)
			return yield* view(inv)
		}),

	publishInvoice: (owner, invoiceId) =>
		Effect.gen(function* () {
			const inv = yield* ownedAsPayee(owner, invoiceId)
			if (inv.status === 'open') return yield* view(inv)
			if (inv.status !== 'draft') return yield* Effect.fail(bankErr('CONFLICT', `Invoice is ${inv.status}`))
			const [row] = yield* bankDb((db) => db.update(bankInvoices).set({ status: 'open', updatedAt: new Date() }).where(and(eq(bankInvoices.id, inv.id), eq(bankInvoices.status, 'draft'))).returning())
			return yield* view(row ?? (yield* loadInvoice({ id: inv.id })))
		}),

	voidInvoice: (owner, invoiceId) =>
		Effect.gen(function* () {
			const inv = yield* ownedAsPayee(owner, invoiceId)
			if (inv.status === 'void') return yield* view(inv)
			if (inv.status === 'paid' || BigInt(inv.paidMinor) > 0n) return yield* Effect.fail(bankErr('CONFLICT', 'Invoice already has payments; cannot void'))
			// MONEY-PATH: lock the invoice row (same lock as receivables financing), then re-check paid/financed under it.
			const row = yield* bankDb((db) =>
				db.transaction(async (tx) => {
					const [cur] = await tx.select().from(bankInvoices).where(eq(bankInvoices.id, inv.id)).for('update')
					if (!cur || cur.status === 'paid' || BigInt(cur.paidMinor) > 0n) return null
					const fin = (await tx.execute(sql`select 1 as x from bank_credit_lines where receivable_id = ${inv.id} and kind = 'receivable' and status = 'active' limit 1`)) as unknown as unknown[]
					if (fin.length > 0) return null
					const [u] = await tx.update(bankInvoices).set({ status: 'void', updatedAt: new Date() }).where(eq(bankInvoices.id, inv.id)).returning()
					return u ?? null
				}),
			)
			// MONEY-PATH: a financed (active receivable line) invoice cannot be voided.
			if (!row) return yield* Effect.fail(bankErr('CONFLICT', 'Invoice received a payment or is financed; cannot void'))
			return yield* view(row)
		}),

	getInvoice: (owner, invoiceId) =>
		Effect.gen(function* () {
			const inv = yield* loadInvoice({ id: invoiceId })
			const isPayee = inv.payeeOwnerType === owner.ownerType && inv.payeeOwnerId === owner.ownerId
			const isPayer = inv.payerOwnerType === owner.ownerType && inv.payerOwnerId === owner.ownerId
			if (!isPayee && !isPayer) return yield* Effect.fail(bankErr('NOT_FOUND', 'Invoice not found'))
			return yield* view(inv)
		}),

	listInvoices: (owner, opts) =>
		bankDb((db) => {
			const role = opts?.role ?? 'payee'
			const conds = [
				role === 'payee'
					? and(eq(bankInvoices.payeeOwnerType, owner.ownerType), eq(bankInvoices.payeeOwnerId, owner.ownerId))
					: and(eq(bankInvoices.payerOwnerType, owner.ownerType), eq(bankInvoices.payerOwnerId, owner.ownerId)),
			]
			if (opts?.status) conds.push(eq(bankInvoices.status, opts.status as InvoiceStatus))
			return db.select().from(bankInvoices).where(and(...conds)).orderBy(desc(bankInvoices.createdAt)).limit(Math.min(opts?.limit ?? 50, 200))
		}),

	getPublicInvoice: (slug) =>
		Effect.gen(function* () {
			const inv = yield* loadInvoice({ slug })
			if (inv.status === 'draft') return yield* Effect.fail(bankErr('NOT_FOUND', 'Invoice not found'))
			const payTo = yield* payToOf(inv)
			const paymentRequest = yield* guard(() => buildPaymentRequest(inv, payTo))
			return {
				slug: inv.slug,
				status: inv.status,
				amountMinor: inv.amountMinor,
				paidMinor: inv.paidMinor,
				asset: inv.asset,
				symbol: inv.asset,
				decimals: assetOf(inv.asset, inv.chain).decimals,
				chainName: chainName(inv.chain),
				chain: inv.chain,
				acceptance: yield* acceptanceOf(inv),
				lineItems: inv.lineItems,
				memo: inv.memo,
				dueAt: inv.dueAt ? inv.dueAt.toISOString() : null,
				paymentRequest,
			}
		}),

	// MONEY-PATH
	payInvoice: (owner, input) =>
		Effect.gen(function* () {
			if (!input.invoiceId === !input.slug) return yield* Effect.fail(bankErr('VALIDATION', 'Provide exactly one of invoiceId or slug'))
			const ledger = yield* BankLedgerService
			const xfer = yield* BankTransferService
			const inv = yield* loadInvoice(input.invoiceId ? { id: input.invoiceId } : { slug: input.slug! })
			if (!(LIVE as string[]).includes(inv.status)) return yield* Effect.fail(bankErr('CONFLICT', `Invoice is ${inv.status}`))
			if (inv.payerOwnerType && !sameOwner(owner, toOwner(inv.payerOwnerType, inv.payerOwnerId!)))
				return yield* Effect.fail(bankErr('FORBIDDEN', 'This invoice is addressed to a different payer'))
			const from = yield* ledger.getAccount(owner, input.fromAccountId)
			{ const sysErr = assertSpendable(from); if (sysErr) return yield* Effect.fail(sysErr) } // MONEY-PATH: system-kind accounts are never user-spendable
			if (from.asset !== inv.asset || from.chain !== inv.chain)
				return yield* Effect.fail(bankErr('VALIDATION', `Invoice is denominated in ${inv.asset} on ${inv.chain}; convert with /fx first or pay from a matching account`))
			const remaining = BigInt(inv.amountMinor) - BigInt(inv.paidMinor)
			const pending = yield* bankDb(async (db) => {
				const r = await db.execute(sql`select coalesce(sum(amount_minor),0)::text as s from bank_invoice_payments where invoice_id = ${inv.id} and status = 'pending'`)
				return BigInt((r as unknown as Array<{ s: string }>)[0]?.s ?? '0')
			})
			const amount = yield* guard(() => (input.amountMinor ? parseMinor(input.amountMinor) : remaining))
			// Replays of the same client key re-enter here with their own pending row already counted — so only enforce
			// the cap against OTHER in-flight payments when this key has not been used before.
			const key = idemKey('inv', inv.id, sha(input.idempotencyKey))
			const refKey = `transfer:${key}`
			const [known] = yield* bankDb((db) => db.select().from(bankInvoicePayments).where(and(eq(bankInvoicePayments.invoiceId, inv.id), eq(bankInvoicePayments.refKey, refKey))).limit(1))
			if (!known && amount + pending > remaining) return yield* Effect.fail(bankErr('VALIDATION', `Amount exceeds the outstanding balance of ${remaining - pending}`))
			if (amount <= 0n) return yield* Effect.fail(bankErr('CONFLICT', 'Invoice has nothing outstanding'))
			const t = yield* xfer.transfer({
				owner,
				idempotencyKey: key,
				type: 'internal',
				fromAccountId: from.id,
				toAccountId: inv.payeeAccountId,
				amountMinor: amount.toString(),
				memo: `Invoice ${inv.slug}`.slice(0, 280),
				metadata: { invoiceId: inv.id, module: 'payments' },
			})
			const payment = yield* bankDb(async (db) => {
				await db
					.insert(bankInvoicePayments)
					.values({ id: uid('ipay'), invoiceId: inv.id, payerOwnerType: owner.ownerType, payerOwnerId: owner.ownerId, source: 'bank', refKey, amountMinor: amount.toString(), transferId: t.id, status: 'pending' })
					.onConflictDoNothing()
				const [p] = await db.select().from(bankInvoicePayments).where(and(eq(bankInvoicePayments.invoiceId, inv.id), eq(bankInvoicePayments.refKey, refKey))).limit(1)
				return p!
			})
			if (t.status === 'confirmed') yield* settlePayment(payment.id)
			else if (t.status === 'failed' || t.status === 'reversed')
				yield* bankDb((db) => db.update(bankInvoicePayments).set({ status: 'failed' }).where(and(eq(bankInvoicePayments.id, payment.id), eq(bankInvoicePayments.status, 'pending'))))
			const [p2, inv2] = yield* bankDb(async (db) => [
				(await db.select().from(bankInvoicePayments).where(eq(bankInvoicePayments.id, payment.id)).limit(1))[0]!,
				(await db.select().from(bankInvoices).where(eq(bankInvoices.id, inv.id)).limit(1))[0]!,
			] as const)
			return { invoice: inv2, payment: p2, transferStatus: t.status, transferId: t.id }
		}),

	// MONEY-PATH
	runJob: () =>
		Effect.gen(function* () {
			const xfer = yield* BankTransferService
			const ledger = yield* BankLedgerService
			let confirmed = 0
			let credited = 0

			// 1. Pending bank payments: advance from the transfer's real state.
			const pend = yield* bankDb((db) => db.select().from(bankInvoicePayments).where(and(eq(bankInvoicePayments.status, 'pending'), eq(bankInvoicePayments.source, 'bank'))).limit(100))
			for (const p of pend) {
				if (!p.payerOwnerType || !p.transferId) continue
				const t = yield* xfer.getTransfer(toOwner(p.payerOwnerType, p.payerOwnerId!), p.transferId).pipe(Effect.option)
				if (Option.isNone(t)) continue
				if (t.value.status === 'confirmed') {
					if (yield* settlePayment(p.id)) confirmed++
				} else if (t.value.status === 'failed' || t.value.status === 'reversed') {
					yield* bankDb((db) => db.update(bankInvoicePayments).set({ status: 'failed' }).where(and(eq(bankInvoicePayments.id, p.id), eq(bankInvoicePayments.status, 'pending'))))
				}
			}

			// 2. External payments from confirmed on-chain evidence only.
			const live = yield* bankDb((db) => db.select().from(bankInvoices).where(inArray(bankInvoices.status, LIVE)).limit(500))
			const groups = new Map<string, BankInvoice[]>()
			for (const inv of live) groups.set(inv.payeeAccountId, [...(groups.get(inv.payeeAccountId) ?? []), inv])
			for (const [accountId, invs] of groups) {
				const res = yield* Effect.gen(function* () {
					const acct = yield* ledger.getAccountById(accountId)
					if (!acct.address) return 0
					const a = yield* guard(() => assetOf(acct.asset, acct.chain))
					if (a.family === 'evm') return yield* scanEvmGroup(invs, a.address, acct.address, acct.chain)
					let n = 0
					for (const inv of invs) n += yield* scanSolana(inv, acct.address, a.address)
					return n
				}).pipe(Effect.catchAll((e) => Effect.sync(() => (logger.warn({ accountId, err: e.message }, 'bank: invoice scan failed'), 0))))
				credited += res
			}

			// 3. Overdue.
			const overdue = yield* bankDb(async (db) => {
				const r = await db.execute(sql`update bank_invoices set status = 'overdue', updated_at = now() where status in ('open','partially_paid') and due_at is not null and due_at < now() returning id`)
				return (r as unknown as unknown[]).length
			})
			return { credited, confirmed, overdue }
		}),
})
