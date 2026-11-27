/**
 * BankEarnService (M2) — MONEY-PATH.
 *
 * Savings = Morpho ERC-4626 vault shares held by the account's custody wallet.
 *  - deposit : ledger checking->savings (type 'earn', reserved first) -> approve -> vault.deposit.
 *              Any definitive failure reverses the ledger move; ambiguous results stay `pending`
 *              and are finished by confirmPendingOps() (reconciler tick).
 *  - withdraw: vault.withdraw/redeem first (cannot know yield beforehand), then ledger:
 *              savings->checking for the pro-rata principal, external->checking for realized yield.
 *  - principal = savings ledger balance; value = vault.convertToAssets(shares); yield = value - principal.
 * Every operation is idempotent on (owner, idempotencyKey) via bank_earn_ops.
 */
import { and, desc, eq, gt, inArray, sql } from 'drizzle-orm'
import { Context, Effect, Layer } from 'effect'
import {
	type BankAccount,
	type BankEarnOp,
	type BankEarnSetting,
	bankEarnOps,
	bankEarnPositions,
	bankEarnSettings,
	bankEarnSnapshots,
} from '../../db'
import { logger } from '../../lib/logger'
import { findAsset } from './assets'
import { BankLedgerService } from './BankLedgerService'
import { BankTransferService, type BankDeps } from './BankTransferService'
import { evmTokenBalance } from './chain'
import { type BankOwner, bankDb, newId } from './db'
import {
	call,
	erc20Abi,
	hashOf,
	isInterestFree,
	postExternalLeg,
	readContract,
	vaultAbi,
	vaultEvent,
	waitReceipt,
} from './earnCreditChain'
import { BankError, bankErr } from './errors'

type Fx<A> = Effect.Effect<A, BankError, BankDeps | BankTransferService>

export interface Vault {
	address: string
	name: string
	symbol: string
	chain: string
	asset: string
	assetAddress: string
	decimals: number
	apy: number
	netApy: number
	feePct: number
	totalAssetsMinor: string
	totalAssetsUsd: number | null
	listed: boolean
}

export interface EarnPositionView {
	savingsAccountId: string
	checkingAccountId: string
	vault: string
	chain: string
	asset: string
	sharesMinor: string
	pledgedSharesMinor: string
	principalMinor: string
	valueMinor: string
	yieldMinor: string
	realizedYieldMinor: string
	apy: number | null
}

export interface DepositInput {
	owner: BankOwner
	idempotencyKey: string
	accountId: string
	vault: string
	amountMinor: string
	source?: 'manual' | 'sweep'
}
export interface WithdrawInput {
	owner: BankOwner
	idempotencyKey: string
	accountId: string
	vault: string
	/** Omit with `all: true` to redeem every free share. */
	amountMinor?: string | undefined
	all?: boolean | undefined
}
export interface EarnSettingsInput {
	owner: BankOwner
	accountId: string
	vault: string
	floorMinor: string
	enabled: boolean
	minSweepMinor?: string | undefined
}

export interface BankEarnServiceInterface {
	readonly listVaults: (owner: BankOwner, q: { chain: string; asset: string }) => Fx<{ vaults: Vault[] }>
	readonly deposit: (i: DepositInput) => Fx<EarnOpView>
	readonly withdraw: (i: WithdrawInput) => Fx<EarnOpView>
	readonly positions: (owner: BankOwner) => Fx<{ positions: EarnPositionView[] }>
	readonly history: (owner: BankOwner, q: { accountId?: string | undefined; limit?: number | undefined }) => Fx<{ snapshots: unknown[]; operations: BankEarnOp[] }>
	readonly getSettings: (owner: BankOwner) => Fx<{ settings: BankEarnSetting[] }>
	readonly setSettings: (i: EarnSettingsInput) => Fx<{ settings: BankEarnSetting }>
	/** Reconciler hooks (called from the recurring job). */
	readonly runSweep: (opts?: { now?: Date }) => Fx<{ checked: number; swept: number; skipped: number; failed: number }>
	readonly confirmPendingOps: () => Fx<{ checked: number; confirmed: number; failed: number }>
	readonly snapshotPositions: (opts?: { now?: Date }) => Fx<{ written: number }>
}

export type EarnOpView = BankEarnOp

export class BankEarnService extends Context.Tag('BankEarnService')<BankEarnService, BankEarnServiceInterface>() {}

// ------------------------------------------------------------------ helpers

const lc = (s: string) => s.toLowerCase()
const isAddr = (s: string) => /^0x[0-9a-fA-F]{40}$/.test(s)
const periodOf = (d: Date) => d.toISOString().slice(0, 10)

const up = <A>(f: () => Promise<A>, what: string): Effect.Effect<A, BankError> =>
	Effect.tryPromise({
		try: f,
		catch: (e) => (e instanceof BankError ? e : bankErr('UPSTREAM', `${what}: ${e instanceof Error ? e.message : String(e)}`, { cause: e })),
	})

// Morpho REST API v0 (the GraphQL API incl. `vaults` is retired 2027-01-25; verified live 2026-11-27).
const MORPHO_REST = 'https://api.morpho.org/v0'
/** REST has no `listed` flag, so curation is approximated: a vault must have a curator, a guardian, a >=1 day timelock and TVL >= MIN_VAULT_TVL_UNITS whole asset units. */
const MIN_VAULT_TVL_UNITS = 1_000_000n
const MIN_TIMELOCK_SECONDS = 86_400
const ZERO_ADDR = /^0x0{40}$/i
const MAX_LIST_CANDIDATES = 15

async function morphoRest<T>(path: string): Promise<T | null> {
	const res = await fetch(`${MORPHO_REST}${path}`, { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(15_000) })
	if (res.status === 404) return null
	if (!res.ok) throw new Error(`Morpho API ${res.status} ${path}`)
	const j = (await res.json()) as { data?: T }
	if (j.data === undefined) throw new Error('Morpho API: missing data')
	return j.data
}

interface RestVaultListItem { chain_id: number; vault_address: string; curator: string | null; guardian: string | null; asset_address: string }
interface RestVault {
	chain_id: number; address: string; name: string; symbol: string
	asset: { address: string; decimals: number; symbol: string }
	fee_wad: string | null; curator: string | null; guardian: string | null; timelock_seconds: number | null
}
interface RestState { total_assets: string }
interface RestApy { apy: number | null }

const wadPct = (w: string | null): number => (w ? Number((BigInt(w) * 10_000n) / 10n ** 18n) / 100 : 0)
const nonZero = (a: string | null | undefined): boolean => !!a && !ZERO_ADDR.test(a)

async function buildVault(chainId: number, chain: string, address: string): Promise<Vault | null> {
	const sel = `${chainId}:${address}`
	const [d, st, apy] = await Promise.all([
		morphoRest<RestVault>(`/vaults-v1/${sel}`),
		morphoRest<RestState>(`/vaults-v1/${sel}/state`),
		morphoRest<RestApy>(`/vaults-v1/${sel}/apy-averages?lookback=seven_days`),
	])
	if (!d || !st) return null
	const total = BigInt(st.total_assets)
	const listed = nonZero(d.curator) && nonZero(d.guardian) && (d.timelock_seconds ?? 0) >= MIN_TIMELOCK_SECONDS && total >= MIN_VAULT_TVL_UNITS * 10n ** BigInt(d.asset.decimals)
	const rate = (apy?.apy ?? 0) * 100
	return {
		address: d.address, name: d.name, symbol: d.symbol, chain, asset: d.asset.symbol, assetAddress: d.asset.address, decimals: d.asset.decimals,
		apy: rate, netApy: rate, feePct: wadPct(d.fee_wad), totalAssetsMinor: total.toString(), totalAssetsUsd: null, listed,
	}
}

export async function fetchVaults(chainId: number, chain: string, assetAddress: string): Promise<Vault[]> {
	const items = (await morphoRest<RestVaultListItem[]>(`/vaults-v1?chain_ids=${chainId}&asset_addresses=${assetAddress}&limit=100`)) ?? []
	const candidates = items.filter((i) => i.chain_id === chainId && nonZero(i.curator) && nonZero(i.guardian))
	const states = await Promise.all(candidates.map(async (c) => ({ c, st: await morphoRest<RestState>(`/vaults-v1/${chainId}:${c.vault_address}/state`).catch(() => null) })))
	const top = states.filter((x) => x.st).sort((x, y) => (BigInt(y.st!.total_assets) > BigInt(x.st!.total_assets) ? 1 : -1)).slice(0, MAX_LIST_CANDIDATES)
	const built = await Promise.all(top.map((x) => buildVault(chainId, chain, x.c.vault_address).catch(() => null)))
	return built.filter((v): v is Vault => !!v && v.listed).sort((x, y) => (BigInt(y.totalAssetsMinor) > BigInt(x.totalAssetsMinor) ? 1 : -1))
}

async function fetchVault(chainId: number, chain: string, address: string): Promise<Vault | null> {
	return buildVault(chainId, chain, address)
}

/** Resolves + validates a vault: listed on Morpho, same underlying as the account asset (verified on-chain). */
const requireVault = (acct: BankAccount, vaultAddr: string): Effect.Effect<Vault, BankError> =>
	Effect.gen(function* () {
		if (!isAddr(vaultAddr)) return yield* Effect.fail(bankErr('VALIDATION', 'vault must be an EVM address'))
		const asset = findAsset(acct.asset, acct.chain)
		if (!asset || asset.family !== 'evm' || asset.chainId === null)
			return yield* Effect.fail(bankErr('ASSET_UNSUPPORTED', `Earn supports EVM assets only (${acct.asset} on ${acct.chain})`))
		const v = yield* up(() => fetchVault(asset.chainId!, acct.chain, vaultAddr), 'Morpho vault lookup')
		if (!v || !v.listed) return yield* Effect.fail(bankErr('NOT_FOUND', `Vault ${vaultAddr} is not a listed Morpho vault on ${acct.chain}`))
		const underlying = yield* up(() => readContract<string>(acct.chain, vaultAddr, vaultAbi, 'asset'), 'vault.asset()')
		if (lc(underlying) !== lc(asset.address))
			return yield* Effect.fail(bankErr('VALIDATION', `Vault underlying ${underlying} does not match ${acct.asset} (${asset.address})`))
		return v
	})

const guardEarn = (acct: BankAccount): Effect.Effect<void, BankError> =>
	isInterestFree(acct)
		? Effect.fail(bankErr('POLICY_BLOCKED', 'INTEREST_FREE_MODE: this account uses a sharia-compliant (interest-free) profile; earn products are disabled'))
		: Effect.void

const loadOwnedChecking = (owner: BankOwner, accountId: string): Fx<BankAccount> =>
	Effect.gen(function* () {
		const ledger = yield* BankLedgerService
		const a = yield* ledger.getAccount(owner, accountId)
		if (a.kind === 'savings' || a.kind === 'pool' || a.kind === 'credit')
			return yield* Effect.fail(bankErr('VALIDATION', `Use a checking/treasury account (got ${a.kind})`))
		if (a.status !== 'active') return yield* Effect.fail(bankErr('ACCOUNT_STATE', `Account is ${a.status}`))
		if (!a.address || a.walletId === null || a.walletUserId === null) return yield* Effect.fail(bankErr('WALLET_UNAVAILABLE', 'Account has no custody wallet'))
		return a
	})

const savingsLabel = (vault: string) => `earn:${lc(vault).slice(2, 12)}`

const ensureSavings = (owner: BankOwner, checking: BankAccount, vault: string): Fx<BankAccount> =>
	Effect.gen(function* () {
		const ledger = yield* BankLedgerService
		return yield* ledger.openAccount({
			owner,
			kind: 'savings',
			asset: checking.asset,
			chain: checking.chain,
			label: savingsLabel(vault),
			wallet: { walletId: checking.walletId!, walletUserId: checking.walletUserId!, address: checking.address! },
			metadata: { earnVault: vault },
		})
	})

const getOp = (owner: BankOwner, key: string) =>
	bankDb(async (db) => {
		const [r] = await db
			.select()
			.from(bankEarnOps)
			.where(and(eq(bankEarnOps.ownerType, owner.ownerType), eq(bankEarnOps.ownerId, owner.ownerId), eq(bankEarnOps.idempotencyKey, key)))
			.limit(1)
		return r ?? null
	})

const patchOp = (id: string, patch: Partial<typeof bankEarnOps.$inferInsert>) =>
	bankDb(async (db) => {
		const [r] = await db.update(bankEarnOps).set({ ...patch, updatedAt: new Date() }).where(eq(bankEarnOps.id, id)).returning()
		if (!r) throw bankErr('DB', `earn op ${id} vanished`)
		return r
	})

const addShares = (savingsId: string, deltaFree: bigint) =>
	bankDb(async (db) => {
		await db
			.update(bankEarnPositions)
			.set({ sharesMinor: sql`${bankEarnPositions.sharesMinor} + ${deltaFree.toString()}::numeric`, updatedAt: new Date() })
			.where(eq(bankEarnPositions.savingsAccountId, savingsId))
	})

const getPosition = (savingsId: string) =>
	bankDb(async (db) => (await db.select().from(bankEarnPositions).where(eq(bankEarnPositions.savingsAccountId, savingsId)).limit(1))[0] ?? null)

/** MONEY-PATH: returns the ledger reservation of a failed deposit (savings -> checking). Idempotent on its key. */
const undoDeposit = (op: BankEarnOp, owner: BankOwner, reason: string): Fx<BankEarnOp> =>
	Effect.gen(function* () {
		const xfer = yield* BankTransferService
		yield* xfer.transfer({
			owner,
			idempotencyKey: `earn:${op.idempotencyKey}:undo`,
			type: 'earn',
			fromAccountId: op.savingsAccountId,
			toAccountId: op.checkingAccountId,
			amountMinor: op.assetsMinor,
			memo: 'earn deposit reversed',
			metadata: { earnOpId: op.id, reason },
		})
		logger.warn({ opId: op.id, reason }, '[bank-earn] deposit reversed')
		return yield* patchOp(op.id, { status: 'failed', failureReason: reason.slice(0, 1000) })
	})

/**
 * MONEY-PATH: books a confirmed withdrawal. principal share = savings balance * burned / sharesBefore.
 * Idempotent: every posting has a fixed idempotency key derived from the op.
 */
const finalizeWithdraw = (op: BankEarnOp, owner: BankOwner, received: bigint, burned: bigint): Fx<BankEarnOp> =>
	Effect.gen(function* () {
		const ledger = yield* BankLedgerService
		const xfer = yield* BankTransferService
		const pos = yield* getPosition(op.savingsAccountId)
		const meta = op.metadata as { sharesBefore?: string; principalBefore?: string }
		const sharesBefore = BigInt(meta.sharesBefore ?? '0')
		const principalBefore = BigInt(meta.principalBefore ?? '0')
		if (sharesBefore <= 0n) return yield* Effect.fail(bankErr('DB', 'withdraw op lacks sharesBefore'))
		const principalPortion = burned >= sharesBefore ? principalBefore : (principalBefore * burned) / sharesBefore
		const toChecking = principalPortion < received ? principalPortion : received
		const savings = yield* ledger.getAccountById(op.savingsAccountId)
		const checking = yield* ledger.getAccountById(op.checkingAccountId)
		if (toChecking > 0n)
			yield* xfer.transfer({
				owner,
				idempotencyKey: `earn:${op.idempotencyKey}:principal`,
				type: 'earn',
				fromAccountId: savings.id,
				toAccountId: checking.id,
				amountMinor: toChecking.toString(),
				memo: 'earn withdraw: principal',
				metadata: { earnOpId: op.id, txHash: op.txHash },
			})
		if (received > principalPortion)
			yield* postExternalLeg({
				owner,
				idempotencyKey: `earn:${op.idempotencyKey}:yield`,
				type: 'earn',
				account: checking,
				direction: 'in',
				amountMinor: received - principalPortion,
				txHash: op.txHash ?? undefined,
				memo: 'earn withdraw: realized yield',
				metadata: { earnOpId: op.id },
			})
		if (received < principalPortion)
			yield* postExternalLeg({
				owner,
				idempotencyKey: `earn:${op.idempotencyKey}:loss`,
				type: 'earn',
				account: savings,
				direction: 'out',
				amountMinor: principalPortion - received,
				txHash: op.txHash ?? undefined,
				memo: 'earn withdraw: realized loss',
				metadata: { earnOpId: op.id },
			})
		const realized = received > principalPortion ? received - principalPortion : 0n
		if (pos)
			yield* bankDb((db) =>
				db
					.update(bankEarnPositions)
					.set({
						sharesMinor: sql`greatest(${bankEarnPositions.sharesMinor} - ${burned.toString()}::numeric, 0)`,
						realizedYieldMinor: sql`${bankEarnPositions.realizedYieldMinor} + ${realized.toString()}::numeric`,
						updatedAt: new Date(),
					})
					.where(eq(bankEarnPositions.savingsAccountId, op.savingsAccountId)),
			)
		return yield* patchOp(op.id, { status: 'confirmed', sharesMinor: burned.toString(), failureReason: null, metadata: { ...op.metadata, receivedMinor: received.toString(), realizedYieldMinor: realized.toString() } })
	})

// ------------------------------------------------------------------ operations

const deposit = (i: DepositInput): Fx<EarnOpView> =>
	Effect.gen(function* () {
		if (!/^[1-9][0-9]{0,77}$/.test(i.amountMinor)) return yield* Effect.fail(bankErr('VALIDATION', 'amountMinor must be a positive integer string'))
		const amount = BigInt(i.amountMinor)
		const checking = yield* loadOwnedChecking(i.owner, i.accountId)
		yield* guardEarn(checking)
		const reqHash = hashOf('deposit', checking.id, lc(i.vault), i.amountMinor)
		const prior = yield* getOp(i.owner, i.idempotencyKey)
		if (prior) {
			if (prior.requestHash !== reqHash) return yield* Effect.fail(bankErr('CONFLICT', 'idempotencyKey already used with different terms'))
			return prior.status === 'pending' ? yield* confirmOp(prior) : prior
		}
		const vault = yield* requireVault(checking, i.vault)
		const asset = findAsset(checking.asset, checking.chain)!
		const ledger = yield* BankLedgerService
		const xfer = yield* BankTransferService

		const bal = yield* ledger.balance(checking.id)
		if (bal < amount) return yield* Effect.fail(bankErr('INSUFFICIENT_FUNDS', `Balance ${bal} < ${amount}`))
		const onchain = yield* up(() => evmTokenBalance(asset, checking.address!), 'wallet balance')
		if (onchain < amount) return yield* Effect.fail(bankErr('INSUFFICIENT_FUNDS', `Wallet holds ${onchain} on-chain (some funds may still be settling)`))

		const savings = yield* ensureSavings(i.owner, checking, vault.address)
		yield* bankDb((db) =>
			db
				.insert(bankEarnPositions)
				.values({ savingsAccountId: savings.id, ownerType: i.owner.ownerType, ownerId: i.owner.ownerId, checkingAccountId: checking.id, chain: checking.chain, asset: checking.asset, vault: vault.address })
				.onConflictDoNothing(),
		)
		const opId = newId('xfer').replace('xfer_', 'earn_')
		const inserted = yield* bankDb(async (db) => {
			const rows = await db
				.insert(bankEarnOps)
				.values({
					id: opId, ownerType: i.owner.ownerType, ownerId: i.owner.ownerId, idempotencyKey: i.idempotencyKey, requestHash: reqHash,
					kind: 'deposit', source: i.source ?? 'manual', savingsAccountId: savings.id, checkingAccountId: checking.id,
					vault: vault.address, chain: checking.chain, assetsMinor: i.amountMinor, status: 'pending',
				})
				.onConflictDoNothing()
				.returning()
			return rows[0] ?? null
		})
		if (!inserted) {
			const raced = yield* getOp(i.owner, i.idempotencyKey)
			if (raced) return raced
			return yield* Effect.fail(bankErr('DB', 'earn op insert raced and vanished'))
		}
		let op = inserted

		// 1) Reserve in the ledger (checking -> savings). Same wallet+asset => ledger-only, confirmed immediately.
		const t = yield* xfer
			.transfer({
				owner: i.owner,
				idempotencyKey: `earn:${i.idempotencyKey}`,
				type: 'earn',
				fromAccountId: checking.id,
				toAccountId: savings.id,
				amountMinor: i.amountMinor,
				memo: `earn deposit ${vault.symbol}`,
				metadata: { earnOpId: op.id, vault: vault.address },
			})
			.pipe(Effect.tapError((e) => patchOp(op.id, { status: 'failed', failureReason: e.message.slice(0, 1000) }).pipe(Effect.ignore)))
		op = yield* patchOp(op.id, { transferId: t.id })

		// 2) approve (exact amount) + deposit. Failure before broadcast => reverse the reservation.
		const onchainStep = Effect.gen(function* () {
			const allowance = yield* up(() => readContract<bigint>(checking.chain, asset.address, erc20Abi, 'allowance', [checking.address, vault.address]), 'allowance')
			if (allowance < amount) {
				const ap = yield* xfer.sendEvm({ account: checking, to: asset.address, data: call(erc20Abi, 'approve', [vault.address, amount]) })
				if (ap.outcome === 'rejected') return yield* Effect.fail(bankErr('UPSTREAM', `approve rejected: ${ap.message ?? ''}`))
				const r = yield* up(() => waitReceipt(checking.chain, ap.txHash), 'approve receipt')
				if (!r) return yield* Effect.fail(bankErr('UPSTREAM', 'approve not mined in time; retry with the same idempotencyKey'))
				if (!r.success) return yield* Effect.fail(bankErr('UPSTREAM', 'approve reverted'))
				op = yield* patchOp(op.id, { approveTxHash: ap.txHash })
			}
			return yield* xfer.sendEvm({
				account: checking,
				to: vault.address,
				data: call(vaultAbi, 'deposit', [amount, checking.address]),
				onSigned: ({ txHash }) => patchOp(op.id, { txHash }).pipe(Effect.asVoid),
			})
		})
		const sent = yield* onchainStep.pipe(
			Effect.catchAll((e) =>
				Effect.gen(function* () {
					// A tx hash may already be persisted (ambiguous) -> keep pending, otherwise release the reservation.
					const cur = yield* getOp(i.owner, i.idempotencyKey)
					if (cur?.txHash) return yield* Effect.fail(e)
					yield* undoDeposit(cur ?? op, i.owner, e.message)
					return yield* Effect.fail(e)
				}),
			),
		)
		if (sent.outcome === 'rejected') {
			const cur = (yield* getOp(i.owner, i.idempotencyKey)) ?? op
			return yield* undoDeposit(cur, i.owner, `deposit rejected: ${sent.message ?? ''}`)
		}
		const cur = (yield* getOp(i.owner, i.idempotencyKey)) ?? op
		return yield* confirmOp(cur)
	})

/** Drives a pending op to a terminal state if its tx has a receipt; otherwise leaves it pending. */
const confirmOp = (op: BankEarnOp): Fx<BankEarnOp> =>
	Effect.gen(function* () {
		if (op.status !== 'pending') return op
		const owner = { ownerType: op.ownerType as BankOwner['ownerType'], ownerId: op.ownerId }
		if (!op.txHash) {
			// Never broadcast. Deposit: stale > 10min => release reservation. Withdraw: nothing moved => fail.
			if (Date.now() - op.updatedAt.getTime() < 10 * 60_000) return op
			return op.kind === 'deposit' ? yield* undoDeposit(op, owner, 'never broadcast') : yield* patchOp(op.id, { status: 'failed', failureReason: 'never broadcast' })
		}
		const { evmReceipt } = yield* Effect.promise(() => import('./chain'))
		const r = yield* up(() => waitReceipt(op.chain, op.txHash!, 6_000).then((x) => x ?? evmReceipt(op.chain, op.txHash!)), 'receipt')
		if (!r) return op
		if (!r.success) return op.kind === 'deposit' ? yield* undoDeposit(op, owner, 'deposit tx reverted') : yield* patchOp(op.id, { status: 'failed', failureReason: 'withdraw tx reverted' })
		if (op.kind === 'deposit') {
			const ev = vaultEvent(r, op.vault, 'deposit')
			if (!ev) return yield* patchOp(op.id, { metadata: { ...op.metadata, reviewRequired: 'no Deposit event in receipt' } })
			yield* addShares(op.savingsAccountId, ev.shares)
			return yield* patchOp(op.id, { status: 'confirmed', sharesMinor: ev.shares.toString(), failureReason: null })
		}
		const ev = vaultEvent(r, op.vault, 'withdraw')
		if (!ev) return yield* patchOp(op.id, { metadata: { ...op.metadata, reviewRequired: 'no Withdraw event in receipt' } })
		return yield* finalizeWithdraw(op, owner, ev.assets, ev.shares)
	})

const withdraw = (i: WithdrawInput): Fx<EarnOpView> =>
	Effect.gen(function* () {
		if (!i.all && !(i.amountMinor && /^[1-9][0-9]{0,77}$/.test(i.amountMinor))) return yield* Effect.fail(bankErr('VALIDATION', 'provide amountMinor (positive integer string) or all=true'))
		const checking = yield* loadOwnedChecking(i.owner, i.accountId)
		yield* guardEarn(checking)
		const reqHash = hashOf('withdraw', checking.id, lc(i.vault), i.all ? 'all' : i.amountMinor)
		const prior = yield* getOp(i.owner, i.idempotencyKey)
		if (prior) {
			if (prior.requestHash !== reqHash) return yield* Effect.fail(bankErr('CONFLICT', 'idempotencyKey already used with different terms'))
			return prior.status === 'pending' ? yield* confirmOp(prior) : prior
		}
		const ledger = yield* BankLedgerService
		const xfer = yield* BankTransferService
		const savings = yield* ensureSavings(i.owner, checking, i.vault)
		const pos = yield* getPosition(savings.id)
		if (!pos || BigInt(pos.sharesMinor) === 0n) return yield* Effect.fail(bankErr('NOT_FOUND', 'No withdrawable shares in this vault (pledged shares must be released from credit lines first)'))
		const free = BigInt(pos.sharesMinor)
		const walletShares = yield* up(() => readContract<bigint>(checking.chain, i.vault, erc20Abi, 'balanceOf', [checking.address]), 'share balance')
		if (walletShares < free) return yield* Effect.fail(bankErr('CONFLICT', `Tracked shares ${free} exceed wallet shares ${walletShares}; refusing until reconciled`))
		const principalBefore = yield* ledger.balance(savings.id)
		const maxAssets = yield* up(() => readContract<bigint>(checking.chain, i.vault, vaultAbi, 'convertToAssets', [free]), 'convertToAssets')
		let data: `0x${string}`
		let amountEst: bigint
		if (i.all) {
			amountEst = maxAssets
			data = call(vaultAbi, 'redeem', [free, checking.address, checking.address])
		} else {
			amountEst = BigInt(i.amountMinor!)
			if (amountEst > maxAssets) return yield* Effect.fail(bankErr('INSUFFICIENT_FUNDS', `Position is worth ${maxAssets}; requested ${amountEst}`))
			const liquid = yield* up(() => readContract<bigint>(checking.chain, i.vault, vaultAbi, 'maxWithdraw', [checking.address]), 'maxWithdraw')
			if (amountEst > liquid) return yield* Effect.fail(bankErr('LIMIT_EXCEEDED', `Vault liquidity allows ${liquid} right now`))
			data = call(vaultAbi, 'withdraw', [amountEst, checking.address, checking.address])
		}
		const opId = newId('xfer').replace('xfer_', 'earn_')
		const inserted = yield* bankDb(async (db) => {
			const rows = await db
				.insert(bankEarnOps)
				.values({
					id: opId, ownerType: i.owner.ownerType, ownerId: i.owner.ownerId, idempotencyKey: i.idempotencyKey, requestHash: reqHash,
					kind: 'withdraw', source: 'manual', savingsAccountId: savings.id, checkingAccountId: checking.id, vault: pos.vault, chain: checking.chain,
					assetsMinor: amountEst.toString(), status: 'pending',
					metadata: { sharesBefore: free.toString(), principalBefore: principalBefore.toString(), all: !!i.all },
				})
				.onConflictDoNothing()
				.returning()
			return rows[0] ?? null
		})
		if (!inserted) return (yield* getOp(i.owner, i.idempotencyKey)) ?? (yield* Effect.fail(bankErr('DB', 'earn op insert raced')))
		const op = inserted
		const sent = yield* xfer.sendEvm({
			account: checking,
			to: pos.vault,
			data,
			onSigned: ({ txHash }) => patchOp(op.id, { txHash }).pipe(Effect.asVoid),
		})
		if (sent.outcome === 'rejected') return yield* patchOp(op.id, { status: 'failed', failureReason: `withdraw rejected: ${sent.message ?? ''}` })
		const cur = (yield* getOp(i.owner, i.idempotencyKey)) ?? op
		return yield* confirmOp(cur)
	})

// ------------------------------------------------------------------ reads

const positions = (owner: BankOwner): Fx<{ positions: EarnPositionView[] }> =>
	Effect.gen(function* () {
		const ledger = yield* BankLedgerService
		const rows = yield* bankDb((db) =>
			db.select().from(bankEarnPositions).where(and(eq(bankEarnPositions.ownerType, owner.ownerType), eq(bankEarnPositions.ownerId, owner.ownerId))),
		)
		const out: EarnPositionView[] = []
		for (const p of rows) {
			const total = BigInt(p.sharesMinor) + BigInt(p.pledgedSharesMinor)
			const value = total === 0n ? 0n : yield* up(() => readContract<bigint>(p.chain, p.vault, vaultAbi, 'convertToAssets', [total]), 'convertToAssets')
			const principal = yield* ledger.balance(p.savingsAccountId)
			const asset = findAsset(p.asset, p.chain)
			const apy = asset?.chainId
				? yield* up(() => fetchVault(asset.chainId!, p.chain, p.vault), 'Morpho vault lookup').pipe(Effect.map((v) => v?.netApy ?? null), Effect.catchAll(() => Effect.succeed(null)))
				: null
			out.push({
				savingsAccountId: p.savingsAccountId, checkingAccountId: p.checkingAccountId, vault: p.vault, chain: p.chain, asset: p.asset,
				sharesMinor: p.sharesMinor, pledgedSharesMinor: p.pledgedSharesMinor, principalMinor: principal.toString(),
				valueMinor: value.toString(), yieldMinor: (value - principal).toString(), realizedYieldMinor: p.realizedYieldMinor, apy,
			})
		}
		return { positions: out }
	})

const history = (owner: BankOwner, q: { accountId?: string | undefined; limit?: number | undefined }): Fx<{ snapshots: unknown[]; operations: BankEarnOp[] }> =>
	bankDb(async (db) => {
		const limit = Math.min(Math.max(q.limit ?? 90, 1), 365)
		const mine = await db
			.select({ id: bankEarnPositions.savingsAccountId, checking: bankEarnPositions.checkingAccountId })
			.from(bankEarnPositions)
			.where(and(eq(bankEarnPositions.ownerType, owner.ownerType), eq(bankEarnPositions.ownerId, owner.ownerId)))
		const ids = mine.filter((m) => !q.accountId || m.id === q.accountId || m.checking === q.accountId).map((m) => m.id)
		if (ids.length === 0) return { snapshots: [], operations: [] }
		const snapshots = await db.select().from(bankEarnSnapshots).where(inArray(bankEarnSnapshots.savingsAccountId, ids)).orderBy(desc(bankEarnSnapshots.takenAt)).limit(limit)
		const operations = await db.select().from(bankEarnOps).where(and(eq(bankEarnOps.ownerType, owner.ownerType), eq(bankEarnOps.ownerId, owner.ownerId), inArray(bankEarnOps.savingsAccountId, ids))).orderBy(desc(bankEarnOps.createdAt)).limit(limit)
		return {
			snapshots: snapshots.map((s) => ({ ...s, yieldMinor: (BigInt(s.valueMinor) - BigInt(s.principalMinor)).toString() })),
			operations,
		}
	})

const getSettings = (owner: BankOwner): Fx<{ settings: BankEarnSetting[] }> =>
	bankDb(async (db) => ({
		settings: await db.select().from(bankEarnSettings).where(and(eq(bankEarnSettings.ownerType, owner.ownerType), eq(bankEarnSettings.ownerId, owner.ownerId))),
	}))

const setSettings = (i: EarnSettingsInput): Fx<{ settings: BankEarnSetting }> =>
	Effect.gen(function* () {
		const checking = yield* loadOwnedChecking(i.owner, i.accountId)
		yield* guardEarn(checking)
		for (const [k, v] of [['floorMinor', i.floorMinor], ['minSweepMinor', i.minSweepMinor ?? '1']] as const)
			if (!/^(0|[1-9][0-9]{0,77})$/.test(v)) return yield* Effect.fail(bankErr('VALIDATION', `${k} must be a non-negative integer string`))
		const vault = yield* requireVault(checking, i.vault)
		const row = yield* bankDb(async (db) => {
			const [r] = await db
				.insert(bankEarnSettings)
				.values({
					accountId: checking.id, ownerType: i.owner.ownerType, ownerId: i.owner.ownerId, enabled: i.enabled ? 1 : 0,
					floorMinor: i.floorMinor, vault: vault.address, minSweepMinor: i.minSweepMinor ?? '1000000',
				})
				.onConflictDoUpdate({
					target: bankEarnSettings.accountId,
					set: { enabled: i.enabled ? 1 : 0, floorMinor: i.floorMinor, vault: vault.address, ...(i.minSweepMinor ? { minSweepMinor: i.minSweepMinor } : {}), updatedAt: new Date() },
				})
				.returning()
			return r!
		})
		return { settings: row }
	})

// ------------------------------------------------------------------ recurring job hooks

/**
 * MONEY-PATH: idempotent per UTC-day period. The deposit's idempotency key is `sweep:<account>:<period>`
 * so a crash/replay inside a period can never deposit twice; the period is stamped only after success.
 */
const runSweep = (opts?: { now?: Date }): Fx<{ checked: number; swept: number; skipped: number; failed: number }> =>
	Effect.gen(function* () {
		const period = periodOf(opts?.now ?? new Date())
		const rows = yield* bankDb((db) => db.select().from(bankEarnSettings).where(eq(bankEarnSettings.enabled, 1)).limit(500))
		const ledger = yield* BankLedgerService
		const res = { checked: 0, swept: 0, skipped: 0, failed: 0 }
		for (const s of rows) {
			res.checked++
			if (s.lastSweepPeriod === period) { res.skipped++; continue }
			const owner = { ownerType: s.ownerType as BankOwner['ownerType'], ownerId: s.ownerId }
			const outcome = yield* Effect.gen(function* () {
				const acct = yield* ledger.getAccountById(s.accountId)
				if (acct.status !== 'active' || isInterestFree(acct)) return 'skipped' as const
				const bal = yield* ledger.balance(acct.id)
				const idle = bal - BigInt(s.floorMinor)
				if (idle <= 0n || idle < BigInt(s.minSweepMinor)) return 'skipped' as const
				const op = yield* deposit({ owner, idempotencyKey: `sweep:${s.accountId}:${period}`, accountId: s.accountId, vault: s.vault, amountMinor: idle.toString(), source: 'sweep' })
				if (op.status === 'failed') return yield* Effect.fail(bankErr('UPSTREAM', op.failureReason ?? 'sweep deposit failed'))
				yield* bankDb((db) => db.update(bankEarnSettings).set({ lastSweepPeriod: period, updatedAt: new Date() }).where(eq(bankEarnSettings.accountId, s.accountId)))
				return 'swept' as const
			}).pipe(
				Effect.catchAll((e) => {
					logger.warn({ account: s.accountId, err: e.message }, '[bank-earn] sweep failed')
					return Effect.succeed('failed' as const)
				}),
			)
			res[outcome === 'swept' ? 'swept' : outcome === 'failed' ? 'failed' : 'skipped']++
		}
		return res
	})

const confirmPendingOps = (): Fx<{ checked: number; confirmed: number; failed: number }> =>
	Effect.gen(function* () {
		const rows = yield* bankDb((db) => db.select().from(bankEarnOps).where(eq(bankEarnOps.status, 'pending')).limit(100))
		const res = { checked: 0, confirmed: 0, failed: 0 }
		for (const op of rows) {
			res.checked++
			const next = yield* confirmOp(op).pipe(Effect.catchAll((e) => { logger.warn({ op: op.id, err: e.message }, '[bank-earn] confirm failed'); return Effect.succeed(op) }))
			if (next.status === 'confirmed') res.confirmed++
			if (next.status === 'failed') res.failed++
		}
		return res
	})

const snapshotPositions = (opts?: { now?: Date }): Fx<{ written: number }> =>
	Effect.gen(function* () {
		const period = periodOf(opts?.now ?? new Date())
		const ledger = yield* BankLedgerService
		const rows = yield* bankDb((db) => db.select().from(bankEarnPositions).where(gt(sql`${bankEarnPositions.sharesMinor} + ${bankEarnPositions.pledgedSharesMinor}`, sql`0`)).limit(1000))
		let written = 0
		for (const p of rows) {
			const total = BigInt(p.sharesMinor) + BigInt(p.pledgedSharesMinor)
			const snap = yield* Effect.gen(function* () {
				const value = yield* up(() => readContract<bigint>(p.chain, p.vault, vaultAbi, 'convertToAssets', [total]), 'convertToAssets')
				const principal = yield* ledger.balance(p.savingsAccountId)
				yield* bankDb((db) =>
					db.insert(bankEarnSnapshots).values({ id: newId('le').replace('le_', 'snap_'), savingsAccountId: p.savingsAccountId, vault: p.vault, sharesMinor: total.toString(), principalMinor: principal.toString(), valueMinor: value.toString(), period }).onConflictDoNothing(),
				)
				return 1
			}).pipe(Effect.catchAll(() => Effect.succeed(0)))
			written += snap
		}
		return { written }
	})

export const BankEarnServiceLive = Layer.succeed(BankEarnService, {
	listVaults: (owner, q) =>
		Effect.gen(function* () {
			void owner
			const asset = findAsset(q.asset, q.chain)
			if (!asset || asset.family !== 'evm' || asset.chainId === null) return yield* Effect.fail(bankErr('ASSET_UNSUPPORTED', `Earn supports EVM assets only (${q.asset} on ${q.chain})`))
			const vaults = yield* up(() => fetchVaults(asset.chainId!, asset.chain, asset.address), 'Morpho vault list')
			return { vaults }
		}),
	deposit,
	withdraw,
	positions,
	history,
	getSettings,
	setSettings,
	runSweep,
	confirmPendingOps,
	snapshotPositions,
})

