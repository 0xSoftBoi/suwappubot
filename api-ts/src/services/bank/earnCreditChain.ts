/**
 * Shared on-chain + ledger helpers for M2 Earn / M3 Credit (Morpho Blue + ERC-4626).
 * Reads are plain eth_call through RPC_ENDPOINTS; writes go through
 * BankTransferService.sendEvm (never signed here).
 */
import { createHash } from 'node:crypto'
import { and, eq, sql } from 'drizzle-orm'
import { Effect } from 'effect'
import { type Hex, decodeFunctionResult, encodeFunctionData, parseAbi, toEventSelector } from 'viem'
import { RPC_ENDPOINTS } from '../../config/chains'
import { bankTransfers, type BankAccount } from '../../db'
import { fetchWithRetry } from '../../lib/retry'
import { BankLedgerService, postInTx } from './BankLedgerService'
import { evmReceipt, type EvmReceipt } from './chain'
import { bankDb, newId } from './db'
import { bankErr } from './errors'
import { assertAvailable } from './holds'

export const MORPHO_BLUE = '0xBBBBBbbBBb9cC5e90e3b3Af64bdAF62C37EEFFCb'
export const MORPHO_API = 'https://api.morpho.org/graphql'
export const WAD = 10n ** 18n
export const ORACLE_SCALE = 10n ** 36n

export const erc20Abi = parseAbi([
	'function balanceOf(address) view returns (uint256)',
	'function allowance(address,address) view returns (uint256)',
	'function approve(address,uint256) returns (bool)',
	'function decimals() view returns (uint8)',
	'function symbol() view returns (string)',
])

export const vaultAbi = parseAbi([
	'function asset() view returns (address)',
	'function convertToAssets(uint256) view returns (uint256)',
	'function convertToShares(uint256) view returns (uint256)',
	'function previewRedeem(uint256) view returns (uint256)',
	'function maxWithdraw(address) view returns (uint256)',
	'function maxRedeem(address) view returns (uint256)',
	'function totalAssets() view returns (uint256)',
	'function deposit(uint256,address) returns (uint256)',
	'function withdraw(uint256,address,address) returns (uint256)',
	'function redeem(uint256,address,address) returns (uint256)',
	'event Deposit(address indexed sender, address indexed owner, uint256 assets, uint256 shares)',
	'event Withdraw(address indexed sender, address indexed receiver, address indexed owner, uint256 assets, uint256 shares)',
])

const mp = '(address loanToken, address collateralToken, address oracle, address irm, uint256 lltv)'
export const blueAbi = parseAbi([
	'function market(bytes32) view returns (uint128 totalSupplyAssets, uint128 totalSupplyShares, uint128 totalBorrowAssets, uint128 totalBorrowShares, uint128 lastUpdate, uint128 fee)',
	'function position(bytes32, address) view returns (uint256 supplyShares, uint128 borrowShares, uint128 collateral)',
	'function idToMarketParams(bytes32) view returns (address loanToken, address collateralToken, address oracle, address irm, uint256 lltv)',
	`function supplyCollateral(${mp} marketParams, uint256 assets, address onBehalf, bytes data)`,
	`function borrow(${mp} marketParams, uint256 assets, uint256 shares, address onBehalf, address receiver) returns (uint256, uint256)`,
	`function repay(${mp} marketParams, uint256 assets, uint256 shares, address onBehalf, bytes data) returns (uint256, uint256)`,
	`function withdrawCollateral(${mp} marketParams, uint256 assets, address onBehalf, address receiver)`,
])
export const oracleAbi = parseAbi(['function price() view returns (uint256)'])

export const DEPOSIT_TOPIC = toEventSelector('Deposit(address,address,uint256,uint256)')
export const WITHDRAW_TOPIC = toEventSelector('Withdraw(address,address,address,uint256,uint256)')

export interface MarketParams {
	loanToken: Hex
	collateralToken: Hex
	oracle: Hex
	irm: Hex
	lltv: bigint
}

/** Raw eth_call. Throws on RPC error / revert. */
export async function ethCall(chain: string, to: string, data: Hex, block: string = 'latest'): Promise<Hex> {
	const url = RPC_ENDPOINTS[chain]
	if (!url) throw new Error(`No RPC endpoint for chain ${chain}`)
	const res = await fetchWithRetry(url, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_call', params: [{ to, data }, block] }),
	})
	const j = (await res.json()) as { result?: Hex; error?: { message: string } }
	if (j.error) throw new Error(`eth_call ${to}: ${j.error.message}`)
	if (!j.result || j.result === '0x') throw new Error(`eth_call ${to}: empty result (not a contract on ${chain}?)`)
	return j.result
}

// biome-ignore lint/suspicious/noExplicitAny: viem generic ABI plumbing
export async function readContract<T = any>(chain: string, to: string, abi: any, functionName: string, args: unknown[] = [], block: string = 'latest'): Promise<T> {
	const data = encodeFunctionData({ abi, functionName, args } as never)
	const out = await ethCall(chain, to, data, block)
	return decodeFunctionResult({ abi, functionName, data: out } as never) as T
}

export const call = (abi: unknown, functionName: string, args: unknown[]): Hex =>
	encodeFunctionData({ abi, functionName, args } as never)

export async function loadMarketParams(chain: string, marketId: string): Promise<MarketParams> {
	const r = await readContract<readonly [Hex, Hex, Hex, Hex, bigint]>(chain, MORPHO_BLUE, blueAbi, 'idToMarketParams', [marketId])
	if (/^0x0{40}$/.test(r[0])) throw new Error(`Morpho market ${marketId} does not exist on ${chain}`)
	return { loanToken: r[0], collateralToken: r[1], oracle: r[2], irm: r[3], lltv: r[4] }
}

export const mpTuple = (p: MarketParams) => ({ loanToken: p.loanToken, collateralToken: p.collateralToken, oracle: p.oracle, irm: p.irm, lltv: p.lltv })

export interface BluePosition {
	collateral: bigint
	borrowShares: bigint
	borrowAssets: bigint
	totalBorrowAssets: bigint
	totalBorrowShares: bigint
	lastUpdate: bigint
}

export const irmAbi = parseAbi([
	'function borrowRateView((address loanToken, address collateralToken, address oracle, address irm, uint256 lltv) marketParams, (uint128 totalSupplyAssets, uint128 totalSupplyShares, uint128 totalBorrowAssets, uint128 totalBorrowShares, uint128 lastUpdate, uint128 fee) market) view returns (uint256)',
])

/** Morpho MathLib.wTaylorCompounded: e^(x*n) - 1 to the third order (x = per-second WAD rate). */
export const wTaylorCompounded = (x: bigint, n: bigint): bigint => {
	const first = x * n
	const second = (first * first) / (2n * WAD)
	const third = (second * first) / (3n * WAD)
	return first + second + third
}

/** Latest block number + timestamp, so every read in one valuation sees the same state. */
export async function latestBlock(chain: string): Promise<{ number: Hex; timestamp: bigint }> {
	const url = RPC_ENDPOINTS[chain]
	if (!url) throw new Error(`No RPC endpoint for chain ${chain}`)
	const res = await fetchWithRetry(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_getBlockByNumber', params: ['latest', false] }) })
	const j = (await res.json()) as { result?: { number: Hex; timestamp: Hex }; error?: { message: string } }
	if (j.error || !j.result) throw new Error(`eth_getBlockByNumber: ${j.error?.message ?? 'empty'}`)
	return { number: j.result.number, timestamp: BigInt(j.result.timestamp) }
}

/**
 * MONEY-PATH. Position with interest ACCRUED to the block timestamp, exactly as Morpho's periphery
 * (MorphoBalancesLib.expectedMarketBalances + expectedBorrowAssets): borrow rate from the market's IRM
 * `borrowRateView`, interest = totalBorrowAssets * wTaylorCompounded(rate, elapsed), borrow assets rounded UP
 * (toAssetsUp, virtual 1 / 1e6 offsets). All bigint. `at` pins every read to one block (default: latest block).
 */
export async function loadBluePosition(chain: string, marketId: string, user: string, at?: { number: Hex; timestamp: bigint }): Promise<BluePosition> {
	const blk = at ?? (await latestBlock(chain))
	const tag = blk.number
	const [pos, mkt, mpRaw] = await Promise.all([
		readContract<readonly [bigint, bigint, bigint]>(chain, MORPHO_BLUE, blueAbi, 'position', [marketId, user], tag),
		readContract<readonly [bigint, bigint, bigint, bigint, bigint, bigint]>(chain, MORPHO_BLUE, blueAbi, 'market', [marketId], tag),
		readContract<readonly [Hex, Hex, Hex, Hex, bigint]>(chain, MORPHO_BLUE, blueAbi, 'idToMarketParams', [marketId], tag),
	])
	const borrowShares = pos[1]
	let totalBorrowAssets = mkt[2]
	const totalBorrowShares = mkt[3]
	const lastUpdate = mkt[4]
	const elapsed = blk.timestamp - lastUpdate
	const irm = mpRaw[3]
	if (elapsed > 0n && totalBorrowAssets !== 0n && !/^0x0{40}$/i.test(irm)) {
		const marketParams = { loanToken: mpRaw[0], collateralToken: mpRaw[1], oracle: mpRaw[2], irm, lltv: mpRaw[4] }
		const rate = await readContract<bigint>(chain, irm, irmAbi, 'borrowRateView', [marketParams, { totalSupplyAssets: mkt[0], totalSupplyShares: mkt[1], totalBorrowAssets: mkt[2], totalBorrowShares: mkt[3], lastUpdate: mkt[4], fee: mkt[5] }], tag)
		totalBorrowAssets += (totalBorrowAssets * wTaylorCompounded(rate, elapsed)) / WAD // wMulDown
	}
	// toAssetsUp(shares, totalAssets, totalShares) with virtual 1 / 1e6 offsets.
	const num = borrowShares * (totalBorrowAssets + 1n)
	const den = totalBorrowShares + 1_000_000n
	const borrowAssets = (num + den - 1n) / den
	return { collateral: pos[2], borrowShares, borrowAssets, totalBorrowAssets, totalBorrowShares, lastUpdate }
}

export interface HealthMetrics {
	collateralMinor: string
	borrowAssetsMinor: string
	/** collateral value expressed in loan-token minor units. */
	collateralValueMinor: string
	ltvBps: number
	lltvBps: number
	/** lltv / ltv scaled by 10_000 (10_000 = 1.0). null when there is no debt. */
	healthFactorBps: number | null
	/** Loan-token units per 1 whole collateral token at which the position is liquidatable (decimal string). null w/o debt. */
	liquidationPrice: string | null
	oraclePrice: string
	maxBorrowMinor: string
	availableToBorrowMinor: string
}

const fixed = (n: bigint, d: bigint, dec: number): string => {
	const scaled = (n * 10n ** BigInt(dec)) / d
	const s = scaled.toString().padStart(dec + 1, '0')
	return `${s.slice(0, s.length - dec)}.${s.slice(s.length - dec)}`
}

export function computeHealth(p: MarketParams, pos: BluePosition, oraclePrice: bigint, collDecimals: number): HealthMetrics {
	const collValue = (pos.collateral * oraclePrice) / ORACLE_SCALE
	const maxBorrow = (collValue * p.lltv) / WAD
	const ltvBps = collValue === 0n ? (pos.borrowAssets > 0n ? 1_000_000 : 0) : Number((pos.borrowAssets * 10_000n) / collValue)
	const lltvBps = Number((p.lltv * 10_000n) / WAD)
	const hf = pos.borrowAssets === 0n ? null : maxBorrow === 0n ? 0 : Number((maxBorrow * 10_000n) / pos.borrowAssets)
	// liquidation when borrow = collateral * price * lltv  =>  price* = borrow * 1e36 / (collateral * lltv/1e18)
	let liq: string | null = null
	if (pos.borrowAssets > 0n && pos.collateral > 0n) {
		const priceStar = (pos.borrowAssets * ORACLE_SCALE * WAD) / (pos.collateral * p.lltv) // oracle units (loan minor per collateral minor * 1e36)
		// loan minor per whole collateral = priceStar * 10^collDec / 1e36 (still loan minor) -> caller scales by loan decimals via fixed()
		liq = priceStar.toString() + `e${collDecimals}`
	}
	return {
		collateralMinor: pos.collateral.toString(),
		borrowAssetsMinor: pos.borrowAssets.toString(),
		collateralValueMinor: collValue.toString(),
		ltvBps,
		lltvBps,
		healthFactorBps: hf,
		liquidationPrice: liq,
		oraclePrice: oraclePrice.toString(),
		maxBorrowMinor: maxBorrow.toString(),
		availableToBorrowMinor: (maxBorrow > pos.borrowAssets ? maxBorrow - pos.borrowAssets : 0n).toString(),
	}
}

/** Converts computeHealth's raw `<priceStar>e<collDec>` into loan units per whole collateral token. */
export function liquidationPriceHuman(raw: string | null, loanDecimals: number): string | null {
	if (!raw) return null
	const [ps, e] = raw.split('e')
	const collDec = Number(e)
	// loan minor per whole collateral = ps * 10^collDec / 1e36 ; human = / 10^loanDec
	return fixed(BigInt(ps) * 10n ** BigInt(collDec), ORACLE_SCALE * 10n ** BigInt(loanDecimals), 6)
}

export const hashOf = (...parts: unknown[]): string => createHash('sha256').update(JSON.stringify(parts)).digest('hex')

/** Waits (bounded) for a receipt; returns null if not mined within the window (caller keeps the op pending). */
export async function waitReceipt(chain: string, hash: string, timeoutMs = 90_000): Promise<EvmReceipt | null> {
	const deadline = Date.now() + timeoutMs
	while (Date.now() < deadline) {
		const r = await evmReceipt(chain, hash).catch(() => null)
		if (r) return r
		await new Promise((res) => setTimeout(res, 2_500))
	}
	return null
}

const lc = (s: string) => s.toLowerCase()

/** Pulls (assets, shares) from the first ERC-4626 Deposit/Withdraw event emitted by `vault` in a receipt. */
export function vaultEvent(r: EvmReceipt, vault: string, kind: 'deposit' | 'withdraw'): { assets: bigint; shares: bigint } | null {
	const topic = kind === 'deposit' ? DEPOSIT_TOPIC : WITHDRAW_TOPIC
	const log = r.logs.find((l) => lc(l.address) === lc(vault) && l.topics[0] === topic)
	if (!log) return null
	const d = log.data.replace(/^0x/, '')
	return { assets: BigInt(`0x${d.slice(0, 64)}`), shares: BigInt(`0x${d.slice(64, 128)}`) }
}

/** Segment profiles M13 will define; read defensively. Interest-bearing products refuse these. */
export function isInterestFree(acct: Pick<BankAccount, 'segmentProfile' | 'metadata'>): boolean {
	const md = (acct.metadata ?? {}) as Record<string, unknown>
	const cands = [acct.segmentProfile, md.segment, md.segmentProfile, md.profile]
	if (md.interestFree === true || md.interest_free === true) return true
	return cands.some((c) => typeof c === 'string' && /sharia|shariah|islamic|interest[-_ ]?free|halal/i.test(c))
}

/**
 * MONEY-PATH: posts a ledger movement against a system account (external) with its own
 * bank_transfers row, idempotent on (owner, idempotencyKey). `direction` is from the customer
 * account's viewpoint: 'in' = external -> account (credit account), 'out' = account -> external.
 */
export const postExternalLeg = (input: {
	owner: { ownerType: 'user' | 'agent' | 'org' | 'partner_customer'; ownerId: string }
	idempotencyKey: string
	type: 'earn' | 'credit'
	account: BankAccount
	direction: 'in' | 'out'
	amountMinor: bigint
	txHash?: string | undefined
	memo?: string | undefined
	metadata?: Record<string, unknown> | undefined
}) =>
	Effect.gen(function* () {
		if (input.amountMinor <= 0n) return null
		const ledger = yield* BankLedgerService
		const ext = yield* ledger.ensureSystemAccount('external', input.account.asset, input.account.chain)
		const existing = yield* bankDb(async (db) => {
			const rows = await db
				.select()
				.from(bankTransfers)
				.where(
					and(
						eq(bankTransfers.ownerType, input.owner.ownerType),
						eq(bankTransfers.ownerId, input.owner.ownerId),
						eq(bankTransfers.idempotencyKey, input.idempotencyKey),
					),
				)
				.limit(1)
			return rows[0] ?? null
		})
		if (existing) {
			// MONEY-PATH: repair — a confirmed op whose ledger entries are missing is re-posted; postInTx is a no-op
			// when the 'settle' entries already exist (idempotent per transfer+phase).
			if (existing.status === 'confirmed')
				yield* bankDb((db) =>
					db.transaction((tx) =>
						postInTx(tx, {
							transferId: existing.id,
							phase: 'settle',
							legs:
								input.direction === 'in'
									? [
											{ accountId: ext.id, direction: 'debit', amountMinor: input.amountMinor },
											{ accountId: input.account.id, direction: 'credit', amountMinor: input.amountMinor },
										]
									: [
											{ accountId: input.account.id, direction: 'debit', amountMinor: input.amountMinor },
											{ accountId: ext.id, direction: 'credit', amountMinor: input.amountMinor },
										],
						}),
					),
				)
			return existing
		}
		const id = newId('xfer')
		const hash = hashOf(input.type, input.account.id, input.direction, input.amountMinor.toString())
		// MONEY-PATH: op row + ledger post in ONE transaction (a confirmed op can never exist without its ledger entry).
		yield* bankDb((db) =>
			db.transaction(async (tx) => {
				const ins = await tx.insert(bankTransfers).values({
				id,
				ownerType: input.owner.ownerType,
				ownerId: input.owner.ownerId,
				idempotencyKey: input.idempotencyKey,
				requestHash: hash,
				type: input.type,
				fromAccount: input.direction === 'out' ? input.account.id : null,
				toAccount: input.direction === 'in' ? input.account.id : null,
				toExternal: null,
				amountMinor: input.amountMinor.toString(),
				asset: input.account.asset,
				chain: input.account.chain,
				status: 'confirmed',
				txHash: input.txHash ?? null,
				memo: input.memo ?? null,
				metadata: input.metadata ?? {},
				confirmedAt: new Date(),
			}).onConflictDoNothing().returning({ id: bankTransfers.id })
				if (ins.length === 0) return
				await postInTx(tx, {
					transferId: id,
					phase: 'settle',
					legs:
						input.direction === 'in'
							? [
									{ accountId: ext.id, direction: 'debit', amountMinor: input.amountMinor },
									{ accountId: input.account.id, direction: 'credit', amountMinor: input.amountMinor },
								]
							: [
									{ accountId: input.account.id, direction: 'debit', amountMinor: input.amountMinor },
									{ accountId: ext.id, direction: 'credit', amountMinor: input.amountMinor },
								],
				})
			}),
		)
		return yield* bankDb(async (db) => (await db.select().from(bankTransfers).where(eq(bankTransfers.id, id)).limit(1))[0]!)
	})

/**
 * MONEY-PATH. Direct on-chain spends (credit repay, collateral supply) debit the ledger only at settlement, after the
 * money has moved. Check BEFORE broadcasting that the account's ledger balance net of active holds (card
 * authorisations, escrow) covers `amount`, under the account row lock.
 */
export const assertSpendable = (accountId: string, amount: bigint) =>
	bankDb((db) =>
		db.transaction(async (tx) => {
			await tx.execute(sql`select 1 from bank_accounts where id = ${accountId} for update`)
			await assertAvailable(accountId, tx, amount)
		}),
	)

export const requireEvmAccount = (a: BankAccount) => {
	if (!a.address || a.walletId === null || a.walletUserId === null)
		throw bankErr('WALLET_UNAVAILABLE', 'Account has no custody wallet')
	return a.address
}
