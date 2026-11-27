/**
 * BankEscrowService (M7) — MONEY-PATH. Release-on-delivery escrow.
 *
 * Funds sit in an escrow-kind bank account (owned by the payer, label `escrow:{id}`, same custody wallet, so funding
 * is a ledger move that makes the funds unspendable by the payer). State machine per milestone:
 *   funded -> delivered | disputed | released | refunded ;  delivered -> released | disputed | refunded ;  disputed -> released | refunded
 * A transition is claimed with a conditional UPDATE that ALSO persists the fund-movement intents and an event row in
 * one transaction; the transfers run afterwards with deterministic keys `escrow:{id}:{milestone}:{kind}:{attempt}`.
 * If the process dies between claim and transfer, the recurring job re-executes the intents (same keys => no double pay).
 */
import { and, asc, eq, inArray, lte, sql } from 'drizzle-orm'
import { Context, Effect, Layer } from 'effect'
import { type BankEscrow, type BankEscrowMilestone, bankEscrowEvents, bankEscrowMilestones, bankEscrows, type EscrowStatus, type MilestoneStatus } from '../../db'
import { logger } from '../../lib/logger'
import { assertAvailable, registerHoldProvider, sumRow } from './holds'
import { BankLedgerService } from './BankLedgerService'
import { BankTransferService } from './BankTransferService'
import { type BankOwner, bankDb } from './db'
import { BankError, bankErr } from './errors'
import { systemDebit } from './systemDebit'
import { actorOf, guard, idemKey, nextAttemptKey, type PayFx, parseMinor, sameOwner, subErr, toOwner, uid } from './paymentsCommon'

type Entry = BankEscrowMilestone['settlement'][number]
const DAY = 86_400

export interface CreateEscrowInput {
	idempotencyKey: string
	payee: BankOwner
	payerAccountId: string
	payeeAccountId: string
	/** Either a single amount or milestones (amounts summed). */
	amountMinor?: string | undefined
	milestones?: Array<{ amountMinor: string; description?: string | undefined; deliverBy?: Date | undefined }> | undefined
	arbiter?: BankOwner | undefined
	description?: string | undefined
	deliverBy?: Date | undefined
	/** Seconds the payer has after delivery to confirm/dispute before auto-release. Default 7 days. */
	autoReleaseSeconds?: number | undefined
}

export interface EscrowView {
	escrow: BankEscrow
	milestones: BankEscrowMilestone[]
	events: Array<typeof bankEscrowEvents.$inferSelect>
}

export interface BankEscrowServiceInterface {
	readonly createEscrow: (payer: BankOwner, input: CreateEscrowInput) => PayFx<EscrowView>
	readonly getEscrow: (owner: BankOwner, id: string) => PayFx<EscrowView>
	readonly listEscrows: (owner: BankOwner, role?: 'payer' | 'payee' | 'arbiter') => PayFx<BankEscrow[]>
	readonly markDelivered: (owner: BankOwner, id: string, seq: number, proof: string) => PayFx<EscrowView>
	readonly confirmRelease: (owner: BankOwner, id: string, seq: number) => PayFx<EscrowView>
	readonly dispute: (owner: BankOwner, id: string, seq: number, reason: string) => PayFx<EscrowView>
	readonly resolveDispute: (owner: BankOwner, id: string, seq: number, releaseMinor: string, note?: string) => PayFx<EscrowView>
	readonly refund: (owner: BankOwner, id: string, seq: number) => PayFx<EscrowView>
	/** Job step: finish funding, enforce delivery/auto-release timeouts, re-execute unfinished fund movements. */
	readonly runJob: () => PayFx<{ timedOut: number; settled: number; funded: number }>
}

export class BankEscrowService extends Context.Tag('BankEscrowService')<BankEscrowService, BankEscrowServiceInterface>() {}

const loadEscrow = (id: string) =>
	bankDb(async (db) => {
		const [e] = await db.select().from(bankEscrows).where(eq(bankEscrows.id, id)).limit(1)
		if (!e) throw bankErr('NOT_FOUND', 'Escrow not found')
		return e
	})

const loadView = (id: string): PayFx<EscrowView> =>
	bankDb(async (db) => {
		const [escrow] = await db.select().from(bankEscrows).where(eq(bankEscrows.id, id)).limit(1)
		if (!escrow) throw bankErr('NOT_FOUND', 'Escrow not found')
		const milestones = await db.select().from(bankEscrowMilestones).where(eq(bankEscrowMilestones.escrowId, id)).orderBy(asc(bankEscrowMilestones.seq))
		const events = await db.select().from(bankEscrowEvents).where(eq(bankEscrowEvents.escrowId, id)).orderBy(asc(bankEscrowEvents.createdAt))
		return { escrow, milestones, events }
	})

const roleOf = (e: BankEscrow, o: BankOwner): Array<'payer' | 'payee' | 'arbiter'> => {
	const r: Array<'payer' | 'payee' | 'arbiter'> = []
	if (sameOwner(o, toOwner(e.payerOwnerType, e.payerOwnerId))) r.push('payer')
	if (sameOwner(o, toOwner(e.payeeOwnerType, e.payeeOwnerId))) r.push('payee')
	if (e.arbiterOwnerType && sameOwner(o, toOwner(e.arbiterOwnerType, e.arbiterOwnerId!))) r.push('arbiter')
	return r
}

const escrowStatusOf = (ms: Array<Pick<BankEscrowMilestone, 'status' | 'releasedMinor' | 'refundedMinor'>>): EscrowStatus => {
	if (ms.every((m) => m.status === 'released' || m.status === 'refunded')) {
		const rel = ms.some((m) => BigInt(m.releasedMinor) > 0n)
		return rel ? 'released' : 'refunded'
	}
	if (ms.some((m) => m.status === 'disputed')) return 'disputed'
	if (ms.some((m) => m.status === 'delivered')) return 'delivered'
	return 'funded'
}

interface Claim {
	actor: BankOwner | 'system'
	action: string
	from: MilestoneStatus[]
	to: MilestoneStatus
	releaseMinor?: bigint
	refundMinor?: bigint
	/** MONEY-PATH: arbiter split — release is explicit, refund is whatever remains of the milestone. */
	remainder?: boolean
	patch?: Partial<{ deliveryProof: string; deliveredAt: Date; autoReleaseAt: Date }>
	data?: Record<string, unknown>
}

/** Atomically move a milestone, persist fund-movement intents + event. Fails CONFLICT if the state moved underneath us. */
const claim = (escrowId: string, seq: number, c: Claim): PayFx<void> =>
	bankDb((db) =>
		db.transaction(async (tx) => {
			await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${escrowId}))`)
			const [e] = await tx.select().from(bankEscrows).where(eq(bankEscrows.id, escrowId)).limit(1)
			if (!e) throw bankErr('NOT_FOUND', 'Escrow not found')
			const [m] = await tx.select().from(bankEscrowMilestones).where(and(eq(bankEscrowMilestones.escrowId, escrowId), eq(bankEscrowMilestones.seq, seq))).limit(1)
			if (!m) throw bankErr('NOT_FOUND', 'Milestone not found')
			if (e.status === 'funding' || e.status === 'failed') throw subErr('INVALID_TRANSITION', 'ACCOUNT_STATE', `Escrow is ${e.status}`)
			if (!c.from.includes(m.status)) throw subErr('INVALID_TRANSITION', 'CONFLICT', `Milestone is ${m.status}; ${c.action} requires ${c.from.join('|')}`)
			// A milestone with unfinished fund movements may not transition again. MONEY-PATH: terminal-'failed' movements (funds already reversed back into escrow) are finished and do not block a retry/resolution.
			if (m.settlement.some((s) => s.state === 'intent')) throw subErr('INVALID_TRANSITION', 'CONFLICT', 'Milestone has unfinished fund movements')
			// MONEY-PATH: only the still-movable remainder (amount - released - refunded, where failed/reversed legs were already returned) may be allocated; a sent leg is never paid twice.
			const full = BigInt(m.amountMinor)
			const remaining = full - BigInt(m.releasedMinor) - BigInt(m.refundedMinor)
			let rel = c.releaseMinor ?? 0n
			let ref = c.refundMinor ?? 0n
			if (c.remainder) ref = remaining - rel
			else if (remaining < full && rel + ref === full && (rel === 0n || ref === 0n)) {
				// single-leg claim computed against the full amount (confirm/refund/auto/retry): scale to the remainder
				rel = rel > 0n ? remaining : 0n
				ref = ref > 0n ? remaining : 0n
			}
			if (remaining <= 0n && rel + ref > 0n) throw bankErr('VALIDATION', 'Milestone has nothing left to move')
			if (rel < 0n || ref < 0n || (rel + ref > 0n && rel + ref !== remaining)) throw bankErr('VALIDATION', `release + refund must equal the remaining milestone amount (${remaining})`)
			const entries: Entry[] = []
			// MONEY-PATH: attempt counts ALL prior entries so every retry gets a fresh deterministic key (executeMoves additionally verifies the prior transfer is terminal-failed via nextAttemptKey).
			const attempt = m.settlement.length
			if (rel > 0n) entries.push({ kind: 'release', transferId: '', amountMinor: rel.toString(), attempt, state: 'intent' })
			if (ref > 0n) entries.push({ kind: 'refund', transferId: '', amountMinor: ref.toString(), attempt, state: 'intent' })
			const upd = await tx
				.update(bankEscrowMilestones)
				.set({
					status: c.to,
					...c.patch,
					releasedMinor: sql`${bankEscrowMilestones.releasedMinor} + ${rel.toString()}::numeric`,
					refundedMinor: sql`${bankEscrowMilestones.refundedMinor} + ${ref.toString()}::numeric`,
					settlement: [...m.settlement, ...entries],
					updatedAt: new Date(),
				})
				.where(and(eq(bankEscrowMilestones.id, m.id), eq(bankEscrowMilestones.status, m.status)))
				.returning({ id: bankEscrowMilestones.id })
			if (upd.length === 0) throw subErr('INVALID_TRANSITION', 'CONFLICT', 'Milestone changed concurrently; reload and retry')
			const all = await tx.select().from(bankEscrowMilestones).where(eq(bankEscrowMilestones.escrowId, escrowId))
			const relTot = all.reduce((s, x) => s + BigInt(x.releasedMinor), 0n)
			const refTot = all.reduce((s, x) => s + BigInt(x.refundedMinor), 0n)
			// MONEY-PATH invariant: per milestone and in total, released + refunded never exceeds the funded amount (rolls the transaction back).
			if (all.some((x) => BigInt(x.releasedMinor) + BigInt(x.refundedMinor) > BigInt(x.amountMinor)) || relTot + refTot > BigInt(e.amountMinor)) throw subErr('INVALID_TRANSITION', 'CONFLICT', 'Escrow invariant violated: released + refunded would exceed the funded amount')
			await tx.update(bankEscrows).set({ status: escrowStatusOf(all), releasedMinor: relTot.toString(), refundedMinor: refTot.toString(), updatedAt: new Date() }).where(eq(bankEscrows.id, escrowId))
			await tx.insert(bankEscrowEvents).values({
				id: uid('eev'),
				escrowId,
				milestoneId: m.id,
				actor: actorOf(c.actor),
				action: c.action,
				fromStatus: m.status,
				toStatus: c.to,
				data: { ...c.data, releaseMinor: rel.toString(), refundMinor: ref.toString() },
			})
		}),
	)

/** Execute any 'intent' fund movements of one milestone (idempotent via deterministic keys). */
const executeMoves = (escrowId: string, milestoneId: string): PayFx<number> =>
	Effect.gen(function* () {
		const xfer = yield* BankTransferService
		const e = yield* loadEscrow(escrowId)
		const [m] = yield* bankDb((db) => db.select().from(bankEscrowMilestones).where(eq(bankEscrowMilestones.id, milestoneId)).limit(1))
		if (!m || !e.escrowAccountId) return 0
		const payer = toOwner(e.payerOwnerType, e.payerOwnerId)
		let done = 0
		const next: Entry[] = [...m.settlement]
		for (let i = 0; i < next.length; i++) {
			const en = next[i]!
			if (en.state !== 'intent') continue
			// MONEY-PATH: deterministic key; replays return the same transfer instead of paying twice.
			const t = yield* xfer.transfer({
				owner: payer,
				idempotencyKey: yield* nextAttemptKey(payer, idemKey('escrow', e.id, m.id, en.kind, String(en.attempt))),
				type: 'escrow',
				fromAccountId: e.escrowAccountId,
				systemDebit: systemDebit('escrow-settlement', e.escrowAccountId), // MONEY-PATH: service-only capability to debit the escrow account
				toAccountId: en.kind === 'release' ? e.payeeAccountId : e.payerAccountId,
				amountMinor: en.amountMinor,
				memo: `Escrow ${en.kind}`,
				metadata: { escrowId: e.id, milestoneId: m.id, kind: en.kind, module: 'escrow' },
			})
			if (t.status === 'failed' || t.status === 'reversed') {
				// Ledger reservation was reversed back into the escrow account: park the milestone for arbiter/manual action.
				next[i] = { ...en, transferId: t.id, state: 'failed' }
				yield* bankDb((db) =>
					db.transaction(async (tx) => {
						await tx
							.update(bankEscrowMilestones)
							.set({
								status: 'disputed',
								settlement: next,
								releasedMinor: sql`${bankEscrowMilestones.releasedMinor} - ${en.kind === 'release' ? en.amountMinor : '0'}::numeric`,
								refundedMinor: sql`${bankEscrowMilestones.refundedMinor} - ${en.kind === 'refund' ? en.amountMinor : '0'}::numeric`,
								updatedAt: new Date(),
							})
							.where(eq(bankEscrowMilestones.id, m.id))
						const all = await tx.select().from(bankEscrowMilestones).where(eq(bankEscrowMilestones.escrowId, e.id))
						await tx.update(bankEscrows).set({
							status: escrowStatusOf(all),
							releasedMinor: all.reduce((s, x) => s + BigInt(x.releasedMinor), 0n).toString(),
							refundedMinor: all.reduce((s, x) => s + BigInt(x.refundedMinor), 0n).toString(),
							updatedAt: new Date(),
						}).where(eq(bankEscrows.id, e.id))
						await tx.insert(bankEscrowEvents).values({ id: uid('eev'), escrowId: e.id, milestoneId: m.id, actor: 'system', action: 'transfer_failed', fromStatus: m.status, toStatus: 'disputed', data: { transferId: t.id, kind: en.kind, reason: t.failureReason } })
					}),
				)
				return done
			}
			next[i] = { ...en, transferId: t.id, state: 'sent' }
			yield* bankDb((db) => db.update(bankEscrowMilestones).set({ settlement: next, updatedAt: new Date() }).where(eq(bankEscrowMilestones.id, m.id)))
			done++
		}
		return done
	})

const act = (escrowId: string, seq: number, c: Claim): PayFx<EscrowView> =>
	Effect.gen(function* () {
		yield* claim(escrowId, seq, c)
		const [m] = yield* bankDb((db) => db.select().from(bankEscrowMilestones).where(and(eq(bankEscrowMilestones.escrowId, escrowId), eq(bankEscrowMilestones.seq, seq))).limit(1))
		if (m) yield* executeMoves(escrowId, m.id)
		return yield* loadView(escrowId)
	})

const requireRole = (e: BankEscrow, o: BankOwner, ...allowed: Array<'payer' | 'payee' | 'arbiter'>): Effect.Effect<Array<'payer' | 'payee' | 'arbiter'>, BankError> => {
	const roles = roleOf(e, o)
	if (roles.length === 0) return Effect.fail(bankErr('NOT_FOUND', 'Escrow not found'))
	if (!roles.some((r) => allowed.includes(r))) return Effect.fail(bankErr('FORBIDDEN', `Requires role ${allowed.join(' or ')}`))
	return Effect.succeed(roles)
}

// MONEY-PATH: an escrow in 'funding' reserves its full amount on the payer account until the funding transfer row exists (from then the ledger debit is the reserve).
registerHoldProvider('escrow', async (accountId, tx, excludeId) =>
	sumRow(
		await tx.execute(
			sql`select coalesce(sum(amount_minor),0)::text as s from bank_escrows where payer_account_id = ${accountId} and status = 'funding' and not exists (select 1 from bank_transfers t where t.metadata->>'escrowId' = bank_escrows.id and t.metadata->>'kind' = 'fund') and (${excludeId ?? null}::text is null or id <> ${excludeId ?? null}::text)`,
		),
	),
)

// MONEY-PATH: fund the escrow account (idempotent on key escrow:{id}:fund).
const ensureFunded = (e: BankEscrow): PayFx<BankEscrow> =>
	Effect.gen(function* () {
		if (e.status !== 'funding') return e
		const ledger = yield* BankLedgerService
		const xfer = yield* BankTransferService
		const payer = toOwner(e.payerOwnerType, e.payerOwnerId)
		let escrowAccountId = e.escrowAccountId
		if (!escrowAccountId) {
			const existing = (yield* ledger.getAccounts(payer)).find((a) => a.kind === 'escrow' && a.label === `escrow:${e.id}`)
			const from = yield* ledger.getAccount(payer, e.payerAccountId)
			if (from.walletId == null || from.walletUserId == null || !from.address) return yield* Effect.fail(bankErr('WALLET_UNAVAILABLE', 'Payer account has no custody wallet'))
			const acct =
				existing ??
				(yield* ledger.openAccount({
					owner: payer,
					kind: 'escrow',
					asset: e.asset,
					chain: e.chain,
					label: `escrow:${e.id}`,
					metadata: { escrowId: e.id },
					wallet: { walletId: from.walletId, walletUserId: from.walletUserId, address: from.address },
				}))
			escrowAccountId = acct.id
			yield* bankDb((db) => db.update(bankEscrows).set({ escrowAccountId, updatedAt: new Date() }).where(eq(bankEscrows.id, e.id)))
		}
		const t = yield* xfer.transfer({
			owner: payer,
			idempotencyKey: idemKey('escrow', e.id, 'fund'),
			type: 'escrow',
			fromAccountId: e.payerAccountId,
			toAccountId: escrowAccountId,
			amountMinor: e.amountMinor,
			memo: 'Escrow funding',
			metadata: { escrowId: e.id, kind: 'fund', module: 'escrow' },
			consumesHold: { provider: 'escrow', id: e.id },
		})
		if (t.status === 'confirmed') {
			yield* bankDb((db) =>
				db.transaction(async (tx) => {
					const r = await tx.update(bankEscrows).set({ status: 'funded', escrowAccountId, updatedAt: new Date() }).where(and(eq(bankEscrows.id, e.id), eq(bankEscrows.status, 'funding'))).returning({ id: bankEscrows.id })
					if (r.length) await tx.insert(bankEscrowEvents).values({ id: uid('eev'), escrowId: e.id, actor: actorOf(payer), action: 'fund', fromStatus: 'funding', toStatus: 'funded', data: { transferId: t.id } })
				}),
			)
		} else if (t.status === 'failed' || t.status === 'reversed') {
			yield* bankDb((db) => db.update(bankEscrows).set({ status: 'failed', updatedAt: new Date() }).where(and(eq(bankEscrows.id, e.id), eq(bankEscrows.status, 'funding'))))
		}
		return yield* loadEscrow(e.id)
	})

export const BankEscrowServiceLive = Layer.succeed(BankEscrowService, {
	createEscrow: (payer, input) =>
		Effect.gen(function* () {
			const ledger = yield* BankLedgerService
			const from = yield* ledger.getAccount(payer, input.payerAccountId)
			const to = yield* ledger.getAccount(input.payee, input.payeeAccountId)
			if (from.asset !== to.asset || from.chain !== to.chain) return yield* Effect.fail(bankErr('VALIDATION', 'Payer and payee accounts must share asset and chain'))
			if (from.status !== 'active' || to.status !== 'active') return yield* Effect.fail(bankErr('ACCOUNT_STATE', 'Both accounts must be active'))
			if (sameOwner(payer, input.payee)) return yield* Effect.fail(bankErr('VALIDATION', 'Payer and payee must differ'))
			if (input.arbiter && (sameOwner(input.arbiter, payer) || sameOwner(input.arbiter, input.payee))) return yield* Effect.fail(bankErr('VALIDATION', 'Arbiter must be independent of payer and payee'))
			if (!/^[A-Za-z0-9_.:-]{8,128}$/.test(input.idempotencyKey)) return yield* Effect.fail(bankErr('VALIDATION', 'idempotencyKey must be 8-128 chars of A-Za-z0-9_.:-'))
			const ms = yield* guard(() => {
				const list = input.milestones?.length ? input.milestones : input.amountMinor ? [{ amountMinor: input.amountMinor, deliverBy: input.deliverBy }] : []
				if (list.length === 0) throw bankErr('VALIDATION', 'Provide amountMinor or milestones')
				if (list.length > 50) throw bankErr('VALIDATION', 'At most 50 milestones')
				const parsed = list.map((m) => ({ ...m, amount: parseMinor(m.amountMinor, 'milestone amount') }))
				if (input.amountMinor && input.milestones?.length && parseMinor(input.amountMinor) !== parsed.reduce((s, m) => s + m.amount, 0n)) throw bankErr('VALIDATION', 'amountMinor does not equal the milestone total')
				return parsed
			})
			const total = ms.reduce((s, m) => s + m.amount, 0n)
			const autoRelease = input.autoReleaseSeconds ?? 7 * DAY
			if (!Number.isInteger(autoRelease) || autoRelease < 3600 || autoRelease > 180 * DAY) return yield* Effect.fail(bankErr('VALIDATION', 'autoReleaseSeconds must be between 1 hour and 180 days'))
			const esc = yield* bankDb((db) =>
				db.transaction(async (tx) => {
					const [ex] = await tx.select().from(bankEscrows).where(and(eq(bankEscrows.payerOwnerType, payer.ownerType), eq(bankEscrows.payerOwnerId, payer.ownerId), eq(bankEscrows.idempotencyKey, input.idempotencyKey))).limit(1)
					if (ex) {
						if (ex.payerAccountId !== from.id || ex.payeeAccountId !== to.id || BigInt(ex.amountMinor) !== total) throw bankErr('CONFLICT', 'idempotencyKey was already used with different escrow terms')
						return ex
					}
					// MONEY-PATH: lock the payer account, then reserve against ledger balance minus ALL holds (cards, streams, other escrows).
					await tx.execute(sql`select 1 from bank_accounts where id = ${from.id} for update`)
					await assertAvailable(from.id, tx, total)
					const id = uid('esc')
					const [row] = await tx
						.insert(bankEscrows)
						.values({
							id,
							idempotencyKey: input.idempotencyKey,
							payerOwnerType: payer.ownerType,
							payerOwnerId: payer.ownerId,
							payeeOwnerType: input.payee.ownerType,
							payeeOwnerId: input.payee.ownerId,
							arbiterOwnerType: input.arbiter?.ownerType ?? null,
							arbiterOwnerId: input.arbiter?.ownerId ?? null,
							payerAccountId: from.id,
							payeeAccountId: to.id,
							asset: from.asset,
							chain: from.chain,
							amountMinor: total.toString(),
							description: input.description ?? null,
							autoReleaseSeconds: autoRelease,
						})
						.returning()
					await tx.insert(bankEscrowMilestones).values(
						ms.map((m, i) => ({ id: uid('ems'), escrowId: id, seq: i + 1, amountMinor: m.amount.toString(), description: m.description ?? null, deliverBy: m.deliverBy ?? null })),
					)
					return row!
				}),
			)
			const funded = yield* ensureFunded(esc).pipe(
				Effect.tapError((e) =>
					['INSUFFICIENT_FUNDS', 'INSUFFICIENT_AVAILABLE', 'LIMIT_EXCEEDED', 'POLICY_BLOCKED', 'ACCOUNT_STATE', 'VALIDATION'].includes(e.code)
						? bankDb((db) => db.update(bankEscrows).set({ status: 'failed', updatedAt: new Date() }).where(and(eq(bankEscrows.id, esc.id), eq(bankEscrows.status, 'funding'))))
						: Effect.void,
				),
			)
			return yield* loadView(funded.id)
		}),

	getEscrow: (owner, id) =>
		Effect.gen(function* () {
			const e = yield* loadEscrow(id)
			yield* requireRole(e, owner, 'payer', 'payee', 'arbiter')
			return yield* loadView(id)
		}),

	listEscrows: (owner, role) =>
		bankDb((db) => {
			const p = and(eq(bankEscrows.payerOwnerType, owner.ownerType), eq(bankEscrows.payerOwnerId, owner.ownerId))
			const y = and(eq(bankEscrows.payeeOwnerType, owner.ownerType), eq(bankEscrows.payeeOwnerId, owner.ownerId))
			const a = and(eq(bankEscrows.arbiterOwnerType, owner.ownerType), eq(bankEscrows.arbiterOwnerId, owner.ownerId))
			const cond = role === 'payer' ? p : role === 'payee' ? y : role === 'arbiter' ? a : sql`(${p}) or (${y}) or (${a})`
			return db.select().from(bankEscrows).where(cond).orderBy(sql`${bankEscrows.createdAt} desc`).limit(100)
		}),

	markDelivered: (owner, id, seq, proof) =>
		Effect.gen(function* () {
			const e = yield* loadEscrow(id)
			yield* requireRole(e, owner, 'payee')
			if (!proof.trim()) return yield* Effect.fail(bankErr('VALIDATION', 'Delivery proof is required'))
			const now = new Date()
			return yield* act(id, seq, {
				actor: owner,
				action: 'deliver',
				from: ['funded'],
				to: 'delivered',
				patch: { deliveryProof: proof.slice(0, 4000), deliveredAt: now, autoReleaseAt: new Date(now.getTime() + e.autoReleaseSeconds * 1000) },
				data: { proof: proof.slice(0, 500) },
			})
		}),

	confirmRelease: (owner, id, seq) =>
		Effect.gen(function* () {
			const e = yield* loadEscrow(id)
			yield* requireRole(e, owner, 'payer')
			const [m] = yield* bankDb((db) => db.select().from(bankEscrowMilestones).where(and(eq(bankEscrowMilestones.escrowId, id), eq(bankEscrowMilestones.seq, seq))).limit(1))
			if (!m) return yield* Effect.fail(bankErr('NOT_FOUND', 'Milestone not found'))
			return yield* act(id, seq, { actor: owner, action: 'confirm', /* MONEY-PATH: no arbiter -> payer may always (re)release their own funds, incl. after a failed transfer */ from: e.arbiterOwnerType ? ['funded', 'delivered'] : ['funded', 'delivered', 'disputed'], to: 'released', releaseMinor: BigInt(m.amountMinor) })
		}),

	dispute: (owner, id, seq, reason) =>
		Effect.gen(function* () {
			const e = yield* loadEscrow(id)
			const roles = yield* requireRole(e, owner, 'payer', 'payee')
			if (!e.arbiterOwnerType) return yield* Effect.fail(bankErr('CONFLICT', 'No arbiter designated; payer must confirm or payee must refund'))
			const from: MilestoneStatus[] = roles.includes('payer') ? ['funded', 'delivered'] : ['delivered']
			return yield* act(id, seq, { actor: owner, action: 'dispute', from, to: 'disputed', data: { reason: reason.slice(0, 1000) } })
		}),

	resolveDispute: (owner, id, seq, releaseMinor, note) =>
		Effect.gen(function* () {
			const e = yield* loadEscrow(id)
			yield* requireRole(e, owner, 'arbiter')
			const [m] = yield* bankDb((db) => db.select().from(bankEscrowMilestones).where(and(eq(bankEscrowMilestones.escrowId, id), eq(bankEscrowMilestones.seq, seq))).limit(1))
			if (!m) return yield* Effect.fail(bankErr('NOT_FOUND', 'Milestone not found'))
			const total = BigInt(m.amountMinor)
			const rel = yield* guard(() => {
				if (!/^(0|[1-9][0-9]{0,77})$/.test(releaseMinor)) throw bankErr('VALIDATION', 'releaseMinor must be a non-negative integer string')
				const r = BigInt(releaseMinor)
				if (r > total) throw bankErr('VALIDATION', 'releaseMinor exceeds the milestone amount')
				return r
			})
			return yield* act(id, seq, { actor: owner, action: 'resolve', from: ['disputed'], to: rel === 0n ? 'refunded' : 'released', releaseMinor: rel, remainder: true, data: { note: note?.slice(0, 1000) } })
		}),

	refund: (owner, id, seq) =>
		Effect.gen(function* () {
			const e = yield* loadEscrow(id)
			yield* requireRole(e, owner, 'payee')
			const [m] = yield* bankDb((db) => db.select().from(bankEscrowMilestones).where(and(eq(bankEscrowMilestones.escrowId, id), eq(bankEscrowMilestones.seq, seq))).limit(1))
			if (!m) return yield* Effect.fail(bankErr('NOT_FOUND', 'Milestone not found'))
			return yield* act(id, seq, { actor: owner, action: 'refund', /* MONEY-PATH: payee may always give funds back, incl. after a failed transfer */ from: ['funded', 'delivered', 'disputed'], to: 'refunded', refundMinor: BigInt(m.amountMinor) })
		}),

	runJob: () =>
		Effect.gen(function* () {
			let timedOut = 0
			let settled = 0
			let funded = 0
			const log = (e: BankError, ctx: Record<string, unknown>) => Effect.sync(() => logger.warn({ ...ctx, err: e.message }, 'bank: escrow job step failed'))

			for (const e of yield* bankDb((db) => db.select().from(bankEscrows).where(eq(bankEscrows.status, 'funding')).limit(50))) {
				yield* ensureFunded(e).pipe(Effect.tap(() => Effect.sync(() => funded++)), Effect.catchAll((er) => log(er, { escrowId: e.id })))
			}

			// Unfinished fund movements (crash between claim and transfer).
			const stuck = yield* bankDb((db) =>
				db.select().from(bankEscrowMilestones).where(sql`exists (select 1 from jsonb_array_elements(${bankEscrowMilestones.settlement}) s where s->>'state' = 'intent')`).limit(50),
			)
			for (const m of stuck) settled += yield* executeMoves(m.escrowId, m.id).pipe(Effect.catchAll((er) => log(er, { milestoneId: m.id }).pipe(Effect.as(0))))

			// MONEY-PATH: arbiter-less milestone parked as 'disputed' by a failed transfer: timeout rule, retry the same movement after a 1h cooldown.
			const parked = yield* bankDb((db) => db.select().from(bankEscrowMilestones).where(and(eq(bankEscrowMilestones.status, 'disputed'), lte(bankEscrowMilestones.updatedAt, new Date(Date.now() - 3600_000)))).limit(50))
			for (const m of parked) {
				const last = [...m.settlement].reverse().find((x) => x.state === 'failed')
				if (!last || m.settlement.some((x) => x.state === 'intent')) continue
				yield* Effect.gen(function* () {
					const esc = yield* loadEscrow(m.escrowId)
					if (esc.arbiterOwnerType) return
					const amt = BigInt(m.amountMinor)
					yield* act(m.escrowId, m.seq, { actor: 'system', action: 'retry_failed', from: ['disputed'], to: last.kind === 'release' ? 'released' : 'refunded', releaseMinor: last.kind === 'release' ? amt : 0n, refundMinor: last.kind === 'release' ? 0n : amt })
					settled++
				}).pipe(Effect.catchAll((er) => log(er, { milestoneId: m.id })))
			}

			// Payer silence after delivery -> auto-release to payee.
			const now = new Date()
			const dueRelease = yield* bankDb((db) => db.select().from(bankEscrowMilestones).where(and(eq(bankEscrowMilestones.status, 'delivered'), lte(bankEscrowMilestones.autoReleaseAt, now))).limit(50))
			for (const m of dueRelease)
				yield* act(m.escrowId, m.seq, { actor: 'system', action: 'auto_release', from: ['delivered'], to: 'released', releaseMinor: BigInt(m.amountMinor) }).pipe(
					Effect.tap(() => Effect.sync(() => timedOut++)),
					Effect.catchAll((er) => log(er, { milestoneId: m.id })),
				)
			// Never delivered by the deadline -> refund payer.
			const dueRefund = yield* bankDb((db) => db.select().from(bankEscrowMilestones).where(and(inArray(bankEscrowMilestones.status, ['funded']), lte(bankEscrowMilestones.deliverBy, now))).limit(50))
			for (const m of dueRefund)
				yield* act(m.escrowId, m.seq, { actor: 'system', action: 'auto_refund', from: ['funded'], to: 'refunded', refundMinor: BigInt(m.amountMinor) }).pipe(
					Effect.tap(() => Effect.sync(() => timedOut++)),
					Effect.catchAll((er) => log(er, { milestoneId: m.id })),
				)
			return { timedOut, settled, funded }
		}),
})
