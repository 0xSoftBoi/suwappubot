/** Shared helpers for M7/M8 (payments, escrow, streams, payroll, pools). */
import { createHash, randomBytes, randomUUID } from 'node:crypto'
import { Context, Effect, Option } from 'effect'
import type { DrizzleService } from '../../db'
import { BankFxService } from './BankFxService'
import { BankLedgerService } from './BankLedgerService'
import { type BankDeps, BankTransferService } from './BankTransferService'
import type { BankOwner } from './db'
import { BankError, bankErr } from './errors'

/** Everything the M7/M8 services need from the layer at call time. */
export type PayDeps = BankDeps | BankTransferService | BankFxService
export type PayFx<A> = Effect.Effect<A, BankError, PayDeps>

export const uid = (prefix: string): string => `${prefix}_${randomUUID().replace(/-/g, '')}`
export const newSlug = (): string => randomBytes(12).toString('base64url')
export const ownerKey = (o: BankOwner): string => `${o.ownerType}:${o.ownerId}`
export const sameOwner = (a: BankOwner, b: BankOwner): boolean => a.ownerType === b.ownerType && a.ownerId === b.ownerId
export const toOwner = (type: string, id: string): BankOwner => ({ ownerType: type as BankOwner['ownerType'], ownerId: id })
export const actorOf = (o: BankOwner | 'system'): string => (o === 'system' ? 'system' : ownerKey(o))

/** Deterministic transfer key: `<scope>:<parts...>`; long parts are hashed so the 128-char limit can never be hit. */
export const idemKey = (...parts: string[]): string => {
	const k = parts.join(':')
	if (k.length <= 120) return k
	const h = createHash('sha256').update(k).digest('hex').slice(0, 40)
	return `${parts[0]}:${h}`
}

/** Typed sub-errors that are not in BankErrorCode: the machine code is the message prefix (e.g. `POOL_UNFUNDED: ...`). */
export type SubErrorCode = 'POOL_UNFUNDED' | 'EXPOSURE_LIMIT' | 'RAMP_UNAVAILABLE' | 'APPROVAL_REQUIRED' | 'EWA_LIMIT' | 'INVALID_TRANSITION'
export const subErr = (sub: SubErrorCode, code: BankError['code'], message: string, missing?: string): BankError =>
	bankErr(code, `${sub}: ${message}`, missing ? { missing } : undefined)

export const parseMinor = (s: string, what = 'amount'): bigint => {
	if (!/^[1-9][0-9]{0,77}$/.test(s)) throw bankErr('VALIDATION', `${what} must be a positive integer string in minor units`)
	return BigInt(s)
}

/** Run a sync/Promise block, mapping throws of BankError through and anything else to VALIDATION. */
export const guard = <A>(f: () => A): Effect.Effect<A, BankError> =>
	Effect.try({ try: f, catch: (e) => (e instanceof BankError ? e : bankErr('VALIDATION', e instanceof Error ? e.message : String(e))) })

// -------- optional sibling modules (never hard-fail if absent) --------

/** Minimal slice of the credit module (receivables financing). */
export interface BankCreditLike {
	readonly settleReceivable: (invoiceId: string, amountMinor: string) => Effect.Effect<unknown, unknown, DrizzleService>
}
export const BankCreditLookup = Context.GenericTag<BankCreditLike>('BankCreditService')

/** Minimal slice of the ramp module for local-rail payouts. */
export interface BankRampLike {
	readonly payoutLocal: (input: {
		owner: BankOwner
		idempotencyKey: string
		fromAccountId: string
		amountMinor: string
		rail?: string | undefined
		railAccountId: string
		currency: string
		memo?: string | undefined
	}) => Effect.Effect<{ id: string; status: string }, unknown, DrizzleService>
}
export const BankRampLookup = Context.GenericTag<BankRampLike>('BankRampService')

/** Minimal slice of the M9 approvals module. `check` fails when the token does not authorise this action. */
export interface BankApprovalLike {
	readonly check: (input: {
		token: string
		owner: BankOwner
		action: string
		refId: string
		amountMinor: string
	}) => Effect.Effect<{ approvedBy: string }, unknown, DrizzleService>
}
export const BankApprovalLookup = Context.GenericTag<BankApprovalLike>('BankApprovalService')

export const optional = <T>(tag: Context.Tag<T, T>): Effect.Effect<Option.Option<T>> => Effect.serviceOption(tag)

export const ledger = BankLedgerService
export const transfers = BankTransferService
