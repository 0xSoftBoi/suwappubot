/**
 * Shared on-chain + ledger helpers for M2 Earn / M3 Credit (Morpho Blue + ERC-4626).
 * Reads are plain eth_call through RPC_ENDPOINTS; writes go through
 * BankTransferService.sendEvm (never signed here).
 */
import { createHash } from 'node:crypto'
import { and, eq } from 'drizzle-orm'
import { Effect } from 'effect'
import { type Hex, decodeFunctionResult, encodeFunctionData, parseAbi, toEventSelector } from 'viem'
import { RPC_ENDPOINTS } from '../../config/chains'
import { bankTransfers, type BankAccount } from '../../db'
import { fetchWithRetry } from '../../lib/retry'
import { BankLedgerService } from './BankLedgerService'
import { evmReceipt, type EvmReceipt } from './chain'
import { bankDb, newId } from './db'
import { bankErr } from './errors'

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
export async function ethCall(chain: string, to: string, data: Hex): Promise<Hex> {
	const url = RPC_ENDPOINTS[chain]
	if (!url) throw new Error(`No RPC endpoint for chain ${chain}`)
	const res = await fetchWithRetry(url, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_call', params: [{ to, data }, 'latest'] }),
	})
	const j = (await res.json()) as { result?: Hex; error?: { message: string } }
	if (j.error) throw new Error(`eth_call ${to}: ${j.error.message}`)
	if (!j.result || j.result === '0x') throw new Error(`eth_call ${to}: empty result (not a contract on ${chain}?)`)
	return j.result
}

// biome-ignore lint/suspicious/noExplicitAny: viem generic ABI plumbing
export async function readContract<T = any>(chain: string, to: string, abi: any, functionName: string, args: unknown[] = []): Promise<T> {
	const data = encodeFunctionData({ abi, functionName, args } as never)
	const out = await ethCall(chain, to, data)
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

/** Position with borrow assets rounded UP like Morpho (toAssetsUp). Interest since lastUpdate is not accrued (see report). */
export async function loadBluePosition(chain: string, marketId: string, user: string): Promise<BluePosition> {
	const [pos, mkt] = await Promise.all([
		readContract<readonly [bigint, bigint, bigint]>(chain, MORPHO_BLUE, blueAbi, 'position', [marketId, user]),
		readContract<readonly [bigint, bigint, bigint, bigint, bigint, bigint]>(chain, MORPHO_BLUE, blueAbi, 'market', [marketId]),
	])
	const borrowShares = pos[1]
	const totalBorrowAssets = mkt[2]
	const totalBorrowShares = mkt[3]
	// toAssetsUp(shares, totalAssets, totalShares) with virtual 1 / 1e6 offsets.
	const num = borrowShares * (totalBorrowAssets + 1n)
	const den = totalBorrowShares + 1_000_000n
	const borrowAssets = (num + den - 1n) / den
	return { collateral: pos[2], borrowShares, borrowAssets, totalBorrowAssets, totalBorrowShares, lastUpdate: mkt[4] }
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
		if (existing) return existing
		const id = newId('xfer')
		const hash = hashOf(input.type, input.account.id, input.direction, input.amountMinor.toString())
		yield* bankDb((db) =>
			db.insert(bankTransfers).values({
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
			}),
		)
		yield* ledger.post({
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
		return yield* bankDb(async (db) => (await db.select().from(bankTransfers).where(eq(bankTransfers.id, id)).limit(1))[0]!)
	})

export const requireEvmAccount = (a: BankAccount) => {
	if (!a.address || a.walletId === null || a.walletUserId === null)
		throw bankErr('WALLET_UNAVAILABLE', 'Account has no custody wallet')
	return a.address
}
