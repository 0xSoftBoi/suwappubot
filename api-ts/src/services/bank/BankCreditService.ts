/**
 * BankCreditService (M3) — MONEY-PATH.
 *
 * kind 'collateralized'   : Morpho Blue market position held by the custody wallet
 *                           (supplyCollateral / borrow / repay / withdrawCollateral). Source of truth = onchain position + oracle.
 * kind 'undercollateralized' / 'receivable': funded by a lender pool account (bank_accounts.kind='pool').
 *                           Never fakes capital: no balance => LENDER_POOL_UNFUNDED. Interest accrues in integer math
 *                           (simple interest, floor): principal * aprBps * seconds / (10_000 * 31_536_000).
 * Idempotency: lines have deterministic ids; draws/repays are keyed on a bank_transfers idempotency key and applied
 * to the line at most once (line.metadata.applied).
 */
import { and, desc, eq, inArray, sql } from 'drizzle-orm'
import { Context, Effect, Layer } from 'effect'
import {
	type BankAccount,
	type BankCreditEvent,
	type BankCreditLine,
	type BankCreditScore,
	bankAccounts,
	bankCreditEvents,
	bankCreditLines,
	bankCreditScores,
	bankEarnPositions,
	bankTransfers,
} from '../../db'
import { logger } from '../../lib/logger'
import { findAsset } from './assets'
import { BankLedgerService } from './BankLedgerService'
import { BankTransferService, type BankDeps } from './BankTransferService'
import { type BankOwner, bankDb, newId } from './db'
import {
	MORPHO_API,
	MORPHO_BLUE,
	type HealthMetrics,
	type MarketParams,
	blueAbi,
	call,
	computeHealth,
	erc20Abi,
	hashOf,
	liquidationPriceHuman,
	loadBluePosition,
	loadMarketParams,
	mpTuple,
	oracleAbi,
	readContract,
	waitReceipt,
} from './earnCreditChain'
import { BankError, bankErr } from './errors'

type Fx<A> = Effect.Effect<A, BankError, BankDeps | BankTransferService>

/** Draws/withdrawals keep LTV <= 90% of the market LLTV (10% safety buffer to liquidation). */
export const MAX_DRAW_LTV_OF_LLTV_BPS = 9000
export const WARN_LTV_OF_LLTV_BPS = 8500
export const CRITICAL_LTV_OF_LLTV_BPS = 9300
const YEAR_SECONDS = 31_536_000n
const UNSECURED_CAP_UNITS = 5_000n // whole units of the loan asset
const RECEIVABLE_ADVANCE_BPS = 8000
const RECEIVABLE_APR_BPS = 1200

export interface CreditMarket {
	marketId: string
	chain: string
	loanAsset: { address: string; symbol: string; decimals: number }
	collateralAsset: { address: string; symbol: string; decimals: number }
	lltvBps: number
	oracle: string
	irm: string
	borrowApy: number
	supplyApy: number
	liquidityUsd: number | null
	utilizationPct: number
}

export interface LineView {
	line: BankCreditLine
	health: (HealthMetrics & { liquidationPriceHuman: string | null; level: Level }) | null
	owed: { principalMinor: string; accruedInterestMinor: string; totalMinor: string } | null
}

type Level = 'ok' | 'warn' | 'critical'

export interface PoolOpResult {
	line: BankCreditLine
	transferId: string
	transferStatus: string
	appliedNow: boolean
}

export interface BankCreditServiceInterface {
	readonly listMarkets: (o: BankOwner, q: { chain: string; loanAsset: string; collateral?: string | undefined }) => Fx<{ markets: CreditMarket[] }>
	readonly openLine: (i: OpenLineInput) => Fx<LineView>
	readonly draw: (i: DrawInput) => Fx<{ line: LineView; transferId: string | null; txHash: string | null; status: string }>
	readonly repay: (i: RepayInput) => Fx<{ line: LineView; transferId: string | null; txHash: string | null; status: string }>
	readonly withdrawCollateral: (i: WithdrawCollateralInput) => Fx<{ line: LineView; txHash: string }>
	readonly listLines: (o: BankOwner) => Fx<{ lines: LineView[] }>
	readonly getLine: (o: BankOwner, lineId: string) => Fx<LineView>
	readonly events: (o: BankOwner, q: { lineId?: string | undefined; since?: string | undefined; limit?: number | undefined }) => Fx<{ events: BankCreditEvent[] }>
	readonly score: (o: BankOwner, q: { asset: string; chain: string }) => Fx<{ score: BankCreditScore }>
	readonly openUnsecuredLine: (i: { owner: BankOwner; idempotencyKey: string; accountId: string }) => Fx<LineView>
	readonly financeReceivable: (i: { owner: BankOwner; idempotencyKey: string; accountId: string; invoiceId: string }) => Fx<{ line: LineView; advanceMinor: string }>
	/** Called by M7 when an invoice is paid: collects principal+interest from the line's account. */
	readonly settleReceivable: (invoiceId: string, amountMinor: string, paymentRef?: string) => Fx<{ settled: Array<{ lineId: string; collectedMinor: string; remainingOwedMinor: string }> }>
	readonly runLtvMonitor: () => Fx<{ checked: number; events: number }>
	readonly settlePendingPoolOps: () => Fx<{ checked: number; applied: number }>
}

export interface OpenLineInput {
	owner: BankOwner
	idempotencyKey: string
	/** Bank account that receives draws / pays repayments (loan asset, EVM). */
	accountId: string
	marketId: string
	collateral: { amountMinor: string; source: 'wallet' | 'vault_shares'; savingsAccountId?: string | undefined }
}
export interface DrawInput { owner: BankOwner; idempotencyKey: string; lineId: string; amountMinor: string }
export interface RepayInput { owner: BankOwner; idempotencyKey: string; lineId: string; amountMinor?: string | undefined; all?: boolean | undefined }
export interface WithdrawCollateralInput { owner: BankOwner; idempotencyKey: string; lineId: string; amountMinor?: string | undefined; all?: boolean | undefined }

export class BankCreditService extends Context.Tag('BankCreditService')<BankCreditService, BankCreditServiceInterface>() {}

// ------------------------------------------------------------------ helpers

const lc = (s: string) => s.toLowerCase()
const MINOR_RE = /^[1-9][0-9]{0,77}$/
const up = <A>(f: () => Promise<A>, what: string): Effect.Effect<A, BankError> =>
	Effect.tryPromise({
		try: f,
		catch: (e) => (e instanceof BankError ? e : bankErr('UPSTREAM', `${what}: ${e instanceof Error ? e.message : String(e)}`, { cause: e })),
	})

const lineIdFor = (owner: BankOwner, key: string) => `cl_${hashOf(owner.ownerType, owner.ownerId, key).slice(0, 32)}`

async function morphoMarkets(chainId: number, chain: string, loanAddr: string, collateralAddr?: string): Promise<CreditMarket[]> {
	const res = await fetch(MORPHO_API, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({
			query: `query M($c:[Int!]!, $l:[String!]!, $k:[String!]) { markets(first: 50, where:{ chainId_in:$c, loanAssetAddress_in:$l, collateralAssetAddress_in:$k, listed:true }, orderBy: SupplyAssetsUsd, orderDirection: Desc) { items { marketId lltv oracle{address} irmAddress loanAsset{address symbol decimals} collateralAsset{address symbol decimals} state{ borrowApy supplyApy liquidityAssetsUsd utilization } } } }`,
			variables: { c: [chainId], l: [loanAddr], k: collateralAddr ? [collateralAddr] : null },
		}),
	})
	if (!res.ok) throw new Error(`Morpho API ${res.status}`)
	const j = (await res.json()) as { data?: { markets: { items: Array<Record<string, any>> } }; errors?: Array<{ message?: string }> }
	if (j.errors?.length) throw new Error(`Morpho API: ${j.errors.map((e) => e.message).join('; ')}`)
	return (j.data?.markets.items ?? [])
		.filter((m) => m.collateralAsset && m.oracle)
		.map((m) => ({
			marketId: m.marketId,
			chain,
			loanAsset: m.loanAsset,
			collateralAsset: m.collateralAsset,
			lltvBps: Number((BigInt(m.lltv) * 10_000n) / 10n ** 18n),
			oracle: m.oracle.address,
			irm: m.irmAddress,
			borrowApy: (m.state?.borrowApy ?? 0) * 100,
			supplyApy: (m.state?.supplyApy ?? 0) * 100,
			liquidityUsd: m.state?.liquidityAssetsUsd ?? null,
			utilizationPct: (m.state?.utilization ?? 0) * 100,
		}))
}

const loadLine = (o: BankOwner, lineId: string): Fx<BankCreditLine> =>
	bankDb(async (db) => {
		const [r] = await db
			.select()
			.from(bankCreditLines)
			.where(and(eq(bankCreditLines.id, lineId), eq(bankCreditLines.ownerType, o.ownerType), eq(bankCreditLines.ownerId, o.ownerId)))
			.limit(1)
		if (!r) throw bankErr('NOT_FOUND', 'Credit line not found')
		return r
	})

const loadLineById = (id: string) =>
	bankDb(async (db) => {
		const [r] = await db.select().from(bankCreditLines).where(eq(bankCreditLines.id, id)).limit(1)
		if (!r) throw bankErr('NOT_FOUND', 'Credit line not found')
		return r
	})

const addEvent = (line: BankCreditLine, e: { type: string; level?: string; ltvBps?: number | null; healthFactorBps?: number | null; data?: Record<string, unknown> }) =>
	bankDb((db) =>
		db.insert(bankCreditEvents).values({
			id: newId('le').replace('le_', 'ce_'),
			lineId: line.id, ownerType: line.ownerType, ownerId: line.ownerId, type: e.type, level: e.level ?? 'info',
			ltvBps: e.ltvBps ?? null, healthFactorBps: e.healthFactorBps ?? null, data: e.data ?? {},
		}),
	)

const levelOf = (m: HealthMetrics): Level => {
	if (m.lltvBps === 0 || BigInt(m.borrowAssetsMinor) === 0n) return 'ok'
	const ratio = Math.floor((m.ltvBps * 10_000) / m.lltvBps)
	return ratio >= CRITICAL_LTV_OF_LLTV_BPS ? 'critical' : ratio >= WARN_LTV_OF_LLTV_BPS ? 'warn' : 'ok'
}

const loadWalletAccount = (line: BankCreditLine): Fx<BankAccount> =>
	Effect.gen(function* () {
		const ledger = yield* BankLedgerService
		const a = yield* ledger.getAccountById(line.accountId)
		if (!a.address || a.walletId === null || a.walletUserId === null) return yield* Effect.fail(bankErr('WALLET_UNAVAILABLE', 'Account has no custody wallet'))
		return a
	})

const marketState = (line: BankCreditLine, wallet: string) =>
	up(async () => {
		const params = await loadMarketParams(line.chain, line.marketId!)
		const [pos, price] = await Promise.all([
			loadBluePosition(line.chain, line.marketId!, wallet),
			readContract<bigint>(line.chain, params.oracle, oracleAbi, 'price'),
		])
		return { params, pos, price }
	}, 'Morpho position/oracle read')

const healthFor = (line: BankCreditLine, params: MarketParams, pos: Awaited<ReturnType<typeof loadBluePosition>>, price: bigint) => {
	const m = computeHealth(params, pos, price, line.collateralDecimals ?? 18)
	const loan = findAsset(line.loanAsset, line.chain)
	return { ...m, liquidationPriceHuman: liquidationPriceHuman(m.liquidationPrice, loan?.decimals ?? 6), level: levelOf(m) }
}

/** Interest owed on a pool line as of `now` (integer math, floor). */
export const accruedSince = (principal: bigint, aprBps: number, from: Date, now: Date): bigint => {
	const secs = BigInt(Math.max(0, Math.floor((now.getTime() - from.getTime()) / 1000)))
	return (principal * BigInt(aprBps) * secs) / (10_000n * YEAR_SECONDS)
}

const view = (line: BankCreditLine): Fx<LineView> =>
	Effect.gen(function* () {
		if (line.kind === 'collateralized' && line.marketId) {
			const acct = yield* loadWalletAccount(line)
			const s = yield* marketState(line, acct.address!)
			const health = healthFor(line, s.params, s.pos, s.price)
			return { line, health, owed: { principalMinor: s.pos.borrowAssets.toString(), accruedInterestMinor: '0', totalMinor: s.pos.borrowAssets.toString() } }
		}
		const accrued = BigInt(line.accruedInterestMinor) + accruedSince(BigInt(line.principalMinor), line.aprBps, line.lastAccrualAt, new Date())
		return { line, health: null, owed: { principalMinor: line.principalMinor, accruedInterestMinor: accrued.toString(), totalMinor: (BigInt(line.principalMinor) + accrued).toString() } }
	})

/** Atomically applies a delta once per key (line.metadata.applied). Returns false if already applied. */
const applyOnce = (lineId: string, key: string, set: Record<string, unknown>) =>
	bankDb(async (db) => {
		const rows = await db
			.update(bankCreditLines)
			.set({
				...set,
				metadata: sql`jsonb_set(${bankCreditLines.metadata}, '{applied}', coalesce(${bankCreditLines.metadata}->'applied','[]'::jsonb) || to_jsonb(${key}::text))`,
				updatedAt: new Date(),
			} as never)
			.where(and(eq(bankCreditLines.id, lineId), sql`not (coalesce(${bankCreditLines.metadata}->'applied','[]'::jsonb) @> to_jsonb(${key}::text))`))
			.returning({ id: bankCreditLines.id })
		return rows.length > 0
	})

// ---- external-leg op (collateralized draw/repay): pending transfer row -> chain -> ledger settle

const beginExternalOp = (input: { owner: BankOwner; key: string; account: BankAccount; direction: 'in' | 'out'; amountMinor: bigint; metadata: Record<string, unknown> }) =>
	bankDb(async (db) => {
		const hash = hashOf('credit-ext', input.account.id, input.direction, input.amountMinor.toString())
		const id = newId('xfer')
		const inserted = await db
			.insert(bankTransfers)
			.values({
				id, ownerType: input.owner.ownerType, ownerId: input.owner.ownerId, idempotencyKey: input.key, requestHash: hash, type: 'credit',
				fromAccount: input.direction === 'out' ? input.account.id : null, toAccount: input.direction === 'in' ? input.account.id : null,
				amountMinor: input.amountMinor.toString(), asset: input.account.asset, chain: input.account.chain, status: 'pending', metadata: input.metadata,
			})
			.onConflictDoNothing()
			.returning()
		if (inserted[0]) return { row: inserted[0], created: true }
		const [existing] = await db
			.select()
			.from(bankTransfers)
			.where(and(eq(bankTransfers.ownerType, input.owner.ownerType), eq(bankTransfers.ownerId, input.owner.ownerId), eq(bankTransfers.idempotencyKey, input.key)))
			.limit(1)
		if (!existing) throw bankErr('DB', 'credit op insert raced')
		if (existing.requestHash !== hash) throw bankErr('CONFLICT', 'idempotencyKey already used with different terms')
		return { row: existing, created: false }
	})

/** MONEY-PATH: posts external<->account legs for a confirmed on-chain borrow/repay and marks the transfer confirmed. */
const settleExternalOp = (t: typeof bankTransfers.$inferSelect, account: BankAccount, direction: 'in' | 'out', txHash: string) =>
	Effect.gen(function* () {
		if (t.status === 'confirmed') return t
		const ledger = yield* BankLedgerService
		const ext = yield* ledger.ensureSystemAccount('external', account.asset, account.chain)
		const amount = BigInt(t.amountMinor)
		yield* ledger.post({
			transferId: t.id,
			phase: 'settle',
			legs:
				direction === 'in'
					? [{ accountId: ext.id, direction: 'debit', amountMinor: amount }, { accountId: account.id, direction: 'credit', amountMinor: amount }]
					: [{ accountId: account.id, direction: 'debit', amountMinor: amount }, { accountId: ext.id, direction: 'credit', amountMinor: amount }],
		})
		return yield* bankDb(async (db) => (await db.update(bankTransfers).set({ status: 'confirmed', txHash, confirmedAt: new Date(), updatedAt: new Date() }).where(eq(bankTransfers.id, t.id)).returning())[0]!)
	})

const failExternalOp = (id: string, reason: string) =>
	bankDb((db) => db.update(bankTransfers).set({ status: 'failed', failureReason: reason.slice(0, 1000), updatedAt: new Date() }).where(eq(bankTransfers.id, id)))

const setTxHash = (id: string, txHash: string) => bankDb((db) => db.update(bankTransfers).set({ txHash, status: 'submitted', updatedAt: new Date() }).where(eq(bankTransfers.id, id)))

// ------------------------------------------------------------------ markets + open

const listMarkets = (o: BankOwner, q: { chain: string; loanAsset: string; collateral?: string | undefined }): Fx<{ markets: CreditMarket[] }> =>
	Effect.gen(function* () {
		void o
		const asset = findAsset(q.loanAsset, q.chain)
		if (!asset || asset.family !== 'evm' || asset.chainId === null) return yield* Effect.fail(bankErr('ASSET_UNSUPPORTED', `Credit supports EVM assets only (${q.loanAsset} on ${q.chain})`))
		const markets = yield* up(() => morphoMarkets(asset.chainId!, asset.chain, asset.address, q.collateral), 'Morpho market list')
		return { markets }
	})

const loadBorrowAccount = (owner: BankOwner, accountId: string): Fx<BankAccount> =>
	Effect.gen(function* () {
		const ledger = yield* BankLedgerService
		const a = yield* ledger.getAccount(owner, accountId)
		if (a.kind === 'savings' || a.kind === 'pool') return yield* Effect.fail(bankErr('VALIDATION', `Use a checking/treasury account (got ${a.kind})`))
		if (a.status !== 'active') return yield* Effect.fail(bankErr('ACCOUNT_STATE', `Account is ${a.status}`))
		if (!a.address || a.walletId === null || a.walletUserId === null) return yield* Effect.fail(bankErr('WALLET_UNAVAILABLE', 'Account has no custody wallet'))
		return a
	})

const waitOk = (chain: string, txHash: string, what: string): Effect.Effect<void, BankError> =>
	Effect.gen(function* () {
		const r = yield* up(() => waitReceipt(chain, txHash), `${what} receipt`)
		if (!r) return yield* Effect.fail(bankErr('UPSTREAM', `${what} not mined in time (tx ${txHash}); position will be re-read by the monitor`))
		if (!r.success) return yield* Effect.fail(bankErr('UPSTREAM', `${what} reverted (tx ${txHash})`))
	})

const ensureAllowance = (acct: BankAccount, token: string, spender: string, need: bigint): Fx<void> =>
	Effect.gen(function* () {
		const xfer = yield* BankTransferService
		const have = yield* up(() => readContract<bigint>(acct.chain, token, erc20Abi, 'allowance', [acct.address, spender]), 'allowance')
		if (have >= need) return
		const ap = yield* xfer.sendEvm({ account: acct, to: token, data: call(erc20Abi, 'approve', [spender, need]) })
		if (ap.outcome === 'rejected') return yield* Effect.fail(bankErr('UPSTREAM', `approve rejected: ${ap.message ?? ''}`))
		yield* waitOk(acct.chain, ap.txHash, 'approve')
	})

const openLine = (i: OpenLineInput): Fx<LineView> =>
	Effect.gen(function* () {
		if (!MINOR_RE.test(i.collateral.amountMinor)) return yield* Effect.fail(bankErr('VALIDATION', 'collateral.amountMinor must be a positive integer string'))
		const amount = BigInt(i.collateral.amountMinor)
		const id = lineIdFor(i.owner, i.idempotencyKey)
		const existing = yield* bankDb(async (db) => (await db.select().from(bankCreditLines).where(eq(bankCreditLines.id, id)).limit(1))[0] ?? null)
		if (existing) {
			if (existing.marketId !== i.marketId || existing.accountId !== i.accountId) return yield* Effect.fail(bankErr('CONFLICT', 'idempotencyKey already used with different terms'))
			return yield* view(existing)
		}
		const acct = yield* loadBorrowAccount(i.owner, i.accountId)
		const loan = findAsset(acct.asset, acct.chain)!
		const params = yield* up(() => loadMarketParams(acct.chain, i.marketId), 'Morpho market')
		if (lc(params.loanToken) !== lc(loan.address)) return yield* Effect.fail(bankErr('VALIDATION', `Market loan token ${params.loanToken} is not ${acct.asset} on ${acct.chain}`))

		let savingsAccountId: string | null = null
		if (i.collateral.source === 'vault_shares') {
			if (!i.collateral.savingsAccountId) return yield* Effect.fail(bankErr('VALIDATION', 'collateral.savingsAccountId is required for vault_shares'))
			const ledger = yield* BankLedgerService
			const sav = yield* ledger.getAccount(i.owner, i.collateral.savingsAccountId)
			const pos = yield* bankDb(async (db) => (await db.select().from(bankEarnPositions).where(eq(bankEarnPositions.savingsAccountId, sav.id)).limit(1))[0] ?? null)
			if (!pos) return yield* Effect.fail(bankErr('NOT_FOUND', 'No earn position on that savings account'))
			if (lc(pos.vault) !== lc(params.collateralToken)) {
				const shareMarkets = yield* up(() => morphoMarkets(loan.chainId!, acct.chain, loan.address, pos.vault), 'Morpho market list')
				const other = yield* up(() => morphoMarkets(loan.chainId!, acct.chain, loan.address, undefined), 'Morpho market list').pipe(Effect.map((ms) => ms.filter((m) => lc(m.collateralAsset.address) === lc(pos.vault))))
				const found = [...shareMarkets, ...other]
				return yield* Effect.fail(
					bankErr(
						'ASSET_UNSUPPORTED',
						`NO_MARKET_FOR_SHARE_TOKEN: market ${i.marketId} does not accept vault ${pos.vault} as collateral. Morpho markets with that share token as collateral and ${acct.asset} as loan: ${found.length ? found.map((m) => m.marketId).join(', ') : 'none'}`,
					),
				)
			}
			if (BigInt(pos.sharesMinor) < amount) return yield* Effect.fail(bankErr('INSUFFICIENT_FUNDS', `Only ${pos.sharesMinor} free shares (pledged or withdrawn shares cannot be reused)`))
			savingsAccountId = sav.id
		}
		const have = yield* up(() => readContract<bigint>(acct.chain, params.collateralToken, erc20Abi, 'balanceOf', [acct.address]), 'collateral balance')
		if (have < amount) return yield* Effect.fail(bankErr('INSUFFICIENT_FUNDS', `Wallet holds ${have} of collateral token ${params.collateralToken}`))
		const decimals = Number(yield* up(() => readContract<number>(acct.chain, params.collateralToken, erc20Abi, 'decimals'), 'collateral decimals'))

		// Persist the line BEFORE any chain activity (collateral is recoverable by the monitor from the onchain position).
		const inserted = yield* bankDb(async (db) => {
			const rows = await db
				.insert(bankCreditLines)
				.values({
					id, ownerType: i.owner.ownerType, ownerId: i.owner.ownerId, kind: 'collateralized', status: 'active', chain: acct.chain, loanAsset: acct.asset, accountId: acct.id,
					marketId: i.marketId, collateralToken: params.collateralToken, collateralDecimals: decimals, collateralSavingsAccountId: savingsAccountId, collateralMinor: '0',
					metadata: { pendingCollateral: amount.toString() },
				})
				.onConflictDoNothing()
				.returning()
			return rows[0] ?? null
		})
		if (!inserted) return yield* view(yield* loadLineById(id))

		const xfer = yield* BankTransferService
		yield* ensureAllowance(acct, params.collateralToken, MORPHO_BLUE, amount)
		// MONEY-PATH: supplyCollateral pulls the collateral tokens from the wallet into Morpho Blue.
		const sent = yield* xfer.sendEvm({
			account: acct, to: MORPHO_BLUE,
			data: call(blueAbi, 'supplyCollateral', [mpTuple(params), amount, acct.address, '0x']),
		})
		if (sent.outcome === 'rejected') {
			yield* bankDb((db) => db.update(bankCreditLines).set({ status: 'closed', updatedAt: new Date(), metadata: { failed: sent.message ?? 'rejected' } }).where(eq(bankCreditLines.id, id)))
			return yield* Effect.fail(bankErr('UPSTREAM', `supplyCollateral rejected: ${sent.message ?? ''}`))
		}
		yield* waitOk(acct.chain, sent.txHash, 'supplyCollateral')
		if (savingsAccountId)
			yield* bankDb((db) =>
				db
					.update(bankEarnPositions)
					.set({
						sharesMinor: sql`${bankEarnPositions.sharesMinor} - ${amount.toString()}::numeric`,
						pledgedSharesMinor: sql`${bankEarnPositions.pledgedSharesMinor} + ${amount.toString()}::numeric`,
						updatedAt: new Date(),
					})
					.where(eq(bankEarnPositions.savingsAccountId, savingsAccountId!)),
			)
		const line = yield* bankDb(async (db) => (await db.update(bankCreditLines).set({ collateralMinor: amount.toString(), updatedAt: new Date(), metadata: { supplyTx: sent.txHash } }).where(eq(bankCreditLines.id, id)).returning())[0]!)
		yield* addEvent(line, { type: 'opened', data: { marketId: i.marketId, collateralMinor: amount.toString(), supplyTx: sent.txHash } })
		return yield* view(line)
	})

// ------------------------------------------------------------------ pool (undercollateralized / receivable)

const findPool = (asset: string, chain: string, needMinor: bigint): Fx<BankAccount> =>
	Effect.gen(function* () {
		const ledger = yield* BankLedgerService
		const pools = yield* bankDb((db) =>
			db.select().from(bankAccounts).where(and(eq(bankAccounts.kind, 'pool'), eq(bankAccounts.asset, asset), eq(bankAccounts.chain, chain), eq(bankAccounts.status, 'active'))),
		)
		const usable = pools.filter((p) => p.ownerType !== 'system' && p.address && p.walletId !== null)
		const balances: Array<{ acct: BankAccount; bal: bigint }> = []
		for (const p of usable) balances.push({ acct: p, bal: yield* ledger.balance(p.id) })
		const best = balances.reduce<{ acct: BankAccount; bal: bigint } | undefined>((m, x) => (!m || x.bal > m.bal ? x : m), undefined)
		if (!best || best.bal <= 0n || best.bal < needMinor)
			return yield* Effect.fail(
				bankErr('NOT_CONFIGURED', `LENDER_POOL_UNFUNDED: no funded lender pool for ${asset} on ${chain} (need ${needMinor}, best pool balance ${best?.bal ?? 0n})`, {
					missing: `a funded bank_accounts row with kind='pool' (owner org/user/agent with a custody wallet), asset=${asset}, chain=${chain}, balance >= ${needMinor}`,
				}),
			)
		return best.acct
	})

const poolOwner = (pool: BankAccount): BankOwner => ({ ownerType: pool.ownerType as BankOwner['ownerType'], ownerId: pool.ownerId })

const accrue = (line: BankCreditLine, now: Date) => {
	const add = accruedSince(BigInt(line.principalMinor), line.aprBps, line.lastAccrualAt, now)
	return { accrued: BigInt(line.accruedInterestMinor) + add, now }
}

/** MONEY-PATH: draw from the lender pool into the borrower's account. */
const poolDraw = (owner: BankOwner, line: BankCreditLine, amount: bigint, key: string): Fx<{ transferId: string; status: string }> =>
	Effect.gen(function* () {
		const xfer = yield* BankTransferService
		const acct = yield* loadBorrowAccount(owner, line.accountId)
		const pool = yield* findPool(line.loanAsset, line.chain, amount)
		const limit = BigInt(line.limitMinor)
		const { accrued } = accrue(line, new Date())
		const used = BigInt(line.principalMinor) + accrued + BigInt(((line.metadata.pendingDrawTotal as string) ?? '0'))
		if (used + amount > limit) return yield* Effect.fail(bankErr('LIMIT_EXCEEDED', `Draw ${amount} exceeds available credit ${limit - used > 0n ? limit - used : 0n}`))
		const t = yield* xfer.transfer({
			owner: poolOwner(pool), idempotencyKey: `credit:draw:${line.id}:${key}`, type: 'credit', fromAccountId: pool.id, toAccountId: acct.id,
			amountMinor: amount.toString(), memo: `credit draw ${line.kind}`, metadata: { creditLineId: line.id, op: 'draw' },
		})
		if (t.status === 'failed') return yield* Effect.fail(bankErr('UPSTREAM', `pool transfer failed: ${t.failureReason ?? ''}`))
		return { transferId: t.id, status: t.status }
	})

/** Records the debt on the line once the pool transfer is confirmed (or queues it for settlePendingPoolOps). */
const recordPoolOp = (line: BankCreditLine, kind: 'draw' | 'repay', key: string, transferId: string, status: string, split: { principal: bigint; interest: bigint }) =>
	Effect.gen(function* () {
		const pending = { ...(line.metadata.pending as Record<string, unknown> | undefined) }
		if (status !== 'confirmed') {
			pending[key] = { transferId, kind, principal: split.principal.toString(), interest: split.interest.toString() }
			yield* bankDb((db) => db.update(bankCreditLines).set({ metadata: { ...line.metadata, pending }, updatedAt: new Date() }).where(eq(bankCreditLines.id, line.id)))
			return false
		}
		return yield* applyPoolDelta(line.id, kind, key, split)
	})

const applyPoolDelta = (lineId: string, kind: 'draw' | 'repay', key: string, split: { principal: bigint; interest: bigint }) =>
	Effect.gen(function* () {
		const now = new Date()
		const line = yield* loadLineById(lineId)
		const { accrued } = accrue(line, now)
		const principal = kind === 'draw' ? BigInt(line.principalMinor) + split.principal : BigInt(line.principalMinor) - split.principal
		const interest = kind === 'repay' ? accrued - split.interest : accrued
		if (principal < 0n || interest < 0n) return yield* Effect.fail(bankErr('CONFLICT', 'repayment exceeds amount owed'))
		const pendingNext = { ...(line.metadata.pending as Record<string, unknown> | undefined) }
		delete pendingNext[key]
		const applied = yield* applyOnce(lineId, key, {
			principalMinor: principal.toString(), accruedInterestMinor: interest.toString(), lastAccrualAt: now,
			status: principal === 0n && interest === 0n && kind === 'repay' && line.kind === 'receivable' ? 'closed' : line.status,
		})
		if (applied) {
			yield* bankDb((db) => db.update(bankCreditLines).set({ metadata: sql`jsonb_set(${bankCreditLines.metadata}, '{pending}', ${JSON.stringify(pendingNext)}::jsonb)` as never }).where(eq(bankCreditLines.id, lineId)))
			yield* addEvent(line, { type: kind, data: { key, principalMinor: split.principal.toString(), interestMinor: split.interest.toString() } })
		}
		return applied
	})

const poolRepay = (owner: BankOwner, line: BankCreditLine, amount: bigint, key: string): Fx<{ transferId: string; status: string; split: { principal: bigint; interest: bigint } }> =>
	Effect.gen(function* () {
		const xfer = yield* BankTransferService
		const acct = yield* loadBorrowAccount(owner, line.accountId)
		const { accrued } = accrue(line, new Date())
		const principal = BigInt(line.principalMinor)
		const owed = principal + accrued
		if (owed === 0n) return yield* Effect.fail(bankErr('VALIDATION', 'Nothing owed on this line'))
		const pay = amount > owed ? owed : amount
		const interest = pay < accrued ? pay : accrued
		const split = { interest, principal: pay - interest }
		const poolId = line.poolAccountId
		if (!poolId) return yield* Effect.fail(bankErr('NOT_CONFIGURED', 'LENDER_POOL_UNFUNDED: line has no pool account', { missing: 'bank_credit_lines.pool_account_id (set when the first draw is made)' }))
		const t = yield* xfer.transfer({
			owner, idempotencyKey: `credit:repay:${line.id}:${key}`, type: 'credit', fromAccountId: acct.id, toAccountId: poolId,
			amountMinor: pay.toString(), memo: `credit repay ${line.kind}`, metadata: { creditLineId: line.id, op: 'repay' },
		})
		if (t.status === 'failed') return yield* Effect.fail(bankErr('UPSTREAM', `repay transfer failed: ${t.failureReason ?? ''}`))
		return { transferId: t.id, status: t.status, split }
	})

// ------------------------------------------------------------------ draw / repay / withdraw

const draw: BankCreditServiceInterface['draw'] = (i) =>
	Effect.gen(function* () {
		if (!MINOR_RE.test(i.amountMinor)) return yield* Effect.fail(bankErr('VALIDATION', 'amountMinor must be a positive integer string'))
		const amount = BigInt(i.amountMinor)
		let line = yield* loadLine(i.owner, i.lineId)
		if (line.status !== 'active') return yield* Effect.fail(bankErr('ACCOUNT_STATE', 'Credit line is closed'))
		const acct = yield* loadBorrowAccount(i.owner, line.accountId)

		if (line.kind !== 'collateralized') {
			const dkey = i.idempotencyKey
			if (line.kind === 'receivable') return yield* Effect.fail(bankErr('VALIDATION', 'Receivable lines are advanced once when financed; use /credit/receivables/finance'))
			const r = yield* poolDraw(i.owner, line, amount, dkey)
			const pool = yield* bankDb(async (db) => (await db.select().from(bankTransfers).where(eq(bankTransfers.id, r.transferId)).limit(1))[0]!)
			if (!line.poolAccountId) line = yield* bankDb(async (db) => (await db.update(bankCreditLines).set({ poolAccountId: pool.fromAccount, updatedAt: new Date() }).where(eq(bankCreditLines.id, line.id)).returning())[0]!)
			yield* recordPoolOp(line, 'draw', `draw:${dkey}`, r.transferId, r.status, { principal: amount, interest: 0n })
			return { line: yield* view(yield* loadLineById(line.id)), transferId: r.transferId, txHash: pool.txHash, status: r.status }
		}

		// collateralized: replay-safe via the pending/confirmed external op row
		const key = `credit:draw:${line.id}:${i.idempotencyKey}`
		const { row, created } = yield* beginExternalOp({ owner: i.owner, key, account: acct, direction: 'in', amountMinor: amount, metadata: { creditLineId: line.id, op: 'draw', creditOp: true } })
		if (!created) {
			if (row.status === 'confirmed') return { line: yield* view(line), transferId: row.id, txHash: row.txHash, status: row.status }
			return { line: yield* view(line), transferId: row.id, txHash: row.txHash, status: row.status } // in flight; settlePendingPoolOps finalizes
		}
		const st = yield* marketState(line, acct.address!)
		const h = computeHealth(st.params, st.pos, st.price, line.collateralDecimals ?? 18)
		const cap = (BigInt(h.maxBorrowMinor) * BigInt(MAX_DRAW_LTV_OF_LLTV_BPS)) / 10_000n
		if (BigInt(h.borrowAssetsMinor) + amount > cap) {
			yield* failExternalOp(row.id, 'exceeds safe borrow capacity')
			return yield* Effect.fail(bankErr('LIMIT_EXCEEDED', `Draw would push LTV above ${MAX_DRAW_LTV_OF_LLTV_BPS / 100}% of the market LLTV; safe capacity left: ${cap > BigInt(h.borrowAssetsMinor) ? cap - BigInt(h.borrowAssetsMinor) : 0n}`))
		}
		const xfer = yield* BankTransferService
		// MONEY-PATH: borrow assets against the wallet's Morpho position, receiver = the custody wallet.
		const sent = yield* xfer
			.sendEvm({ account: acct, to: MORPHO_BLUE, data: call(blueAbi, 'borrow', [mpTuple(st.params), amount, 0n, acct.address, acct.address]), onSigned: ({ txHash }) => setTxHash(row.id, txHash).pipe(Effect.asVoid) })
			.pipe(Effect.tapError(() => bankDb((db) => db.select({ h: bankTransfers.txHash }).from(bankTransfers).where(eq(bankTransfers.id, row.id))).pipe(Effect.flatMap((r) => (r[0]?.h ? Effect.void : failExternalOp(row.id, 'borrow not broadcast').pipe(Effect.ignore))))))
		if (sent.outcome === 'rejected') {
			yield* failExternalOp(row.id, `borrow rejected: ${sent.message ?? ''}`)
			return yield* Effect.fail(bankErr('UPSTREAM', `borrow rejected: ${sent.message ?? ''}`))
		}
		yield* waitOk(line.chain, sent.txHash, 'borrow').pipe(Effect.tapError((e) => (e.message.includes('reverted') ? failExternalOp(row.id, e.message).pipe(Effect.ignore) : Effect.void)))
		const done = yield* settleExternalOp(row, acct, 'in', sent.txHash)
		const after = yield* marketState(line, acct.address!)
		line = yield* bankDb(async (db) => (await db.update(bankCreditLines).set({ principalMinor: after.pos.borrowAssets.toString(), updatedAt: new Date() }).where(eq(bankCreditLines.id, line.id)).returning())[0]!)
		const hh = healthFor(line, after.params, after.pos, after.price)
		yield* addEvent(line, { type: 'draw', ltvBps: hh.ltvBps, healthFactorBps: hh.healthFactorBps, data: { amountMinor: amount.toString(), txHash: sent.txHash } })
		return { line: yield* view(line), transferId: done.id, txHash: sent.txHash, status: 'confirmed' }
	})

const repay: BankCreditServiceInterface['repay'] = (i) =>
	Effect.gen(function* () {
		if (!i.all && !(i.amountMinor && MINOR_RE.test(i.amountMinor))) return yield* Effect.fail(bankErr('VALIDATION', 'provide amountMinor or all=true'))
		let line = yield* loadLine(i.owner, i.lineId)
		const acct = yield* loadBorrowAccount(i.owner, line.accountId)
		const ledger = yield* BankLedgerService

		if (line.kind !== 'collateralized') {
			const v = yield* view(line)
			const owed = BigInt(v.owed!.totalMinor)
			const amount = i.all ? owed : BigInt(i.amountMinor!)
			const r = yield* poolRepay(i.owner, line, amount, i.idempotencyKey)
			yield* recordPoolOp(line, 'repay', `repay:${i.idempotencyKey}`, r.transferId, r.status, r.split)
			return { line: yield* view(yield* loadLineById(line.id)), transferId: r.transferId, txHash: null, status: r.status }
		}

		const st = yield* marketState(line, acct.address!)
		if (st.pos.borrowShares === 0n) return yield* Effect.fail(bankErr('VALIDATION', 'Nothing borrowed on this line'))
		const repayAll = !!i.all || BigInt(i.amountMinor!) >= st.pos.borrowAssets
		const amount = repayAll ? st.pos.borrowAssets : BigInt(i.amountMinor!)
		const approveFor = repayAll ? (st.pos.borrowAssets * 10_050n) / 10_000n + 10n : amount // headroom for interest accrued between read and mine
		const bal = yield* ledger.balance(acct.id)
		if (bal < approveFor && bal < amount) return yield* Effect.fail(bankErr('INSUFFICIENT_FUNDS', `Account balance ${bal} < ${amount}`))
		const key = `credit:repay:${line.id}:${i.idempotencyKey}`
		const { row, created } = yield* beginExternalOp({ owner: i.owner, key, account: acct, direction: 'out', amountMinor: amount, metadata: { creditLineId: line.id, op: 'repay', creditOp: true, repayAll } })
		if (!created) return { line: yield* view(line), transferId: row.id, txHash: row.txHash, status: row.status }
		const loan = findAsset(acct.asset, acct.chain)!
		yield* ensureAllowance(acct, loan.address, MORPHO_BLUE, approveFor).pipe(Effect.tapError((e) => failExternalOp(row.id, e.message).pipe(Effect.ignore)))
		const xfer = yield* BankTransferService
		// MONEY-PATH: repay by shares when closing (avoids dust), by assets otherwise.
		const data = repayAll
			? call(blueAbi, 'repay', [mpTuple(st.params), 0n, st.pos.borrowShares, acct.address, '0x'])
			: call(blueAbi, 'repay', [mpTuple(st.params), amount, 0n, acct.address, '0x'])
		const sent = yield* xfer
			.sendEvm({ account: acct, to: MORPHO_BLUE, data, onSigned: ({ txHash }) => setTxHash(row.id, txHash).pipe(Effect.asVoid) })
			.pipe(Effect.tapError(() => bankDb((db) => db.select({ h: bankTransfers.txHash }).from(bankTransfers).where(eq(bankTransfers.id, row.id))).pipe(Effect.flatMap((r) => (r[0]?.h ? Effect.void : failExternalOp(row.id, 'repay not broadcast').pipe(Effect.ignore))))))
		if (sent.outcome === 'rejected') {
			yield* failExternalOp(row.id, `repay rejected: ${sent.message ?? ''}`)
			return yield* Effect.fail(bankErr('UPSTREAM', `repay rejected: ${sent.message ?? ''}`))
		}
		yield* waitOk(line.chain, sent.txHash, 'repay').pipe(Effect.tapError((e) => (e.message.includes('reverted') ? failExternalOp(row.id, e.message).pipe(Effect.ignore) : Effect.void)))
		// Ledger debit = what Morpho actually pulled: read it from the wallet's loan-token Transfer to Morpho in the receipt.
		const rcpt = yield* up(() => waitReceipt(line.chain, sent.txHash, 5_000), 'repay receipt')
		const { sumTransfersTo } = yield* Effect.promise(() => import('./chain'))
		const pulled = rcpt ? sumTransfersTo(rcpt, loan.address, MORPHO_BLUE) : 0n
		const actual = pulled > 0n ? pulled : amount
		const settleRow = actual === amount ? row : yield* bankDb(async (db) => (await db.update(bankTransfers).set({ amountMinor: actual.toString() }).where(eq(bankTransfers.id, row.id)).returning())[0]!)
		const done = yield* settleExternalOp(settleRow, acct, 'out', sent.txHash)
		const after = yield* marketState(line, acct.address!)
		line = yield* bankDb(async (db) => (await db.update(bankCreditLines).set({ principalMinor: after.pos.borrowAssets.toString(), updatedAt: new Date() }).where(eq(bankCreditLines.id, line.id)).returning())[0]!)
		const hh = healthFor(line, after.params, after.pos, after.price)
		yield* addEvent(line, { type: 'repay', ltvBps: hh.ltvBps, healthFactorBps: hh.healthFactorBps, data: { amountMinor: actual.toString(), txHash: sent.txHash } })
		return { line: yield* view(line), transferId: done.id, txHash: sent.txHash, status: 'confirmed' }
	})

const withdrawCollateral: BankCreditServiceInterface['withdrawCollateral'] = (i) =>
	Effect.gen(function* () {
		let line = yield* loadLine(i.owner, i.lineId)
		if (line.kind !== 'collateralized') return yield* Effect.fail(bankErr('VALIDATION', 'Only collateralized lines hold collateral'))
		const acct = yield* loadBorrowAccount(i.owner, line.accountId)
		const st = yield* marketState(line, acct.address!)
		const amount = i.all ? st.pos.collateral : BigInt(i.amountMinor ?? '0')
		if (amount <= 0n || amount > st.pos.collateral) return yield* Effect.fail(bankErr('VALIDATION', `amount must be 1..${st.pos.collateral}`))
		if (st.pos.borrowAssets > 0n) {
			const remaining = { ...st.pos, collateral: st.pos.collateral - amount }
			const h = computeHealth(st.params, remaining, st.price, line.collateralDecimals ?? 18)
			const cap = (BigInt(h.maxBorrowMinor) * BigInt(MAX_DRAW_LTV_OF_LLTV_BPS)) / 10_000n
			if (st.pos.borrowAssets > cap) return yield* Effect.fail(bankErr('LIMIT_EXCEEDED', `Withdrawal would push LTV above ${MAX_DRAW_LTV_OF_LLTV_BPS / 100}% of the market LLTV; repay first`))
		}
		const xfer = yield* BankTransferService
		// MONEY-PATH: collateral leaves Morpho back to the custody wallet only.
		const sent = yield* xfer.sendEvm({ account: acct, to: MORPHO_BLUE, data: call(blueAbi, 'withdrawCollateral', [mpTuple(st.params), amount, acct.address, acct.address]) })
		if (sent.outcome === 'rejected') return yield* Effect.fail(bankErr('UPSTREAM', `withdrawCollateral rejected: ${sent.message ?? ''}`))
		yield* waitOk(line.chain, sent.txHash, 'withdrawCollateral')
		const remainingCollateral = st.pos.collateral - amount
		if (line.collateralSavingsAccountId)
			yield* bankDb((db) =>
				db
					.update(bankEarnPositions)
					.set({
						sharesMinor: sql`${bankEarnPositions.sharesMinor} + ${amount.toString()}::numeric`,
						pledgedSharesMinor: sql`greatest(${bankEarnPositions.pledgedSharesMinor} - ${amount.toString()}::numeric, 0)`,
						updatedAt: new Date(),
					})
					.where(eq(bankEarnPositions.savingsAccountId, line.collateralSavingsAccountId!)),
			)
		line = yield* bankDb(async (db) =>
			(await db.update(bankCreditLines).set({ collateralMinor: remainingCollateral.toString(), status: remainingCollateral === 0n && st.pos.borrowAssets === 0n ? 'closed' : line.status, updatedAt: new Date() }).where(eq(bankCreditLines.id, line.id)).returning())[0]!,
		)
		yield* addEvent(line, { type: 'collateral_withdrawn', data: { amountMinor: amount.toString(), txHash: sent.txHash } })
		return { line: yield* view(line), txHash: sent.txHash }
	})

// ------------------------------------------------------------------ reads

const listLines = (o: BankOwner): Fx<{ lines: LineView[] }> =>
	Effect.gen(function* () {
		const rows = yield* bankDb((db) => db.select().from(bankCreditLines).where(and(eq(bankCreditLines.ownerType, o.ownerType), eq(bankCreditLines.ownerId, o.ownerId))).orderBy(desc(bankCreditLines.createdAt)))
		const lines: LineView[] = []
		for (const r of rows) lines.push(yield* view(r).pipe(Effect.catchAll((e) => { logger.warn({ line: r.id, err: e.message }, '[bank-credit] view failed'); return Effect.succeed({ line: r, health: null, owed: null } as LineView) })))
		return { lines }
	})

const getLine = (o: BankOwner, id: string): Fx<LineView> => loadLine(o, id).pipe(Effect.flatMap(view))

const events = (o: BankOwner, q: { lineId?: string | undefined; since?: string | undefined; limit?: number | undefined }): Fx<{ events: BankCreditEvent[] }> =>
	bankDb(async (db) => {
		const conds = [eq(bankCreditEvents.ownerType, o.ownerType), eq(bankCreditEvents.ownerId, o.ownerId)]
		if (q.lineId) conds.push(eq(bankCreditEvents.lineId, q.lineId))
		if (q.since) {
			const d = new Date(q.since)
			if (Number.isNaN(d.getTime())) throw bankErr('VALIDATION', 'since must be an ISO timestamp')
			conds.push(sql`${bankCreditEvents.createdAt} > ${d.toISOString()}::timestamp`)
		}
		return { events: await db.select().from(bankCreditEvents).where(and(...conds)).orderBy(desc(bankCreditEvents.createdAt)).limit(Math.min(Math.max(q.limit ?? 50, 1), 200)) }
	})

// ------------------------------------------------------------------ scoring (deterministic, from real bank history)

const TIERS = [
	{ min: 850, tier: 'platinum', mult: 20, apr: 1000 },
	{ min: 700, tier: 'gold', mult: 15, apr: 1200 },
	{ min: 500, tier: 'silver', mult: 10, apr: 1500 },
	{ min: 300, tier: 'bronze', mult: 5, apr: 1800 },
] as const

const score = (o: BankOwner, q: { asset: string; chain: string }): Fx<{ score: BankCreditScore }> =>
	Effect.gen(function* () {
		const asset = findAsset(q.asset, q.chain)
		if (!asset) return yield* Effect.fail(bankErr('ASSET_UNSUPPORTED', `Unsupported asset ${q.asset} on ${q.chain}`))
		const now = Date.now()
		const f = yield* bankDb(async (db) => {
			const accts = await db.select().from(bankAccounts).where(and(eq(bankAccounts.ownerType, o.ownerType), eq(bankAccounts.ownerId, o.ownerId)))
			const ids = accts.map((a) => a.id)
			const oldest = accts.reduce((m, a) => Math.min(m, a.createdAt.getTime()), now)
			const ageDays = ids.length ? Math.floor((now - oldest) / 86_400_000) : 0
			const since = new Date(now - 180 * 86_400_000)
			const monthly = new Map<string, bigint>()
			if (ids.length) {
				const rows = await db
					.select({ at: bankTransfers.confirmedAt, amt: bankTransfers.amountMinor, from: bankTransfers.fromAccount })
					.from(bankTransfers)
					.where(and(eq(bankTransfers.status, 'confirmed'), eq(bankTransfers.asset, asset.symbol), eq(bankTransfers.chain, asset.chain), inArray(bankTransfers.toAccount, ids), sql`${bankTransfers.type} not in ('earn','fx','credit')`, sql`${bankTransfers.confirmedAt} >= ${since.toISOString()}::timestamp`))
				for (const r of rows) {
					if (r.from && ids.includes(r.from)) continue // own-account shuffles are not income
					const k = (r.at ?? new Date()).toISOString().slice(0, 7)
					monthly.set(k, (monthly.get(k) ?? 0n) + BigInt(r.amt))
				}
			}
			const lines = await db.select().from(bankCreditLines).where(and(eq(bankCreditLines.ownerType, o.ownerType), eq(bankCreditLines.ownerId, o.ownerId), sql`${bankCreditLines.kind} <> 'collateralized'`))
			const evs = lines.length ? await db.select().from(bankCreditEvents).where(inArray(bankCreditEvents.lineId, lines.map((l) => l.id))) : []
			return {
				ageDays,
				activeMonths: monthly.size,
				totalInflow: [...monthly.values()].reduce((a, b) => a + b, 0n),
				repayments: evs.filter((e) => e.type === 'repay').length,
				delinquencies: evs.filter((e) => e.type === 'delinquent').length,
			}
		})
		const avgMonthly = f.activeMonths > 0 ? f.totalInflow / BigInt(f.activeMonths) : 0n
		const sAge = Math.min(f.ageDays, 365) * 250 / 365
		const sReg = Math.min(f.activeMonths, 6) * 350 / 6
		const sRepay = f.repayments + f.delinquencies === 0 ? 100 : Math.floor((250 * f.repayments) / (f.repayments + 3 * f.delinquencies))
		const sVol = avgMonthly > 0n ? Math.min(150, 50 + Math.floor((Math.log10(Number(avgMonthly / 10n ** BigInt(asset.decimals)) + 1) / 4) * 100)) : 0
		let total = Math.floor(sAge + sReg + sRepay + sVol)
		const reasons: string[] = []
		if (f.ageDays < 30) reasons.push('account age < 30 days')
		if (f.activeMonths < 2) reasons.push('fewer than 2 months with external inflow')
		if (f.delinquencies > 0) reasons.push('prior delinquency')
		if (reasons.length) total = Math.min(total, 299)
		const t = TIERS.find((x) => total >= x.min)
		const cap = UNSECURED_CAP_UNITS * 10n ** BigInt(asset.decimals)
		const raw = t ? (avgMonthly * BigInt(t.mult)) / 10n : 0n
		const limit = raw > cap ? cap : raw
		const row = yield* bankDb(async (db) =>
			(await db.insert(bankCreditScores).values({
				id: newId('le').replace('le_', 'cs_'), ownerType: o.ownerType, ownerId: o.ownerId, asset: asset.symbol, chain: asset.chain,
				score: Math.min(total, 1000), tier: t?.tier ?? 'none', proposedLimitMinor: limit.toString(), aprBps: t?.apr ?? 0,
				factors: { ...f, totalInflow: f.totalInflow.toString(), avgMonthlyInflowMinor: avgMonthly.toString(), components: { age: Math.floor(sAge), regularity: Math.floor(sReg), repayment: sRepay, volume: sVol }, declineReasons: reasons, capUnits: UNSECURED_CAP_UNITS.toString() },
			}).returning())[0]!,
		)
		return { score: row }
	})

const openUnsecuredLine = (i: { owner: BankOwner; idempotencyKey: string; accountId: string }): Fx<LineView> =>
	Effect.gen(function* () {
		const id = lineIdFor(i.owner, i.idempotencyKey)
		const ex = yield* bankDb(async (db) => (await db.select().from(bankCreditLines).where(eq(bankCreditLines.id, id)).limit(1))[0] ?? null)
		if (ex) return yield* view(ex)
		const acct = yield* loadBorrowAccount(i.owner, i.accountId)
		const { score: s } = yield* score(i.owner, { asset: acct.asset, chain: acct.chain })
		if (BigInt(s.proposedLimitMinor) <= 0n) return yield* Effect.fail(bankErr('POLICY_BLOCKED', `No unsecured limit available (score ${s.score}, tier ${s.tier}): ${JSON.stringify((s.factors as { declineReasons?: string[] }).declineReasons ?? [])}`))
		const line = yield* bankDb(async (db) =>
			(await db.insert(bankCreditLines).values({ id, ownerType: i.owner.ownerType, ownerId: i.owner.ownerId, kind: 'undercollateralized', chain: acct.chain, loanAsset: acct.asset, accountId: acct.id, limitMinor: s.proposedLimitMinor, aprBps: s.aprBps, metadata: { scoreId: s.id } }).onConflictDoNothing().returning())[0] ?? (await db.select().from(bankCreditLines).where(eq(bankCreditLines.id, id)))[0]!,
		)
		yield* addEvent(line, { type: 'opened', data: { limitMinor: s.proposedLimitMinor, aprBps: s.aprBps, score: s.score, tier: s.tier } })
		return yield* view(line)
	})

// ------------------------------------------------------------------ receivables

const loadInvoice = (invoiceId: string) =>
	Effect.gen(function* () {
		const res = yield* bankDb((db) => db.execute(sql`select * from bank_invoices where id = ${invoiceId} limit 1`)).pipe(
			Effect.mapError((e) => {
				const msg = `${e.message} ${String((e.cause as { cause?: unknown } | undefined)?.cause ?? '')} ${String(e.cause ?? '')}`
				return /bank_invoices/.test(msg) && /(does not exist|no such table|undefined_table)/i.test(msg)
					? bankErr('NOT_CONFIGURED', 'RECEIVABLES_UNAVAILABLE: bank_invoices table does not exist yet (M7 Payments not deployed)', { missing: 'table bank_invoices (M7)' })
					: e
			}),
		)
		const rows = (Array.isArray(res) ? res : ((res as { rows?: unknown[] }).rows ?? [])) as Array<Record<string, unknown>>
		if (!rows[0]) return yield* Effect.fail(bankErr('NOT_FOUND', `Invoice ${invoiceId} not found in bank_invoices`))
		return rows[0]
	})

const pick = (r: Record<string, unknown>, ...keys: string[]) => keys.map((k) => r[k]).find((v) => v !== undefined && v !== null)

const financeReceivable: BankCreditServiceInterface['financeReceivable'] = (i) =>
	Effect.gen(function* () {
		const id = lineIdFor(i.owner, i.idempotencyKey)
		const ex = yield* bankDb(async (db) => (await db.select().from(bankCreditLines).where(eq(bankCreditLines.id, id)).limit(1))[0] ?? null)
		if (ex) return { line: yield* view(ex), advanceMinor: (ex.limitMinor) }
		const acct = yield* loadBorrowAccount(i.owner, i.accountId)
		const inv = yield* loadInvoice(i.invoiceId)
		const status = String(pick(inv, 'status') ?? '').toLowerCase()
		if (!['open', 'sent', 'issued', 'pending', 'unpaid', 'overdue'].includes(status)) return yield* Effect.fail(bankErr('VALIDATION', `Invoice ${i.invoiceId} is '${status || 'unknown'}'; only unpaid invoices can be financed`))
		const ownerType = pick(inv, 'owner_type', 'ownerType'); const ownerId = pick(inv, 'owner_id', 'ownerId')
		if (ownerType === undefined || ownerId === undefined || String(ownerType) !== i.owner.ownerType || String(ownerId) !== i.owner.ownerId)
			return yield* Effect.fail(bankErr('FORBIDDEN', 'Invoice does not belong to this owner (or bank_invoices has no owner_type/owner_id columns)'))
		const faceRaw = pick(inv, 'amount_minor', 'amountMinor', 'total_minor', 'totalMinor')
		if (faceRaw === undefined || !/^[1-9][0-9]*$/.test(String(faceRaw))) return yield* Effect.fail(bankErr('VALIDATION', 'Invoice has no integer amount_minor/total_minor'))
		const invAsset = pick(inv, 'asset'); const invChain = pick(inv, 'chain')
		if ((invAsset && String(invAsset).toUpperCase() !== acct.asset) || (invChain && String(invChain).toLowerCase() !== acct.chain))
			return yield* Effect.fail(bankErr('VALIDATION', `Invoice is denominated in ${String(invAsset)}/${String(invChain)}; advance account is ${acct.asset}/${acct.chain}`))
		const already = yield* bankDb(async (db) => (await db.select({ id: bankCreditLines.id }).from(bankCreditLines).where(and(eq(bankCreditLines.receivableId, i.invoiceId), eq(bankCreditLines.status, 'active'))).limit(1))[0] ?? null)
		if (already) return yield* Effect.fail(bankErr('CONFLICT', 'Invoice is already financed'))
		const face = BigInt(String(faceRaw))
		const advance = (face * BigInt(RECEIVABLE_ADVANCE_BPS)) / 10_000n
		const pool = yield* findPool(acct.asset, acct.chain, advance)
		const line = yield* bankDb(async (db) =>
			(await db.insert(bankCreditLines).values({ id, ownerType: i.owner.ownerType, ownerId: i.owner.ownerId, kind: 'receivable', chain: acct.chain, loanAsset: acct.asset, accountId: acct.id, poolAccountId: pool.id, limitMinor: advance.toString(), aprBps: RECEIVABLE_APR_BPS, receivableId: i.invoiceId, faceMinor: face.toString(), metadata: { advanceRateBps: RECEIVABLE_ADVANCE_BPS } }).onConflictDoNothing().returning())[0] ?? (await db.select().from(bankCreditLines).where(eq(bankCreditLines.id, id)))[0]!,
		)
		const r = yield* poolDraw(i.owner, line, advance, 'advance')
		yield* recordPoolOp(line, 'draw', 'draw:advance', r.transferId, r.status, { principal: advance, interest: 0n })
		return { line: yield* view(yield* loadLineById(id)), advanceMinor: advance.toString() }
	})

const settleReceivable: BankCreditServiceInterface['settleReceivable'] = (invoiceId, amountMinor, paymentRef) =>
	Effect.gen(function* () {
		if (!MINOR_RE.test(amountMinor)) return yield* Effect.fail(bankErr('VALIDATION', 'amountMinor must be a positive integer string'))
		const lines = yield* bankDb((db) => db.select().from(bankCreditLines).where(and(eq(bankCreditLines.receivableId, invoiceId), eq(bankCreditLines.kind, 'receivable'), eq(bankCreditLines.status, 'active'))))
		const settled: Array<{ lineId: string; collectedMinor: string; remainingOwedMinor: string }> = []
		let budget = BigInt(amountMinor)
		for (const line of lines) {
			if (budget <= 0n) break
			const owner = { ownerType: line.ownerType as BankOwner['ownerType'], ownerId: line.ownerId }
			const v = yield* view(line)
			const owed = BigInt(v.owed!.totalMinor)
			if (owed === 0n) continue
			const take = budget < owed ? budget : owed
			// MONEY-PATH: auto-collect from the line's own account (M7 credits the merchant before calling this).
			const r = yield* poolRepay(owner, line, take, `settle:${paymentRef ?? amountMinor}`)
			yield* recordPoolOp(line, 'repay', `repay:settle:${paymentRef ?? amountMinor}`, r.transferId, r.status, r.split)
			yield* addEvent(line, { type: 'receivable_settled', data: { invoiceId, collectedMinor: take.toString(), paymentRef: paymentRef ?? null } })
			budget -= take
			settled.push({ lineId: line.id, collectedMinor: take.toString(), remainingOwedMinor: (owed - take).toString() })
		}
		return { settled }
	})

// ------------------------------------------------------------------ recurring job

const runLtvMonitor = (): Fx<{ checked: number; events: number }> =>
	Effect.gen(function* () {
		const rows = yield* bankDb((db) => db.select().from(bankCreditLines).where(and(eq(bankCreditLines.kind, 'collateralized'), eq(bankCreditLines.status, 'active'))).limit(1000))
		let evCount = 0
		for (const line of rows) {
			yield* Effect.gen(function* () {
				const acct = yield* loadWalletAccount(line)
				const st = yield* marketState(line, acct.address!)
				const h = healthFor(line, st.params, st.pos, st.price)
				const prev = line.lastLevel as Level
				if (h.level !== prev) {
					const type = h.level === 'critical' ? 'ltv_critical' : h.level === 'warn' ? 'ltv_warn' : 'ltv_recovered'
					yield* addEvent(line, { type, level: h.level, ltvBps: h.ltvBps, healthFactorBps: h.healthFactorBps, data: { liquidationPrice: h.liquidationPriceHuman, borrowAssetsMinor: h.borrowAssetsMinor, collateralValueMinor: h.collateralValueMinor, lltvBps: h.lltvBps } })
					evCount++
				}
				yield* bankDb((db) => db.update(bankCreditLines).set({ lastLevel: h.level, principalMinor: st.pos.borrowAssets.toString(), collateralMinor: st.pos.collateral.toString(), updatedAt: new Date() }).where(eq(bankCreditLines.id, line.id)))
			}).pipe(Effect.catchAll((e) => { logger.warn({ line: line.id, err: e.message }, '[bank-credit] ltv check failed'); return Effect.void }))
		}
		// delinquency: pool line with debt and no draw/repay event for 45 days
		const pool = yield* bankDb((db) => db.select().from(bankCreditLines).where(and(sql`${bankCreditLines.kind} <> 'collateralized'`, eq(bankCreditLines.status, 'active'), sql`${bankCreditLines.principalMinor} > 0`)).limit(1000))
		for (const line of pool) {
			const last = yield* bankDb(async (db) => (await db.select().from(bankCreditEvents).where(and(eq(bankCreditEvents.lineId, line.id), sql`${bankCreditEvents.type} in ('draw','repay','delinquent')`)).orderBy(desc(bankCreditEvents.createdAt)).limit(1))[0])
			if (last && Date.now() - last.createdAt.getTime() > 45 * 86_400_000 && last.type !== 'delinquent') {
				yield* addEvent(line, { type: 'delinquent', level: 'critical', data: { principalMinor: line.principalMinor } })
				evCount++
			}
		}
		return { checked: rows.length + pool.length, events: evCount }
	})

/** Applies pool draws/repays whose bank transfer settled after the request returned; also finalizes stuck external borrow/repay ops. */
const settlePendingPoolOps = (): Fx<{ checked: number; applied: number }> =>
	Effect.gen(function* () {
		const ledger = yield* BankLedgerService
		const lines = yield* bankDb((db) => db.select().from(bankCreditLines).where(and(eq(bankCreditLines.status, 'active'), sql`${bankCreditLines.metadata}->'pending' is not null and ${bankCreditLines.metadata}->'pending' <> '{}'::jsonb`)).limit(500))
		let checked = 0
		let applied = 0
		for (const line of lines) {
			const pending = (line.metadata.pending ?? {}) as Record<string, { transferId: string; kind: 'draw' | 'repay'; principal: string; interest: string }>
			for (const [key, p] of Object.entries(pending)) {
				checked++
				const t = yield* bankDb(async (db) => (await db.select().from(bankTransfers).where(eq(bankTransfers.id, p.transferId)).limit(1))[0] ?? null)
				if (!t) continue
				if (t.status === 'confirmed') {
					if (yield* applyPoolDelta(line.id, p.kind, key, { principal: BigInt(p.principal), interest: BigInt(p.interest) }).pipe(Effect.catchAll(() => Effect.succeed(false)))) applied++
				} else if (t.status === 'failed' || t.status === 'reversed') {
					const cur = yield* loadLineById(line.id)
					const next = { ...(cur.metadata.pending as Record<string, unknown>) }
					delete next[key]
					yield* bankDb((db) => db.update(bankCreditLines).set({ metadata: { ...cur.metadata, pending: next }, updatedAt: new Date() }).where(eq(bankCreditLines.id, line.id)))
				}
			}
		}
		// collateralized ops stuck pending with a tx hash: settle from the receipt
		const stuck = yield* bankDb((db) => db.select().from(bankTransfers).where(and(eq(bankTransfers.type, 'credit'), inArray(bankTransfers.status, ['pending', 'submitted']), sql`${bankTransfers.metadata}->>'creditOp' = 'true'`, sql`${bankTransfers.txHash} is not null`)).limit(100))
		for (const t of stuck) {
			checked++
			yield* Effect.gen(function* () {
				const { evmReceipt } = yield* Effect.promise(() => import('./chain'))
				const r = yield* up(() => evmReceipt(t.chain, t.txHash!), 'receipt')
				if (!r) return
				if (!r.success) { yield* failExternalOp(t.id, 'tx reverted'); return }
				const acct = yield* ledger.getAccountById((t.toAccount ?? t.fromAccount)!)
				yield* settleExternalOp(t, acct, t.toAccount ? 'in' : 'out', t.txHash!)
				applied++
			}).pipe(Effect.catchAll((e) => { logger.warn({ transfer: t.id, err: e.message }, '[bank-credit] pending op settle failed'); return Effect.void }))
		}
		return { checked, applied }
	})

export const BankCreditServiceLive = Layer.succeed(BankCreditService, {
	listMarkets,
	openLine,
	draw,
	repay,
	withdrawCollateral,
	listLines,
	getLine,
	events,
	score,
	openUnsecuredLine,
	financeReceivable,
	settleReceivable,
	runLtvMonitor,
	settlePendingPoolOps,
})
