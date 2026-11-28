/**
 * BankPayoutPoolService (M8) — MONEY-PATH. Instant payout pool.
 *
 * A pool-kind bank account (owned by the pool operator) pays the recipient immediately. The payer's obligation is a
 * row in bank_pool_receivables; when the payer's own funds arrive (their account balance covers it) the job transfers
 * payer -> pool and marks it settled. Hard guarantees:
 *   - never pays beyond the pool's REAL ledger balance (POOL_UNFUNDED); the ledger itself also refuses to overdraw;
 *   - per-payer exposure cap (EXPOSURE_LIMIT): open + settling receivables + new amount <= limit (default 0 = no credit);
 *   - exposure check + receivable insert run under an advisory lock; payout/settle transfer keys derive from the
 *     receivable id, so retries never pay or collect twice.
 */
import { and, eq, inArray, sql } from 'drizzle-orm'
import { Context, Effect, Layer } from 'effect'
import { type BankPayoutPool, type BankPoolReceivable, bankPayoutPools, bankPoolReceivables, bankTransfers } from '../../db'
import { logger } from '../../lib/logger'
import { BankLedgerService } from './BankLedgerService'
import { BankTransferService } from './BankTransferService'
import { type BankOwner, bankDb } from './db'
import { type BankError, bankErr } from './errors'
import { systemDebit } from './systemDebit'
import { guard, idemKey, nextAttemptKey, ownerKey, type PayFx, parseMinor, sameOwner, subErr, toOwner, uid } from './paymentsCommon'

export interface PoolView {
	pool: BankPayoutPool
	balanceMinor: string
	exposureMinor: string
	receivables: { open: number; settling: number }
}

export interface AdvancePayoutInput {
	poolId: string
	payer: BankOwner
	payerAccountId: string
	/** Exactly one destination. */
	toAccountId?: string | undefined
	toExternal?: { address: string } | undefined
	amountMinor: string
	/** Stable per-payout id (e.g. payroll item id) — the idempotency anchor. */
	itemKey: string
	memo?: string | undefined
}

export interface BankPayoutPoolServiceInterface {
	readonly createPool: (
		operator: BankOwner,
		input: { accountId?: string | undefined; asset?: string | undefined; chain?: string | undefined; defaultPayerLimitMinor?: string | undefined; payerLimits?: Record<string, string> | undefined },
	) => PayFx<PoolView>
	readonly setPayerLimit: (operator: BankOwner, poolId: string, payer: BankOwner, limitMinor: string) => PayFx<PoolView>
	readonly getPool: (operator: BankOwner, poolId: string) => PayFx<PoolView>
	readonly listPools: (operator: BankOwner) => PayFx<PoolView[]>
	readonly listReceivables: (owner: BankOwner, opts?: { poolId?: string; role?: 'payer' | 'operator' }) => PayFx<BankPoolReceivable[]>
	/** Pay out of the pool now; records the payer's receivable. Returns the receivable + payout transfer id. */
	readonly advancePayout: (input: AdvancePayoutInput) => PayFx<{ receivable: BankPoolReceivable; transferId: string; status: string }>
	/** Job: collect receivables whose payer now has funds. */
	readonly runJob: () => PayFx<{ settled: number; pending: number }>
}

export class BankPayoutPoolService extends Context.Tag('BankPayoutPoolService')<BankPayoutPoolService, BankPayoutPoolServiceInterface>() {}

const loadPool = (poolId: string) =>
	bankDb(async (db) => {
		const [p] = await db.select().from(bankPayoutPools).where(eq(bankPayoutPools.id, poolId)).limit(1)
		if (!p) throw bankErr('NOT_FOUND', 'Pool not found')
		return p
	})

const requireOperator = (pool: BankPayoutPool, o: BankOwner) =>
	sameOwner(o, toOwner(pool.operatorOwnerType, pool.operatorOwnerId)) ? Effect.succeed(pool) : Effect.fail(bankErr('NOT_FOUND', 'Pool not found'))

const limitFor = (pool: BankPayoutPool, payer: BankOwner): bigint => BigInt(pool.payerLimits[ownerKey(payer)] ?? pool.defaultPayerLimitMinor)

const exposureOf = (tx: { execute: (q: ReturnType<typeof sql>) => Promise<unknown> }, poolId: string, payer?: BankOwner) =>
	tx
		.execute(
			payer
				? sql`select coalesce(sum(amount_minor - settled_minor),0)::text as s from bank_pool_receivables where pool_id = ${poolId} and payer_owner_type = ${payer.ownerType} and payer_owner_id = ${payer.ownerId} and status in ('open','settling')`
				: sql`select coalesce(sum(amount_minor - settled_minor),0)::text as s from bank_pool_receivables where pool_id = ${poolId} and status in ('open','settling')`,
		)
		.then((r) => BigInt((r as Array<{ s: string }>)[0]?.s ?? '0'))

const poolView = (pool: BankPayoutPool): PayFx<PoolView> =>
	Effect.gen(function* () {
		const ledger = yield* BankLedgerService
		const balance = yield* ledger.balance(pool.poolAccountId)
		const { exposure, open, settling } = yield* bankDb(async (db) => {
			const r = await db.execute(sql`select status, count(*)::int as n from bank_pool_receivables where pool_id = ${pool.id} and status in ('open','settling') group by status`)
			const rows = r as unknown as Array<{ status: string; n: number }>
			return { exposure: await exposureOf(db, pool.id), open: rows.find((x) => x.status === 'open')?.n ?? 0, settling: rows.find((x) => x.status === 'settling')?.n ?? 0 }
		})
		return { pool, balanceMinor: balance.toString(), exposureMinor: exposure.toString(), receivables: { open, settling } }
	})

const validLimit = (s: string) =>
	guard(() => {
		if (!/^(0|[1-9][0-9]{0,77})$/.test(s)) throw bankErr('VALIDATION', 'limit must be a non-negative integer string (minor units)')
		return s
	})

export const BankPayoutPoolServiceLive = Layer.succeed(BankPayoutPoolService, {
	createPool: (operator, input) =>
		Effect.gen(function* () {
			const ledger = yield* BankLedgerService
			let acct
			if (input.accountId) {
				acct = yield* ledger.getAccount(operator, input.accountId)
				if (acct.kind !== 'pool') return yield* Effect.fail(bankErr('VALIDATION', 'accountId must be a pool-kind account'))
			} else {
				if (!input.asset || !input.chain) return yield* Effect.fail(bankErr('VALIDATION', 'Provide accountId, or asset + chain to open a pool account'))
				// MONEY-PATH: openAccount requires a resolved custody wallet; without it every pool creation by asset+chain failed (WALLET_UNAVAILABLE).
				const wallet = yield* ledger.resolveCustodyWallet(operator, input.chain === 'solana' ? 'solana' : 'evm')
				acct = yield* ledger.openAccount({ owner: operator, kind: 'pool', asset: input.asset, chain: input.chain, label: 'payout-pool', wallet })
			}
			const dflt = yield* validLimit(input.defaultPayerLimitMinor ?? '0')
			for (const v of Object.values(input.payerLimits ?? {})) yield* validLimit(v)
			const pool = yield* bankDb(async (db) => {
				const [ex] = await db.select().from(bankPayoutPools).where(eq(bankPayoutPools.poolAccountId, acct.id)).limit(1)
				if (ex) return ex
				const [row] = await db.insert(bankPayoutPools).values({ id: uid('pool'), operatorOwnerType: operator.ownerType, operatorOwnerId: operator.ownerId, poolAccountId: acct.id, asset: acct.asset, chain: acct.chain, defaultPayerLimitMinor: dflt, payerLimits: input.payerLimits ?? {} }).returning()
				return row!
			})
			return yield* poolView(pool)
		}),

	setPayerLimit: (operator, poolId, payer, limitMinor) =>
		Effect.gen(function* () {
			const pool = yield* loadPool(poolId).pipe(Effect.flatMap((p) => requireOperator(p, operator)))
			const lim = yield* validLimit(limitMinor)
			const [row] = yield* bankDb((db) =>
				db.update(bankPayoutPools).set({ payerLimits: sql`${bankPayoutPools.payerLimits} || ${JSON.stringify({ [ownerKey(payer)]: lim })}::jsonb` }).where(eq(bankPayoutPools.id, pool.id)).returning(),
			)
			return yield* poolView(row!)
		}),

	getPool: (operator, poolId) => loadPool(poolId).pipe(Effect.flatMap((p) => requireOperator(p, operator)), Effect.flatMap(poolView)),

	listPools: (operator) =>
		Effect.gen(function* () {
			const pools = yield* bankDb((db) => db.select().from(bankPayoutPools).where(and(eq(bankPayoutPools.operatorOwnerType, operator.ownerType), eq(bankPayoutPools.operatorOwnerId, operator.ownerId))))
			const out: PoolView[] = []
			for (const p of pools) out.push(yield* poolView(p))
			return out
		}),

	listReceivables: (owner, opts) =>
		Effect.gen(function* () {
			const role = opts?.role ?? 'payer'
			if (role === 'operator') {
				const pools = yield* bankDb((db) => db.select({ id: bankPayoutPools.id }).from(bankPayoutPools).where(and(eq(bankPayoutPools.operatorOwnerType, owner.ownerType), eq(bankPayoutPools.operatorOwnerId, owner.ownerId))))
				if (pools.length === 0) return []
				return yield* bankDb((db) => db.select().from(bankPoolReceivables).where(inArray(bankPoolReceivables.poolId, pools.map((p) => p.id))).limit(200))
			}
			return yield* bankDb((db) =>
				db.select().from(bankPoolReceivables).where(and(eq(bankPoolReceivables.payerOwnerType, owner.ownerType), eq(bankPoolReceivables.payerOwnerId, owner.ownerId), ...(opts?.poolId ? [eq(bankPoolReceivables.poolId, opts.poolId)] : []))).limit(200),
			)
		}),

	// MONEY-PATH
	advancePayout: (input) =>
		Effect.gen(function* () {
			const ledger = yield* BankLedgerService
			const xfer = yield* BankTransferService
			if ((input.toAccountId ? 1 : 0) + (input.toExternal ? 1 : 0) !== 1) return yield* Effect.fail(bankErr('VALIDATION', 'Provide exactly one of toAccountId or toExternal'))
			const amount = yield* guard(() => parseMinor(input.amountMinor))
			const pool = yield* loadPool(input.poolId)
			if (pool.status !== 'active') return yield* Effect.fail(bankErr('ACCOUNT_STATE', `Pool is ${pool.status}`))
			const payerAcct = yield* ledger.getAccount(input.payer, input.payerAccountId)
			if (payerAcct.asset !== pool.asset || payerAcct.chain !== pool.chain) return yield* Effect.fail(bankErr('VALIDATION', `Pool pays ${pool.asset} on ${pool.chain}; the payer account differs`))
			const destFp = input.toAccountId ? `a:${input.toAccountId}` : `x:${(input.toExternal?.address ?? '').toLowerCase()}`

			// Receivable first (idempotent per itemKey), under a lock so concurrent payouts cannot jointly exceed the cap.
			const rec = yield* bankDb((db) =>
				db.transaction(async (tx) => {
					await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`pool:${pool.id}`}))`)
					const [ex] = await tx.select().from(bankPoolReceivables).where(eq(bankPoolReceivables.payrollItemId, input.itemKey)).limit(1)
					if (ex) {
						// MONEY-PATH: same key must mean same terms (pool/asset, amount, payer account, destination).
						if (ex.poolId !== pool.id || BigInt(ex.amountMinor) !== amount || ex.payerAccountId !== payerAcct.id || (ex.destFp != null && ex.destFp !== destFp)) throw bankErr('CONFLICT', 'itemKey was already used with different payout terms')
						if (ex.status !== 'void') return ex
						// A voided receivable is never paid while void: either the earlier payout really went out (repair status), or re-run the exposure check and reopen atomically.
						if (ex.payoutTransferId) {
							const [pt] = await tx.select({ status: bankTransfers.status }).from(bankTransfers).where(eq(bankTransfers.id, ex.payoutTransferId)).limit(1)
							if (pt && pt.status !== 'failed' && pt.status !== 'reversed') {
								const [fixed] = await tx.update(bankPoolReceivables).set({ status: 'open' }).where(and(eq(bankPoolReceivables.id, ex.id), eq(bankPoolReceivables.status, 'void'))).returning()
								return fixed ?? ex
							}
						}
						const lim = limitFor(pool, input.payer)
						const exposure = await exposureOf(tx, pool.id, input.payer)
						if (exposure + amount > lim) throw subErr('EXPOSURE_LIMIT', 'LIMIT_EXCEEDED', `Payer exposure ${exposure} + ${amount} exceeds the pool limit of ${lim}`)
						const [reopened] = await tx.update(bankPoolReceivables).set({ status: 'open', payoutTransferId: null, destFp }).where(and(eq(bankPoolReceivables.id, ex.id), eq(bankPoolReceivables.status, 'void'))).returning()
						return reopened ?? ex
					}
					const limit = limitFor(pool, input.payer)
					const cur = await exposureOf(tx, pool.id, input.payer)
					if (cur + amount > limit) throw subErr('EXPOSURE_LIMIT', 'LIMIT_EXCEEDED', `Payer exposure ${cur} + ${amount} exceeds the pool limit of ${limit}`)
					const [row] = await tx
						.insert(bankPoolReceivables)
						.values({ id: uid('prc'), poolId: pool.id, payerOwnerType: input.payer.ownerType, payerOwnerId: input.payer.ownerId, payerAccountId: payerAcct.id, amountMinor: amount.toString(), payrollItemId: input.itemKey, destFp })
						.returning()
					return row!
				}),
			)
			if (rec.status === 'void') return yield* Effect.fail(bankErr('CONFLICT', 'Payout receivable is void and could not be reopened'))
			const payKey = yield* nextAttemptKey(toOwner(pool.operatorOwnerType, pool.operatorOwnerId), idemKey('poolpay', rec.id))
			if (rec.payoutTransferId) {
				return { receivable: rec, transferId: rec.payoutTransferId, status: 'replayed' }
			}

			const balance = yield* ledger.balance(pool.poolAccountId)
			if (balance < amount) {
				yield* bankDb((db) => db.update(bankPoolReceivables).set({ status: 'void' }).where(and(eq(bankPoolReceivables.id, rec.id), eq(bankPoolReceivables.status, 'open'), sql`${bankPoolReceivables.payoutTransferId} is null`)))
				return yield* Effect.fail(subErr('POOL_UNFUNDED', 'INSUFFICIENT_FUNDS', `Pool balance ${balance} is below the payout of ${amount}`))
			}
			const t = yield* xfer
				.transfer({
					owner: toOwner(pool.operatorOwnerType, pool.operatorOwnerId),
					idempotencyKey: payKey,
					type: 'payout',
					fromAccountId: pool.poolAccountId,
					systemDebit: systemDebit('pool-payout', pool.poolAccountId), // MONEY-PATH: service-only capability to debit the pool account
					toAccountId: input.toAccountId,
					toExternal: input.toExternal,
					amountMinor: amount.toString(),
					memo: input.memo,
					metadata: { poolId: pool.id, receivableId: rec.id, payer: ownerKey(input.payer), module: 'pool' },
				})
				.pipe(
					Effect.tapError((e) =>
						e.code === 'INSUFFICIENT_FUNDS' || e.code === 'INSUFFICIENT_AVAILABLE' || e.code === 'VALIDATION' || e.code === 'ACCOUNT_STATE' || e.code === 'LIMIT_EXCEEDED' || e.code === 'POLICY_BLOCKED'
							? bankDb((db) => db.update(bankPoolReceivables).set({ status: 'void' }).where(and(eq(bankPoolReceivables.id, rec.id), sql`${bankPoolReceivables.payoutTransferId} is null`)))
							: Effect.void,
					),
					Effect.mapError((e) => (e.code === 'INSUFFICIENT_FUNDS' ? subErr('POOL_UNFUNDED', 'INSUFFICIENT_FUNDS', e.message) : e)),
				)
			if (t.status === 'failed' || t.status === 'reversed') {
				yield* bankDb((db) => db.update(bankPoolReceivables).set({ status: 'void', payoutTransferId: t.id }).where(eq(bankPoolReceivables.id, rec.id)))
				return yield* Effect.fail(bankErr('UPSTREAM', `Pool payout failed: ${t.failureReason ?? 'transfer failed'}`))
			}
			const [updated] = yield* bankDb((db) => db.update(bankPoolReceivables).set({ payoutTransferId: t.id, status: 'open' }).where(and(eq(bankPoolReceivables.id, rec.id), inArray(bankPoolReceivables.status, ['open', 'void']))).returning())
			return { receivable: updated ?? rec, transferId: t.id, status: t.status }
		}),

	// MONEY-PATH
	runJob: () =>
		Effect.gen(function* () {
			const ledger = yield* BankLedgerService
			const xfer = yield* BankTransferService
			let settled = 0
			let pending = 0
			const recs = yield* bankDb((db) =>
				db.select().from(bankPoolReceivables).where(and(inArray(bankPoolReceivables.status, ['open', 'settling']), sql`${bankPoolReceivables.payoutTransferId} is not null`)).orderBy(bankPoolReceivables.createdAt).limit(200),
			)
			const avail = new Map<string, bigint>()
			const poolCache = new Map<string, BankPayoutPool>()
			for (const r of recs) {
				const step = Effect.gen(function* () {
					let pool = poolCache.get(r.poolId)
					if (!pool) {
						pool = yield* loadPool(r.poolId)
						poolCache.set(r.poolId, pool)
					}
					const payer = toOwner(r.payerOwnerType, r.payerOwnerId)
					// The payout must have actually landed before we collect from the payer.
					const payout = yield* xfer.getTransfer(toOwner(pool.operatorOwnerType, pool.operatorOwnerId), r.payoutTransferId!)
					if (payout.status === 'failed' || payout.status === 'reversed') {
						yield* bankDb((db) => db.update(bankPoolReceivables).set({ status: 'void' }).where(and(eq(bankPoolReceivables.id, r.id), sql`${bankPoolReceivables.status} <> 'settled'`)))
						return
					}
					if (payout.status !== 'confirmed') {
						pending++
						return
					}
					const remaining = BigInt(r.amountMinor) - BigInt(r.settledMinor)
					if (r.status === 'open') {
						let have = avail.get(r.payerAccountId)
						if (have === undefined) have = yield* ledger.balance(r.payerAccountId)
						if (have < remaining) {
							avail.set(r.payerAccountId, have)
							pending++
							return
						}
						const claimed = yield* bankDb((db) => db.update(bankPoolReceivables).set({ status: 'settling' }).where(and(eq(bankPoolReceivables.id, r.id), eq(bankPoolReceivables.status, 'open'))).returning({ id: bankPoolReceivables.id }))
						if (claimed.length === 0) return
						avail.set(r.payerAccountId, have - remaining)
					}
					const settleKey = yield* nextAttemptKey(payer, idemKey('poolsettle', r.id))
					const t = yield* xfer
						.transfer({
							owner: payer,
							idempotencyKey: settleKey, // MONEY-PATH: rotates only after the previous collection transfer is terminal-failed/reversed
							type: 'payout',
							fromAccountId: r.payerAccountId,
							toAccountId: pool.poolAccountId,
							amountMinor: remaining.toString(),
							memo: 'Payout pool settlement',
							metadata: { poolId: pool.id, receivableId: r.id, module: 'pool' },
						})
						.pipe(
							Effect.tapError((e) =>
								['INSUFFICIENT_FUNDS', 'INSUFFICIENT_AVAILABLE', 'LIMIT_EXCEEDED', 'POLICY_BLOCKED', 'ACCOUNT_STATE'].includes(e.code)
									? bankDb((db) => db.update(bankPoolReceivables).set({ status: 'open' }).where(and(eq(bankPoolReceivables.id, r.id), eq(bankPoolReceivables.status, 'settling'), sql`${bankPoolReceivables.settleTransferId} is null`)))
									: Effect.void,
							),
						)
					if (t.status === 'confirmed') {
						yield* bankDb((db) => db.update(bankPoolReceivables).set({ status: 'settled', settledMinor: r.amountMinor, settleTransferId: t.id, settledAt: new Date() }).where(and(eq(bankPoolReceivables.id, r.id), eq(bankPoolReceivables.status, 'settling'))))
						settled++
					} else if (t.status === 'failed' || t.status === 'reversed') {
						// Collection transfer is dead; the payer's funds were released back. Retry with a fresh key is a manual/ops action.
						yield* bankDb((db) => db.update(bankPoolReceivables).set({ status: 'open', settleTransferId: null }).where(eq(bankPoolReceivables.id, r.id)))
						logger.warn({ receivableId: r.id, transferId: t.id }, 'bank: pool settlement transfer failed')
					} else {
						yield* bankDb((db) => db.update(bankPoolReceivables).set({ settleTransferId: t.id }).where(eq(bankPoolReceivables.id, r.id)))
						pending++
					}
				})
				yield* step.pipe(Effect.catchAll((e: BankError) => Effect.sync(() => logger.warn({ receivableId: r.id, err: e.message }, 'bank: pool receivable step failed'))))
			}
			return { settled, pending }
		}),
})
