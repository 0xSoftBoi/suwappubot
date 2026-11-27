/**
 * BankRemittanceService (M4) — send to a user / address / claim link / local payout.
 *
 * MONEY-PATH. Rules:
 * - Funds are always moved through BankTransferService (never signed here).
 * - Claim links reserve funds in a sender-owned `escrow` account (ledger-only move: same custody wallet).
 *   Token = 24 random bytes (base64url); only its SHA-256 is stored. Single-use is enforced by an atomic
 *   status compare-and-swap (awaiting_claim -> pending) so concurrent claims cannot both win.
 * - Expiry / cancel refund escrow -> the sender's source account (CAS awaiting_claim -> pending first).
 * - Every remittance row is the recipient's financial-identity record read by M3 (credit score).
 * - Cash-out ("sandwich") = claim into the recipient's own account, then BankRampService.offramp from it.
 */
import { createHash, randomBytes } from 'node:crypto'
import { and, desc, eq, inArray, lt, or, sql } from 'drizzle-orm'
import { Context, Effect, Layer } from 'effect'
import { EnvService } from '../../config/EnvService'
import { type BankRemittance, bankRemittances, bankTransfers, bankRampTransfers, users } from '../../db'
import type { DrizzleService } from '../../db'
import { logger } from '../../lib/logger'
import { BankEarnService } from './BankEarnService'
import { BankLedgerService } from './BankLedgerService'
import { BankRampService, type QuoteInput } from './BankRampService'
import { type BankDeps, BankTransferService } from './BankTransferService'
import { findAsset } from './assets'
import { type BankOwner, bankDb, newId } from './db'
import { type BankError, bankErr } from './errors'
import { assertSpendable, systemDebit } from './systemDebit'
import { nextAttemptKey } from './paymentsCommon'
import { RAIL_INFO, type Rail } from './ramps/rails'

type Deps = BankDeps | BankTransferService | BankRampService | EnvService | BankEarnService
type Fx<A> = Effect.Effect<A, BankError, Deps>

export type Recipient =
	| { kind: 'user'; telegramId?: number | undefined; username?: string | undefined }
	| { kind: 'address'; address: string }
	| { kind: 'claim'; label?: string | undefined }
	| { kind: 'payout'; rail: Rail; externalAccountId: string }

export interface SendInput {
	idempotencyKey: string
	fromAccountId: string
	amountMinor: string
	recipient: Recipient
	memo?: string | undefined
	/** Recipient's new account gets autoEarn=true metadata (M2 sweeps read it). */
	autoEarn?: boolean | undefined
}

export interface ClaimInput {
	token: string
	/** Existing account of the claimer to credit; default: their checking account for the asset/chain (opened if absent). */
	accountId?: string | undefined
	choice: 'keep' | 'cashout'
	externalAccountId?: string | undefined
}

const sha = (s: string) => createHash('sha256').update(s).digest('hex')
const KEY_OK = /^[A-Za-z0-9_.:-]{8,128}$/
const POS_INT = /^[1-9][0-9]{0,77}$/

export interface BankRemittanceServiceInterface {
	readonly quote: (owner: BankOwner, i: { fromAccountId: string; amountMinor: string; rail?: Rail | undefined; currency?: string | undefined }) => Fx<Record<string, unknown>>
	readonly send: (owner: BankOwner, i: SendInput) => Fx<{ remittance: BankRemittance; claimToken?: string; claimLink?: string; claimPath?: string; quote?: unknown }>
	readonly claimPreview: (token: string) => Fx<Record<string, unknown>>
	readonly claim: (claimer: BankOwner, i: ClaimInput) => Fx<{ remittance: BankRemittance; cashout?: { rampTransferId?: string; error?: string } }>
	readonly cancel: (owner: BankOwner, id: string) => Fx<BankRemittance>
	readonly list: (owner: BankOwner, limit?: number) => Fx<{ sent: BankRemittance[]; received: BankRemittance[] }>
	readonly get: (owner: BankOwner, id: string) => Fx<BankRemittance>
	readonly identity: (owner: BankOwner) => Fx<Record<string, unknown>>
	readonly corridorStats: () => Fx<Array<Record<string, unknown>>>
	readonly runJob: () => Fx<{ refunded: number; refreshed: number; rampsSettled: number }>
}

export class BankRemittanceService extends Context.Tag('BankRemittanceService')<BankRemittanceService, BankRemittanceServiceInterface>() {}

const loadRem = (id: string) =>
	bankDb(async (db) => {
		const [r] = await db.select().from(bankRemittances).where(eq(bankRemittances.id, id)).limit(1)
		if (!r) throw bankErr('NOT_FOUND', 'Remittance not found')
		return r
	})

const setRem = (id: string, patch: Partial<typeof bankRemittances.$inferInsert>) =>
	bankDb(async (db) => {
		const [r] = await db.update(bankRemittances).set({ ...patch, updatedAt: new Date() }).where(eq(bankRemittances.id, id)).returning()
		return r as BankRemittance
	})

/** Atomic status compare-and-swap. Returns the row if this caller won. */
const cas = (where: ReturnType<typeof and>, to: BankRemittance['status']) =>
	bankDb(async (db) => {
		const [r] = await db.update(bankRemittances).set({ status: to, updatedAt: new Date() }).where(where).returning()
		return r ?? null
	})

const resolveUser = (rec: { telegramId?: number | undefined; username?: string | undefined }) =>
	bankDb(async (db) => {
		if (rec.telegramId == null && !rec.username) throw bankErr('VALIDATION', 'recipient needs telegramId or username')
		const cond = rec.telegramId != null ? eq(users.telegramId, rec.telegramId) : sql`lower(${users.username}) = ${rec.username!.replace(/^@/, '').toLowerCase()}`
		const rows = await db.select({ id: users.id }).from(users).where(cond).limit(2)
		if (rows.length === 0) throw bankErr('NOT_FOUND', 'Recipient is not a Suwappu user; send a claim link instead (recipient.kind="claim")')
		if (rows.length > 1) throw bankErr('CONFLICT', 'Ambiguous recipient; use telegramId')
		return rows[0]!.id
	})

/** Records the autoEarn choice through Earn's real settings call (honours interest-free mode and the default keep-floor). Never fails the remittance. */
const enrolAutoEarn = (accountId: string, owner: BankOwner, autoEarn: boolean): Fx<{ id: string }> =>
	autoEarn
		? Effect.flatMap(BankEarnService, (earn) => earn.setSettings({ owner, accountId, enabled: true })).pipe(
				Effect.catchAll((e) => {
					logger.warn({ accountId, err: e.message }, '[bank-remittance] autoEarn enrolment not applied')
					// transient failure: leave the choice for Earn's sweep job to enrol (it reads the flag); policy blocks are final
					return e.code === 'POLICY_BLOCKED'
						? Effect.void
						: bankDb((db) => db.execute(sql`update bank_accounts set metadata = metadata || '{"autoEarn": true}'::jsonb where id = ${accountId}`)).pipe(Effect.ignore)
				}),
				Effect.as({ id: accountId }),
			)
		: Effect.succeed({ id: accountId })

/** Recipient's checking account for asset/chain, opened if absent. */
const ensureAccount = (owner: BankOwner, asset: string, chain: string, autoEarn: boolean): Fx<{ id: string }> =>
	Effect.gen(function* () {
		const ledger = yield* BankLedgerService
		const existing = (yield* ledger.getAccounts(owner)).find((a) => a.kind === 'checking' && a.asset === asset && a.chain === chain && a.status === 'active' && !a.label)
		if (existing) return yield* enrolAutoEarn(existing.id, owner, autoEarn)
		// MONEY-PATH: openAccount requires a resolved custody wallet; a first-time recipient had none, so claim/send-to-user failed.
		const wallet = yield* ledger.resolveCustodyWallet(owner, chain === 'solana' ? 'solana' : 'evm')
		const opened = yield* ledger.openAccount({ owner, kind: 'checking', asset, chain, wallet })
		return yield* enrolAutoEarn(opened.id, owner, autoEarn)
	})

const claimBase = (env: EnvService['Type']) => (env.BANK_CLAIM_BASE_URL ? env.BANK_CLAIM_BASE_URL.replace(/\/$/, '') : null)
// BANK_CLAIM_BASE_URL may be a template containing `{token}` (e.g. a Telegram deep link
// `https://t.me/<bot>?start=claim_{token}`); otherwise the link is `<base>/claim/<token>`
// (set the base to `<webapp>/bank` so it lands on the Mini App route /bank/claim/:token).
const claimLinkFor = (base: string, token: string) => (base.includes('{token}') ? base.replace('{token}', encodeURIComponent(token)) : `${base}/claim/${token}`)

export const BankRemittanceServiceLive = Layer.sync(BankRemittanceService, () => impl)

const impl: BankRemittanceServiceInterface = {
	quote: (owner, i) =>
		Effect.gen(function* () {
			const ledger = yield* BankLedgerService
			const acct = yield* ledger.getAccount(owner, i.fromAccountId)
			{ const sysErr = assertSpendable(acct); if (sysErr) return yield* Effect.fail(sysErr) } // MONEY-PATH
			if (!POS_INT.test(i.amountMinor)) return yield* Effect.fail(bankErr('VALIDATION', 'amountMinor must be a positive integer string'))
			if (!i.rail) return { sendAmountMinor: i.amountMinor, receiveAmountMinor: i.amountMinor, feeMinor: '0', rate: '1', asset: acct.asset, currency: acct.currency, route: ['internal'], eta: 'immediate' }
			const ramp = yield* BankRampService
			const r = yield* ramp.quote({ direction: 'offramp', rail: i.rail, asset: acct.asset, amountMinor: i.amountMinor, currency: i.currency } satisfies QuoteInput)
			const info = RAIL_INFO[i.rail]
			return { ...r.best, allQuotes: r.quotes, failures: r.failures, eta: info.instant ? 'instant rail (minutes once the provider receives funds)' : 'non-instant rail (typically 1-3 business days)', note: r.best.indicative ? 'indicative: provider offers no locked quote' : 'locked until expiresAt' }
		}),

	// MONEY-PATH
	send: (owner, i) =>
		Effect.gen(function* () {
			if (!KEY_OK.test(i.idempotencyKey)) return yield* Effect.fail(bankErr('VALIDATION', 'idempotencyKey must be 8-128 chars of A-Za-z0-9_.:-'))
			if (!POS_INT.test(i.amountMinor)) return yield* Effect.fail(bankErr('VALIDATION', 'amountMinor must be a positive integer string'))
			const env = yield* EnvService
			const ledger = yield* BankLedgerService
			const transfers = yield* BankTransferService
			const from = yield* ledger.getAccount(owner, i.fromAccountId)
			{ const sysErr = assertSpendable(from); if (sysErr) return yield* Effect.fail(sysErr) } // MONEY-PATH
			const asset = findAsset(from.asset, from.chain)
			if (!asset) return yield* Effect.fail(bankErr('ASSET_UNSUPPORTED', `Unsupported asset ${from.asset} on ${from.chain}`))

			const prior = yield* bankDb(async (db) => {
				const [r] = await db.select().from(bankRemittances).where(and(eq(bankRemittances.senderType, owner.ownerType), eq(bankRemittances.senderId, owner.ownerId), eq(bankRemittances.idempotencyKey, i.idempotencyKey))).limit(1)
				return r
			})
			if (prior) {
				if (prior.amountMinor !== i.amountMinor || prior.fromAccountId !== i.fromAccountId) return yield* Effect.fail(bankErr('CONFLICT', 'idempotencyKey reused with different terms'))
				return { remittance: prior } // claim token is shown once, at creation
			}

			const id = newId('xfer').replace('xfer_', 'rem_')
			const rec = i.recipient
			const token = rec.kind === 'claim' ? randomBytes(24).toString('base64url') : null
			const expires = token ? new Date(Date.now() + env.BANK_REMIT_CLAIM_TTL_HOURS * 3_600_000) : null
			const base = { id, senderType: owner.ownerType, senderId: owner.ownerId, mode: rec.kind === 'user' ? ('internal' as const) : rec.kind === 'address' ? ('address' as const) : rec.kind === 'claim' ? ('claim' as const) : ('payout' as const), corridor: `${from.currency}->${from.currency}`, sendAsset: from.asset, sendChain: from.chain, sendCurrency: from.currency, amountMinor: i.amountMinor, fromAccountId: from.id, idempotencyKey: i.idempotencyKey, memo: i.memo ?? null, autoEarn: i.autoEarn ? 'true' : 'false', claimTokenHash: token ? sha(token) : null, claimExpiresAt: expires }

			const insert = (extra: Partial<typeof bankRemittances.$inferInsert>) =>
				bankDb(async (db) => {
					const [r] = await db.insert(bankRemittances).values({ ...base, ...extra } as never).onConflictDoNothing().returning()
					if (!r) throw bankErr('CONFLICT', 'Concurrent remittance with the same idempotencyKey')
					return r
				})
			const fail = (reason: string) => (e: BankError) => setRem(id, { status: 'failed', metadata: { failure: reason, error: e.message } }).pipe(Effect.zipRight(Effect.fail(e)))

			if (rec.kind === 'user') {
				const rid = yield* resolveUser(rec)
				const ro: BankOwner = { ownerType: 'user', ownerId: String(rid) }
				if (ro.ownerType === owner.ownerType && ro.ownerId === owner.ownerId) return yield* Effect.fail(bankErr('VALIDATION', 'Cannot send to yourself'))
				yield* insert({ recipientType: 'user', recipientId: ro.ownerId, recipientRef: rec.username ?? String(rec.telegramId) })
				const to = yield* ensureAccount(ro, from.asset, from.chain, !!i.autoEarn).pipe(Effect.tapError(fail('recipient account')))
				const bt = yield* transfers.transfer({ owner, idempotencyKey: `remit:${id}:send`, type: 'remittance', fromAccountId: from.id, toAccountId: to.id, amountMinor: i.amountMinor, ...(i.memo ? { memo: i.memo } : {}), metadata: { remittanceId: id } }).pipe(Effect.tapError(fail('transfer')))
				const r = yield* setRem(id, { toAccountId: to.id, bankTransferId: bt.id, status: bt.status === 'confirmed' ? 'completed' : bt.status === 'failed' ? 'failed' : 'pending', completedAt: bt.status === 'confirmed' ? new Date() : null })
				return { remittance: r }
			}

			if (rec.kind === 'address') {
				yield* insert({ recipientRef: rec.address })
				const bt = yield* transfers.transfer({ owner, idempotencyKey: `remit:${id}:send`, type: 'remittance', fromAccountId: from.id, toExternal: { address: rec.address }, amountMinor: i.amountMinor, ...(i.memo ? { memo: i.memo } : {}), metadata: { remittanceId: id } }).pipe(Effect.tapError(fail('transfer')))
				const r = yield* setRem(id, { bankTransferId: bt.id, status: bt.status === 'confirmed' ? 'completed' : bt.status === 'failed' ? 'failed' : 'pending', completedAt: bt.status === 'confirmed' ? new Date() : null })
				return { remittance: r }
			}

			if (rec.kind === 'claim') {
				yield* insert({ recipientRef: rec.label ?? null })
				// MONEY-PATH: the claim escrow needs a custody wallet like every other account (same as BankEscrowService): reuse the sender's.
				if (from.walletId == null || from.walletUserId == null || !from.address) return yield* Effect.fail(bankErr('WALLET_UNAVAILABLE', 'Source account has no custody wallet'))
				const escrow = yield* ledger.openAccount({ owner, kind: 'escrow', asset: from.asset, chain: from.chain, label: `remit:${id}`.slice(0, 80), metadata: { remittanceId: id }, wallet: { walletId: from.walletId, walletUserId: from.walletUserId, address: from.address } }).pipe(Effect.tapError(fail('escrow account')))
				const bt = yield* transfers.transfer({ owner, idempotencyKey: `remit:${id}:fund`, type: 'remittance', fromAccountId: from.id, toAccountId: escrow.id, amountMinor: i.amountMinor, metadata: { remittanceId: id, escrow: true } }).pipe(Effect.tapError(fail('escrow funding')))
				if (bt.status === 'failed') return yield* Effect.fail(bankErr('UPSTREAM', 'Escrow funding failed')).pipe(Effect.tapError(fail('escrow funding')))
				const r = yield* setRem(id, { escrowAccountId: escrow.id, bankTransferId: bt.id, status: 'awaiting_claim' })
				const base0 = claimBase(env)
				return { remittance: r, claimToken: token as string, claimPath: `/claim/${token}`, ...(base0 ? { claimLink: claimLinkFor(base0, token as string) } : {}) }
			}

			// payout: sender cashes out to an external account they own, with the upfront all-in quote.
			const ramp = yield* BankRampService
			const info = RAIL_INFO[rec.rail]
			yield* insert({ recipientRef: rec.externalAccountId, receiveCurrency: info.currency, corridor: `${from.currency}->${info.currency}`, status: 'payout_processing' })
			const res = yield* ramp.offramp({ owner, fromAccountId: from.id, externalAccountId: rec.externalAccountId, amountMinor: i.amountMinor, idempotencyKey: `remit-${id}` }).pipe(Effect.tapError(fail('offramp')))
			const r = yield* setRem(id, { rampTransferId: res.rampTransfer.id, bankTransferId: res.rampTransfer.bankTransferId, receiveMinor: res.quote?.receiveAmountMinor ?? res.rampTransfer.receiveMinor, feeMinor: res.quote?.feeMinor ?? null })
			return { remittance: r, quote: res.quote }
		}),

	claimPreview: (token) =>
		Effect.gen(function* () {
			const r = yield* bankDb(async (db) => {
				const [x] = await db.select().from(bankRemittances).where(eq(bankRemittances.claimTokenHash, sha(token))).limit(1)
				if (!x) throw bankErr('NOT_FOUND', 'Claim link not found')
				return x
			})
			const expired = !!r.claimExpiresAt && r.claimExpiresAt.getTime() < Date.now()
			return { status: expired && r.status === 'awaiting_claim' ? 'expired' : r.status, amountMinor: r.amountMinor, asset: r.sendAsset, chain: r.sendChain, currency: r.sendCurrency, memo: r.memo, expiresAt: r.claimExpiresAt, autoEarn: r.autoEarn === 'true' }
		}),

	// MONEY-PATH
	claim: (claimer, i) =>
		Effect.gen(function* () {
			const ledger = yield* BankLedgerService
			const transfers = yield* BankTransferService
			const th = sha(i.token)
			const found = yield* bankDb(async (db) => {
				const [x] = await db.select().from(bankRemittances).where(eq(bankRemittances.claimTokenHash, th)).limit(1)
				return x
			})
			if (!found) return yield* Effect.fail(bankErr('NOT_FOUND', 'Claim link not found'))
			if (found.senderType === claimer.ownerType && found.senderId === claimer.ownerId) return yield* Effect.fail(bankErr('VALIDATION', 'Sender cannot claim their own remittance (use cancel)'))
			if (i.choice === 'cashout' && !i.externalAccountId) return yield* Effect.fail(bankErr('VALIDATION', 'cashout requires externalAccountId'))
			// Single-use: only one caller wins this swap. Expired links never match.
			const won = yield* cas(and(eq(bankRemittances.claimTokenHash, th), eq(bankRemittances.status, 'awaiting_claim'), sql`${bankRemittances.claimExpiresAt} > now()`), 'pending')
			if (!won) return yield* Effect.fail(bankErr('CONFLICT', 'Claim link already used, expired or not yet funded'))
			const sender: BankOwner = { ownerType: won.senderType as BankOwner['ownerType'], ownerId: won.senderId }
			const revert = (e: BankError) => setRem(won.id, { status: 'awaiting_claim' }).pipe(Effect.zipRight(Effect.fail(e)))
			const to = yield* (i.accountId
				? ledger.getAccount(claimer, i.accountId).pipe(
						Effect.flatMap((a) => (a.asset === won.sendAsset && a.chain === won.sendChain ? Effect.succeed({ id: a.id }) : Effect.fail(bankErr('VALIDATION', `Account must be ${won.sendAsset} on ${won.sendChain}`)))),
					)
				: ensureAccount(claimer, won.sendAsset, won.sendChain, won.autoEarn === 'true')
			).pipe(Effect.catchAll(revert))
			if (won.autoEarn === 'true' && i.accountId) yield* enrolAutoEarn(to.id, claimer, true)
			const bt = yield* transfers
				.transfer({ owner: sender, idempotencyKey: yield* nextAttemptKey(sender, `remit:${won.id}:claim`).pipe(Effect.catchAll(revert)) /* MONEY-PATH: rotates only after the previous attempt is terminal-failed */, type: 'remittance', fromAccountId: won.escrowAccountId as string, systemDebit: systemDebit('remittance-escrow', won.escrowAccountId as string), toAccountId: to.id, amountMinor: won.amountMinor, metadata: { remittanceId: won.id, claim: true } })
				.pipe(Effect.catchAll(revert))
			if (bt.status === 'failed' || bt.status === 'reversed') return yield* revert(bankErr('UPSTREAM', 'Claim transfer failed; link is still valid'))
			let rem = yield* setRem(won.id, { status: 'completed', recipientType: claimer.ownerType, recipientId: claimer.ownerId, toAccountId: to.id, bankTransferId: bt.id, completedAt: new Date() })
			if (i.choice === 'keep') return { remittance: rem }
			// Cash-out: recipient is now the owner of the funds; offramp from their account.
			const ramp = yield* BankRampService
			const out = yield* Effect.either(ramp.offramp({ owner: claimer, fromAccountId: to.id, externalAccountId: i.externalAccountId as string, amountMinor: won.amountMinor, idempotencyKey: `remit-${won.id}-cashout` }))
			if (out._tag === 'Left') {
				rem = yield* setRem(won.id, { metadata: { cashoutError: out.left.message } })
				return { remittance: rem, cashout: { error: out.left.message } }
			}
			rem = yield* setRem(won.id, { status: 'payout_processing', rampTransferId: out.right.rampTransfer.id, receiveMinor: out.right.quote?.receiveAmountMinor ?? null, feeMinor: out.right.quote?.feeMinor ?? null, receiveCurrency: out.right.rampTransfer.destCurrency, corridor: `${won.sendCurrency}->${out.right.rampTransfer.destCurrency}` })
			return { remittance: rem, cashout: { rampTransferId: out.right.rampTransfer.id } }
		}),

	// MONEY-PATH
	cancel: (owner, id) =>
		Effect.gen(function* () {
			const r = yield* loadRem(id)
			if (r.senderType !== owner.ownerType || r.senderId !== owner.ownerId) return yield* Effect.fail(bankErr('NOT_FOUND', 'Remittance not found'))
			return yield* refundEscrow(id, 'cancelled by sender', false)
		}),

	list: (owner, limit = 50) =>
		bankDb(async (db) => {
			const n = Math.min(limit, 200)
			const sent = await db.select().from(bankRemittances).where(and(eq(bankRemittances.senderType, owner.ownerType), eq(bankRemittances.senderId, owner.ownerId))).orderBy(desc(bankRemittances.createdAt)).limit(n)
			const received = await db.select().from(bankRemittances).where(and(eq(bankRemittances.recipientType, owner.ownerType), eq(bankRemittances.recipientId, owner.ownerId))).orderBy(desc(bankRemittances.createdAt)).limit(n)
			return { sent: sent.map(maskClaim), received: received.map(maskClaim) }
		}),

	get: (owner, id) =>
		Effect.gen(function* () {
			const r = yield* loadRem(id)
			const mine = (r.senderType === owner.ownerType && r.senderId === owner.ownerId) || (r.recipientType === owner.ownerType && r.recipientId === owner.ownerId)
			if (!mine) return yield* Effect.fail(bankErr('NOT_FOUND', 'Remittance not found'))
			return maskClaim(r)
		}),

	identity: (owner) =>
		bankDb(async (db) => {
			const rows = await db.execute(sql`
				select send_currency as currency, count(*)::int as count, coalesce(sum(amount_minor),0)::text as total_minor,
				       count(distinct sender_type || ':' || sender_id)::int as distinct_senders,
				       min(created_at) as first_at, max(created_at) as last_at,
				       count(distinct to_char(created_at,'YYYY-MM'))::int as active_months
				from bank_remittances
				where recipient_type = ${owner.ownerType} and recipient_id = ${owner.ownerId} and status in ('completed','payout_processing')
				group by send_currency`)
			return { ownerType: owner.ownerType, ownerId: owner.ownerId, received: (rows as unknown as { rows?: unknown[] }).rows ?? rows }
		}),

	corridorStats: () =>
		bankDb(async (db) => {
			const rows = await db.execute(sql`
				select corridor, count(*)::int as count, sum(amount_minor)::text as volume_minor, send_currency,
				       avg(fee_minor / nullif(amount_minor,0)) filter (where fee_minor is not null) * 10000 as avg_fee_bps,
				       count(*) filter (where fee_minor is not null)::int as fee_samples,
				       avg(extract(epoch from (completed_at - created_at))) filter (where completed_at is not null) as avg_seconds_to_complete
				from bank_remittances where status = 'completed'
				group by corridor, send_currency order by sum(amount_minor) desc`)
			return ((rows as unknown as { rows?: Array<Record<string, unknown>> }).rows ?? (rows as unknown as Array<Record<string, unknown>>))
		}),

	runJob: () =>
		Effect.gen(function* () {
			const ramp = yield* BankRampService
			const expired = yield* bankDb((db) => db.select({ id: bankRemittances.id }).from(bankRemittances).where(and(eq(bankRemittances.status, 'awaiting_claim'), lt(bankRemittances.claimExpiresAt, new Date()))).limit(50))
			let refunded = 0
			for (const e of expired) {
				const r = yield* refundEscrow(e.id, 'claim link expired', true).pipe(Effect.either)
				if (r._tag === 'Right') refunded++
				else logger.warn({ id: e.id, err: r.left.message }, 'bank remit: expiry refund failed')
			}
			// Settle in-flight remittances against the underlying transfer / ramp transfer.
			const open = yield* bankDb((db) => db.select().from(bankRemittances).where(and(inArray(bankRemittances.status, ['pending', 'payout_processing']), or(sql`${bankRemittances.bankTransferId} is not null`, sql`${bankRemittances.rampTransferId} is not null`))).limit(100))
			let refreshed = 0
			for (const r of open) {
				if (r.claimTokenHash && r.status === 'pending' && !r.toAccountId) continue // claim in progress
				const next = yield* bankDb(async (db): Promise<BankRemittance['status'] | null> => {
					if (r.rampTransferId) {
						const [rt] = await db.select().from(bankRampTransfers).where(eq(bankRampTransfers.id, r.rampTransferId)).limit(1)
						if (rt?.status === 'completed') return 'completed'
						if (rt && ['failed', 'returned', 'refunded'].includes(rt.status)) return 'failed'
						return null
					}
					if (r.bankTransferId) {
						const [bt] = await db.select({ status: bankTransfers.status }).from(bankTransfers).where(eq(bankTransfers.id, r.bankTransferId)).limit(1)
						if (bt?.status === 'confirmed') return 'completed'
						if (bt?.status === 'failed' || bt?.status === 'reversed') return 'failed'
					}
					return null
				})
				if (next) {
					yield* setRem(r.id, { status: next, ...(next === 'completed' ? { completedAt: new Date() } : {}) })
					refreshed++
				}
			}
			const settled = yield* ramp.settleRampTransfers()
			return { refunded, refreshed, rampsSettled: settled.credited }
		}),
}

const maskClaim = (r: BankRemittance): BankRemittance => ({ ...r, claimTokenHash: null })

/** MONEY-PATH: escrow -> sender source account. CAS guards double refund / racing claim. */
const refundEscrow = (id: string, reason: string, requireExpired: boolean): Fx<BankRemittance> =>
	Effect.gen(function* () {
		const transfers = yield* BankTransferService
		const where = requireExpired
			? and(eq(bankRemittances.id, id), eq(bankRemittances.status, 'awaiting_claim'), lt(bankRemittances.claimExpiresAt, new Date()))
			: and(eq(bankRemittances.id, id), eq(bankRemittances.status, 'awaiting_claim'))
		const won = yield* cas(where, 'pending')
		if (!won) return yield* Effect.fail(bankErr('CONFLICT', 'Remittance is not refundable (already claimed, refunded or not an open claim)'))
		const sender: BankOwner = { ownerType: won.senderType as BankOwner['ownerType'], ownerId: won.senderId }
		const bt = yield* transfers
			.transfer({ owner: sender, idempotencyKey: yield* nextAttemptKey(sender, `remit:${won.id}:refund`).pipe(Effect.tapError(() => setRem(won.id, { status: 'awaiting_claim' }).pipe(Effect.ignore))), type: 'remittance', fromAccountId: won.escrowAccountId as string, systemDebit: systemDebit('remittance-escrow', won.escrowAccountId as string), toAccountId: won.fromAccountId, amountMinor: won.amountMinor, metadata: { remittanceId: won.id, refund: reason } })
			.pipe(Effect.tapError(() => setRem(won.id, { status: 'awaiting_claim' }).pipe(Effect.ignore)))
		if (bt.status === 'failed' || bt.status === 'reversed') {
			yield* setRem(won.id, { status: 'awaiting_claim' })
			return yield* Effect.fail(bankErr('UPSTREAM', 'Refund transfer failed; will retry'))
		}
		return yield* setRem(won.id, { status: 'refunded', bankTransferId: bt.id, completedAt: new Date(), metadata: { refundReason: reason } })
	})

// ---------------------------------------------------------------- recurring job (expiry refunds, settlement)
/** One tick; scheduled by the bank job registry (services/bank/jobs.ts). Interval: BANK_REMIT_JOB_SECONDS. */
export async function runRemittanceJobOnce(): Promise<void> {
	const { runEffect } = await import('../../runtime')
	const r = await runEffect(Effect.flatMap(BankRemittanceService, (s) => s.runJob()) as never)
	const x = r as { refunded: number; refreshed: number; rampsSettled: number }
	if (x.refunded || x.refreshed || x.rampsSettled) logger.info(x, 'bank: remittance job')
}
