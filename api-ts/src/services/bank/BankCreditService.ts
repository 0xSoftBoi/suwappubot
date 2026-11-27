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
	bankCreditOps,
bankInvoiceAcceptances,
	bankCreditLines,
	bankCreditScores,
	bankEarnPositions,
	bankTransfers,
} from '../../db'
import { logger } from '../../lib/logger'
import { findAsset } from './assets'
import { resolveRate } from './BankBooksService'
import { BankLedgerService, postInTx } from './BankLedgerService'
import { BankTransferService, type BankDeps } from './BankTransferService'
import { type BankOwner, bankDb, newId, withDbLock } from './db'
import {
	MORPHO_API,
	MORPHO_BLUE,
	type HealthMetrics,
	type MarketParams,
	blueAbi,
	call,
	computeHealth,
	erc20Abi,
	assertSpendable,
	hashOf,
	isInterestFree,
	postExternalLeg,
	liquidationPriceHuman,
	loadBluePosition,
	loadMarketParams,
	mpTuple,
	oracleAbi,
	readContract,
	waitReceipt,
} from './earnCreditChain'
import { BankError, bankErr } from './errors'
import { type BankTx, type ConsumesHold, assertAvailable, registerHoldProvider, sumRow } from './holds'
import { featureEnabled } from './segments'

type Fx<A> = Effect.Effect<A, BankError, BankDeps | BankTransferService>

/** Draws/withdrawals keep LTV <= 90% of the market LLTV (10% safety buffer to liquidation). */
export const MAX_DRAW_LTV_OF_LLTV_BPS = 9000
export const WARN_LTV_OF_LLTV_BPS = 8500
export const CRITICAL_LTV_OF_LLTV_BPS = 9300
const YEAR_SECONDS = 31_536_000n
const UNSECURED_CAP_UNITS = 5_000n // whole units of the loan asset
const RECEIVABLE_ADVANCE_BPS = 8000
/** Fixed-markup (interest-free) financing is priced as the product's APR over this standard term, charged ONCE up front. */
const FIXED_MARKUP_TERM_DAYS = 30

/** MONEY-PATH: flat markup bps disclosed up front; derived from the product APR over the standard term (ceil). */
export const fixedMarkupBps = (aprBps: number): number => Math.ceil((aprBps * FIXED_MARKUP_TERM_DAYS) / 365)
const FIXED_MARKUP = 'fixed_markup'
const markupOf = (principal: bigint, bps: number): bigint => (principal * BigInt(bps) + 9_999n) / 10_000n
const lineMarkupBps = (line: BankCreditLine): number => (line.metadata.financing === FIXED_MARKUP ? Number(line.metadata.markupBps ?? 0) : 0)

/**
 * Interest-free mode (sharia_compliant segment / interest-free metadata / any segment with interestCredit off).
 * MONEY-PATH policy gate for every interest-bearing credit product. Returns 'interest' (normal) or 'markup'
 * (fixed disclosed markup, no accrual, no late interest). Morpho collateralised borrow has no fixed-markup form.
 */
export const financingMode = (acct: BankAccount, product: 'collateralized' | 'pool'): Effect.Effect<'interest' | 'markup', BankError> => {
	const interestFree = isInterestFree(acct) || !featureEnabled(acct, 'interestCredit')
	if (!interestFree) return Effect.succeed('interest')
	if (product === 'collateralized')
		return Effect.fail(bankErr('POLICY_BLOCKED', `INTEREST_FREE_MODE: account segment '${acct.segmentProfile ?? 'default'}' disallows interest-bearing credit; Morpho borrowing accrues interest`))
	if (!featureEnabled(acct, 'fixedMarkupFinancing'))
		return Effect.fail(bankErr('POLICY_BLOCKED', `INTEREST_FREE_MODE: account segment '${acct.segmentProfile ?? 'default'}' disallows interest-bearing credit and does not enable fixed-markup financing`))
	return Effect.succeed('markup')
}
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
	/** Card refunds the provider returned that are not yet applied to the debt (owner scope), with age and totals. */
	readonly listPendingRefunds: (o: BankOwner) => Fx<{ refunds: Array<{ lineId: string; providerTransactionId: string; amountMinor: string; asset: string; chain: string; ageSeconds: number; status: string }>; totals: Array<{ asset: string; chain: string; amountMinor: string }> }>
	readonly openUnsecuredLine: (i: { owner: BankOwner; idempotencyKey: string; accountId: string }) => Fx<LineView>
	readonly financeReceivable: (i: { owner: BankOwner; idempotencyKey: string; accountId: string; invoiceId: string }) => Fx<{ line: LineView; advanceMinor: string }>
	readonly acceptReceivable: (i: { owner: BankOwner; invoiceId: string }) => Fx<{ invoiceId: string; accepted: boolean }>
/** Called by M7 when an invoice is paid: collects principal+interest from the line's account. */
	readonly settleReceivable: (invoiceId: string, amountMinor: string, paymentRef?: string) => Fx<{ settled: Array<{ lineId: string; collectedMinor: string; remainingOwedMinor: string }> }>
	/** Card hooks (M6): remaining spendable credit, a draw funding a card capture, and a refund restoring credit. */
	readonly undrawnLimit: (lineId: string) => Fx<bigint>
	readonly drawForCard: (lineId: string, amountMinor: bigint, ctx: { cardId: string; providerTransactionId: string }) => Fx<unknown>
	readonly repayForRefund: (lineId: string, amountMinor: bigint, ctx: { cardId: string; providerTransactionId: string }) => Fx<unknown>
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

// MONEY-PATH: wallet-sourced collateral leaves the wallet (and Morpho holds it) while the ledger balance is unchanged, so it is registered as a
// 'collateral' hold on the account that holds that token on the same wallet. It shrinks as withdrawCollateral confirmation lowers collateral_minor.
registerHoldProvider('collateral', async (accountId, tx, excludeId) => {
	const [a] = (await tx.execute(sql`select asset, chain, address from bank_accounts where id = ${accountId}`)) as unknown as Array<{ asset: string; chain: string; address: string | null }>
	if (!a?.address) return 0n
	const tok = findAsset(a.asset, a.chain)?.address
	if (!tok) return 0n
	return sumRow(
		await tx.execute(
			sql`select coalesce(sum(greatest(l.collateral_minor, coalesce((l.metadata->>'pendingCollateral')::numeric, 0))), 0)::text as s from bank_credit_lines l join bank_accounts b on b.id = l.account_id
				where l.kind = 'collateralized' and l.status = 'active' and l.collateral_savings_account_id is null and lower(l.collateral_token) = lower(${tok})
				and b.chain = ${a.chain} and lower(b.address) = lower(${a.address}) and l.id <> ${excludeId ?? ''}`,
		),
	)
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

/**
 * Interest owed on a pool line as of `now` (integer math). MONEY-PATH: rounds UP (seconds and interest), so the sub-unit
 * remainder lost when lastAccrualAt resets on every applied op never favours the borrower. `refunds` are card refunds the
 * provider already returned but that are not yet applied to the debt: no interest accrues on them from the refund time.
 */
export const accruedSince = (principal: bigint, aprBps: number, from: Date, now: Date, refunds: ReadonlyArray<{ amountMinor: bigint; at: Date }> = []): bigint => {
	const secsOf = (t0: Date) => BigInt(Math.ceil(Math.max(0, now.getTime() - t0.getTime()) / 1000))
	let weighted = principal * secsOf(from)
	for (const r of refunds) weighted -= r.amountMinor * secsOf(r.at.getTime() > from.getTime() ? r.at : from)
	if (weighted <= 0n) return 0n
	const den = 10_000n * YEAR_SECONDS
	return (weighted * BigInt(aprBps) + den - 1n) / den
}

/** Pending (unapplied) card-refund ops of a line: the provider returned the cash, the pool has not received it yet. */
const refundReductions = async (tx: BankTx, lineId: string): Promise<Array<{ amountMinor: bigint; at: Date }>> =>
	((await tx.execute(sql`select principal_minor::text as p, (extract(epoch from created_at) * 1000)::bigint::text as t from bank_credit_ops where line_id = ${lineId} and kind = 'repay' and status = 'pending' and op_key like 'cardref:%'`)) as unknown as Array<{ p: string; t: string }>).map((r) => ({ amountMinor: BigInt(r.p), at: new Date(Number(r.t)) }))

const view = (line: BankCreditLine): Fx<LineView> =>
	Effect.gen(function* () {
		if (line.kind === 'collateralized' && line.marketId) {
			const acct = yield* loadWalletAccount(line)
			const s = yield* marketState(line, acct.address!)
			const health = healthFor(line, s.params, s.pos, s.price)
			return { line, health, owed: { principalMinor: s.pos.borrowAssets.toString(), accruedInterestMinor: '0', totalMinor: s.pos.borrowAssets.toString() } }
		}
		const reds = yield* bankDb((db) => refundReductions(db as unknown as BankTx, line.id))
		const accrued = BigInt(line.accruedInterestMinor) + accruedSince(BigInt(line.principalMinor), line.aprBps, line.lastAccrualAt, new Date(), reds)
		return { line, health: null, owed: { principalMinor: line.principalMinor, accruedInterestMinor: accrued.toString(), totalMinor: (BigInt(line.principalMinor) + accrued).toString() } }
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
		// MONEY-PATH: ledger post + 'confirmed' flip in ONE transaction, with the op row locked (no confirmed-without-ledger, no double post).
		return yield* bankDb((db) =>
			db.transaction(async (tx) => {
				const [cur] = await tx.select().from(bankTransfers).where(eq(bankTransfers.id, t.id)).for('update')
				if (!cur) throw bankErr('NOT_FOUND', 'Transfer not found')
				if (cur.status === 'confirmed') return cur
				await postInTx(tx, {
					transferId: t.id,
					phase: 'settle',
					legs:
						direction === 'in'
							? [{ accountId: ext.id, direction: 'debit', amountMinor: amount }, { accountId: account.id, direction: 'credit', amountMinor: amount }]
							: [{ accountId: account.id, direction: 'debit', amountMinor: amount }, { accountId: ext.id, direction: 'credit', amountMinor: amount }],
				})
				return (await tx.update(bankTransfers).set({ status: 'confirmed', txHash, confirmedAt: new Date(), updatedAt: new Date() }).where(eq(bankTransfers.id, t.id)).returning())[0]!
			}),
		)
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
		if (a.kind === 'savings' || a.kind === 'pool' || a.kind === 'escrow') return yield* Effect.fail(bankErr('VALIDATION', `Use a checking/treasury account (got ${a.kind})`))
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
		yield* financingMode(acct, 'collateralized')
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
		// wallet-sourced collateral leaves the wallet without a ledger debit: it must not eat held funds of that asset
		if (!savingsAccountId) {
			const sameWallet = yield* bankDb((db) => db.select().from(bankAccounts).where(and(eq(bankAccounts.chain, acct.chain), eq(bankAccounts.address, acct.address!), eq(bankAccounts.status, 'active'))))
			const collAcct = sameWallet.find((a) => lc(findAsset(a.asset, a.chain)?.address ?? '') === lc(params.collateralToken))
			if (collAcct) yield* bankDb((db) => db.transaction(async (tx) => { await tx.execute(sql`select 1 from bank_accounts where id = ${collAcct.id} for update`); await assertAvailable(collAcct.id, tx, amount, { provider: 'collateral', id }) })).pipe(Effect.tapError((e) => bankDb((db) => db.update(bankCreditLines).set({ status: 'closed', updatedAt: new Date(), metadata: { failed: e.message } }).where(eq(bankCreditLines.id, id))).pipe(Effect.ignore)))
		}
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
				bankErr('LENDER_POOL_UNFUNDED', `no funded lender pool for ${asset} on ${chain} (need ${needMinor}, best pool balance ${best?.bal ?? 0n})`, {
					missing: `a funded bank_accounts row with kind='pool' (owner org/user/agent with a custody wallet), asset=${asset}, chain=${chain}, balance >= ${needMinor}`,
				}),
			)
		return best.acct
	})

const poolOwner = (pool: BankAccount): BankOwner => ({ ownerType: pool.ownerType as BankOwner['ownerType'], ownerId: pool.ownerId })

const accrue = async (tx: BankTx, line: BankCreditLine, now: Date) => {
	const add = accruedSince(BigInt(line.principalMinor), line.aprBps, line.lastAccrualAt, now, await refundReductions(tx, line.id))
	return { accrued: BigInt(line.accruedInterestMinor) + add, now }
}

// ---- MONEY-PATH (review1b): pool ops live in bank_credit_ops (unique per line+key); every read-modify-write holds the line row lock.

const lockLine = async (tx: BankTx, id: string): Promise<BankCreditLine> => {
	const [r] = await tx.select().from(bankCreditLines).where(eq(bankCreditLines.id, id)).for('update')
	if (!r) throw bankErr('NOT_FOUND', 'Credit line not found')
	return r
}

/** Pending (reserved, not yet applied) ops of `kind`: principal total, interest total. */
const pendingTotals = async (tx: BankTx, lineId: string, kind: 'draw' | 'repay'): Promise<{ principal: bigint; interest: bigint }> => {
	const r = (await tx.execute(
		sql`select coalesce(sum(principal_minor),0)::text as p, coalesce(sum(interest_minor),0)::text as i from bank_credit_ops where line_id = ${lineId} and kind = ${kind} and status = 'pending' and op_key not like 'cardref:%'`,
	)) as unknown as Array<{ p: string; i: string }>
	return { principal: BigInt(r[0]?.p ?? '0'), interest: BigInt(r[0]?.i ?? '0') }
}
// MONEY-PATH: card-refund ops (op_key 'cardref:*') are settlement receivables, excluded above so they never block the borrower's own repays.

const opTransferKey = (lineId: string, kind: 'draw' | 'repay', opKey: string) => `credit:${kind}:${lineId}:${opKey.slice(kind.length + 1)}`

const failOp = (lineId: string, opKey: string) =>
	bankDb((db) => db.update(bankCreditOps).set({ status: 'failed', updatedAt: new Date() }).where(and(eq(bankCreditOps.lineId, lineId), eq(bankCreditOps.opKey, opKey), eq(bankCreditOps.status, 'pending'))))

/** Releases the reservation only if no transfer row was ever created for it (otherwise the reconciler decides). */
const failOpIfNoTransfer = (lineId: string, kind: 'draw' | 'repay', opKey: string) =>
	Effect.gen(function* () {
		const t = yield* bankDb(async (db) => (await db.select({ id: bankTransfers.id }).from(bankTransfers).where(and(eq(bankTransfers.type, 'credit'), eq(bankTransfers.idempotencyKey, opTransferKey(lineId, kind, opKey)))).limit(1))[0])
		if (!t) yield* failOp(lineId, opKey)
	})

/** MONEY-PATH: under the line row lock, checks limit against principal + accrued + ALL pending draws and reserves this draw. */
const reserveDraw = (lineId: string, amount: bigint, key: string): Fx<void> =>
	bankDb((db) =>
		db.transaction(async (tx) => {
			const l = await lockLine(tx, lineId)
			if (l.status !== 'active') throw bankErr('ACCOUNT_STATE', 'Credit line is closed')
			const opKey = `draw:${key}`
			const [ex] = await tx.select().from(bankCreditOps).where(and(eq(bankCreditOps.lineId, lineId), eq(bankCreditOps.opKey, opKey))).limit(1)
			if (ex && ex.status !== 'failed') return
			const markup = markupOf(amount, lineMarkupBps(l))
			const { accrued } = await accrue(tx, l, new Date())
			const pend = await pendingTotals(tx, lineId, 'draw')
			const used = BigInt(l.principalMinor) + accrued + pend.principal + pend.interest
			if (used + amount + markup > BigInt(l.limitMinor)) throw bankErr('LIMIT_EXCEEDED', `Draw ${amount} exceeds available credit ${BigInt(l.limitMinor) - used > 0n ? BigInt(l.limitMinor) - used : 0n}`)
			await tx
				.insert(bankCreditOps)
				.values({ id: newId('le').replace('le_', 'cop_'), lineId, opKey, kind: 'draw', status: 'pending', principalMinor: amount.toString(), interestMinor: markup.toString() })
				.onConflictDoUpdate({ target: [bankCreditOps.lineId, bankCreditOps.opKey], set: { status: 'pending', principalMinor: amount.toString(), interestMinor: markup.toString(), updatedAt: new Date() } })
		}),
	)

/** MONEY-PATH: under the line row lock, caps the repay at owed - pending repays and reserves it. Replays return the reserved split. */
const reserveRepay = (lineId: string, amount: bigint, key: string): Fx<{ pay: bigint; split: { principal: bigint; interest: bigint } }> =>
	bankDb((db) =>
		db.transaction(async (tx) => {
			const l = await lockLine(tx, lineId)
			const opKey = `repay:${key}`
			const [ex] = await tx.select().from(bankCreditOps).where(and(eq(bankCreditOps.lineId, lineId), eq(bankCreditOps.opKey, opKey))).limit(1)
			if (ex && ex.status !== 'failed') {
				const p = BigInt(ex.principalMinor)
				const i = BigInt(ex.interestMinor)
				return { pay: p + i, split: { principal: p, interest: i } }
			}
			const { accrued } = await accrue(tx, l, new Date())
			const pend = await pendingTotals(tx, lineId, 'repay')
			const owed = BigInt(l.principalMinor) + accrued - pend.principal - pend.interest
			if (owed <= 0n) throw bankErr('VALIDATION', 'Nothing owed on this line (or pending repayments already cover it)')
			const pay = amount > owed ? owed : amount
			const accruedLeft = accrued - pend.interest > 0n ? accrued - pend.interest : 0n
			const interest = pay < accruedLeft ? pay : accruedLeft
			const split = { interest, principal: pay - interest }
			await tx
				.insert(bankCreditOps)
				.values({ id: newId('le').replace('le_', 'cop_'), lineId, opKey, kind: 'repay', status: 'pending', principalMinor: split.principal.toString(), interestMinor: split.interest.toString() })
				.onConflictDoUpdate({ target: [bankCreditOps.lineId, bankCreditOps.opKey], set: { status: 'pending', principalMinor: split.principal.toString(), interestMinor: split.interest.toString(), updatedAt: new Date() } })
			return { pay, split }
		}),
	)

/** MONEY-PATH: draw from the lender pool into the borrower's account. */
const poolDraw = (owner: BankOwner, line: BankCreditLine, amount: bigint, key: string): Fx<{ transferId: string; status: string }> =>
	Effect.gen(function* () {
		const xfer = yield* BankTransferService
		const acct = yield* loadBorrowAccount(owner, line.accountId)
		const pool = yield* findPool(line.loanAsset, line.chain, amount)
		yield* reserveDraw(line.id, amount, key)
		const t = yield* xfer
			.transfer({
				owner: poolOwner(pool), idempotencyKey: `credit:draw:${line.id}:${key}`, type: 'credit', fromAccountId: pool.id, toAccountId: acct.id,
				amountMinor: amount.toString(), memo: `credit draw ${line.kind}`, metadata: { creditLineId: line.id, op: 'draw' },
			})
			.pipe(Effect.tapError(() => failOpIfNoTransfer(line.id, 'draw', `draw:${key}`).pipe(Effect.ignore)))
		if (t.status === 'failed') {
			yield* failOp(line.id, `draw:${key}`)
			return yield* Effect.fail(bankErr('UPSTREAM', `pool transfer failed: ${t.failureReason ?? ''}`))
		}
		return { transferId: t.id, status: t.status }
	})

/** Records the transfer on the op row, then applies the debt once the pool transfer is confirmed (else settlePendingPoolOps does). */
const recordPoolOp = (line: BankCreditLine, kind: 'draw' | 'repay', key: string, transferId: string, status: string, split: { principal: bigint; interest: bigint }) =>
	Effect.gen(function* () {
		yield* bankDb((db) =>
			db
				.insert(bankCreditOps)
				.values({ id: newId('le').replace('le_', 'cop_'), lineId: line.id, opKey: key, kind, transferId, status: 'pending', principalMinor: split.principal.toString(), interestMinor: split.interest.toString() })
				.onConflictDoUpdate({ target: [bankCreditOps.lineId, bankCreditOps.opKey], set: { transferId, updatedAt: new Date() }, where: sql`${bankCreditOps.status} = 'pending'` }),
		)
		if (status !== 'confirmed') return false
		return yield* applyPoolDelta(line.id, kind, key, split)
	})

/** MONEY-PATH: applies a draw/repay ONCE (unique op row flips to 'applied') under the line row lock, in one transaction. */
const applyPoolDelta = (lineId: string, kind: 'draw' | 'repay', key: string, split: { principal: bigint; interest: bigint }) =>
	bankDb((db) =>
		db.transaction(async (tx) => {
			const line = await lockLine(tx, lineId)
			if (((line.metadata.applied ?? []) as string[]).includes(key)) return false // legacy applied-key list
			const preReds = await refundReductions(tx, lineId) // taken BEFORE the op flips to 'applied' so an applied refund still stops accruing from its refund time
			const marked = await tx
				.insert(bankCreditOps)
				.values({ id: newId('le').replace('le_', 'cop_'), lineId, opKey: key, kind, status: 'applied', principalMinor: split.principal.toString(), interestMinor: split.interest.toString() })
				.onConflictDoUpdate({ target: [bankCreditOps.lineId, bankCreditOps.opKey], set: { status: 'applied', updatedAt: new Date() }, where: sql`${bankCreditOps.status} <> 'applied'` })
				.returning({ id: bankCreditOps.id })
			if (marked.length === 0) return false
			const now = new Date()
			const accrued = BigInt(line.accruedInterestMinor) + accruedSince(BigInt(line.principalMinor), line.aprBps, line.lastAccrualAt, now, preReds)
			const principal = kind === 'draw' ? BigInt(line.principalMinor) + split.principal : BigInt(line.principalMinor) - split.principal
			// draw: split.interest is the fixed markup agreed up front (0 for interest-bearing lines)
			const interest = kind === 'repay' ? accrued - split.interest : accrued + split.interest
			if (principal < 0n || interest < 0n) throw bankErr('CONFLICT', 'repayment exceeds amount owed')
			await tx
				.update(bankCreditLines)
				.set({
					principalMinor: principal.toString(), accruedInterestMinor: interest.toString(), lastAccrualAt: now, updatedAt: now,
					status: principal === 0n && interest === 0n && kind === 'repay' && line.kind === 'receivable' ? 'closed' : line.status,
					metadata: sql`coalesce(${bankCreditLines.metadata}, '{}'::jsonb) #- ARRAY['pending', ${key}]::text[]` as never,
				})
				.where(eq(bankCreditLines.id, lineId))
			await tx.insert(bankCreditEvents).values({
				id: newId('le').replace('le_', 'ce_'), lineId, ownerType: line.ownerType, ownerId: line.ownerId, type: kind, level: 'info',
				data: { key, principalMinor: split.principal.toString(), interestMinor: split.interest.toString() },
			})
			return true
		}),
	)

const poolRepay = (owner: BankOwner, line: BankCreditLine, amount: bigint, key: string, consumesHold?: ConsumesHold): Fx<{ transferId: string; status: string; split: { principal: bigint; interest: bigint } }> =>
	Effect.gen(function* () {
		const xfer = yield* BankTransferService
		const acct = yield* loadBorrowAccount(owner, line.accountId)
		const poolId = line.poolAccountId
		if (!poolId) return yield* Effect.fail(bankErr('LENDER_POOL_UNFUNDED', 'line has no pool account', { missing: 'bank_credit_lines.pool_account_id (set when the first draw is made)' }))
		const { pay, split } = yield* reserveRepay(line.id, amount, key)
		const t = yield* xfer
			.transfer({
				owner, idempotencyKey: `credit:repay:${line.id}:${key}`, type: 'credit', fromAccountId: acct.id, toAccountId: poolId,
				amountMinor: pay.toString(), memo: `credit repay ${line.kind}`, metadata: { creditLineId: line.id, op: 'repay' }, consumesHold,
			})
			.pipe(Effect.tapError(() => failOpIfNoTransfer(line.id, 'repay', `repay:${key}`).pipe(Effect.ignore)))
		if (t.status === 'failed') {
			yield* failOp(line.id, `repay:${key}`)
			return yield* Effect.fail(bankErr('UPSTREAM', `repay transfer failed: ${t.failureReason ?? ''}`))
		}
		return { transferId: t.id, status: t.status, split }
	})

// ------------------------------------------------------------------ draw / repay / withdraw

const drawInner: BankCreditServiceInterface['draw'] = (i) =>
	Effect.gen(function* () {
		if (!MINOR_RE.test(i.amountMinor)) return yield* Effect.fail(bankErr('VALIDATION', 'amountMinor must be a positive integer string'))
		const amount = BigInt(i.amountMinor)
		let line = yield* loadLine(i.owner, i.lineId)
		if (line.status !== 'active') return yield* Effect.fail(bankErr('ACCOUNT_STATE', 'Credit line is closed'))
		const acct = yield* loadBorrowAccount(i.owner, line.accountId)
		const mode = yield* financingMode(acct, line.kind === 'collateralized' ? 'collateralized' : 'pool')
		if (mode === 'markup' && line.kind !== 'collateralized' && line.metadata.financing !== FIXED_MARKUP)
			return yield* Effect.fail(bankErr('POLICY_BLOCKED', 'INTEREST_FREE_MODE: this line accrues interest; open a fixed-markup line instead'))

		if (line.kind !== 'collateralized') {
			const dkey = i.idempotencyKey
			if (line.kind === 'receivable') return yield* Effect.fail(bankErr('VALIDATION', 'Receivable lines are advanced once when financed; use /credit/receivables/finance'))
			const r = yield* poolDraw(i.owner, line, amount, dkey)
			const pool = yield* bankDb(async (db) => (await db.select().from(bankTransfers).where(eq(bankTransfers.id, r.transferId)).limit(1))[0]!)
			if (!line.poolAccountId) line = yield* bankDb(async (db) => (await db.update(bankCreditLines).set({ poolAccountId: pool.fromAccount, updatedAt: new Date() }).where(eq(bankCreditLines.id, line.id)).returning())[0]!)
			yield* recordPoolOp(line, 'draw', `draw:${dkey}`, r.transferId, r.status, { principal: amount, interest: markupOf(amount, lineMarkupBps(line)) })
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

/** MONEY-PATH: per-line serialisation (cross-replica advisory lock) so the 90%-of-LLTV buffer check cannot be raced. */
const draw: BankCreditServiceInterface['draw'] = (i) => withDbLock(`credit-line:${i.lineId}`, drawInner(i))

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
		// holds (card auths / escrow) must not be spent by a direct on-chain repay
		yield* assertSpendable(acct.id, amount).pipe(Effect.tapError((e) => failExternalOp(row.id, e.message).pipe(Effect.ignore)))
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

const withdrawCollateralInner: BankCreditServiceInterface['withdrawCollateral'] = (i) =>
	Effect.gen(function* () {
		let line = yield* loadLine(i.owner, i.lineId)
		if (line.kind !== 'collateralized') return yield* Effect.fail(bankErr('VALIDATION', 'Only collateralized lines hold collateral'))
		const acct = yield* loadBorrowAccount(i.owner, line.accountId)
		// MONEY-PATH: honour the idempotency key (op row in bank_credit_ops; transfer_id holds the tx hash once applied).
		const wKey = `withdraw:${i.idempotencyKey}`
		const prior = yield* bankDb(async (db) => (await db.select().from(bankCreditOps).where(and(eq(bankCreditOps.lineId, line.id), eq(bankCreditOps.opKey, wKey))).limit(1))[0] ?? null)
		if (prior?.status === 'applied') return { line: yield* view(yield* loadLineById(line.id)), txHash: prior.transferId ?? '' }
		if (prior?.status === 'pending') return yield* Effect.fail(bankErr('CONFLICT', 'A withdrawal with this idempotencyKey is still in flight'))
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
		yield* bankDb((db) =>
			db.insert(bankCreditOps).values({ id: newId('le').replace('le_', 'cop_'), lineId: line.id, opKey: wKey, kind: 'withdraw', status: 'pending', principalMinor: amount.toString(), interestMinor: '0' })
				.onConflictDoUpdate({ target: [bankCreditOps.lineId, bankCreditOps.opKey], set: { status: 'pending', principalMinor: amount.toString(), updatedAt: new Date() } }),
		)
		// MONEY-PATH: collateral leaves Morpho back to the custody wallet only.
		const sent = yield* xfer.sendEvm({ account: acct, to: MORPHO_BLUE, data: call(blueAbi, 'withdrawCollateral', [mpTuple(st.params), amount, acct.address, acct.address]) }).pipe(Effect.tapError(() => failOp(line.id, wKey).pipe(Effect.ignore)))
		if (sent.outcome === 'rejected') {
			yield* failOp(line.id, wKey)
			return yield* Effect.fail(bankErr('UPSTREAM', `withdrawCollateral rejected: ${sent.message ?? ''}`))
		}
		yield* waitOk(line.chain, sent.txHash, 'withdrawCollateral').pipe(Effect.tapError((e) => (e.message.includes('reverted') ? failOp(line.id, wKey).pipe(Effect.ignore) : Effect.void)))
		yield* bankDb((db) => db.update(bankCreditOps).set({ status: 'applied', transferId: sent.txHash, updatedAt: new Date() }).where(and(eq(bankCreditOps.lineId, line.id), eq(bankCreditOps.opKey, wKey))))
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
	withRootLock(i.owner, (root) => Effect.gen(function* () {
		const id = lineIdFor(i.owner, i.idempotencyKey)
		const ex = yield* bankDb(async (db) => (await db.select().from(bankCreditLines).where(eq(bankCreditLines.id, id)).limit(1))[0] ?? null)
		if (ex) return yield* view(ex)
		const acct = yield* loadBorrowAccount(i.owner, i.accountId)
		const mode = yield* financingMode(acct, 'pool')
		const { score: s } = yield* score(i.owner, { asset: acct.asset, chain: acct.chain })
		// MONEY-PATH: one active unsecured line per (owner, asset, chain) (also a partial unique index), no new credit while delinquent, capped total exposure.
		const act = yield* bankDb(async (db) => (await db.select().from(bankCreditLines).where(and(eq(bankCreditLines.ownerType, i.owner.ownerType), eq(bankCreditLines.ownerId, i.owner.ownerId), eq(bankCreditLines.kind, 'undercollateralized'), eq(bankCreditLines.loanAsset, acct.asset), eq(bankCreditLines.chain, acct.chain), eq(bankCreditLines.status, 'active'))).limit(1))[0] ?? null)
		if (act) return yield* Effect.fail(bankErr('CONFLICT', 'An active unsecured credit line already exists for this asset/chain'))
		const delinquent = yield* bankDb(async (db) => (await db.execute(sql`select 1 as x from bank_credit_lines l where l.owner_type = ${i.owner.ownerType} and l.owner_id = ${i.owner.ownerId} and l.kind <> 'collateralized' and l.status = 'active' and l.principal_minor > 0 and exists (select 1 from bank_credit_events e where e.line_id = l.id and e.type = 'delinquent') limit 1`)) as unknown as unknown[])
		if (delinquent.length > 0) return yield* Effect.fail(bankErr('POLICY_BLOCKED', 'Existing credit is delinquent; repay it before opening new credit'))
		// MONEY-PATH: ONE exposure cap per root principal (USD, all assets/chains, all owned agents/orgs); serialised by the root lock.
		const prices = yield* rootPrices(root, acct.asset)
		const room = yield* bankDb((db) => db.transaction((tx) => rootRoomMinor(tx, root, prices, acct.asset, acct.chain)))
		const proposed = BigInt(s.proposedLimitMinor)
		const effLimit = proposed < room ? proposed : room
		if (effLimit <= 0n && proposed > 0n) return yield* Effect.fail(bankErr('LIMIT_EXCEEDED', 'Total credit exposure cap reached for this owner'))
		if (BigInt(s.proposedLimitMinor) <= 0n) return yield* Effect.fail(bankErr('POLICY_BLOCKED', `No unsecured limit available (score ${s.score}, tier ${s.tier}): ${JSON.stringify((s.factors as { declineReasons?: string[] }).declineReasons ?? [])}`))
		const line = yield* bankDb(async (db) =>
			(await db.insert(bankCreditLines).values({ id, ownerType: i.owner.ownerType, ownerId: i.owner.ownerId, kind: 'undercollateralized', chain: acct.chain, loanAsset: acct.asset, accountId: acct.id, limitMinor: effLimit.toString(), aprBps: mode === 'markup' ? 0 : s.aprBps, metadata: mode === 'markup' ? { scoreId: s.id, financing: FIXED_MARKUP, markupBps: fixedMarkupBps(s.aprBps), termDays: FIXED_MARKUP_TERM_DAYS } : { scoreId: s.id } }).onConflictDoNothing().returning())[0] ?? (await db.select().from(bankCreditLines).where(eq(bankCreditLines.id, id)))[0] ?? null,
		)
		if (!line) return yield* Effect.fail(bankErr('CONFLICT', 'An active unsecured credit line already exists for this asset/chain'))
		yield* addEvent(line, { type: 'opened', data: { limitMinor: effLimit.toString(), aprBps: mode === 'markup' ? 0 : s.aprBps, ...(mode === 'markup' ? { financing: FIXED_MARKUP, markupBps: fixedMarkupBps(s.aprBps) } : {}), score: s.score, tier: s.tier } })
		return yield* view(line)
	}))

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

/** MONEY-PATH: the invoice's payer (authenticated owner) records explicit acceptance; required before the payee can finance it. */
const acceptReceivable: BankCreditServiceInterface['acceptReceivable'] = (i) =>
Effect.gen(function* () {
	const inv = yield* loadInvoice(i.invoiceId)
	const pType = pick(inv, 'payer_owner_type', 'payerOwnerType'); const pId = pick(inv, 'payer_owner_id', 'payerOwnerId')
	if (pType === undefined || pId === undefined || String(pType) !== i.owner.ownerType || String(pId) !== i.owner.ownerId)
		return yield* Effect.fail(bankErr('FORBIDDEN', 'Only the invoice payer can accept it'))
	const status = String(pick(inv, 'status') ?? '').toLowerCase()
	if (!['open', 'sent', 'issued', 'pending', 'unpaid', 'overdue'].includes(status)) return yield* Effect.fail(bankErr('VALIDATION', `Invoice is '${status || 'unknown'}'; only unpaid invoices can be accepted`))
	yield* bankDb((db) => db.insert(bankInvoiceAcceptances).values({ invoiceId: i.invoiceId, payerOwnerType: i.owner.ownerType, payerOwnerId: i.owner.ownerId }).onConflictDoNothing())
	return { invoiceId: i.invoiceId, accepted: true }
})


// ---- MONEY-PATH: root principal (the human behind users / agents / orgs) used for relatedness and the global exposure cap.

/** user -> itself; agent -> agents.owner_user_id; org -> bank_orgs.owner_user_id. Unresolvable owners keep their own identity. */
const ownerRoot = async (tx: BankTx, t: string, id: string): Promise<string> => {
	const r = (t === 'agent'
		? await tx.execute(sql`select 'u:' || owner_user_id::text as r from agents where (id::text = ${id} or uuid::text = ${id}) and owner_user_id is not null limit 1`)
		: t === 'org'
			? await tx.execute(sql`select 'u:' || owner_user_id::text as r from bank_orgs where id = ${id} limit 1`)
			: null) as unknown as Array<{ r: string | null }> | null
	return r?.[0]?.r ?? (t === 'user' ? `u:${id}` : `${t}:${id}`)
}

/** The root plus, for an org, every member's root: two owners are RELATED when these sets intersect. */
const relatedRoots = async (tx: BankTx, t: string, id: string): Promise<Set<string>> => {
	const out = new Set([await ownerRoot(tx, t, id)])
	if (t === 'org') for (const m of (await tx.execute(sql`select 'u:' || user_id::text as r from bank_org_members where org_id = ${id}`)) as unknown as Array<{ r: string }>) out.add(m.r)
	return out
}

/** Every owner a root principal controls: the user, their agents, the orgs they own. */
const controlledOwners = async (tx: BankTx, root: string): Promise<Array<{ t: string; id: string }>> => {
	if (!root.startsWith('u:')) { const [t, ...rest] = root.split(':'); return [{ t: t!, id: rest.join(':') }] }
	const uid = root.slice(2)
	if (!/^[0-9]{1,18}$/.test(uid)) return [{ t: 'user', id: uid }]
	const ags = (await tx.execute(sql`select id::text as a, uuid::text as b from agents where owner_user_id = ${Number(uid)}`)) as unknown as Array<{ a: string; b: string }>
	const orgs = (await tx.execute(sql`select id from bank_orgs where owner_user_id = ${Number(uid)}`)) as unknown as Array<{ id: string }>
	return [{ t: 'user', id: uid }, ...ags.flatMap((a) => [{ t: 'agent', id: a.a }, { t: 'agent', id: a.b }]), ...orgs.map((o) => ({ t: 'org', id: o.id }))]
}

/** Assets (symbols) the root currently has non-collateral lines in, plus `extra`, priced in USD micros via the books price source. Fails closed. */
const rootPrices = (root: string, extra: string): Fx<Map<string, bigint>> =>
	Effect.gen(function* () {
		const owners = yield* bankDb((db) => db.transaction((tx) => controlledOwners(tx, root)))
		const assets = new Set([extra])
		if (owners.length) {
			const cond = sql.join(owners.map((o) => sql`(owner_type = ${o.t} and owner_id = ${o.id})`), sql` or `)
			for (const r of (yield* bankDb(async (db) => await db.execute(sql`select distinct loan_asset as a from bank_credit_lines where kind <> 'collateralized' and status = 'active' and (${cond})`))) as unknown as Array<{ a: string }>) assets.add(r.a)
		}
		const m = new Map<string, bigint>()
		for (const a of assets) {
			const rate = yield* resolveRate(a, 'USD')
			m.set(a, BigInt(Math.round(Number(rate.rate) * 1_000_000)))
		}
		return m
	})

/**
 * MONEY-PATH: remaining room (in `asset` minor units) under ONE global cap per root principal across all non-collateralized lines
 * (unsecured + receivable advances), every asset/chain, summed in USD. Callers hold the root lock (withRootLock).
 */
const rootRoomMinor = async (tx: BankTx, root: string, prices: Map<string, bigint>, asset: string, chain: string): Promise<bigint> => {
	const owners = await controlledOwners(tx, root)
	const cond = sql.join(owners.map((o) => sql`(l.owner_type = ${o.t} and l.owner_id = ${o.id})`), sql` or `)
	const rows = (await tx.execute(sql`select l.loan_asset as a, l.chain as c, coalesce(sum(l.limit_minor), 0)::text as s from bank_credit_lines l where l.kind <> 'collateralized' and l.status = 'active' and (${cond}) group by 1, 2`)) as unknown as Array<{ a: string; c: string; s: string }>
	let used = 0n
	for (const r of rows) {
		const px = prices.get(r.a)
		if (!px) throw bankErr('UPSTREAM', `No USD price for ${r.a}; cannot evaluate the exposure cap`)
		used += (BigInt(r.s) * px) / 10n ** BigInt(findAsset(r.a, r.c)?.decimals ?? 6)
	}
	const roomMicro = UNSECURED_CAP_UNITS * 1_000_000n - used
	const px = prices.get(asset)
	if (!px || px <= 0n) throw bankErr('UPSTREAM', `No USD price for ${asset}; cannot evaluate the exposure cap`)
	return roomMicro <= 0n ? 0n : (roomMicro * 10n ** BigInt(findAsset(asset, chain)?.decimals ?? 6)) / px
}

/** Serialises credit-opening for everything one root principal controls (cross-process advisory lock). */
const withRootLock = <A>(owner: BankOwner, inner: (root: string) => Fx<A>): Fx<A> =>
	Effect.gen(function* () {
		const root = yield* bankDb((db) => db.transaction((tx) => ownerRoot(tx, owner.ownerType, owner.ownerId)))
		return yield* withDbLock(`credit-root:${root}`, inner(root))
	})

const financeReceivable: BankCreditServiceInterface['financeReceivable'] = (i) =>
	withRootLock(i.owner, (root) => Effect.gen(function* () {
		const id = lineIdFor(i.owner, i.idempotencyKey)
		const ex = yield* bankDb(async (db) => (await db.select().from(bankCreditLines).where(eq(bankCreditLines.id, id)).limit(1))[0] ?? null)
		if (ex) return { line: yield* view(ex), advanceMinor: (ex.limitMinor) }
		const acct = yield* loadBorrowAccount(i.owner, i.accountId)
		const mode = yield* financingMode(acct, 'pool')
		const inv = yield* loadInvoice(i.invoiceId)
		const status = String(pick(inv, 'status') ?? '').toLowerCase()
		if (!['open', 'sent', 'issued', 'pending', 'unpaid', 'overdue'].includes(status)) return yield* Effect.fail(bankErr('VALIDATION', `Invoice ${i.invoiceId} is '${status || 'unknown'}'; only unpaid invoices can be financed`))
		const ownerType = pick(inv, 'payee_owner_type', 'payeeOwnerType', 'owner_type', 'ownerType'); const ownerId = pick(inv, 'payee_owner_id', 'payeeOwnerId', 'owner_id', 'ownerId')
		if (ownerType === undefined || ownerId === undefined || String(ownerType) !== i.owner.ownerType || String(ownerId) !== i.owner.ownerId)
			return yield* Effect.fail(bankErr('FORBIDDEN', 'Invoice does not belong to this owner (or bank_invoices has no owner_type/owner_id columns)'))
		const faceRaw = pick(inv, 'amount_minor', 'amountMinor', 'total_minor', 'totalMinor')
		if (faceRaw === undefined || !/^[1-9][0-9]*$/.test(String(faceRaw))) return yield* Effect.fail(bankErr('VALIDATION', 'Invoice has no integer amount_minor/total_minor'))
		const invAsset = pick(inv, 'asset'); const invChain = pick(inv, 'chain')
		if ((invAsset && String(invAsset).toUpperCase() !== acct.asset) || (invChain && String(invChain).toLowerCase() !== acct.chain))
			return yield* Effect.fail(bankErr('VALIDATION', `Invoice is denominated in ${String(invAsset)}/${String(invChain)}; advance account is ${acct.asset}/${acct.chain}`))
		// MONEY-PATH: the payer (a distinct owner) must have explicitly accepted this invoice.
		const pType = pick(inv, 'payer_owner_type', 'payerOwnerType'); const pId = pick(inv, 'payer_owner_id', 'payerOwnerId')
		if (pType === undefined || pId === undefined) return yield* Effect.fail(bankErr('VALIDATION', 'Invoice has no payer; only invoices owed by a distinct, accepting payer can be financed'))
		if (String(pType) === i.owner.ownerType && String(pId) === i.owner.ownerId) return yield* Effect.fail(bankErr('FORBIDDEN', 'Self-issued invoices (payer = payee) cannot be financed'))
		const acc = yield* bankDb(async (db) => (await db.execute(sql`select payer_owner_type, payer_owner_id from bank_invoice_acceptances where invoice_id = ${i.invoiceId} limit 1`)) as unknown as Array<{ payer_owner_type: string; payer_owner_id: string }>)
		if (!acc[0] || acc[0].payer_owner_type !== String(pType) || acc[0].payer_owner_id !== String(pId)) return yield* Effect.fail(bankErr('FORBIDDEN', 'Invoice has not been accepted by its payer (POST /credit/receivables/accept as the payer)'))
		const already = yield* bankDb(async (db) => (await db.select({ id: bankCreditLines.id }).from(bankCreditLines).where(and(eq(bankCreditLines.receivableId, i.invoiceId), eq(bankCreditLines.status, 'active'))).limit(1))[0] ?? null)
		if (already) return yield* Effect.fail(bankErr('CONFLICT', 'Invoice is already financed'))
		// MONEY-PATH: the advance is on what is still OUTSTANDING (face - paid), never the full face of a partly paid invoice.
		const face = BigInt(String(faceRaw)) - BigInt(String(pick(inv, 'paid_minor', 'paidMinor') ?? '0'))
		if (face <= 0n) return yield* Effect.fail(bankErr('VALIDATION', 'Invoice has no outstanding balance to finance'))
		const advance = (face * BigInt(RECEIVABLE_ADVANCE_BPS)) / 10_000n
		const { score: sc } = yield* score(i.owner, { asset: acct.asset, chain: acct.chain })
		const pool = yield* findPool(acct.asset, acct.chain, advance)
		const prices = yield* rootPrices(root, acct.asset)
		const line = yield* bankDb((db) => db.transaction(async (tx) => {
			// MONEY-PATH: lock the invoice row and re-check state/amount/payer/acceptance inside the finance transaction; void, payment credit and a
			// concurrent finance all serialise on this row lock, so none can slip between the check and the line creation.
			const lk = (await tx.execute(sql`select status, amount_minor::text as amount_minor, paid_minor::text as paid_minor, payee_owner_type, payee_owner_id, payer_owner_type, payer_owner_id from bank_invoices where id = ${i.invoiceId} for update`)) as unknown as Array<Record<string, string>>
			const cur = lk[0]
			if (!cur || !['open', 'sent', 'issued', 'pending', 'unpaid', 'overdue', 'partially_paid'].includes(String(cur.status).toLowerCase())) throw bankErr('CONFLICT', `Invoice is '${cur?.status ?? 'missing'}'; it can no longer be financed`)
			if (cur.payee_owner_type !== i.owner.ownerType || cur.payee_owner_id !== i.owner.ownerId || cur.payer_owner_type !== String(pType) || cur.payer_owner_id !== String(pId)) throw bankErr('CONFLICT', 'Invoice parties changed; retry')
			if (BigInt(cur.amount_minor) - BigInt(cur.paid_minor) !== face) throw bankErr('CONFLICT', 'Invoice amount or paid balance changed since it was read; retry')
			const accNow = (await tx.execute(sql`select 1 as x from bank_invoice_acceptances where invoice_id = ${i.invoiceId} and payer_owner_type = ${String(pType)} and payer_owner_id = ${String(pId)} limit 1`)) as unknown as unknown[]
			if (accNow.length === 0) throw bankErr('FORBIDDEN', 'Invoice acceptance no longer valid')
			// MONEY-PATH: issuer and payer must be unrelated principals: same root (user behind an agent / org owner) or either being a member of the other's org is refused.
			const issuerSet = await relatedRoots(tx, i.owner.ownerType, i.owner.ownerId)
			const payerSet = await relatedRoots(tx, String(pType), String(pId))
			if ([...issuerSet].some((r) => payerSet.has(r))) throw bankErr('FORBIDDEN', 'Issuer and payer are related parties (same principal or org membership); invoice cannot be financed')
			// MONEY-PATH: one USD exposure cap per root principal across all non-collateral credit.
			if (advance > (await rootRoomMinor(tx, root, prices, acct.asset, acct.chain))) throw bankErr('LIMIT_EXCEEDED', 'Total credit exposure cap reached for this principal (all assets, chains and owned agents/orgs)')
			// MONEY-PATH: no new advance while any of the issuer's non-collateral lines is delinquent.
			const dq = (await tx.execute(sql`select 1 as x from bank_credit_lines l where l.owner_type = ${i.owner.ownerType} and l.owner_id = ${i.owner.ownerId} and l.kind <> 'collateralized' and l.status = 'active' and l.principal_minor > 0 and exists (select 1 from bank_credit_events e where e.line_id = l.id and e.type = 'delinquent') limit 1`)) as unknown as unknown[]
			if (dq.length > 0) throw bankErr('POLICY_BLOCKED', 'Existing credit is delinquent; repay it before financing receivables')
			// MONEY-PATH: serialise per owner; total advances (active receivable lines) are capped by the score-based limit.
			await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`recv:${i.owner.ownerType}:${i.owner.ownerId}`}))`)
			const tot = (await tx.execute(sql`select coalesce(sum(limit_minor), 0)::text as s from bank_credit_lines where owner_type = ${i.owner.ownerType} and owner_id = ${i.owner.ownerId} and kind = 'receivable' and status = 'active' and loan_asset = ${acct.asset} and chain = ${acct.chain}`)) as unknown as Array<{ s: string }>
			if (BigInt(tot[0]?.s ?? '0') + advance > BigInt(sc.proposedLimitMinor)) throw bankErr('LIMIT_EXCEEDED', `Advance ${advance} exceeds your score-based financing limit (${sc.proposedLimitMinor}, already advanced ${tot[0]?.s ?? '0'})`)
			// MONEY-PATH: advances outstanding against the same PAYER are capped by the same limit (one payer cannot back unlimited advances).
			const pe = (await tx.execute(sql`select coalesce(sum(l.limit_minor), 0)::text as s from bank_credit_lines l join bank_invoices v on v.id = l.receivable_id where l.kind = 'receivable' and l.status = 'active' and l.loan_asset = ${acct.asset} and l.chain = ${acct.chain} and v.payer_owner_type = ${String(pType)} and v.payer_owner_id = ${String(pId)}`)) as unknown as Array<{ s: string }>
			if (BigInt(pe[0]?.s ?? '0') + advance > BigInt(sc.proposedLimitMinor)) throw bankErr('LIMIT_EXCEEDED', `Advances against this payer would exceed the financing limit (${sc.proposedLimitMinor})`)
			return (await tx.insert(bankCreditLines).values({ id, ownerType: i.owner.ownerType, ownerId: i.owner.ownerId, kind: 'receivable', chain: acct.chain, loanAsset: acct.asset, accountId: acct.id, poolAccountId: pool.id, limitMinor: advance.toString(), aprBps: mode === 'markup' ? 0 : RECEIVABLE_APR_BPS, receivableId: i.invoiceId, faceMinor: face.toString(), metadata: mode === 'markup' ? { advanceRateBps: RECEIVABLE_ADVANCE_BPS, financing: FIXED_MARKUP, markupBps: fixedMarkupBps(RECEIVABLE_APR_BPS), termDays: FIXED_MARKUP_TERM_DAYS } : { advanceRateBps: RECEIVABLE_ADVANCE_BPS } }).onConflictDoNothing().returning())[0] ?? (await tx.select().from(bankCreditLines).where(eq(bankCreditLines.id, id)))[0] ?? null
		}))
		if (!line) return yield* Effect.fail(bankErr('CONFLICT', 'Invoice is already financed'))
		const r = yield* poolDraw(i.owner, line, advance, 'advance')
		yield* recordPoolOp(line, 'draw', 'draw:advance', r.transferId, r.status, { principal: advance, interest: markupOf(advance, lineMarkupBps(line)) })
		return { line: yield* view(yield* loadLineById(id)), advanceMinor: advance.toString() }
	}))

/**
 * MONEY-PATH (g7): the financed portion of a PAID invoice is held on the payee's account until settleReceivable collects it.
 * Derived from state (active receivable line on the account whose invoice has received payment), so the hold exists in the same
 * transaction that credits the invoice, and disappears when the line closes/collects. Slack of +1 covers sub-unit accrual rounding.
 */
registerHoldProvider('receivable_collection', async (accountId, tx, excludeId) =>
	sumRow(
		await tx.execute(
			sql`select coalesce(sum(ceil(l.principal_minor + l.accrued_interest_minor + (l.principal_minor * l.apr_bps * greatest(0, extract(epoch from ((now() at time zone 'utc') - l.last_accrual_at)))) / (10000::numeric * 31536000)) + 1), 0)::text as s
				from bank_credit_lines l join bank_invoices v on v.id = l.receivable_id
				where l.account_id = ${accountId} and l.kind = 'receivable' and l.status = 'active' and v.paid_minor > 0 and (${excludeId ?? null}::text is null or l.id <> ${excludeId ?? null})`,
		),
	),
)

/** Retry for collections that failed after the invoice was paid (payments only logs a failed settleReceivable). Runs inside the scheduled settlePendingPoolOps job. */
const retryPaidReceivableCollections = (): Fx<number> =>
	Effect.gen(function* () {
		const rows = (yield* bankDb(async (db) => await db.execute(sql`select l.id as lid, l.receivable_id as inv, v.paid_minor::text as paid from bank_credit_lines l join bank_invoices v on v.id = l.receivable_id where l.kind = 'receivable' and l.status = 'active' and l.principal_minor > 0 and v.paid_minor > 0 limit 100`))) as unknown as Array<{ lid: string; inv: string; paid: string }>
		let n = 0
		for (const r of rows) {
			const res = yield* Effect.either(settleReceivable(r.inv, r.paid, `rc${hashOf('retry', r.lid, String(Math.floor(Date.now() / 900_000))).slice(0, 40)}`))
			if (res._tag === 'Left') logger.warn({ lineId: r.lid, invoiceId: r.inv, err: res.left.message }, '[bank-credit] receivable collection retry failed')
			else n += res.right.settled.length
		}
		return n
	})

const settleReceivable: BankCreditServiceInterface['settleReceivable'] = (invoiceId, amountMinor, paymentRef) =>
	Effect.gen(function* () {
		if (!MINOR_RE.test(amountMinor)) return yield* Effect.fail(bankErr('VALIDATION', 'amountMinor must be a positive integer string'))
		const lines = yield* bankDb((db) => db.select().from(bankCreditLines).where(and(eq(bankCreditLines.receivableId, invoiceId), eq(bankCreditLines.kind, 'receivable'), eq(bankCreditLines.status, 'active'))))
		// MONEY-PATH: always a payment ref (idempotency of the collect). Omitted/odd refs derive from the invoice's payment state, never the amount.
		const inv = yield* loadInvoice(invoiceId)
		const ref = paymentRef && /^[A-Za-z0-9_.:-]{1,64}$/.test(paymentRef) ? paymentRef : `auto${hashOf('settle', invoiceId, paymentRef ?? '', String(pick(inv, 'paid_minor', 'paidMinor') ?? '0')).slice(0, 40)}`
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
			const r = yield* poolRepay(owner, line, take, `settle:${ref}`, { provider: 'receivable_collection', id: line.id })
			const got = r.split.principal + r.split.interest
			yield* recordPoolOp(line, 'repay', `repay:settle:${ref}`, r.transferId, r.status, r.split)
			yield* addEvent(line, { type: 'receivable_settled', data: { invoiceId, collectedMinor: got.toString(), paymentRef: ref } })
			budget -= got
			settled.push({ lineId: line.id, collectedMinor: got.toString(), remainingOwedMinor: (owed - got).toString() })
		}
		return { settled }
	})


// ------------------------------------------------------------------ card hooks (M6)

const undrawnLimit = (lineId: string): Fx<bigint> =>
	Effect.gen(function* () {
		const line = yield* loadLineById(lineId)
		if (line.status !== 'active') return 0n
		// card credit funding obeys interest-free mode: blocked products expose no limit
		const ledger = yield* BankLedgerService
		const lineAcct = yield* ledger.getAccountById(line.accountId)
		const mode = yield* financingMode(lineAcct, line.kind === 'collateralized' ? 'collateralized' : 'pool').pipe(Effect.catchAll(() => Effect.succeed(null)))
		if (mode === null || (mode === 'markup' && line.metadata.financing !== FIXED_MARKUP)) return 0n
		const v = yield* view(line)
		if (v.health) {
			const cap = (BigInt(v.health.maxBorrowMinor) * BigInt(MAX_DRAW_LTV_OF_LLTV_BPS)) / 10_000n
			const left = cap - BigInt(v.health.borrowAssetsMinor)
			return left > 0n ? left : 0n
		}
		const pendRow = (yield* bankDb((db) => db.execute(sql`select coalesce(sum(principal_minor + interest_minor), 0)::text as s from bank_credit_ops where line_id = ${line.id} and kind = 'draw' and status = 'pending'`))) as unknown as Array<{ s: string }>
	const pend = BigInt(pendRow[0]?.s ?? '0')
		const left = BigInt(line.limitMinor) - BigInt(v.owed!.totalMinor) - pend
		const mbps = lineMarkupBps(line)
		const net = mbps > 0 ? (left * 10_000n) / BigInt(10_000 + mbps) : left // the markup on a new draw also consumes limit
		return net > 0n ? net : 0n
	})

/** MONEY-PATH: draws against the line for a card capture; idempotent per provider transaction. */
const drawForCard: BankCreditServiceInterface['drawForCard'] = (lineId, amount, ctx) =>
	Effect.gen(function* () {
		const line = yield* loadLineById(lineId)
		if (line.kind === 'receivable') return yield* Effect.fail(bankErr('VALIDATION', 'Receivable advances cannot fund card spend'))
		const owner = { ownerType: line.ownerType as BankOwner['ownerType'], ownerId: line.ownerId }
		return yield* draw({ owner, idempotencyKey: `card:${ctx.providerTransactionId}`.slice(0, 128), lineId, amountMinor: amount.toString() })
	})

/**
 * MONEY-PATH: a card refund returns cash to the settlement side, not the account, so the line's debt is reduced
 * and the lender pool is credited from `external` (pool-funded lines). Collateralized lines cannot be repaid
 * from refund cash without moving it into the wallet, which this module will not fake.
 */
const repayForRefund: BankCreditServiceInterface['repayForRefund'] = (lineId, amount, ctx) =>
	Effect.gen(function* () {
		const line = yield* loadLineById(lineId)
		if (line.kind === 'collateralized')
			return yield* Effect.fail(bankErr('NOT_CONFIGURED', 'CARD_REFUND_COLLATERALIZED_UNSUPPORTED: refund cash cannot be applied to a Morpho position', { missing: 'a refund settlement address owned by the custody wallet' }))
		if (!line.poolAccountId) return yield* Effect.fail(bankErr('NOT_FOUND', 'Line has no pool account (nothing was drawn)'))
		// MONEY-PATH: checked against principal minus refunds already pending, so pending refunds can never exceed the debt in total.
		const pendingRefunds = yield* bankDb(async (db) => BigInt(((await db.execute(sql`select coalesce(sum(principal_minor),0)::text as p from bank_credit_ops where line_id = ${line.id} and kind = 'repay' and status = 'pending' and op_key like 'cardref:%' and op_key <> ${`cardref:${ctx.providerTransactionId}`.slice(0, 120)}`)) as unknown as Array<{ p: string }>)[0]?.p ?? '0'))
		if (amount + pendingRefunds > BigInt(line.principalMinor)) return yield* Effect.fail(bankErr('VALIDATION', `Refund ${amount} plus pending refunds ${pendingRefunds} exceeds drawn principal ${line.principalMinor}`))
		// MONEY-PATH (review1b): NO pool-ledger credit from `external` without real inflow. The refund is booked as a PENDING op
		// (a settlement receivable: debt unchanged); settlePendingPoolOps applies it once a confirmed transfer into the pool account
		// carries metadata.cardRefundTxn = providerTransactionId (i.e. the cash actually reached the pool wallet).
		const key = `cardref:${ctx.providerTransactionId}`.slice(0, 120)
		const row = yield* bankDb(async (db) =>
			(await db
				.insert(bankCreditOps)
				.values({ id: newId('le').replace('le_', 'cop_'), lineId: line.id, opKey: key, kind: 'repay', status: 'pending', principalMinor: amount.toString(), interestMinor: '0' })
				.onConflictDoNothing()
				.returning({ id: bankCreditOps.id }))[0] ?? null,
		)
		if (row) yield* addEvent(line, { type: 'card_refund_pending', level: 'warn', data: { status: 'AWAITING_REFUND_INFLOW', message: 'refund received by card program — awaiting settlement to lender pool', note: 'The debt drops once the provider refund cash is confirmed into the lender pool account; no interest accrues on this amount meanwhile', cardRefundPending: true, providerTransactionId: ctx.providerTransactionId, amountMinor: amount.toString() } })
		return { applied: false, pending: true }
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
					yield* bankDb((db) => db.update(bankCreditLines).set({ metadata: sql`coalesce(${bankCreditLines.metadata}, '{}'::jsonb) #- ARRAY['pending', ${key}]::text[]` as never, updatedAt: new Date() }).where(eq(bankCreditLines.id, line.id)))
				}
			}
		}
		// pool ops tracked in bank_credit_ops (reservations): apply on confirmed transfer, release on failed/missing transfer
	const ops = yield* bankDb((db) => db.select().from(bankCreditOps).where(eq(bankCreditOps.status, 'pending')).orderBy(bankCreditOps.createdAt).limit(500))
	for (const op of ops) {
		checked++
		if (op.kind === 'withdraw') continue // collateral withdrawals are resolved by their own retry, never auto-failed
		const kind = op.kind as 'draw' | 'repay'
		if (op.opKey.startsWith('cardref:')) {
			const line = yield* loadLineById(op.lineId)
			const inflow = yield* bankDb(async (db) => (await db.select({ id: bankTransfers.id }).from(bankTransfers).where(and(eq(bankTransfers.status, 'confirmed'), eq(bankTransfers.toAccount, line.poolAccountId ?? ''), sql`${bankTransfers.metadata}->>'cardRefundTxn' = ${op.opKey.slice('cardref:'.length)}`)).limit(1))[0] ?? null)
			if (inflow && (yield* applyPoolDelta(op.lineId, 'repay', op.opKey, { principal: BigInt(op.principalMinor), interest: 0n }).pipe(Effect.catchAll(() => Effect.succeed(false))))) applied++
			continue
		}
		const t = yield* bankDb(async (db) => (await db.select().from(bankTransfers).where(op.transferId ? eq(bankTransfers.id, op.transferId) : and(eq(bankTransfers.type, 'credit'), eq(bankTransfers.idempotencyKey, opTransferKey(op.lineId, kind, op.opKey)))).limit(1))[0] ?? null)
		if (!t) {
			if (Date.now() - op.createdAt.getTime() > 15 * 60_000) yield* failOp(op.lineId, op.opKey)
		} else if (t.status === 'confirmed') {
			if (yield* applyPoolDelta(op.lineId, kind, op.opKey, { principal: BigInt(op.principalMinor), interest: BigInt(op.interestMinor) }).pipe(Effect.catchAll(() => Effect.succeed(false)))) applied++
		} else if (t.status === 'failed' || t.status === 'reversed') {
			yield* failOp(op.lineId, op.opKey)
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
		applied += yield* retryPaidReceivableCollections()
		return { checked, applied }
	})

const REFUND_PENDING_STATUS = 'refund received by card program — awaiting settlement to lender pool'
const listPendingRefunds: BankCreditServiceInterface['listPendingRefunds'] = (o) =>
	Effect.gen(function* () {
		const rows = (yield* bankDb(async (db) => await db.execute(sql`select o.line_id as lid, o.op_key as k, o.principal_minor::text as p, l.loan_asset as a, l.chain as c, (extract(epoch from ((now() at time zone 'utc') - o.created_at)))::bigint as age from bank_credit_ops o join bank_credit_lines l on l.id = o.line_id where l.owner_type = ${o.ownerType} and l.owner_id = ${o.ownerId} and o.kind = 'repay' and o.status = 'pending' and o.op_key like 'cardref:%' order by o.created_at limit 500`))) as unknown as Array<{ lid: string; k: string; p: string; a: string; c: string; age: string }>
		const tot = new Map<string, bigint>()
		for (const r of rows) tot.set(`${r.a}|${r.c}`, (tot.get(`${r.a}|${r.c}`) ?? 0n) + BigInt(r.p))
		return {
			refunds: rows.map((r) => ({ lineId: r.lid, providerTransactionId: r.k.slice('cardref:'.length), amountMinor: r.p, asset: r.a, chain: r.c, ageSeconds: Number(r.age), status: REFUND_PENDING_STATUS })),
			totals: [...tot].map(([k, v]) => { const [asset, chain] = k.split('|'); return { asset: asset!, chain: chain!, amountMinor: v.toString() } }),
		}
	})

const withdrawCollateral: BankCreditServiceInterface['withdrawCollateral'] = (i) => withDbLock(`credit-line:${i.lineId}`, withdrawCollateralInner(i))

export const BankCreditServiceLive = Layer.succeed(BankCreditService, {
	listMarkets,
	openLine,
	draw,
	repay,
	withdrawCollateral,
	listLines,
	getLine,
	events,
	listPendingRefunds,
	score,
	openUnsecuredLine,
	financeReceivable,
	acceptReceivable,
	settleReceivable,
	undrawnLimit,
	drawForCard,
	repayForRefund,
	runLtvMonitor,
	settlePendingPoolOps,
})
