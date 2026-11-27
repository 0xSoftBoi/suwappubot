/**
 * M11 branded stablecoin. Bridge documents NO public issuance endpoints, so mint/redeem/reserve
 * reporting go through an IssuerAdapter that a deployment registers; with none registered they fail
 * with a typed ISSUER_NOT_CONFIGURED error. The reserve-yield share accounting is real: pro-rata by
 * time-weighted balance over real bank_ledger_entries, integer math, largest-remainder rounding so
 * the allocation sums exactly to the distributable amount.
 *
 * MONEY-PATH: yield share allocation (sum-preserving integer math).
 */
import { and, asc, eq, gte, inArray, lt, ne, sql } from 'drizzle-orm'
import { Context, Effect, Layer } from 'effect'
import { type DrizzleService, bankAccounts, bankLedgerEntries } from '../../db'
import { bankDb } from './db'
import { type BankError, bankErr } from './errors'

export interface IssuerAdapter {
	readonly name: string
	mint(req: { asset: string; amountMinor: string; destinationAccountId: string; idempotencyKey: string }): Promise<{ reference: string; status: string }>
	redeem(req: { asset: string; amountMinor: string; sourceAccountId: string; idempotencyKey: string }): Promise<{ reference: string; status: string }>
	reserveReport(asset: string): Promise<{ asset: string; reserveMinor: string; supplyMinor: string; yieldAccruedMinor: string; asOf: string }>
	/** Optional: issuer-reported yield for a period (otherwise pass totalYieldMinor explicitly). */
	yieldForPeriod?(asset: string, from: Date, to: Date): Promise<{ totalYieldMinor: string }>
}

let adapter: IssuerAdapter | null = null
export const registerIssuerAdapter = (a: IssuerAdapter | null) => { adapter = a }

const notConfigured = (what: string) =>
	bankErr('ISSUER_NOT_CONFIGURED', `${what} requires a branded-stablecoin issuer adapter. Bridge does not publish public issuance endpoints; no endpoint is assumed.`, { missing: 'IssuerAdapter registration (issuer API credentials + a registered adapter implementing mint/redeem/reserveReport)' })

export interface TwabInput {
	accountId: string
	/** balance at `from` */
	opening: bigint
	/** ledger entries in [from,to) ordered by time: balance after each entry */
	points: Array<{ t: number; balance: bigint }>
}

/** Time-weighted balance area (balance * milliseconds) over [fromMs, toMs). */
export function balanceArea(a: TwabInput, fromMs: number, toMs: number): bigint {
	let bal = a.opening
	let cursor = fromMs
	let area = 0n
	for (const p of a.points) {
		const t = Math.min(Math.max(p.t, fromMs), toMs)
		if (t > cursor) { area += (bal > 0n ? bal : 0n) * BigInt(t - cursor); cursor = t }
		bal = p.balance
	}
	if (toMs > cursor) area += (bal > 0n ? bal : 0n) * BigInt(toMs - cursor)
	return area
}

export interface YieldAllocation { accountId: string; areaWeight: string; shareMinor: string }

/** Pro-rata allocation of `distributable` by area weight; largest-remainder so sum == distributable exactly. */
export function allocateByWeight(weights: Array<{ accountId: string; area: bigint }>, distributable: bigint): { allocations: YieldAllocation[]; undistributedMinor: string } {
	const total = weights.reduce((s, w) => s + w.area, 0n)
	if (total === 0n || distributable === 0n) return { allocations: weights.map((w) => ({ accountId: w.accountId, areaWeight: w.area.toString(), shareMinor: '0' })), undistributedMinor: distributable.toString() }
	const rows = weights.map((w) => ({ w, floor: (distributable * w.area) / total, rem: (distributable * w.area) % total }))
	let left = distributable - rows.reduce((s, r) => s + r.floor, 0n)
	const order = [...rows].sort((a, b) => (a.rem === b.rem ? (a.w.accountId < b.w.accountId ? -1 : 1) : a.rem > b.rem ? -1 : 1))
	for (const r of order) { if (left <= 0n) break; if (r.w.area > 0n) { r.floor += 1n; left -= 1n } }
	return { allocations: rows.map((r) => ({ accountId: r.w.accountId, areaWeight: r.w.area.toString(), shareMinor: r.floor.toString() })), undistributedMinor: left.toString() }
}

export interface BankStablecoinServiceInterface {
	readonly mint: (i: { asset: string; amountMinor: string; destinationAccountId: string; idempotencyKey: string }) => Effect.Effect<{ reference: string; status: string }, BankError>
	readonly redeem: (i: { asset: string; amountMinor: string; sourceAccountId: string; idempotencyKey: string }) => Effect.Effect<{ reference: string; status: string }, BankError>
	readonly reserveReport: (asset: string) => Effect.Effect<Record<string, unknown>, BankError>
	readonly yieldShare: (i: { asset: string; chain?: string; from: Date; to: Date; totalYieldMinor?: string; holderShareBps: number }) => Effect.Effect<Record<string, unknown>, BankError, DrizzleService>
}
export class BankStablecoinService extends Context.Tag('BankStablecoinService')<BankStablecoinService, BankStablecoinServiceInterface>() {}

export const BankStablecoinServiceLive = Layer.succeed(BankStablecoinService, {
	mint: (i) => (adapter ? Effect.tryPromise({ try: () => adapter!.mint(i), catch: (e) => bankErr('UPSTREAM', `issuer mint failed: ${String(e)}`) }) : Effect.fail(notConfigured('mint'))),
	redeem: (i) => (adapter ? Effect.tryPromise({ try: () => adapter!.redeem(i), catch: (e) => bankErr('UPSTREAM', `issuer redeem failed: ${String(e)}`) }) : Effect.fail(notConfigured('redeem'))),
	reserveReport: (asset) => (adapter ? Effect.tryPromise({ try: () => adapter!.reserveReport(asset), catch: (e) => bankErr('UPSTREAM', `issuer reserve report failed: ${String(e)}`) }) : Effect.fail(notConfigured('reserve report'))),

	// MONEY-PATH
	yieldShare: (i) =>
		Effect.gen(function* () {
			if (!(i.from < i.to)) return yield* Effect.fail(bankErr('VALIDATION', 'from must be before to'))
			if (!Number.isInteger(i.holderShareBps) || i.holderShareBps < 0 || i.holderShareBps > 10_000) return yield* Effect.fail(bankErr('VALIDATION', 'holderShareBps must be an integer 0..10000'))
			let total: bigint
			if (i.totalYieldMinor !== undefined) {
				if (!/^\d{1,78}$/.test(i.totalYieldMinor)) return yield* Effect.fail(bankErr('VALIDATION', 'totalYieldMinor must be a non-negative integer string'))
				total = BigInt(i.totalYieldMinor)
			} else if (adapter?.yieldForPeriod) {
				const r = yield* Effect.tryPromise({ try: () => adapter!.yieldForPeriod!(i.asset, i.from, i.to), catch: (e) => bankErr('UPSTREAM', `issuer yield report failed: ${String(e)}`) })
				total = BigInt(r.totalYieldMinor)
			} else return yield* Effect.fail(bankErr('ISSUER_NOT_CONFIGURED', 'totalYieldMinor not supplied and no issuer adapter reports yield', { missing: 'totalYieldMinor (issuer-reported reserve yield for the period) or an IssuerAdapter.yieldForPeriod' }))
			const distributable = (total * BigInt(i.holderShareBps)) / 10_000n
			const fromMs = i.from.getTime()
			const toMs = i.to.getTime()
			const data = yield* bankDb(async (db) => {
				const accts = await db.select({ id: bankAccounts.id }).from(bankAccounts).where(and(eq(bankAccounts.asset, i.asset.toUpperCase()), ne(bankAccounts.ownerType, 'system'), ne(bankAccounts.status, 'closed'), ...(i.chain ? [eq(bankAccounts.chain, i.chain.toLowerCase())] : [])))
				const ids = accts.map((a) => a.id)
				if (!ids.length) return { inputs: [] as TwabInput[] }
				const opening = await db.execute(sql`select distinct on (account_id) account_id, balance_after from bank_ledger_entries where account_id in (${sql.join(ids.map((x) => sql`${x}`), sql`, `)}) and created_at < ${i.from} order by account_id, created_at desc, id desc`)
				const openMap = new Map<string, bigint>()
				for (const r of opening as unknown as Array<{ account_id: string; balance_after: string | null }>) openMap.set(r.account_id, BigInt(r.balance_after ?? '0'))
				const inRange = await db.select().from(bankLedgerEntries).where(and(inArray(bankLedgerEntries.accountId, ids), gte(bankLedgerEntries.createdAt, i.from), lt(bankLedgerEntries.createdAt, i.to))).orderBy(asc(bankLedgerEntries.createdAt), asc(bankLedgerEntries.id))
				const pts = new Map<string, TwabInput['points']>()
				for (const e of inRange) {
					if (e.balanceAfter === null) throw bankErr('DB', `Ledger entry ${e.id} has no balance_after; cannot time-weight`)
					pts.set(e.accountId, [...(pts.get(e.accountId) ?? []), { t: e.createdAt.getTime(), balance: BigInt(e.balanceAfter) }])
				}
				return { inputs: ids.map((id) => ({ accountId: id, opening: openMap.get(id) ?? 0n, points: pts.get(id) ?? [] })) }
			})
			const weights = data.inputs.map((a) => ({ accountId: a.accountId, area: balanceArea(a, fromMs, toMs) })).filter((w) => w.area > 0n)
			const { allocations, undistributedMinor } = allocateByWeight(weights, distributable)
			return { asset: i.asset.toUpperCase(), from: i.from.toISOString(), to: i.to.toISOString(), totalYieldMinor: total.toString(), holderShareBps: i.holderShareBps, distributableMinor: distributable.toString(), retainedByBrandMinor: (total - distributable).toString(), undistributedMinor, holders: allocations.filter((a) => a.shareMinor !== '0'), method: 'time-weighted balance over bank_ledger_entries, largest-remainder integer allocation' }
		}),
})
