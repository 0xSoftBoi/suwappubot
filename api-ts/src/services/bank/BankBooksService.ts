/**
 * BankBooksService — single-denomination books for an org.
 *
 * Every ledger movement on an org-owned account becomes one `bank_org_books`
 * row carrying the reporting-currency amount and the exact rate used (persisted:
 * rate, source, fetched-at, lag). Rates come from lib/prices.ts `fetchTokenPrices`
 * (the repo's price service) — no hardcoded 1:1 for stablecoins. If no price is
 * available for an asset the entry is NOT booked and a typed error / `unrated`
 * list names the missing feed.
 *
 * Rate fidelity: `ingestBooks` runs right after every org transfer and on each
 * read / job tick, so lag is normally seconds; the lag is stored per row
 * (`rate_lag_seconds`) and surfaced in exports so late-ingested rows are visible.
 */
import { and, asc, desc, eq, gte, inArray, lte, sql } from 'drizzle-orm'
import { Context, Effect, Layer } from 'effect'
import {
	type DrizzleService,
	bankAccounts,
	bankLedgerEntries,
	bankOrgBooks,
	bankOrgCategories,
	bankOrgs,
	bankTransfers,
} from '../../db'
import { fetchTokenPrices } from '../../lib/prices'
import { findAsset, fromMinor, listAssets } from './assets'
import { type Actor, authorize, nid, writeAudit } from './BankOrgService'
import { convertMinor, currencyDecimals, rateToString } from './bankOrgPure'
import { type BankOwner, bankDb } from './db'
import { type BankError, bankErr } from './errors'

type Fx<A> = Effect.Effect<A, BankError, DrizzleService>

export interface ResolvedRate {
	/** Reporting-currency units per 1 whole asset unit. */
	rate: string
	source: string
	at: Date
}

/** Market rate for `symbol` in `reportingCurrency`, from the repo price service. */
export const resolveRate = (symbol: string, reportingCurrency: string): Effect.Effect<ResolvedRate, BankError> =>
	Effect.gen(function* () {
		const cur = reportingCurrency.toUpperCase()
		const refSymbol = cur === 'USD' ? null : listAssets({ currency: cur })[0]?.symbol ?? null
		if (cur !== 'USD' && !refSymbol)
			return yield* Effect.fail(bankErr('NOT_CONFIGURED', `No reference asset to price ${cur}`, { missing: `USD/${cur} rate source` }))
		const wanted = refSymbol ? [symbol, refSymbol] : [symbol]
		const prices = yield* Effect.tryPromise({
			try: () => fetchTokenPrices(wanted),
			catch: (e) => bankErr('UPSTREAM', `Price service failed: ${String(e)}`),
		})
		const px = prices[symbol.toUpperCase()]?.usd
		if (!px || !(px > 0))
			return yield* Effect.fail(bankErr('NOT_CONFIGURED', `No USD price available for ${symbol}`, { missing: `price feed for ${symbol} (lib/prices.ts COINGECKO_IDS)` }))
		let usdPerUnitOfReporting = 1
		if (refSymbol) {
			const refPx = prices[refSymbol.toUpperCase()]?.usd
			if (!refPx || !(refPx > 0))
				return yield* Effect.fail(bankErr('NOT_CONFIGURED', `No USD price available for ${refSymbol} (needed to express ${cur})`, { missing: `price feed for ${refSymbol} (lib/prices.ts COINGECKO_IDS)` }))
			usdPerUnitOfReporting = refPx
		}
		return { rate: rateToString(px / usdPerUnitOfReporting), source: `prices.ts:usd${refSymbol ? `/${refSymbol}` : ''}`, at: new Date() }
	})

/** Value of `amountMinor` of an account asset in reporting minor units, with the rate used. */
export const valueInReporting = (symbol: string, chain: string, amountMinor: bigint, reportingCurrency: string) =>
	Effect.gen(function* () {
		const asset = findAsset(symbol, chain)
		if (!asset) return yield* Effect.fail(bankErr('ASSET_UNSUPPORTED', `Unsupported asset ${symbol} on ${chain}`))
		const r = yield* resolveRate(symbol, reportingCurrency)
		return { reportingMinor: convertMinor(amountMinor, asset.decimals, r.rate, currencyDecimals(reportingCurrency)), rate: r }
	})

const csvCell = (v: unknown, text = false): string => {
	let s = v === null || v === undefined ? '' : String(v)
	// CSV-injection guard for free text only.
	if (text && /^[=+\-@\t\r]/.test(s)) s = `'${s}`
	return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

const fmt = (minor: bigint, dec: number): string => fromMinor(minor, dec)

/** Book every not-yet-booked ledger entry on the org's accounts. Idempotent. */
export const ingestBooks = (orgIdValue: string, limit = 500): Fx<{ ingested: number; unrated: Array<{ asset: string; reason: string; missing?: string | undefined }> }> =>
	Effect.gen(function* () {
		const org = yield* bankDb(async (db) => (await db.select().from(bankOrgs).where(eq(bankOrgs.id, orgIdValue)).limit(1))[0])
		if (!org) return yield* Effect.fail(bankErr('NOT_FOUND', 'Organisation not found'))
		const accts = yield* bankDb((db) => db.select({ id: bankAccounts.id }).from(bankAccounts).where(and(eq(bankAccounts.ownerType, 'org'), eq(bankAccounts.ownerId, orgIdValue))))
		if (accts.length === 0) return { ingested: 0, unrated: [] }
		const ids = accts.map((a) => a.id)
		const idSet = new Set(ids)
		const entries = yield* bankDb((db) =>
			db
				.select()
				.from(bankLedgerEntries)
				.where(and(inArray(bankLedgerEntries.accountId, ids), sql`not exists (select 1 from bank_org_books b where b.ledger_entry_id = ${bankLedgerEntries.id})`))
				.orderBy(asc(bankLedgerEntries.createdAt))
				.limit(limit),
		)
		if (entries.length === 0) return { ingested: 0, unrated: [] }
		const transfers = yield* bankDb((db) => db.select().from(bankTransfers).where(inArray(bankTransfers.id, [...new Set(entries.map((e) => e.transferId))])))
		const tById = new Map(transfers.map((t) => [t.id, t]))
		const rates = new Map<string, ResolvedRate | { error: BankError }>()
		const unrated = new Map<string, { asset: string; reason: string; missing?: string | undefined }>()
		const rows: Array<typeof bankOrgBooks.$inferInsert> = []
		const dec = currencyDecimals(org.reportingCurrency)
		for (const e of entries) {
			let r = rates.get(e.asset)
			if (!r) {
				const got = yield* resolveRate(e.asset, org.reportingCurrency).pipe(Effect.either)
				r = got._tag === 'Right' ? got.right : { error: got.left }
				rates.set(e.asset, r)
				if ('error' in r) unrated.set(e.asset, { asset: e.asset, reason: r.error.message, missing: r.error.missing })
			}
			if ('error' in r) continue
			const t = tById.get(e.transferId)
			const asset = [...listAssets()].find((a) => a.symbol === e.asset)
			if (!asset) continue
			const internal = !!t && !!t.fromAccount && !!t.toAccount && idSet.has(t.fromAccount) && idSet.has(t.toAccount)
			const md = (t?.metadata ?? {}) as Record<string, unknown>
			const cat = typeof md.categoryId === 'string' ? md.categoryId : null
			rows.push({
				id: nid('bk'),
				orgId: orgIdValue,
				ledgerEntryId: e.id,
				transferId: e.transferId,
				accountId: e.accountId,
				direction: e.direction,
				scope: internal ? 'internal' : 'external',
				amountMinor: e.amountMinor,
				asset: e.asset,
				reportingCurrency: org.reportingCurrency,
				rate: r.rate,
				rateSource: r.source,
				rateAt: r.at,
				reportingMinor: convertMinor(BigInt(e.amountMinor), asset.decimals, r.rate, dec).toString(),
				categoryId: cat,
				memo: t?.memo ?? null,
				occurredAt: e.createdAt,
				rateLagSeconds: Math.max(0, Math.round((r.at.getTime() - e.createdAt.getTime()) / 1000)),
			})
		}
		if (rows.length) yield* bankDb((db) => db.insert(bankOrgBooks).values(rows).onConflictDoNothing({ target: bankOrgBooks.ledgerEntryId }))
		return { ingested: rows.length, unrated: [...unrated.values()] }
	})

const impl = {
	ingestBooks,

	listCategories: (owner: BankOwner, orgIdValue: string) =>
		Effect.gen(function* () {
			yield* authorize(owner, orgIdValue, 'books.view')
			return { categories: yield* bankDb((db) => db.select().from(bankOrgCategories).where(eq(bankOrgCategories.orgId, orgIdValue)).orderBy(asc(bankOrgCategories.code))) }
		}),

	createCategory: (owner: BankOwner, orgIdValue: string, i: { code: string; name: string; kind: 'income' | 'expense' | 'transfer' | 'asset' | 'liability' | 'equity' }) =>
		Effect.gen(function* () {
			const c = yield* authorize(owner, orgIdValue, 'books.categorize')
			const row = yield* bankDb(async (db) => {
				const r = await db.insert(bankOrgCategories).values({ id: nid('cat'), orgId: orgIdValue, ...i }).onConflictDoNothing().returning()
				if (!r[0]) throw bankErr('CONFLICT', `Category code ${i.code} already exists`)
				return r[0]
			})
			yield* writeAudit({ orgId: orgIdValue, actor: c.actor, action: 'category.create', targetType: 'category', targetId: row.id, detail: i })
			return { category: row }
		}),

	listEntries: (owner: BankOwner, orgIdValue: string, q: { from?: Date | undefined; to?: Date | undefined; categoryId?: string | undefined; limit: number }) =>
		Effect.gen(function* () {
			yield* authorize(owner, orgIdValue, 'books.view')
			const ing = yield* ingestBooks(orgIdValue)
			const conds = [eq(bankOrgBooks.orgId, orgIdValue)]
			if (q.from) conds.push(gte(bankOrgBooks.occurredAt, q.from))
			if (q.to) conds.push(lte(bankOrgBooks.occurredAt, q.to))
			if (q.categoryId) conds.push(eq(bankOrgBooks.categoryId, q.categoryId))
			const entries = yield* bankDb((db) => db.select().from(bankOrgBooks).where(and(...conds)).orderBy(desc(bankOrgBooks.occurredAt)).limit(Math.min(q.limit, 1000)))
			return { entries, unrated: ing.unrated }
		}),

	/** Set the chart-of-accounts category of one entry. Refused for closed periods. */
	categorize: (owner: BankOwner, orgIdValue: string, entryId: string, categoryId: string | null) =>
		Effect.gen(function* () {
			const c = yield* authorize(owner, orgIdValue, 'books.categorize')
			const entry = yield* bankDb(async (db) => (await db.select().from(bankOrgBooks).where(and(eq(bankOrgBooks.id, entryId), eq(bankOrgBooks.orgId, orgIdValue))).limit(1))[0])
			if (!entry) return yield* Effect.fail(bankErr('NOT_FOUND', 'Books entry not found'))
			if (c.org.closedThrough && entry.occurredAt.getTime() <= c.org.closedThrough.getTime())
				return yield* Effect.fail(bankErr('CONFLICT', `Period closed through ${c.org.closedThrough.toISOString()}: entry is locked`))
			if (categoryId) {
				const cat = yield* bankDb((db) => db.select({ id: bankOrgCategories.id }).from(bankOrgCategories).where(and(eq(bankOrgCategories.id, categoryId), eq(bankOrgCategories.orgId, orgIdValue))).limit(1))
				if (!cat.length) return yield* Effect.fail(bankErr('NOT_FOUND', 'Category not found in this organisation'))
			}
			// Re-assert the lock in the UPDATE itself (close may race with this call).
			const closed = sql`(select closed_through from bank_orgs where id = ${orgIdValue}) is not null and ${bankOrgBooks.occurredAt} <= (select closed_through from bank_orgs where id = ${orgIdValue})`
			const r = yield* bankDb((db) =>
				db.update(bankOrgBooks).set({ categoryId }).where(and(eq(bankOrgBooks.id, entryId), eq(bankOrgBooks.orgId, orgIdValue), sql`not (${closed})`)).returning(),
			)
			if (!r[0]) return yield* Effect.fail(bankErr('CONFLICT', 'Period closed: entry is locked'))
			yield* writeAudit({ orgId: orgIdValue, actor: c.actor, action: 'books.categorize', targetType: 'books_entry', targetId: entryId, detail: { from: entry.categoryId, to: categoryId } })
			return { entry: r[0] }
		}),

	/** Close the books through `through` (forward-only). Ingests first so everything up to the cut-off carries a rate. */
	closePeriod: (owner: BankOwner, orgIdValue: string, through: Date) =>
		Effect.gen(function* () {
			const c = yield* authorize(owner, orgIdValue, 'books.close')
			if (through.getTime() > Date.now()) return yield* Effect.fail(bankErr('VALIDATION', 'Cannot close a period in the future'))
			if (c.org.closedThrough && through.getTime() <= c.org.closedThrough.getTime())
				return yield* Effect.fail(bankErr('CONFLICT', `Already closed through ${c.org.closedThrough.toISOString()} (periods cannot be reopened)`))
			const ing = yield* ingestBooks(orgIdValue, 5000)
			if (ing.unrated.length)
				return yield* Effect.fail(bankErr('NOT_CONFIGURED', `Cannot close: unrated assets ${ing.unrated.map((u) => u.asset).join(', ')}`, { missing: ing.unrated.map((u) => u.missing).filter(Boolean).join('; ') || 'price feed' }))
			const r = yield* bankDb((db) =>
				db
					.update(bankOrgs)
					.set({ closedThrough: through, updatedAt: new Date() })
					.where(and(eq(bankOrgs.id, orgIdValue), sql`(closed_through is null or closed_through < ${through})`))
					.returning(),
			)
			if (!r[0]) return yield* Effect.fail(bankErr('CONFLICT', 'Concurrent close detected'))
			yield* writeAudit({ orgId: orgIdValue, actor: c.actor, action: 'books.close', targetType: 'org', targetId: orgIdValue, detail: { through: through.toISOString() } })
			return { closedThrough: through.toISOString() }
		}),

	exportCsv: (owner: BankOwner, orgIdValue: string, q: { from?: Date | undefined; to?: Date | undefined }) =>
		Effect.gen(function* () {
			const c = yield* authorize(owner, orgIdValue, 'books.export')
			const ing = yield* ingestBooks(orgIdValue, 5000)
			const { rows, cats, accts } = yield* loadRange(orgIdValue, q)
			const dec = currencyDecimals(c.org.reportingCurrency)
			const head = ['date', 'entry_id', 'transfer_id', 'account', 'direction', 'scope', 'asset', 'amount', 'rate', 'rate_source', 'rate_at', 'rate_lag_s', 'reporting_currency', 'reporting_amount', 'category_code', 'category', 'memo']
			const lines = [head.join(',')]
			for (const b of rows) {
				const cat = b.categoryId ? cats.get(b.categoryId) : undefined
				const a = findAssetBySymbol(b.asset)
				lines.push(
					[
						b.occurredAt.toISOString(),
						b.id,
						b.transferId,
						csvCell(accts.get(b.accountId) ?? b.accountId, true),
						b.direction,
						b.scope,
						b.asset,
						a ? fmt(BigInt(b.amountMinor), a.decimals) : b.amountMinor,
						b.rate,
						b.rateSource,
						b.rateAt.toISOString(),
						b.rateLagSeconds,
						b.reportingCurrency,
						fmt(BigInt(b.reportingMinor), dec),
						cat?.code ?? '',
						csvCell(cat?.name ?? '', true),
						csvCell(b.memo ?? '', true),
					].join(','),
				)
			}
			yield* writeAudit({ orgId: orgIdValue, actor: c.actor, action: 'books.export', detail: { format: 'csv', rows: rows.length } })
			return { filename: `books-${orgIdValue}.csv`, contentType: 'text/csv', rows: rows.length, unrated: ing.unrated, csv: lines.join('\n') + '\n' }
		}),

	/** Balanced double-entry journal (reporting currency) for accounting import. */
	exportJournal: (owner: BankOwner, orgIdValue: string, q: { from?: Date | undefined; to?: Date | undefined }) =>
		Effect.gen(function* () {
			const c = yield* authorize(owner, orgIdValue, 'books.export')
			const ing = yield* ingestBooks(orgIdValue, 5000)
			const { rows, cats, accts } = yield* loadRange(orgIdValue, q)
			const dec = currencyDecimals(c.org.reportingCurrency)
			const byCode = new Map([...cats.values()].map((x) => [x.code, x]))
			const line = (code: string, minor: bigint, side: 'debit' | 'credit', account?: string) => ({
				account: code,
				accountName: byCode.get(code)?.name ?? code,
				subledger: account ?? null,
				debit: side === 'debit' ? fmt(minor, dec) : '0',
				credit: side === 'credit' ? fmt(minor, dec) : '0',
			})
			const entries = rows.map((b) => {
				const m = BigInt(b.reportingMinor)
				const cat = b.categoryId ? cats.get(b.categoryId) : undefined
				const acct = accts.get(b.accountId) ?? b.accountId
				let lines: ReturnType<typeof line>[]
				if (b.scope === 'internal') {
					lines = b.direction === 'debit' ? [line('1090', m, 'debit'), line('1000', m, 'credit', acct)] : [line('1000', m, 'debit', acct), line('1090', m, 'credit')]
				} else if (b.direction === 'debit') {
					lines = [line(cat?.code ?? '6900', m, 'debit'), line('1000', m, 'credit', acct)]
				} else {
					lines = [line('1000', m, 'debit', acct), line(cat?.code ?? '4900', m, 'credit')]
				}
				const original = findAssetBySymbol(b.asset)
				return {
					id: b.id,
					date: b.occurredAt.toISOString(),
					memo: b.memo,
					currency: b.reportingCurrency,
					lines,
					meta: {
						transferId: b.transferId,
						asset: b.asset,
						originalAmount: original ? fmt(BigInt(b.amountMinor), original.decimals) : b.amountMinor,
						rate: b.rate,
						rateSource: b.rateSource,
						rateAt: b.rateAt.toISOString(),
						rateLagSeconds: b.rateLagSeconds,
					},
				}
			})
			const debit = rows.reduce((s, b) => s + BigInt(b.reportingMinor), 0n)
			yield* writeAudit({ orgId: orgIdValue, actor: c.actor, action: 'books.export', detail: { format: 'journal', entries: entries.length } })
			return {
				journal: {
					orgId: orgIdValue,
					currency: c.org.reportingCurrency,
					closedThrough: c.org.closedThrough?.toISOString() ?? null,
					chart: [...cats.values()].map((x) => ({ code: x.code, name: x.name, kind: x.kind })),
					entries,
					// Every entry is balanced by construction (one debit line == one credit line).
					totals: { debit: fmt(debit, dec), credit: fmt(debit, dec) },
				},
				unrated: ing.unrated,
			}
		}),
}

const findAssetBySymbol = (symbol: string) => listAssets().find((a) => a.symbol === symbol)

const loadRange = (orgIdValue: string, q: { from?: Date | undefined; to?: Date | undefined }) =>
	Effect.gen(function* () {
		const conds = [eq(bankOrgBooks.orgId, orgIdValue)]
		if (q.from) conds.push(gte(bankOrgBooks.occurredAt, q.from))
		if (q.to) conds.push(lte(bankOrgBooks.occurredAt, q.to))
		const rows = yield* bankDb((db) => db.select().from(bankOrgBooks).where(and(...conds)).orderBy(asc(bankOrgBooks.occurredAt)).limit(50_000))
		const catRows = yield* bankDb((db) => db.select().from(bankOrgCategories).where(eq(bankOrgCategories.orgId, orgIdValue)))
		const acctRows = yield* bankDb((db) => db.select({ id: bankAccounts.id, label: bankAccounts.label, asset: bankAccounts.asset, chain: bankAccounts.chain }).from(bankAccounts).where(and(eq(bankAccounts.ownerType, 'org'), eq(bankAccounts.ownerId, orgIdValue))))
		return {
			rows,
			cats: new Map(catRows.map((x) => [x.id, x])),
			accts: new Map(acctRows.map((a) => [a.id, `${a.label ?? a.asset}:${a.chain}:${a.id}`])),
		}
	})

export class BankBooksService extends Context.Tag('BankBooksService')<BankBooksService, typeof impl>() {}
export const BankBooksServiceLive = Layer.succeed(BankBooksService, impl)
export type { Actor }
