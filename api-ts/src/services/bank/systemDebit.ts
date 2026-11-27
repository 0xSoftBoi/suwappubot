/**
 * MONEY-PATH: capability to debit system-kind accounts (escrow, pool). User-initiated entry points never
 * receive one; only bank services mint it. Tokens are tracked in a module-private WeakSet, so a structurally
 * forged object (e.g. parsed from a request body) is rejected. Not re-exported from services/bank/index.ts.
 */
import type { BankAccount } from '../../db/schema'
import { bankErr, type BankError } from './errors'

declare const brand: unique symbol
export interface SystemDebit {
	readonly [brand]: true
	readonly reason: string
}
const minted = new WeakSet<object>()

export const systemDebit = (reason: string): SystemDebit => {
	const t = Object.freeze({ reason }) as unknown as SystemDebit
	minted.add(t)
	return t
}

/** Account kinds that hold funds on behalf of a counterparty/process and must never be user-spendable. */
const SYSTEM_KINDS: ReadonlySet<string> = new Set(['escrow', 'pool'])
export const isSystemKind = (kind: string): boolean => SYSTEM_KINDS.has(kind)

/** Throws FORBIDDEN-style BankError unless the account is user-spendable or a valid SystemDebit capability is presented. */
export const assertSpendable = (acct: Pick<BankAccount, 'kind' | 'id'>, cap?: SystemDebit | undefined): BankError | null =>
	isSystemKind(acct.kind) && !(cap && minted.has(cap as unknown as object))
		? bankErr('ACCOUNT_STATE', `Account ${acct.id} (${acct.kind}) is a system account and cannot be debited directly`)
		: null
