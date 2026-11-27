/**
 * BankLedgerService — accounts + double-entry ledger.
 *
 * Conventions
 * - Money is integer minor units (bigint in code, numeric(78,0) in PG).
 * - balance = credits - debits. Customer accounts can never go negative;
 *   system accounts (owner_type='system': clearing / external / fx) can.
 * - A transfer can post several times ("phases": submit / confirm / reverse);
 *   (transfer_id, phase) is posted at most once.
 */
import { and, desc, eq, inArray, ne, or, sql } from 'drizzle-orm'
import { Context, Effect, Layer } from 'effect'
import {
	agents,
	type BankAccount,
	type BankAccountKind,
	type BankLedgerEntry,
	bankAccounts,
	bankLedgerEntries,
	bankOrgMembers,
	bankOrgWallets,
	bankOrgs,
	bankTransfers,
	users,
	wallets,
} from '../../db'
import type { DbClient, DbTransaction, DrizzleService } from '../../db'
import { type BankAsset, findAsset } from './assets'
import { evmTokenBalance, solTokenBalance } from './chain'
import { type BankOwner, bankDb, isUniqueViolation, newId } from './db'
import { BankError, bankErr } from './errors'

export type SystemAccountRole = 'clearing' | 'external' | 'fx'

export interface WalletRef {
	walletId: number
	walletUserId: number
	address: string
}

export interface OpenAccountInput {
	owner: BankOwner
	kind: BankAccountKind
	asset: string
	chain: string
	label?: string | undefined
	segmentProfile?: string | undefined
	metadata?: Record<string, unknown> | undefined
	/** Server-side only: explicit custody wallet (skips resolution). Never exposed by routes. */
	wallet?: WalletRef | undefined
}

export interface LedgerLeg {
	accountId: string
	direction: 'debit' | 'credit'
	amountMinor: bigint
}

export interface PostInput {
	transferId: string
	phase: string
	legs: LedgerLeg[]
}

export interface StatementPage {
	entries: Array<BankLedgerEntry & { cursor: string }>
	nextCursor: string | null
}

export interface ReconcileReport {
	accountId: string
	chain: string
	asset: string
	address: string | null
	/** Accounts sharing this wallet+asset (the unit that can be compared on-chain). */
	accountsInGroup: string[]
	ledgerMinor: string
	onchainMinor: string
	deltaMinor: string
	inFlightTransfers: number
	status: 'in_sync' | 'pending_settlement' | 'drift'
}

type Fx<A> = Effect.Effect<A, BankError, DrizzleService>

export interface BankLedgerServiceInterface {
	readonly openAccount: (input: OpenAccountInput) => Fx<BankAccount>
	readonly getAccounts: (owner: BankOwner) => Fx<BankAccount[]>
	/** Ownership-checked fetch. NOT_FOUND for both missing and foreign accounts. */
	readonly getAccount: (owner: BankOwner, accountId: string) => Fx<BankAccount>
	/** Unchecked fetch for service-internal use. */
	readonly getAccountById: (accountId: string) => Fx<BankAccount>
	readonly ensureSystemAccount: (role: SystemAccountRole, asset: string, chain: string) => Fx<BankAccount>
	readonly post: (input: PostInput) => Fx<BankLedgerEntry[]>
	readonly balance: (accountId: string) => Fx<bigint>
	readonly statement: (
		owner: BankOwner,
		accountId: string,
		opts?: { limit?: number; cursor?: string | undefined },
	) => Fx<StatementPage>
	readonly reconcile: (owner: BankOwner, accountId: string) => Fx<ReconcileReport>
	readonly resolveCustodyWallet: (owner: BankOwner, family: 'evm' | 'solana') => Fx<WalletRef>
}

export class BankLedgerService extends Context.Tag('BankLedgerService')<
	BankLedgerService,
	BankLedgerServiceInterface
>() {}

const requireAsset = (symbol: string, chain: string): BankAsset => {
	const a = findAsset(symbol, chain)
	if (!a) throw bankErr('ASSET_UNSUPPORTED', `Unsupported asset ${symbol} on ${chain}`)
	return a
}

const SYSTEM_OWNER = 'suwappu'

// ---------------------------------------------------------------- posting core

/**
 * Posts legs inside the caller's transaction. Exported so other bank services can make
 * "insert transfer + post ledger" atomic. Legs with the same (account, direction) are merged
 * so the unique index (transfer, phase, account, direction) holds by construction.
 * Idempotent per (transferId, phase): the transfer row (if any) is locked first, and a
 * concurrent duplicate is resolved by the unique index (caller: see postWithDb).
 */
export async function postInTx(tx: DbTransaction, input: PostInput): Promise<BankLedgerEntry[]> {
	if (input.legs.length < 2) throw bankErr('VALIDATION', 'A posting needs at least two legs')
	for (const l of input.legs)
		if (l.amountMinor <= 0n) throw bankErr('VALIDATION', 'Ledger amounts must be positive integers')

	// Serialise postings of one transfer (row may not exist for module-owned ids; the unique index then backstops).
	await tx.select({ id: bankTransfers.id }).from(bankTransfers).where(eq(bankTransfers.id, input.transferId)).for('update')

	const prior = await tx
		.select()
		.from(bankLedgerEntries)
		.where(and(eq(bankLedgerEntries.transferId, input.transferId), eq(bankLedgerEntries.phase, input.phase)))
	if (prior.length > 0) return prior

	const merged = new Map<string, LedgerLeg>()
	for (const l of input.legs) {
		const k = `${l.accountId}|${l.direction}`
		const m = merged.get(k)
		merged.set(k, m ? { ...m, amountMinor: m.amountMinor + l.amountMinor } : { ...l })
	}
	const legs = [...merged.values()]

	const ids = [...new Set(legs.map((l) => l.accountId))].sort()
	const accts = await tx
		.select()
		.from(bankAccounts)
		.where(inArray(bankAccounts.id, ids))
		.orderBy(bankAccounts.id)
		.for('update')
	const byId = new Map(accts.map((a) => [a.id, a]))
	for (const id of ids) if (!byId.has(id)) throw bankErr('NOT_FOUND', `Ledger account ${id} not found`)

	const net = new Map<string, bigint>()
	for (const l of legs) {
		const a = byId.get(l.accountId)!
		net.set(a.asset, (net.get(a.asset) ?? 0n) + (l.direction === 'debit' ? l.amountMinor : -l.amountMinor))
	}
	for (const [asset, n] of net)
		if (n !== 0n) throw bankErr('VALIDATION', `Unbalanced posting for ${asset}: debits-credits=${n}`)

	const running = new Map(accts.map((a) => [a.id, BigInt(a.balanceMinor)]))
	const out: BankLedgerEntry[] = []
	for (const l of legs) {
		const a = byId.get(l.accountId)!
		if (a.ownerType !== 'system' && a.status !== 'active' && l.direction === 'debit')
			throw bankErr('ACCOUNT_STATE', `Account ${a.id} is ${a.status}`)
		const next = running.get(a.id)! + (l.direction === 'credit' ? l.amountMinor : -l.amountMinor)
		if (next < 0n && a.ownerType !== 'system') throw bankErr('INSUFFICIENT_FUNDS', `Insufficient balance in account ${a.id}`)
		running.set(a.id, next)
		const [e] = await tx
			.insert(bankLedgerEntries)
			.values({
				id: newId('le'),
				transferId: input.transferId,
				accountId: a.id,
				direction: l.direction,
				amountMinor: l.amountMinor.toString(),
				asset: a.asset,
				balanceAfter: next.toString(),
				phase: input.phase,
			})
			.returning()
		out.push(e!)
	}
	for (const [id, bal] of running)
		await tx.update(bankAccounts).set({ balanceMinor: bal.toString(), updatedAt: new Date() }).where(eq(bankAccounts.id, id))
	return out
}

/** Own transaction; a unique violation means a concurrent identical posting won -> return it. */
async function postWithDb(db: DbClient, input: PostInput): Promise<BankLedgerEntry[]> {
	try {
		return await db.transaction((tx) => postInTx(tx, input))
	} catch (e) {
		if (!isUniqueViolation(e)) throw e
		return db
			.select()
			.from(bankLedgerEntries)
			.where(and(eq(bankLedgerEntries.transferId, input.transferId), eq(bankLedgerEntries.phase, input.phase)))
	}
}

/**
 * MONEY-PATH. Org funds must never sit on a person's wallet. Verifies that `wallet` is the org's own
 * dedicated custody wallet (bank_org_wallets row) and that its owning user is the synthetic custody
 * user (negative telegram_id, never an org member / owner). Returns the verified wallet ref.
 */
export const verifyOrgCustodyWallet = async (
	db: DbClient,
	orgId: string,
	family: 'evm' | 'solana',
	expect?: { walletId: number; walletUserId: number; address: string },
): Promise<WalletRef> => {
	const [row] = await db
		.select()
		.from(bankOrgWallets)
		.where(and(eq(bankOrgWallets.orgId, orgId), eq(bankOrgWallets.family, family)))
		.limit(1)
	if (!row)
		throw bankErr('WALLET_UNAVAILABLE', `Organisation has no dedicated ${family} custody wallet`)
	const [w] = await db.select().from(wallets).where(eq(wallets.id, row.walletId)).limit(1)
	if (!w || !w.isActive || w.userId !== row.walletUserId || w.turnkeyWalletId !== row.turnkeyWalletId || w.address !== row.address || !w.turnkeySubOrgId)
		throw bankErr('WALLET_UNAVAILABLE', 'Organisation custody wallet is not usable for signing')
	const [u] = await db.select({ telegramId: users.telegramId }).from(users).where(eq(users.id, w.userId)).limit(1)
	const [org] = await db.select({ ownerUserId: bankOrgs.ownerUserId }).from(bankOrgs).where(eq(bankOrgs.id, orgId)).limit(1)
	const [member] = await db
		.select({ id: bankOrgMembers.id })
		.from(bankOrgMembers)
		.where(and(eq(bankOrgMembers.orgId, orgId), eq(bankOrgMembers.userId, w.userId)))
		.limit(1)
	if (!u || u.telegramId === null || u.telegramId >= 0 || member || org?.ownerUserId === w.userId)
		throw bankErr('FORBIDDEN', 'Org account points at a personal wallet; refusing')
	const ref = { walletId: w.id, walletUserId: w.userId, address: w.address }
	if (expect && (expect.walletId !== ref.walletId || expect.walletUserId !== ref.walletUserId || expect.address !== ref.address))
		throw bankErr('FORBIDDEN', 'Org account wallet is not the organisation custody wallet')
	return ref
}

export const BankLedgerServiceLive = Layer.succeed(BankLedgerService, {
	resolveCustodyWallet: (owner, family) =>
		bankDb(async (db) => {
			if (owner.ownerType === 'user') {
				const uid = Number(owner.ownerId)
				if (!Number.isInteger(uid)) throw bankErr('VALIDATION', 'Invalid user id')
				const rows = await db
					.select()
					.from(wallets)
					.where(and(eq(wallets.userId, uid), eq(wallets.isActive, true), eq(wallets.chainType, family)))
				const w = rows.find((r) => r.walletProvider === 'turnkey' && r.turnkeySubOrgId && r.isDefault) ??
					rows.find((r) => r.walletProvider === 'turnkey' && r.turnkeySubOrgId)
				if (!w)
					throw bankErr('WALLET_UNAVAILABLE', `User has no active custodial ${family} wallet`)
				return { walletId: w.id, walletUserId: w.userId, address: w.address }
			}
			if (owner.ownerType === 'agent') {
				const aid = Number(owner.ownerId)
				const [agent] = await db.select().from(agents).where(eq(agents.id, aid)).limit(1)
				if (!agent) throw bankErr('NOT_FOUND', 'Agent not found')
				const md = (agent.metadata ?? {}) as Record<string, unknown>
				const sfx = family === 'solana' ? '_solana' : ''
				const walletId = md[`internal_wallet_id${sfx}`]
				const internalUser = md[`internal_user_id${sfx}`]
				if (typeof walletId !== 'number' || typeof internalUser !== 'number')
					throw bankErr('WALLET_UNAVAILABLE', `Agent has no managed ${family} wallet (POST /v1/agent/wallets first)`)
				const [w] = await db.select().from(wallets).where(eq(wallets.id, walletId)).limit(1)
				if (!w || w.userId !== internalUser || !w.isActive || !w.turnkeySubOrgId)
					throw bankErr('WALLET_UNAVAILABLE', 'Agent managed wallet is not usable for signing')
				return { walletId: w.id, walletUserId: w.userId, address: w.address }
			}
			throw bankErr(
				'WALLET_UNAVAILABLE',
				`No custody wallet resolver for owner type ${owner.ownerType}; pass an explicit wallet from the owning module`,
			)
		}),

	openAccount: (input) =>
		bankDb(async (db) => {
			const asset = requireAsset(input.asset, input.chain)
			if (!input.wallet) throw bankErr('WALLET_UNAVAILABLE', 'openAccount requires a resolved custody wallet')
			const label = input.label ?? null
			const where = and(
				eq(bankAccounts.ownerType, input.owner.ownerType),
				eq(bankAccounts.ownerId, input.owner.ownerId),
				eq(bankAccounts.kind, input.kind),
				eq(bankAccounts.asset, asset.symbol),
				eq(bankAccounts.chain, asset.chain),
				sql`coalesce(${bankAccounts.label}, '') = ${label ?? ''}`,
			)
			const [existing] = await db.select().from(bankAccounts).where(where).limit(1)
			if (existing) return existing
			const [row] = await db
				.insert(bankAccounts)
				.values({
					id: newId('acct'),
					ownerType: input.owner.ownerType,
					ownerId: input.owner.ownerId,
					kind: input.kind,
					currency: asset.currency,
					asset: asset.symbol,
					chain: asset.chain,
					walletId: input.wallet.walletId,
					walletUserId: input.wallet.walletUserId,
					address: input.wallet.address,
					label,
					segmentProfile: input.segmentProfile ?? null,
					metadata: input.metadata ?? {},
				})
				.onConflictDoNothing()
				.returning()
			if (row) return row
			const [raced] = await db.select().from(bankAccounts).where(where).limit(1)
			if (!raced) throw bankErr('DB', 'Failed to open account')
			return raced
		}),

	getAccounts: (owner) =>
		bankDb((db) =>
			db
				.select()
				.from(bankAccounts)
				.where(
					and(
						eq(bankAccounts.ownerType, owner.ownerType),
						eq(bankAccounts.ownerId, owner.ownerId),
						ne(bankAccounts.status, 'closed'),
					),
				)
				.orderBy(bankAccounts.createdAt),
		),

	getAccount: (owner, accountId) =>
		bankDb(async (db) => {
			const [a] = await db
				.select()
				.from(bankAccounts)
				.where(
					and(
						eq(bankAccounts.id, accountId),
						eq(bankAccounts.ownerType, owner.ownerType),
						eq(bankAccounts.ownerId, owner.ownerId),
					),
				)
				.limit(1)
			if (!a) throw bankErr('NOT_FOUND', 'Account not found')
			return a
		}),

	getAccountById: (accountId) =>
		bankDb(async (db) => {
			const [a] = await db.select().from(bankAccounts).where(eq(bankAccounts.id, accountId)).limit(1)
			if (!a) throw bankErr('NOT_FOUND', 'Account not found')
			return a
		}),

	ensureSystemAccount: (role, assetSymbol, chain) =>
		bankDb(async (db) => {
			const asset = requireAsset(assetSymbol, chain)
			const where = and(
				eq(bankAccounts.ownerType, 'system'),
				eq(bankAccounts.ownerId, SYSTEM_OWNER),
				eq(bankAccounts.asset, asset.symbol),
				eq(bankAccounts.chain, asset.chain),
				eq(bankAccounts.label, role),
			)
			const [existing] = await db.select().from(bankAccounts).where(where).limit(1)
			if (existing) return existing
			await db
				.insert(bankAccounts)
				.values({
					id: newId('acct'),
					ownerType: 'system',
					ownerId: SYSTEM_OWNER,
					kind: 'treasury',
					currency: asset.currency,
					asset: asset.symbol,
					chain: asset.chain,
					label: role,
					metadata: { system: role },
				})
				.onConflictDoNothing()
			const [row] = await db.select().from(bankAccounts).where(where).limit(1)
			if (!row) throw bankErr('DB', 'Failed to create system account')
			return row
		}),

	post: (input) => bankDb((db) => postWithDb(db, input)),

	balance: (accountId) =>
		bankDb(async (db) => {
			const [a] = await db
				.select({ b: bankAccounts.balanceMinor })
				.from(bankAccounts)
				.where(eq(bankAccounts.id, accountId))
				.limit(1)
			if (!a) throw bankErr('NOT_FOUND', 'Account not found')
			return BigInt(a.b)
		}),

	statement: (owner, accountId, opts) =>
		bankDb(async (db) => {
			const [a] = await db
				.select({ id: bankAccounts.id })
				.from(bankAccounts)
				.where(
					and(
						eq(bankAccounts.id, accountId),
						eq(bankAccounts.ownerType, owner.ownerType),
						eq(bankAccounts.ownerId, owner.ownerId),
					),
				)
				.limit(1)
			if (!a) throw bankErr('NOT_FOUND', 'Account not found')
			const limit = Math.min(Math.max(opts?.limit ?? 50, 1), 200)
			let cond = eq(bankLedgerEntries.accountId, accountId)
			if (opts?.cursor) {
				const [ts, id] = opts.cursor.split('|')
				if (!ts || !id) throw bankErr('VALIDATION', 'Invalid cursor')
				cond = and(
					cond,
					sql`(${bankLedgerEntries.createdAt}, ${bankLedgerEntries.id}) < (${ts}::timestamp, ${id})`,
				)!
			}
			const rows = await db
				.select({ e: bankLedgerEntries, ts: sql<string>`${bankLedgerEntries.createdAt}::text` })
				.from(bankLedgerEntries)
				.where(cond)
				.orderBy(desc(bankLedgerEntries.createdAt), desc(bankLedgerEntries.id))
				.limit(limit + 1)
			const page = rows.slice(0, limit).map((r) => ({ ...r.e, cursor: `${r.ts}|${r.e.id}` }))
			return {
				entries: page,
				nextCursor: rows.length > limit ? page[page.length - 1]!.cursor : null,
			}
		}),

	reconcile: (owner, accountId) =>
		bankDb(async (db) => {
			const [acct] = await db
				.select()
				.from(bankAccounts)
				.where(
					and(
						eq(bankAccounts.id, accountId),
						eq(bankAccounts.ownerType, owner.ownerType),
						eq(bankAccounts.ownerId, owner.ownerId),
					),
				)
				.limit(1)
			if (!acct) throw bankErr('NOT_FOUND', 'Account not found')
			if (!acct.address) throw bankErr('VALIDATION', 'Account has no on-chain wallet to reconcile')
			const asset = requireAsset(acct.asset, acct.chain)
			const group = await db
				.select()
				.from(bankAccounts)
				.where(
					and(
						eq(bankAccounts.chain, acct.chain),
						eq(bankAccounts.address, acct.address),
						eq(bankAccounts.asset, acct.asset),
						ne(bankAccounts.status, 'closed'),
					),
				)
			const ledger = group.reduce((s, a) => s + BigInt(a.balanceMinor), 0n)
			let onchain: bigint
			try {
				onchain = asset.family === 'evm' ? await evmTokenBalance(asset, acct.address) : await solTokenBalance(asset, acct.address)
			} catch (e) {
				throw bankErr('UPSTREAM', `Could not read on-chain balance: ${String(e)}`, { cause: e })
			}
			const ids = group.map((g) => g.id)
			const inflight = await db
				.select({ id: bankTransfers.id })
				.from(bankTransfers)
				.where(
					and(
						inArray(bankTransfers.status, ['pending', 'submitted']),
						or(inArray(bankTransfers.fromAccount, ids), inArray(bankTransfers.toAccount, ids)),
					),
				)
			const delta = onchain - ledger
			return {
				accountId,
				chain: acct.chain,
				asset: acct.asset,
				address: acct.address,
				accountsInGroup: ids,
				ledgerMinor: ledger.toString(),
				onchainMinor: onchain.toString(),
				deltaMinor: delta.toString(),
				inFlightTransfers: inflight.length,
				status: delta === 0n ? 'in_sync' : inflight.length > 0 ? 'pending_settlement' : 'drift',
			} satisfies ReconcileReport
		}),
})

export { BankError }
