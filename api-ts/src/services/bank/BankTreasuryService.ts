/**
 * BankTreasuryService — consolidated org balances, target-allocation policy
 * (operating floor + sweep to an earn vault), runway and FX exposure.
 * Every figure is valued in the org's reporting currency through the same rate
 * path as the books (BankBooksService.valueInReporting); an asset without a price
 * produces a typed NOT_CONFIGURED error naming the missing feed — never a guess.
 */
import { eq, sql } from 'drizzle-orm'
import { Context, Effect, Layer, Option } from 'effect'
import type { EnvService } from '../../config/EnvService'
import { type DrizzleService, bankTreasuryPolicies } from '../../db'
import { BankEarnService } from './BankEarnService'
import { ingestBooks, valueInReporting } from './BankBooksService'
import { BankLedgerService, type ReconcileReport } from './BankLedgerService'
import { type OrgCtx, authorize, nid, writeAudit } from './BankOrgService'
import { type BankDeps, type BankTransferService } from './BankTransferService'
import { findAsset, fromMinor } from './assets'
import { currencyDecimals, fxExposure, runway, sweepAmount } from './bankOrgPure'
import { type BankOwner, bankDb } from './db'
import { type BankError, bankErr } from './errors'
import { assertSpendable } from './systemDebit'

type LedgerDeps = DrizzleService | BankLedgerService

export interface Holding {
	accountId: string
	label: string | null
	chain: string
	asset: string
	currency: string
	balanceMinor: string
	balance: string
	reportingMinor: string | null
	rate: string | null
	rateSource: string | null
	reconcile?: ReconcileReport | { error: string }
}

const orgOwner = (orgId: string): BankOwner => ({ ownerType: 'org', ownerId: orgId })

const loadHoldings = (c: OrgCtx, opts: { reconcile: boolean }): Effect.Effect<{ holdings: Holding[]; unrated: Array<{ asset: string; reason: string; missing?: string | undefined }> }, BankError, LedgerDeps> =>
	Effect.gen(function* () {
		const ledger = yield* BankLedgerService
		const owner = orgOwner(c.org.id)
		const accounts = (yield* ledger.getAccounts(owner)).filter((a) => a.status !== 'closed')
		const holdings: Holding[] = []
		const unrated = new Map<string, { asset: string; reason: string; missing?: string | undefined }>()
		for (const a of accounts) {
			const asset = findAsset(a.asset, a.chain)
			if (!asset) continue
			const bal = yield* ledger.balance(a.id)
			const v = yield* valueInReporting(a.asset, a.chain, bal, c.org.reportingCurrency).pipe(Effect.either)
			if (v._tag === 'Left') unrated.set(a.asset, { asset: a.asset, reason: v.left.message, missing: v.left.missing })
			const h: Holding = {
				accountId: a.id,
				label: a.label,
				chain: a.chain,
				asset: a.asset,
				currency: asset.currency,
				balanceMinor: bal.toString(),
				balance: fromMinor(bal, asset.decimals),
				reportingMinor: v._tag === 'Right' ? v.right.reportingMinor.toString() : null,
				rate: v._tag === 'Right' ? v.right.rate.rate : null,
				rateSource: v._tag === 'Right' ? v.right.rate.source : null,
			}
			if (opts.reconcile) {
				const r = yield* ledger.reconcile(owner, a.id).pipe(Effect.either)
				h.reconcile = r._tag === 'Right' ? r.right : { error: r.left.message }
			}
			holdings.push(h)
		}
		return { holdings, unrated: [...unrated.values()] }
	})

const requireAllRated = (r: { unrated: Array<{ asset: string; reason: string; missing?: string | undefined }> }): Effect.Effect<void, BankError> =>
	r.unrated.length
		? Effect.fail(bankErr('NOT_CONFIGURED', `Cannot value ${r.unrated.map((u) => u.asset).join(', ')} in the reporting currency`, { missing: r.unrated.map((u) => u.missing ?? u.asset).join('; ') }))
		: Effect.void

const sumReporting = (hs: Holding[]): bigint => hs.reduce((s, h) => s + BigInt(h.reportingMinor ?? '0'), 0n)

const sweepPlanFor = (c: OrgCtx) =>
	Effect.gen(function* () {
		const ledger = yield* BankLedgerService
		const policies = yield* bankDb((db) => db.select().from(bankTreasuryPolicies).where(eq(bankTreasuryPolicies.orgId, c.org.id)))
		const lines = []
		for (const p of policies) {
			const acct = yield* ledger.getAccount(orgOwner(c.org.id), p.accountId)
			{ const sysErr = assertSpendable(acct); if (sysErr) return yield* Effect.fail(sysErr) } // MONEY-PATH: system-kind accounts are never user-spendable
			const bal = yield* ledger.balance(acct.id)
			const amt = sweepAmount(bal, BigInt(p.floorMinor), BigInt(p.minSweepMinor))
			lines.push({
				accountId: acct.id,
				asset: acct.asset,
				chain: acct.chain,
				balanceMinor: bal.toString(),
				floorMinor: p.floorMinor,
				sweepEnabled: p.sweepEnabled === 1,
				vault: p.sweepVaultId,
				sweepMinor: p.sweepEnabled === 1 && p.sweepVaultId ? amt.toString() : '0',
			})
		}
		return lines
	})

const impl = {
	/** Consolidated balances across accounts / chains / currencies; `reconcile` compares each wallet on-chain. */
	consolidated: (owner: BankOwner, orgId: string, opts: { reconcile: boolean }): Effect.Effect<unknown, BankError, LedgerDeps | EnvService> =>
		Effect.gen(function* () {
			const c = yield* authorize(owner, orgId, 'treasury.view')
			const { holdings, unrated } = yield* loadHoldings(c, opts)
			const group = (key: (h: Holding) => string) => {
				const m = new Map<string, bigint>()
				for (const h of holdings) m.set(key(h), (m.get(key(h)) ?? 0n) + BigInt(h.reportingMinor ?? '0'))
				return [...m.entries()].map(([k, v]) => ({ key: k, reportingMinor: v.toString() }))
			}
			return {
				reportingCurrency: c.org.reportingCurrency,
				reportingDecimals: currencyDecimals(c.org.reportingCurrency),
				totalReportingMinor: sumReporting(holdings).toString(),
				holdings,
				byCurrency: group((h) => h.currency),
				byChain: group((h) => h.chain),
				unrated,
			}
		}),

	setPolicy: (
		owner: BankOwner,
		orgId: string,
		i: { accountId: string; floorMinor: string; sweepEnabled: boolean; sweepVaultId?: string | undefined; minSweepMinor: string },
	): Effect.Effect<unknown, BankError, LedgerDeps> =>
		Effect.gen(function* () {
			const c = yield* authorize(owner, orgId, 'treasury.manage')
			if (i.sweepEnabled && !i.sweepVaultId) return yield* Effect.fail(bankErr('VALIDATION', 'sweepVaultId is required when sweepEnabled'))
			const ledger = yield* BankLedgerService
			yield* ledger.getAccount(orgOwner(orgId), i.accountId) // must be this org's account
			const vals = { floorMinor: i.floorMinor, sweepEnabled: i.sweepEnabled ? 1 : 0, sweepVaultId: i.sweepVaultId ?? null, minSweepMinor: i.minSweepMinor, updatedBy: c.actor.userId, updatedAt: new Date() }
			const row = yield* bankDb(async (db) => {
				const [r] = await db
					.insert(bankTreasuryPolicies)
					.values({ id: nid('tpl'), orgId, accountId: i.accountId, ...vals })
					.onConflictDoUpdate({ target: [bankTreasuryPolicies.orgId, bankTreasuryPolicies.accountId], set: vals })
					.returning()
				return r!
			})
			yield* writeAudit({ orgId, actor: c.actor, action: 'treasury.policy.set', targetType: 'account', targetId: i.accountId, detail: { floorMinor: i.floorMinor, sweepEnabled: i.sweepEnabled, vault: i.sweepVaultId ?? null } })
			return { policy: row }
		}),

	listPolicies: (owner: BankOwner, orgId: string) =>
		Effect.gen(function* () {
			yield* authorize(owner, orgId, 'treasury.view')
			return { policies: yield* bankDb((db) => db.select().from(bankTreasuryPolicies).where(eq(bankTreasuryPolicies.orgId, orgId))) }
		}),

	sweepPlan: (owner: BankOwner, orgId: string): Effect.Effect<unknown, BankError, LedgerDeps> =>
		Effect.gen(function* () {
			const c = yield* authorize(owner, orgId, 'treasury.view')
			return { plan: yield* sweepPlanFor(c) }
		}),

	/** MONEY-PATH. Moves excess above each account's floor into its earn vault via BankEarnService. */
	executeSweep: (owner: BankOwner, orgId: string, idempotencyKey: string): Effect.Effect<unknown, BankError, BankDeps | BankTransferService | EnvService> =>
		Effect.gen(function* () {
			const c = yield* authorize(owner, orgId, 'treasury.manage')
			const earnOpt = yield* Effect.serviceOption(BankEarnService)
			if (Option.isNone(earnOpt))
				return yield* Effect.fail(bankErr('NOT_CONFIGURED', 'Earn vault sweeps need the Earn module in the service layer', { missing: 'BankEarnService (earn module)' }))
			const earn = earnOpt.value
			const plan = (yield* sweepPlanFor(c)).filter((l) => BigInt(l.sweepMinor) > 0n && l.vault)
			const results = []
			for (const l of plan) {
				const r = yield* earn
					.deposit({ owner: orgOwner(orgId), idempotencyKey: `${idempotencyKey}:${l.accountId}`, accountId: l.accountId, vault: l.vault!, amountMinor: l.sweepMinor, source: 'sweep' })
					.pipe(Effect.either)
				results.push(r._tag === 'Right' ? { accountId: l.accountId, ok: true, amountMinor: l.sweepMinor, op: r.right } : { accountId: l.accountId, ok: false, error: r.left.message, code: r.left.code })
			}
			yield* writeAudit({ orgId, actor: c.actor, action: 'treasury.sweep', detail: { lines: results.length, ok: results.filter((x) => x.ok).length } })
			return { swept: results }
		}),

	/** Runway from trailing 30/90-day REAL net outflow (booked external movements, reporting currency). */
	runway: (owner: BankOwner, orgId: string): Effect.Effect<unknown, BankError, LedgerDeps | EnvService> =>
		Effect.gen(function* () {
			const c = yield* authorize(owner, orgId, 'treasury.view')
			yield* ingestBooks(orgId, 5000)
			const h = yield* loadHoldings(c, { reconcile: false })
			yield* requireAllRated(h)
			const net = (days: number) =>
				bankDb(async (db) => {
					const r = await db.execute(
						sql`select coalesce(sum(case when direction = 'debit' then reporting_minor else -reporting_minor end), 0)::text as s from bank_org_books where org_id = ${orgId} and scope = 'external' and occurred_at >= now() - (${days} * interval '1 day')`,
					)
					return BigInt((r as unknown as Array<{ s: string }>)[0]?.s ?? '0')
				})
			const n30 = yield* net(30)
			const n90 = yield* net(90)
			return { reportingCurrency: c.org.reportingCurrency, ...runway(sumReporting(h.holdings), n30, n90), basis: 'booked external ledger movements (outflows minus inflows/reversals), internal transfers excluded' }
		}),

	fxExposure: (owner: BankOwner, orgId: string): Effect.Effect<unknown, BankError, LedgerDeps | EnvService> =>
		Effect.gen(function* () {
			const c = yield* authorize(owner, orgId, 'treasury.view')
			const h = yield* loadHoldings(c, { reconcile: false })
			yield* requireAllRated(h)
			return fxExposure(h.holdings.map((x) => ({ currency: x.currency, asset: x.asset, reportingMinor: BigInt(x.reportingMinor ?? '0') })), c.org.reportingCurrency)
		}),
}

export class BankTreasuryService extends Context.Tag('BankTreasuryService')<BankTreasuryService, typeof impl>() {}
export const BankTreasuryServiceLive = Layer.succeed(BankTreasuryService, impl)
