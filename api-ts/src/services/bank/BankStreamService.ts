/**
 * BankStreamService (M7) — MONEY-PATH. Per-second streaming payments and metered (pay-per-use) payments.
 *
 * Accrual is exact bigint math (streamMath.ts). Settlement batches accrued-but-unsettled amounts above a dust
 * threshold. Double-pay protection: before any transfer the settlement amount is persisted as `pending_minor` with a
 * conditional UPDATE (single in-flight intent per stream); the transfer key is `stream:{id}:{settle_seq}`, so a retry
 * after a crash re-sends the SAME amount under the SAME key (BankTransferService replays instead of re-paying) and
 * `settled_minor`/`settle_seq` only advance after the transfer is `confirmed`.
 */
import { and, desc, eq, inArray, isNull, sql } from 'drizzle-orm'
import { Context, Effect, Layer } from 'effect'
import { type BankStream, bankStreams, bankStreamUsage, bankWageAdvances } from '../../db'
import { logger } from '../../lib/logger'
import { BankLedgerService } from './BankLedgerService'
import { registerHoldProvider, sumRow } from './holds'
import { BankTransferService } from './BankTransferService'
import { type BankOwner, bankDb } from './db'
import { type BankError, bankErr } from './errors'
import { assertSpendable } from './systemDebit'
import { guard, idemKey, type PayFx, parseMinor, sameOwner, subErr, toOwner, uid } from './paymentsCommon'
import { accruedMinor, foldCheckpoint, settleAmount, type StreamAccrualState } from './streamMath'

const NON_RETRYABLE = new Set(['INSUFFICIENT_FUNDS', 'INSUFFICIENT_AVAILABLE', 'LIMIT_EXCEEDED', 'POLICY_BLOCKED', 'ACCOUNT_STATE', 'VALIDATION', 'FORBIDDEN', 'ASSET_UNSUPPORTED', 'NOT_FOUND'])

export interface CreateStreamInput {
	idempotencyKey: string
	payerAccountId: string
	payeeAccountId: string
	kind: 'rate' | 'metered'
	/** rate: minor units accrued per `periodSeconds` (default period 1s). */
	rateMinor?: string | undefined
	periodSeconds?: number | undefined
	/** metered: price per unit in minor units. */
	unitPriceMinor?: string | undefined
	/** Authorised ceiling on total spend. */
	capMinor: string
	/** Do not settle batches smaller than this (pause/cancel/close always settle the remainder). Default 0. */
	dustMinor?: string | undefined
	/** Earned-wage access: share (basis points) of accrued-but-unpaid the payee may draw early. */
	ewaBps?: number | undefined
	metadata?: Record<string, unknown> | undefined
}

export interface StreamView {
	stream: BankStream
	accruedMinor: string
	unsettledMinor: string
	/** Earned-wage access available to the payee right now (0 if not enabled). */
	advanceAvailableMinor: string
	/** Settlement transfer created/replayed by this call (settle/cancel/pause); absent on plain reads. */
	transferId?: string | null
}

export interface BankStreamServiceInterface {
	readonly createStream: (payer: BankOwner, input: CreateStreamInput) => PayFx<StreamView>
	readonly getStream: (owner: BankOwner, id: string) => PayFx<StreamView>
	readonly listStreams: (owner: BankOwner, role?: 'payer' | 'payee') => PayFx<StreamView[]>
	readonly pause: (owner: BankOwner, id: string) => PayFx<StreamView>
	readonly resume: (owner: BankOwner, id: string) => PayFx<StreamView>
	readonly cancel: (owner: BankOwner, id: string) => PayFx<StreamView>
	/** Settle the batch now if it clears the dust threshold. */
	readonly settle: (owner: BankOwner, id: string) => PayFx<StreamView>
	/** Pay-per-use primitive: no invoice. `actor` must be the stream's payee. Idempotent per (stream, idempotencyKey). */
	readonly reportUsage: (streamId: string, units: string, opts: { actor: BankOwner; idempotencyKey: string }) => PayFx<StreamView>
	/** Earned-wage access: the payee draws `amountMinor` of accrued-unpaid early (idempotent per key). */
	readonly advanceWages: (worker: BankOwner, streamId: string, amountMinor: string, idempotencyKey: string) => PayFx<{ stream: StreamView; advanceId: string; transferId: string | null }>
	readonly runJob: () => PayFx<{ settled: number; closed: number }>
}

export class BankStreamService extends Context.Tag('BankStreamService')<BankStreamService, BankStreamServiceInterface>() {}

const stateOf = (s: BankStream): StreamAccrualState => ({
	kind: s.kind,
	rateMinor: s.rateMinor != null ? BigInt(s.rateMinor) : null,
	periodSeconds: s.periodSeconds,
	unitPriceMinor: s.unitPriceMinor != null ? BigInt(s.unitPriceMinor) : null,
	capMinor: BigInt(s.capMinor),
	activeSeconds: BigInt(s.activeSeconds),
	resumedAt: s.resumedAt,
	units: BigInt(s.units),
})

const ewaBpsOf = (s: BankStream): number => {
	const v = (s.metadata as { ewaBps?: unknown }).ewaBps
	return typeof v === 'number' && Number.isInteger(v) && v > 0 && v <= 10_000 ? v : 0
}

export const streamView = (s: BankStream, now = new Date()): StreamView => {
	const accrued = accruedMinor(stateOf(s), now)
	const unsettled = accrued - BigInt(s.settledMinor)
	const un = unsettled > 0n ? unsettled : 0n
	const inflight = s.pendingMinor != null ? BigInt(s.pendingMinor) : 0n
	const avail = ((un - inflight > 0n ? un - inflight : 0n) * BigInt(ewaBpsOf(s))) / 10_000n
	return { stream: s, accruedMinor: accrued.toString(), unsettledMinor: un.toString(), advanceAvailableMinor: s.status === 'cancelled' || s.status === 'capped' ? '0' : avail.toString() }
}

const loadStream = (id: string) =>
	bankDb(async (db) => {
		const [s] = await db.select().from(bankStreams).where(eq(bankStreams.id, id)).limit(1)
		if (!s) throw bankErr('NOT_FOUND', 'Stream not found')
		return s
	})

const authorise = (s: BankStream, o: BankOwner, who: 'payer' | 'either'): Effect.Effect<'payer' | 'payee', BankError> => {
	const isPayer = sameOwner(o, toOwner(s.payerOwnerType, s.payerOwnerId))
	const isPayee = sameOwner(o, toOwner(s.payeeOwnerType, s.payeeOwnerId))
	if (!isPayer && !isPayee) return Effect.fail(bankErr('NOT_FOUND', 'Stream not found'))
	if (who === 'payer' && !isPayer) return Effect.fail(bankErr('FORBIDDEN', 'Only the payer can do this'))
	return Effect.succeed(isPayer ? 'payer' : 'payee')
}

// MONEY-PATH: a claimed settlement intent (pending_minor) is reserved on the payer account until its transfer row exists
// (from then the ledger debit is the reserve, so it is not double counted).
registerHoldProvider('stream', async (accountId, tx, excludeId) =>
	sumRow(
		await tx.execute(
			sql`select coalesce(sum(pending_minor),0)::text as s from bank_streams where payer_account_id = ${accountId} and pending_minor is not null and ended_at is null and not exists (select 1 from bank_transfers t where t.metadata->>'streamId' = bank_streams.id and t.metadata->>'seq' = bank_streams.settle_seq::text) and (${excludeId ?? null}::text is null or id <> ${excludeId ?? null}::text)`,
		),
	),
)

/**
 * MONEY-PATH. Settle one batch. `override` pays exactly that amount (earned-wage advance); otherwise the accrued
 * remainder, subject to the dust threshold unless `force`. Returns the amount confirmed paid (0n if nothing / in flight).
 */
const settleCore = (id: string, opts: { force: boolean; override?: bigint; out?: { transferId?: string } }): PayFx<bigint> =>
	Effect.gen(function* () {
		const xfer = yield* BankTransferService
		let s = yield* loadStream(id)
		const now = new Date()
		let amount: bigint
		if (s.pendingMinor != null) {
			amount = BigInt(s.pendingMinor)
			if (opts.override != null && opts.override !== amount) return yield* Effect.fail(subErr('INVALID_TRANSITION', 'CONFLICT', 'Another settlement is in flight for this stream; retry shortly'))
		} else {
			const accrued = accruedMinor(stateOf(s), now)
			const due = accrued - BigInt(s.settledMinor)
			if (opts.override != null) {
				if (opts.override > due) return yield* Effect.fail(subErr('EWA_LIMIT', 'LIMIT_EXCEEDED', 'Amount exceeds accrued unsettled balance'))
				amount = opts.override
			} else amount = settleAmount(accrued, BigInt(s.settledMinor), BigInt(s.dustMinor), opts.force)
			if (amount <= 0n) return 0n
			const claimed = yield* bankDb((db) =>
				db.update(bankStreams).set({ pendingMinor: amount.toString(), updatedAt: new Date() }).where(and(eq(bankStreams.id, id), isNull(bankStreams.pendingMinor), eq(bankStreams.settleSeq, s.settleSeq))).returning({ id: bankStreams.id }),
			)
			if (claimed.length === 0) return 0n // someone else claimed this batch
			s = yield* loadStream(id)
		}
		const seq = s.settleSeq
		const t = yield* xfer
			.transfer({
				owner: toOwner(s.payerOwnerType, s.payerOwnerId),
				idempotencyKey: idemKey('stream', s.id, String(seq)),
				type: 'internal',
				fromAccountId: s.payerAccountId,
				toAccountId: s.payeeAccountId,
				amountMinor: amount.toString(),
				memo: `Stream ${s.kind} settlement`,
				metadata: { streamId: s.id, seq, module: 'stream' },
				consumesHold: { provider: 'stream', id: s.id },
			})
			.pipe(
				Effect.tapError((e) =>
					NON_RETRYABLE.has(e.code)
						? bankDb((db) => db.update(bankStreams).set({ pendingMinor: null, lastError: e.message.slice(0, 500), updatedAt: new Date() }).where(and(eq(bankStreams.id, id), eq(bankStreams.settleSeq, seq))))
						: Effect.void,
				),
			)
		if (opts.out) opts.out.transferId = t.id
		if (t.status === 'confirmed') {
			yield* bankDb((db) =>
				db.update(bankStreams).set({ settledMinor: sql`${bankStreams.settledMinor} + ${amount.toString()}::numeric`, settleSeq: seq + 1, pendingMinor: null, lastError: null, updatedAt: new Date() }).where(and(eq(bankStreams.id, id), eq(bankStreams.settleSeq, seq))),
			)
			return amount
		}
		if (t.status === 'failed' || t.status === 'reversed') {
			yield* bankDb((db) =>
				db.update(bankStreams).set({ settleSeq: seq + 1, pendingMinor: null, lastError: (t.failureReason ?? 'transfer failed').slice(0, 500), updatedAt: new Date() }).where(and(eq(bankStreams.id, id), eq(bankStreams.settleSeq, seq))),
			)
			return yield* Effect.fail(bankErr('UPSTREAM', `Stream settlement failed: ${t.failureReason ?? 'transfer failed'}`))
		}
		return 0n // submitted: intent stays; the next job tick replays the same key until it confirms
	})

/** Close the stream out once nothing more can accrue/settle. */
const closeIfDone = (id: string): PayFx<boolean> =>
	bankDb(async (db) => {
		const [s] = await db.select().from(bankStreams).where(eq(bankStreams.id, id)).limit(1)
		if (!s || s.endedAt || s.pendingMinor != null) return false
		const accrued = accruedMinor(stateOf(s), new Date())
		const settled = BigInt(s.settledMinor)
		const terminal = s.status === 'cancelled' || (s.status === 'active' && accrued >= BigInt(s.capMinor))
		if (!terminal || accrued > settled) return false
		await db.update(bankStreams).set({ status: s.status === 'cancelled' ? 'cancelled' : 'capped', endedAt: new Date(), updatedAt: new Date() }).where(and(eq(bankStreams.id, id), isNull(bankStreams.endedAt)))
		return true
	})

// MONEY-PATH: if an intent is still in flight, replay its (same-key) transfer; once CONFIRMED settled_minor/settle_seq
// advance exactly once (guarded by settle_seq), so a transfer that confirmed after cancel/settle returned is never missed.
const viewOf = (id: string, transferId?: string | null): PayFx<StreamView> =>
	Effect.gen(function* () {
		let s = yield* loadStream(id)
		const out: { transferId?: string } = {}
		if (s.pendingMinor != null) {
			yield* settleCore(id, { force: true, out }).pipe(Effect.catchAll(() => Effect.void))
			s = yield* loadStream(id)
		}
		const tid = transferId ?? out.transferId
		return tid !== undefined ? { ...streamView(s), transferId: tid } : streamView(s)
	})

export const BankStreamServiceLive = Layer.succeed(BankStreamService, {
	createStream: (payer, input) =>
		Effect.gen(function* () {
			const ledger = yield* BankLedgerService
			if (!/^[A-Za-z0-9_.:-]{8,128}$/.test(input.idempotencyKey)) return yield* Effect.fail(bankErr('VALIDATION', 'idempotencyKey must be 8-128 chars of A-Za-z0-9_.:-'))
			const from = yield* ledger.getAccount(payer, input.payerAccountId)
			{ const sysErr = assertSpendable(from); if (sysErr) return yield* Effect.fail(sysErr) } // MONEY-PATH: system-kind accounts are never user-spendable
			const to = yield* ledger.getAccountById(input.payeeAccountId)
			if (to.ownerType === 'system') return yield* Effect.fail(bankErr('VALIDATION', 'Cannot stream to a system account'))
			if (from.asset !== to.asset || from.chain !== to.chain) return yield* Effect.fail(bankErr('VALIDATION', 'Accounts must share asset and chain'))
			if (from.id === to.id) return yield* Effect.fail(bankErr('VALIDATION', 'Payer and payee accounts must differ'))
			if (from.status !== 'active' || to.status !== 'active') return yield* Effect.fail(bankErr('ACCOUNT_STATE', 'Both accounts must be active'))
			const p = yield* guard(() => {
				const cap = parseMinor(input.capMinor, 'capMinor')
				if (input.kind === 'rate') {
					if (!input.rateMinor) throw bankErr('VALIDATION', 'rate streams need rateMinor')
					const period = input.periodSeconds ?? 1
					if (!Number.isInteger(period) || period < 1 || period > 366 * 86_400) throw bankErr('VALIDATION', 'periodSeconds must be 1..31622400')
					return { cap, rate: parseMinor(input.rateMinor, 'rateMinor'), period, price: null as bigint | null }
				}
				if (!input.unitPriceMinor) throw bankErr('VALIDATION', 'metered streams need unitPriceMinor')
				return { cap, rate: null as bigint | null, period: null as number | null, price: parseMinor(input.unitPriceMinor, 'unitPriceMinor') }
			})
			if (input.ewaBps != null && (!Number.isInteger(input.ewaBps) || input.ewaBps < 1 || input.ewaBps > 10_000)) return yield* Effect.fail(bankErr('VALIDATION', 'ewaBps must be 1..10000'))
			const dust = input.dustMinor ? yield* guard(() => parseMinor(input.dustMinor!, 'dustMinor')) : 0n
			const s = yield* bankDb(async (db) => {
				const [ex] = await db.select().from(bankStreams).where(and(eq(bankStreams.payerOwnerType, payer.ownerType), eq(bankStreams.payerOwnerId, payer.ownerId), eq(bankStreams.idempotencyKey, input.idempotencyKey))).limit(1)
				if (ex) {
					if (ex.payerAccountId !== from.id || ex.payeeAccountId !== to.id || ex.capMinor !== p.cap.toString() || ex.kind !== input.kind) throw bankErr('CONFLICT', 'idempotencyKey was already used with different stream terms')
					return ex
				}
				const [row] = await db
					.insert(bankStreams)
					.values({
						id: uid('strm'),
						idempotencyKey: input.idempotencyKey,
						payerOwnerType: payer.ownerType,
						payerOwnerId: payer.ownerId,
						payeeOwnerType: to.ownerType,
						payeeOwnerId: to.ownerId,
						payerAccountId: from.id,
						payeeAccountId: to.id,
						asset: from.asset,
						chain: from.chain,
						kind: input.kind,
						rateMinor: p.rate?.toString() ?? null,
						periodSeconds: p.period,
						unitPriceMinor: p.price?.toString() ?? null,
						capMinor: p.cap.toString(),
						dustMinor: dust.toString(),
						resumedAt: input.kind === 'rate' ? new Date() : null,
						metadata: { ...(input.metadata ?? {}), ...(input.ewaBps ? { ewaBps: input.ewaBps } : {}) },
					})
					.returning()
				return row!
			})
			return streamView(s)
		}),

	getStream: (owner, id) =>
		Effect.gen(function* () {
			const s = yield* loadStream(id)
			yield* authorise(s, owner, 'either')
			return streamView(s)
		}),

	listStreams: (owner, role) =>
		bankDb(async (db) => {
			const p = and(eq(bankStreams.payerOwnerType, owner.ownerType), eq(bankStreams.payerOwnerId, owner.ownerId))
			const y = and(eq(bankStreams.payeeOwnerType, owner.ownerType), eq(bankStreams.payeeOwnerId, owner.ownerId))
			const rows = await db.select().from(bankStreams).where(role === 'payer' ? p : role === 'payee' ? y : sql`(${p}) or (${y})`).orderBy(desc(bankStreams.createdAt)).limit(100)
			return rows.map((s) => streamView(s))
		}),

	pause: (owner, id) =>
		Effect.gen(function* () {
			const s = yield* loadStream(id)
			yield* authorise(s, owner, 'either')
			if (s.status === 'paused') return streamView(s)
			if (s.status !== 'active') return yield* Effect.fail(bankErr('CONFLICT', `Stream is ${s.status}`))
			const now = new Date()
			const folded = s.kind === 'rate' ? foldCheckpoint(stateOf(s), now) : BigInt(s.activeSeconds)
			const r = yield* bankDb((db) =>
				db.update(bankStreams).set({ status: 'paused', activeSeconds: folded.toString(), resumedAt: null, updatedAt: now }).where(and(eq(bankStreams.id, id), eq(bankStreams.status, 'active'))).returning({ id: bankStreams.id }),
			)
			if (r.length === 0) return yield* Effect.fail(bankErr('CONFLICT', 'Stream changed concurrently'))
			yield* settleCore(id, { force: true })
			return yield* viewOf(id)
		}),

	resume: (owner, id) =>
		Effect.gen(function* () {
			const s = yield* loadStream(id)
			yield* authorise(s, owner, 'payer')
			if (s.status === 'active') return streamView(s)
			if (s.status !== 'paused') return yield* Effect.fail(bankErr('CONFLICT', `Stream is ${s.status}`))
			yield* bankDb((db) =>
				db.update(bankStreams).set({ status: 'active', resumedAt: s.kind === 'rate' ? new Date() : null, updatedAt: new Date() }).where(and(eq(bankStreams.id, id), eq(bankStreams.status, 'paused'))),
			)
			return yield* viewOf(id)
		}),

	cancel: (owner, id) =>
		Effect.gen(function* () {
			const s = yield* loadStream(id)
			yield* authorise(s, owner, 'either')
			if (s.status === 'cancelled') return yield* viewOf(id)
			const now = new Date()
			const folded = s.kind === 'rate' && s.status === 'active' ? foldCheckpoint(stateOf(s), now) : BigInt(s.activeSeconds)
			yield* bankDb((db) =>
				db.update(bankStreams).set({ status: 'cancelled', activeSeconds: folded.toString(), resumedAt: null, updatedAt: now }).where(and(eq(bankStreams.id, id), inArray(bankStreams.status, ['active', 'paused', 'capped']))),
			)
			// Remainder is settled now; if that fails the job keeps retrying (cancelled streams stay open until settled).
			const out: { transferId?: string } = {}
			yield* settleCore(id, { force: true, out })
			yield* viewOf(id) // reconcile any in-flight intent before closing
			// An older in-flight intent may have consumed the first pass: settle the true remainder now (no-op if nothing is due).
			yield* settleCore(id, { force: true, out }).pipe(Effect.catchAll(() => Effect.void))
			yield* closeIfDone(id)
			return yield* viewOf(id, out.transferId ?? null)
		}),

	settle: (owner, id) =>
		Effect.gen(function* () {
			const s = yield* loadStream(id)
			yield* authorise(s, owner, 'either')
			const out: { transferId?: string } = {}
			yield* settleCore(id, { force: false, out })
			yield* closeIfDone(id)
			return yield* viewOf(id, out.transferId ?? null)
		}),

	reportUsage: (streamId, units, opts) =>
		Effect.gen(function* () {
			const s = yield* loadStream(streamId)
			if (!sameOwner(opts.actor, toOwner(s.payeeOwnerType, s.payeeOwnerId))) return yield* Effect.fail(bankErr('FORBIDDEN', 'Only the payee can report usage'))
			if (s.kind !== 'metered') return yield* Effect.fail(bankErr('VALIDATION', 'Not a metered stream'))
			if (!/^[A-Za-z0-9_.:-]{8,128}$/.test(opts.idempotencyKey)) return yield* Effect.fail(bankErr('VALIDATION', 'idempotencyKey must be 8-128 chars of A-Za-z0-9_.:-'))
			const n = yield* guard(() => parseMinor(units, 'units'))
			yield* bankDb((db) =>
				db.transaction(async (tx) => {
					const ins = await tx.insert(bankStreamUsage).values({ id: uid('su'), streamId, units: n.toString(), idempotencyKey: opts.idempotencyKey }).onConflictDoNothing().returning({ id: bankStreamUsage.id })
					if (ins.length === 0) return // replay: already counted
					// Cap enforced in SQL so concurrent reports cannot overshoot the payer's authorisation.
					const upd = await tx
						.update(bankStreams)
						.set({ units: sql`${bankStreams.units} + ${n.toString()}::numeric`, updatedAt: new Date() })
						.where(and(eq(bankStreams.id, streamId), eq(bankStreams.status, 'active'), sql`(${bankStreams.units} + ${n.toString()}::numeric) * ${bankStreams.unitPriceMinor} <= ${bankStreams.capMinor}`))
						.returning({ id: bankStreams.id })
					if (upd.length === 0) throw bankErr(s.status === 'active' ? 'LIMIT_EXCEEDED' : 'ACCOUNT_STATE', s.status === 'active' ? 'Usage would exceed the authorised cap' : `Stream is ${s.status}`)
				}),
			)
			yield* settleCore(streamId, { force: false }).pipe(Effect.catchAll((e) => Effect.sync(() => logger.warn({ streamId, err: e.message }, 'bank: metered settle deferred to job'))))
			return yield* viewOf(streamId)
		}),

	// MONEY-PATH
	advanceWages: (worker, streamId, amountMinor, idempotencyKey) =>
		Effect.gen(function* () {
			const s = yield* loadStream(streamId)
			if (!sameOwner(worker, toOwner(s.payeeOwnerType, s.payeeOwnerId))) return yield* Effect.fail(bankErr('NOT_FOUND', 'Stream not found'))
			if (!/^[A-Za-z0-9_.:-]{8,128}$/.test(idempotencyKey)) return yield* Effect.fail(bankErr('VALIDATION', 'idempotencyKey must be 8-128 chars of A-Za-z0-9_.:-'))
			const bps = ewaBpsOf(s)
			if (bps === 0) return yield* Effect.fail(subErr('EWA_LIMIT', 'FORBIDDEN', 'Earned-wage access is not enabled on this stream'))
			if (s.status === 'cancelled' || s.status === 'capped') return yield* Effect.fail(bankErr('CONFLICT', `Stream is ${s.status}`))
			const amount = yield* guard(() => parseMinor(amountMinor))
			const adv = yield* bankDb((db0) => db0.transaction(async (db) => {
				// MONEY-PATH: lock the stream row, then recompute availability from the fresh row inside this transaction.
				await db.execute(sql`select id from bank_streams where id = ${streamId} for update`)
				const [ex] = await db.select().from(bankWageAdvances).where(and(eq(bankWageAdvances.workerOwnerType, worker.ownerType), eq(bankWageAdvances.workerOwnerId, worker.ownerId), eq(bankWageAdvances.idempotencyKey, idempotencyKey))).limit(1)
				if (ex) {
					if (ex.sourceId !== streamId || ex.amountMinor !== amount.toString()) throw bankErr('CONFLICT', 'idempotencyKey was already used with different terms')
					return { row: ex }
				}
				const [fresh] = await db.select().from(bankStreams).where(eq(bankStreams.id, streamId)).limit(1)
				if (!fresh || fresh.status === 'cancelled' || fresh.status === 'capped') throw bankErr('CONFLICT', `Stream is ${fresh?.status ?? 'missing'}`)
				const v = streamView(fresh)
				// Advances recorded but not yet paid are not reflected in settled/pending minor yet: reserve them against the ewaBps share.
				const [res] = (await db.execute(sql`select coalesce(sum(amount_minor),0)::text as s from bank_wage_advances where source_type = 'stream' and source_id = ${streamId} and transfer_id is null`)) as unknown as Array<{ s: string }>
				const reserved = BigInt(res?.s ?? '0')
				const availNow = BigInt(v.advanceAvailableMinor) > reserved ? BigInt(v.advanceAvailableMinor) - reserved : 0n
				if (amount > availNow) throw subErr('EWA_LIMIT', 'LIMIT_EXCEEDED', `Requested ${amount} exceeds the available advance of ${availNow} (${bps / 100}% of accrued-unpaid)`)
				const [row] = await db
					.insert(bankWageAdvances)
					.values({ id: uid('ewa'), sourceType: 'stream', sourceId: streamId, workerOwnerType: worker.ownerType, workerOwnerId: worker.ownerId, amountMinor: amount.toString(), idempotencyKey })
					.returning()
				return { row: row! }
			}))
			if (!adv.row.transferId) {
				const out: { transferId?: string } = {}
				yield* settleCore(streamId, { force: true, override: amount, out })
				if (out.transferId) {
					const tid = out.transferId
					yield* bankDb((db) => db.update(bankWageAdvances).set({ transferId: tid }).where(and(eq(bankWageAdvances.id, adv.row.id), isNull(bankWageAdvances.transferId))))
					return { stream: yield* viewOf(streamId), advanceId: adv.row.id, transferId: tid }
				}
			}
			return { stream: yield* viewOf(streamId), advanceId: adv.row.id, transferId: adv.row.transferId ?? null }
		}),

	runJob: () =>
		Effect.gen(function* () {
			let settled = 0
			let closed = 0
			const open = yield* bankDb((db) => db.select().from(bankStreams).where(isNull(bankStreams.endedAt)).limit(500))
			for (const s of open) {
				const force = s.status !== 'active'
				const amt = yield* settleCore(s.id, { force }).pipe(
					Effect.catchAll((e) => Effect.sync(() => (logger.warn({ streamId: s.id, err: e.message }, 'bank: stream settle failed'), 0n))),
				)
				if (amt > 0n) settled++
				if (yield* closeIfDone(s.id)) closed++
			}
			return { settled, closed }
		}),
})
