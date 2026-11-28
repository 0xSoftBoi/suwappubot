/**
 * MONEY-PATH: unified available balance.
 *
 *   available = ledger balance (bank_accounts.balance_minor) - sum(active holds from every registered provider)
 *
 * Card authorizations, escrow funding reservations, stream settlement intents and agent-pay spend reserves
 * all live in their own tables; each module registers a provider that reads its table so every debit path and
 * every hold-placement path sees the same number. CALLERS MUST HOLD THE SOURCE ACCOUNT ROW LOCK
 * (`select ... from bank_accounts where id = $1 for update`) in the same transaction, so two different hold
 * types (or a hold and a transfer) cannot both be granted against the same funds.
 *
 * A hold-releasing operation (capturing a card hold, releasing/funding an escrow, settling a stream intent)
 * passes `consumesHold: { provider, id }`; that provider excludes the named hold from the subtraction.
 */
import { sql } from 'drizzle-orm'
import type { DbClient } from '../../db'
import { bankErr } from './errors'

export type BankTx = Parameters<Parameters<DbClient['transaction']>[0]>[0]
export interface ConsumesHold {
	readonly provider: string
	readonly id: string
}
/** Returns the minor-unit total this provider is holding on the account. `excludeId` = the hold being consumed (if it is this provider's). */
export type HoldProvider = (accountId: string, tx: BankTx, excludeId?: string) => bigint | Promise<bigint>

const providers = new Map<string, HoldProvider>()

/** Idempotent per name (re-registering replaces, e.g. on hot reload). */
export const registerHoldProvider = (name: string, fn: HoldProvider): void => {
	providers.set(name, fn)
}

/** Shared helper for providers: run a `select coalesce(sum(..),0)::text as s ...` and parse it. */
export const sumRow = (r: unknown): bigint => BigInt((r as Array<{ s: string | null }>)[0]?.s ?? '0')

export const totalHolds = async (accountId: string, tx: BankTx, consumes?: ConsumesHold): Promise<bigint> => {
	let total = 0n
	for (const [name, fn] of providers) total += await fn(accountId, tx, consumes?.provider === name ? consumes.id : undefined)
	return total
}

/**
 * MONEY-PATH: server-side validation of `consumesHold`. The named provider's total for this account, with and without the hold,
 * must differ by at least `amount` — i.e. the hold exists, is active, belongs to THIS account and covers the debit.
 */
export const assertHoldCovers = async (accountId: string, tx: BankTx, amount: bigint, consumes: ConsumesHold): Promise<void> => {
	const fn = providers.get(consumes.provider)
	if (!fn) throw bankErr('VALIDATION', `Unknown hold provider '${consumes.provider}'`)
	const held = (await fn(accountId, tx)) - (await fn(accountId, tx, consumes.id))
	if (held < amount) throw bankErr('VALIDATION', 'consumesHold does not reference an active hold on the source account covering this amount')
}

// MONEY-PATH: pending transfers whose 'submit' reserve is not yet posted still commit funds the ledger balance does not show yet.
registerHoldProvider('pending-transfer', async (accountId, tx) =>
	sumRow(
		await tx.execute(
			sql`select coalesce(sum(t.amount_minor), 0)::text as s from bank_transfers t where t.from_account = ${accountId} and t.status = 'pending'
				and not exists (select 1 from bank_ledger_entries e where e.transfer_id = t.id and e.phase = 'submit')`,
		),
	),
)

/** MONEY-PATH: ledger balance minus all active holds. Caller must hold the account row lock. */
export const availableBalance = async (accountId: string, tx: BankTx, consumes?: ConsumesHold): Promise<bigint> => {
	const r = (await tx.execute(sql`select balance_minor::text as s from bank_accounts where id = ${accountId}`)) as unknown as Array<{ s: string }>
	if (!r[0]) throw bankErr('NOT_FOUND', 'Account not found')
	return BigInt(r[0].s) - (await totalHolds(accountId, tx, consumes))
}

/** MONEY-PATH: throws INSUFFICIENT_AVAILABLE unless `amount` fits in the available balance. */
export const assertAvailable = async (accountId: string, tx: BankTx, amount: bigint, consumes?: ConsumesHold): Promise<void> => {
	if (consumes) await assertHoldCovers(accountId, tx, amount, consumes)
	const avail = await availableBalance(accountId, tx, consumes)
	if (avail < amount) throw bankErr('INSUFFICIENT_AVAILABLE', `Insufficient available balance (${avail} < ${amount}); funds are reserved by pending holds`)
}
