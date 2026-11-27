/** Shared helpers for M7/M8 (payments, escrow, streams, payroll, pools). */
import { createHash, randomBytes, randomUUID } from 'node:crypto'
import { Context, Effect, Option } from 'effect'
import type { EnvService } from '../../config/EnvService'
import type { DrizzleService } from '../../db'
import type { SwapService } from '../SwapService'
import { BankFxService } from './BankFxService'
import { BankLedgerService } from './BankLedgerService'
import { type BankDeps, BankTransferService } from './BankTransferService'
import type { BankPayoutPoolService } from './BankPayoutPoolService'
import type { BankOwner } from './db'
import { BankError, bankErr } from './errors'

/** Everything the M7/M8 services need from the layer at call time. */
export type PayDeps = BankDeps | BankTransferService | BankFxService | BankPayoutPoolService | EnvService | SwapService
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

/** Typed sub-errors that are not in BankErrorCode: the machine code is the message prefix (POOL_UNFUNDED, EXPOSURE_LIMIT, RAMP_UNAVAILABLE are real BankErrorCodes; the rest are message prefixes). */
export type SubErrorCode = 'POOL_UNFUNDED' | 'EXPOSURE_LIMIT' | 'RAMP_UNAVAILABLE' | 'APPROVAL_REQUIRED' | 'EWA_LIMIT' | 'INVALID_TRANSITION'
const REAL_CODES = new Set<SubErrorCode>(['POOL_UNFUNDED', 'EXPOSURE_LIMIT', 'RAMP_UNAVAILABLE'])
export const subErr = (sub: SubErrorCode, code: BankError['code'], message: string, missing?: string): BankError =>
	REAL_CODES.has(sub)
		? bankErr(sub as BankError['code'], message, missing ? { missing } : undefined)
		: bankErr(code, `${sub}: ${message}`, missing ? { missing } : undefined)

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
	readonly settleReceivable: (invoiceId: string, amountMinor: string, paymentRef?: string) => Effect.Effect<unknown, unknown, DrizzleService>
}
export const BankCreditLookup = Context.GenericTag<BankCreditLike>('BankCreditService')

export const optional = <T>(tag: Context.Tag<T, T>): Effect.Effect<Option.Option<T>> => Effect.serviceOption(tag)

export const ledger = BankLedgerService
export const transfers = BankTransferService
