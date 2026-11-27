/**
 * BankTransferService — MONEY-PATH.
 *
 * Lifecycle (every state change is persisted; ledger is the source of truth for balances):
 *   create (pending) -> ledger "submit": debit FROM / credit clearing   (funds reserved before any signing)
 *   sign -> persist tx hash + status 'submitted' -> broadcast
 *   confirmPending(): receipt/signature verified -> ledger "confirm" + status 'confirmed'
 *   any definitive failure -> ledger "reverse" (clearing -> FROM) + status 'failed'
 * Same wallet+asset internal moves are ledger-only ("settle") and confirmed immediately.
 * Never marked confirmed without an on-chain receipt (EVM) / finalized signature (Solana).
 *
 * Signing: TurnkeyService.signTransactionForAgent wrapped in withSigningFallback —
 * the same primitives as routes/swap.ts:553-584 (see docs/plans/neobank-module-contract.md).
 *
 * Concurrency: a transfer is executed by at most one worker (claim_token); signing runs under a
 * Postgres advisory lock per wallet (replica-safe), re-validates the claim right before signing, and
 * persists 'submitted' only if the claim still holds (else aborts BEFORE broadcast).
 * Status changes that touch money (confirm / reverse) are atomic with their ledger posting.
 */
import { type ConsumesHold, assertAvailable } from './holds'
import { and, desc, eq, inArray, isNull, lt, ne, or, sql } from 'drizzle-orm'
import { Context, Effect, Layer } from 'effect'
import { createHash, randomUUID } from 'node:crypto'
import { agents, bankAccounts, type BankAccount, type BankTransfer, type BankTransferType, bankLedgerEntries, bankTransfers, wallets } from '../../db'
import type { DrizzleService, Wallet } from '../../db'
import { fetchTokenPrices } from '../../lib/prices'
import { logger } from '../../lib/logger'
import { CHAIN_ID_TO_KEY } from '../../config/chains'
import { withSigningFallback } from '../FallbackSigningService'
import { PolicyService } from '../PolicyService'
import { TurnkeyService } from '../TurnkeyService'
import { type BankAsset, findAsset } from './assets'
import { BankLedgerService, type LedgerLeg, postInTx } from './BankLedgerService'
import * as chain from './chain'
import { type BankOwner, bankDb, newId, withDbLock } from './db'
import { BankError, bankErr } from './errors'
import { assertSpendable, type SystemDebit } from './systemDebit'

export type BankDeps = DrizzleService | BankLedgerService | TurnkeyService | PolicyService
type Fx<A> = Effect.Effect<A, BankError, BankDeps>

export interface TransferInput {
	owner: BankOwner
	idempotencyKey: string
	type: BankTransferType
	fromAccountId: string
	toAccountId?: string | undefined
	toExternal?: { address: string } | undefined
	/** Integer minor units as a string. */
	amountMinor: string
	memo?: string | undefined
	metadata?: Record<string, unknown> | undefined
	/** Hold-releasing transfers (card capture, escrow release/fund, stream settlement) name the hold they consume so it is not subtracted from available balance. */
	consumesHold?: ConsumesHold | undefined
	/** MONEY-PATH: required to debit system-kind accounts (escrow/pool). Only services mint it (see systemDebit.ts); routes never pass it. */
	systemDebit?: SystemDebit | undefined
	/**
	 * MONEY-PATH: optional fee taken from the same source account for the same unit. The fee row (`${key}:pfee`) is inserted in the SAME
	 * transaction as the principal under the source-account row lock (available >= amount + fee) and only advances once the principal
	 * is confirmed; if the principal fails the fee is failed unfunded (never charged). A replay with a different fee is a CONFLICT.
	 */
	feeLeg?: { toAccountId: string; amountMinor: string; metadata?: Record<string, unknown> | undefined } | undefined
}

export const feeKeyFor = (key: string): string => `${key}:pfee`

export interface SendEvmInput {
	account: Pick<BankAccount, 'walletId' | 'walletUserId' | 'address' | 'chain'>
	to: string
	data: string
	valueHex?: string
	gas?: bigint
	/** Called after signing, BEFORE broadcast, with the pre-computed tx hash. */
	onSigned?: (info: { txHash: string; nonce: number }) => Effect.Effect<void, BankError, BankDeps>
	/** Called under the wallet lock immediately BEFORE signing; fail (e.g. CONFLICT) to abort. */
	guard?: () => Effect.Effect<void, BankError, BankDeps>
}

export interface SendResult {
	txHash: string
	nonce: number
	outcome: 'accepted' | 'rejected' | 'ambiguous'
	message?: string
}

export interface BankTransferServiceInterface {
	readonly transfer: (input: TransferInput) => Fx<BankTransfer>
	readonly getTransfer: (owner: BankOwner, id: string) => Fx<BankTransfer>
	readonly listTransfers: (
		owner: BankOwner,
		opts?: { accountId?: string | undefined; status?: string | undefined; limit?: number | undefined; before?: string | undefined },
	) => Fx<BankTransfer[]>
	/** Poller entrypoint: advances pending/submitted transfers. Returns counts. */
	readonly confirmPending: (opts?: { limit?: number }) => Fx<{ checked: number; confirmed: number; failed: number }>
	/** Credit on-chain funds that arrived outside the bank into `accountId` (only when nothing is in flight). */
	readonly syncDeposit: (owner: BankOwner, accountId: string) => Fx<{ creditedMinor: string; transfer: BankTransfer | null }>
	/** Low-level: build + lock + sign + broadcast one EVM call from a bank account's wallet. */
	readonly sendEvm: (input: SendEvmInput) => Fx<SendResult>
	/** Used by BankFxService to finish an fx transfer's on-chain leg. */
	readonly settleTransfer: (id: string) => Fx<BankTransfer>
	/** Mark a not-yet-broadcast transfer failed and release its ledger reservation. */
	readonly failTransfer: (id: string, reason: string) => Fx<BankTransfer>
}

export class BankTransferService extends Context.Tag('BankTransferService')<
	BankTransferService,
	BankTransferServiceInterface
>() {}

// ------------------------------------------------------------------ helpers

const CLAIM_STALE_MS = 2 * 60_000
// Reorg-safe depths (blocks). Polygon reorgs of tens of blocks have happened; L2 values cover sequencer soft-confirm risk.
const MIN_CONFIRMATIONS: Record<string, bigint> = { ethereum: 12n, polygon: 64n, bsc: 15n, base: 10n, optimism: 10n, arbitrum: 60n }
const confirmationsFor = (c: string) => MIN_CONFIRMATIONS[c] ?? 12n
const DROP_MIN_CHECKS = 3
const DROP_MIN_AGE_MS = 10 * 60_000

const UINT_RE = /^[1-9][0-9]{0,77}$/
const KEY_RE = /^[A-Za-z0-9_.:-]{8,128}$/

const requireAsset = (symbol: string, c: string): BankAsset => {
	const a = findAsset(symbol, c)
	if (!a) throw bankErr('ASSET_UNSUPPORTED', `Unsupported asset ${symbol} on ${c}`)
	return a
}

const loadWallet = (acct: Pick<BankAccount, 'walletId' | 'walletUserId' | 'address'>): Effect.Effect<Wallet, BankError, DrizzleService> =>
	bankDb(async (db) => {
		if (acct.walletId == null || !acct.address) throw bankErr('WALLET_UNAVAILABLE', 'Account has no custody wallet')
		const [w] = await db.select().from(wallets).where(eq(wallets.id, acct.walletId)).limit(1)
		if (!w || !w.isActive) throw bankErr('WALLET_UNAVAILABLE', 'Custody wallet not found or inactive')
		// Defense in depth: the wallet row must still be the one the account was opened against.
		if (w.userId !== acct.walletUserId || w.address.toLowerCase() !== acct.address.toLowerCase())
			throw bankErr('FORBIDDEN', 'Custody wallet no longer matches the account')
		if (w.walletProvider !== 'turnkey' || !w.turnkeySubOrgId)
			throw bankErr('SIGNING_UNAVAILABLE', 'Wallet does not support server-side signing')
		return w
	})

const patchTransfer = (id: string, patch: Partial<typeof bankTransfers.$inferInsert>) =>
	bankDb(async (db) => {
		const [row] = await db
			.update(bankTransfers)
			.set({ ...patch, updatedAt: new Date() })
			.where(eq(bankTransfers.id, id))
			.returning()
		if (!row) throw bankErr('NOT_FOUND', 'Transfer not found')
		return row
	})

const mergeMeta = (t: BankTransfer, extra: Record<string, unknown>) => ({ ...(t.metadata ?? {}), ...extra })

// ------------------------------------------------------------------ signing

const signPayload = (
	w: Wallet,
	family: 'evm' | 'solana',
	payload: string,
	fallbackPayload: Record<string, unknown>,
): Effect.Effect<string, BankError, TurnkeyService> =>
	Effect.gen(function* () {
		const turnkey = yield* TurnkeyService
		return yield* Effect.tryPromise({
			try: async () => {
				const { signedTransaction } = await withSigningFallback(
					() => Effect.runPromise(turnkey.signTransactionForAgent(w.turnkeySubOrgId!, payload, w.address, family)),
					w.id,
					// wallets.user_id — same id the Python ownership check compares (swap.ts:579).
					w.userId,
					fallbackPayload,
					family,
				)
				return signedTransaction
			},
			catch: (e) =>
				bankErr('SIGNING_UNAVAILABLE', `Signing failed (Turnkey and fallback): ${e instanceof Error ? e.message : String(e)}`, { cause: e }),
		})
	})

const classify = (o: chain.BroadcastOutcome): { outcome: SendResult['outcome']; message?: string } =>
	o.kind === 'accepted' ? { outcome: 'accepted' } : { outcome: o.kind, message: o.message }

const sendEvm = (input: SendEvmInput): Fx<SendResult> =>
	Effect.gen(function* () {
		const asset = input.account.chain
		const chainId = Object.entries(CHAIN_ID_TO_KEY).find(([, k]) => k === asset)?.[0]
		if (!chainId) return yield* Effect.fail(bankErr('ASSET_UNSUPPORTED', `No EVM chain id for ${asset}`))
		const w = yield* loadWallet(input.account)
		return yield* withDbLock(
			`bank-wallet:${input.account.chain}:${w.address.toLowerCase()}`,
			Effect.gen(function* () {
				const built = yield* Effect.tryPromise({
					try: () =>
						chain.evmBuildCall(input.account.chain, Number(chainId), w.address, input.to, input.data, input.valueHex ?? '0x0', input.gas),
					catch: (e) =>
						e instanceof chain.GasShortfallError
							? bankErr('WALLET_UNAVAILABLE', e.message)
							: bankErr('UPSTREAM', `Transaction would fail or RPC unavailable: ${e instanceof Error ? e.message : String(e)}`, { cause: e }),
				})
				if (input.guard) yield* input.guard()
				const signed = yield* signPayload(w, 'evm', JSON.stringify(built.tx), built.tx as unknown as Record<string, unknown>)
				const txHash = chain.evmTxHash(signed)
				// Persist hash BEFORE broadcast: a crash after this point is recoverable by the reconciler.
				if (input.onSigned) yield* input.onSigned({ txHash, nonce: built.nonce })
				const b = classify(yield* Effect.promise(() => chain.evmBroadcast(input.account.chain, signed)))
				return { txHash, nonce: built.nonce, ...b }
			}),
		)
	})

const sendSolana = (
	acct: BankAccount,
	asset: BankAsset,
	recipient: string,
	amount: bigint,
	onSigned: (info: { txHash: string; lastValidBlockHeight: number }) => Effect.Effect<void, BankError, BankDeps>,
	guard?: () => Effect.Effect<void, BankError, BankDeps>,
): Fx<SendResult> =>
	Effect.gen(function* () {
		const w = yield* loadWallet(acct)
		return yield* withDbLock(
			`bank-wallet:solana:${w.address}`,
			Effect.gen(function* () {
				const built = yield* Effect.tryPromise({
					try: () => chain.solBuildSplTransfer(asset, w.address, recipient, amount),
					catch: (e) => bankErr('UPSTREAM', `Could not build Solana transfer: ${e instanceof Error ? e.message : String(e)}`, { cause: e }),
				})
				if (guard) yield* guard()
				const signed = yield* signPayload(w, 'solana', built.unsignedHex, { hex: built.unsignedHex })
				const sig = yield* Effect.try({
					try: () => chain.solSignatureOf(signed),
					catch: (e) => bankErr('SIGNING_UNAVAILABLE', String(e)),
				})
				yield* onSigned({ txHash: sig, lastValidBlockHeight: built.lastValidBlockHeight })
				const b = classify(yield* Effect.promise(() => chain.solBroadcast(signed)))
				return { txHash: sig, nonce: 0, ...b }
			}),
		)
	})

// ------------------------------------------------------------------ ledger legs

const clearingFor = (t: BankTransfer): string | null =>
	typeof t.metadata?.clearingAccountId === 'string' ? (t.metadata.clearingAccountId as string) : null

const reserveLegs = (t: BankTransfer, clearing: string): LedgerLeg[] => [
	{ accountId: t.fromAccount!, direction: 'debit', amountMinor: BigInt(t.amountMinor) },
	{ accountId: clearing, direction: 'credit', amountMinor: BigInt(t.amountMinor) },
]

type TransferPatch = Partial<typeof bankTransfers.$inferInsert>

/**
 * Atomic status transition + ledger posting in ONE transaction, with the transfer row locked.
 * No-ops (returns the current row) if the status is no longer in `from`, so a confirm and a
 * reverse can never both apply. `onlyIfReserved` skips the legs when no 'submit' phase exists.
 */
const finalizeTransfer = (
	id: string,
	opts: { from: BankTransfer['status'][]; phase?: string; legs?: LedgerLeg[]; onlyIfReserved?: boolean; requireNoHash?: boolean; patch: TransferPatch },
): Fx<BankTransfer> =>
	bankDb((db) =>
		db.transaction(async (tx) => {
			const [cur] = await tx.select().from(bankTransfers).where(eq(bankTransfers.id, id)).for('update')
			if (!cur) throw bankErr('NOT_FOUND', 'Transfer not found')
			if (!opts.from.includes(cur.status)) return cur
			// MONEY-PATH: no-broadcast reversals re-check under the row lock that no signed tx was ever persisted.
			if (opts.requireNoHash && cur.txHash) return cur
			let legs = opts.legs
			if (legs && opts.onlyIfReserved) {
				const reserved = await tx
					.select({ id: bankLedgerEntries.id })
					.from(bankLedgerEntries)
					.where(and(eq(bankLedgerEntries.transferId, id), eq(bankLedgerEntries.phase, 'submit')))
					.limit(1)
				if (reserved.length === 0) legs = undefined
			}
			if (legs && opts.phase) await postInTx(tx, { transferId: id, phase: opts.phase, legs })
			const [row] = await tx
				.update(bankTransfers)
				.set({ ...opts.patch, updatedAt: new Date() })
				.where(eq(bankTransfers.id, id))
				.returning()
			return row!
		}),
	)

const failAndReverse = (t: BankTransfer, reason: string, noBroadcast = false): Fx<BankTransfer> =>
	Effect.gen(function* () {
		const clearing = clearingFor(t)
		const amount = BigInt(t.amountMinor)
		const out = yield* finalizeTransfer(t.id, {
			from: ['pending', 'submitted'],
			phase: 'reverse',
			onlyIfReserved: true,
			requireNoHash: noBroadcast,
			...(clearing && t.fromAccount
				? {
						legs: [
							{ accountId: clearing, direction: 'debit' as const, amountMinor: amount },
							{ accountId: t.fromAccount, direction: 'credit' as const, amountMinor: amount },
						],
					}
				: {}),
			patch: { status: 'failed', failureReason: reason.slice(0, 1000) },
		})
		if (out.status === 'failed') logger.warn({ transferId: t.id, reason }, '[bank] transfer failed and reversed')
		return out
	})

const reread = (id: string): Fx<BankTransfer> =>
	bankDb(async (db) => {
		const [r] = await db.select().from(bankTransfers).where(eq(bankTransfers.id, id)).limit(1)
		if (!r) throw bankErr('NOT_FOUND', 'Transfer not found')
		return r
	})

// ------------------------------------------------------------------ execution of one transfer

/** Extends our claim; fails CONFLICT if the transfer is no longer pending under this token. */
const touchClaim = (id: string, token: string): Fx<void> =>
	bankDb(async (db) => {
		const rows = await db
			.update(bankTransfers)
			.set({ claimedAt: new Date(), updatedAt: new Date() })
			.where(and(eq(bankTransfers.id, id), eq(bankTransfers.status, 'pending'), eq(bankTransfers.claimToken, token)))
			.returning({ id: bankTransfers.id })
		if (rows.length !== 1) throw bankErr('CONFLICT', 'Transfer claim lost or no longer pending; aborting before signing')
	})

/** Drives a pending transfer forward (idempotent; safe to call on retries and from the reconciler). */
const advance = (t0: BankTransfer): Fx<BankTransfer> =>
	Effect.gen(function* () {
		const ledger = yield* BankLedgerService
		let t = t0
		if (t.status !== 'pending') return t
		// MONEY-PATH: a partner fee row only moves after its principal confirmed; a failed principal voids it (never reserved -> no legs).
		const feeOf = t.metadata?.feeOfTransferId
		if (typeof feeOf === 'string') {
			const parent = yield* bankDb(async (db) => (await db.select({ status: bankTransfers.status }).from(bankTransfers).where(eq(bankTransfers.id, feeOf)).limit(1))[0])
			if (!parent || parent.status === 'failed')
				return yield* finalizeTransfer(t.id, { from: ['pending'], requireNoHash: true, patch: { status: 'failed', failureReason: 'principal failed; fee not charged' } })
			if (parent.status !== 'confirmed') return t
		}
		const from = yield* ledger.getAccountById(t.fromAccount!)
		const asset = requireAsset(t.asset, t.chain)
		const amount = BigInt(t.amountMinor)

		// Atomic, single-row claim: only one worker may execute a pending transfer.
		const token = randomUUID()
		const claimed = yield* bankDb(async (db) => {
			const rows = await db
				.update(bankTransfers)
				.set({ claimedAt: new Date(), claimToken: token, updatedAt: new Date() })
				.where(
					and(
						eq(bankTransfers.id, t.id),
						eq(bankTransfers.status, 'pending'),
						or(isNull(bankTransfers.claimedAt), lt(bankTransfers.claimedAt, new Date(Date.now() - CLAIM_STALE_MS))),
					),
				)
				.returning()
			if (rows.length === 0) return null
			if (rows.length !== 1 || rows[0]!.id !== t.id) throw bankErr('DB', `Claim matched unexpected rows for ${t.id}`)
			return rows[0]!
		})
		if (!claimed) return t
		t = claimed

		const to = t.toAccount ? yield* ledger.getAccountById(t.toAccount) : null
		const sameWallet =
			to !== null &&
			to.address !== null &&
			from.address !== null &&
			to.chain === from.chain &&
			to.asset === from.asset &&
			to.address.toLowerCase() === from.address.toLowerCase()

		if (sameWallet) {
			return yield* finalizeTransfer(t.id, {
				from: ['pending'],
				phase: 'settle',
				legs: [
					{ accountId: from.id, direction: 'debit', amountMinor: amount },
					{ accountId: to!.id, direction: 'credit', amountMinor: amount },
				],
				patch: { status: 'confirmed', confirmedAt: new Date(), failureReason: null },
			})
		}

		// Reserve funds first.
		const clearing = (yield* ledger.ensureSystemAccount('clearing', t.asset, t.chain)).id
		if (clearingFor(t) !== clearing) t = yield* patchTransfer(t.id, { metadata: mergeMeta(t, { clearingAccountId: clearing }) })
		const reserve = yield* Effect.either(ledger.post({ transferId: t.id, phase: 'submit', legs: reserveLegs(t, clearing) }))
		if (reserve._tag === 'Left')
			// MONEY-PATH: the submit legs may have committed before the ack was lost; failAndReverse reverses only if a submit leg exists.
			return yield* failAndReverse(t, reserve.left.message.slice(0, 1000), true)

		const recipient = to ? to.address! : t.toExternal!.address
		// Persist 'submitted' + hash ONLY while we still own the pending claim; else abort before broadcast.
		const persist = (txHash: string, extra: Record<string, unknown>) =>
			bankDb(async (db) => {
				const rows = await db
					.update(bankTransfers)
					.set({ status: 'submitted', txHash, metadata: mergeMeta(t, { clearingAccountId: clearing, ...extra }), updatedAt: new Date() })
					.where(and(eq(bankTransfers.id, t.id), eq(bankTransfers.status, 'pending'), eq(bankTransfers.claimToken, token)))
					.returning({ id: bankTransfers.id })
				if (rows.length !== 1) throw bankErr('CONFLICT', 'Transfer no longer pending / claim lost; aborting before broadcast')
			})
		const guard = () => touchClaim(t.id, token)

		const sent = yield* Effect.either(
			asset.family === 'evm'
				? sendEvm({
						account: from,
						to: asset.address,
						data: chain.erc20TransferData(recipient, amount),
						guard,
						onSigned: ({ txHash, nonce }) => persist(txHash, { nonce }),
					})
				: sendSolana(from, asset, recipient, amount, ({ txHash, lastValidBlockHeight }) => persist(txHash, { lastValidBlockHeight }), guard),
		)
		const cur = yield* reread(t.id)
		if (sent._tag === 'Left') {
			// Lost claim / lock contention: someone else owns it (or we retry later) -> never reverse here.
			if (sent.left.code === 'CONFLICT' || sent.left.code === 'LOCK_BUSY') return cur
			// Nothing was broadcast (build / signing / persist failed): release only if still ours and hashless.
			if (cur.txHash || cur.status !== 'pending' || cur.claimToken !== token) return cur
			return yield* failAndReverse(cur, sent.left.message, true)
		}
		if (sent.right.outcome === 'rejected') return yield* failAndReverse(cur, `Broadcast rejected: ${sent.right.message}`, true)
		return cur
	})

// ------------------------------------------------------------------ settlement (confirmation)

const confirmedLegs = (t: BankTransfer, clearing: string, externalId: string | null): LedgerLeg[] => {
	const amount = BigInt(t.amountMinor)
	return [
		{ accountId: clearing, direction: 'debit', amountMinor: amount },
		{ accountId: t.toAccount ?? externalId!, direction: 'credit', amountMinor: amount },
	]
}

const settle = (t: BankTransfer): Fx<BankTransfer> =>
	Effect.gen(function* () {
		if (t.status !== 'submitted' && t.status !== 'pending') return t
		const ledger = yield* BankLedgerService
		const md = t.metadata ?? {}
		if (md.reviewRequired) return t

		// Pending with no hash: either mid-flight in another worker or crashed -> let advance() decide (claim-guarded).
		if (!t.txHash) {
			if (t.type !== 'fx') return t.status === 'pending' ? yield* advance(t) : t
			// fx never persisted a hash => nothing was broadcast; release after a grace period.
			return Date.now() - t.updatedAt.getTime() > 10 * 60_000 ? yield* failAndReverse(t, 'fx transfer never reached the network', true) : t
		}
		const asset = requireAsset(t.asset, t.chain)
		const clearing = clearingFor(t)
		if (!clearing) return yield* patchTransfer(t.id, { metadata: mergeMeta(t, { reviewRequired: true }) })

		const finish = (received?: bigint): Fx<BankTransfer> =>
			Effect.gen(function* () {
				if (t.type === 'fx') {
					const fxmeta = md.fx as { toAccountId: string; toAsset: string } | undefined
					if (!fxmeta || received === undefined || received <= 0n) return yield* patchTransfer(t.id, { metadata: mergeMeta(t, { reviewRequired: true }) })
					const fxTo = yield* ledger.ensureSystemAccount('fx', fxmeta.toAsset, t.chain)
					return yield* finalizeTransfer(t.id, {
						from: ['pending', 'submitted'],
						phase: 'confirm',
						legs: [
							{ accountId: fxTo.id, direction: 'debit', amountMinor: received },
							{ accountId: fxmeta.toAccountId, direction: 'credit', amountMinor: received },
						],
						patch: {
							status: 'confirmed',
							confirmedAt: new Date(),
							failureReason: null,
							metadata: mergeMeta(t, { fx: { ...fxmeta, receivedMinor: received.toString() } }),
						},
					})
				}
				const external = t.toAccount ? null : (yield* ledger.ensureSystemAccount('external', t.asset, t.chain)).id
				return yield* finalizeTransfer(t.id, {
					from: ['pending', 'submitted'],
					phase: 'confirm',
					legs: confirmedLegs(t, clearing, external),
					patch: { status: 'confirmed', confirmedAt: new Date(), failureReason: null },
				})
			})

		if (asset.family === 'evm') {
			const fromAddress = t.fromAccount ? ((yield* ledger.getAccountById(t.fromAccount)).address ?? '') : ''
			const check = yield* Effect.tryPromise({
				try: async () => {
					const r = await chain.evmReceipt(t.chain, t.txHash!)
					if (!r) {
						const known = await chain.evmTxKnown(t.chain, t.txHash!)
						const nonce = typeof md.nonce === 'number' ? (md.nonce as number) : null
						if (!known && nonce !== null) {
							const latest = await chain.evmLatestNonce(t.chain, fromAddress)
							if (latest > nonce) return { kind: 'dropped' as const }
						}
						return { kind: 'wait' as const }
					}
					const head = await chain.evmBlockNumber(t.chain)
					return { kind: 'receipt' as const, r, conf: head - r.blockNumber + 1n }
				},
				catch: (e) => bankErr('UPSTREAM', `RPC error while confirming: ${String(e)}`, { cause: e }),
			})
			if (check.kind !== 'dropped' && (t.dropChecks > 0 || t.dropFirstSeenAt))
				yield* patchTransfer(t.id, { dropChecks: 0, dropFirstSeenAt: null })
			if (check.kind === 'wait') return t
			if (check.kind === 'dropped') {
				// A single (possibly lagging) node answer never refunds: require DROP_MIN_CHECKS consecutive
				// ticks spanning >= DROP_MIN_AGE_MS against the pinned RPC, then one final re-check.
				const checks = t.dropChecks + 1
				const first = t.dropFirstSeenAt ?? new Date()
				if (checks < DROP_MIN_CHECKS || Date.now() - first.getTime() < DROP_MIN_AGE_MS) {
					yield* patchTransfer(t.id, { dropChecks: checks, dropFirstSeenAt: first })
					return t
				}
				const late = yield* Effect.tryPromise({
					try: async () => (await chain.evmReceipt(t.chain, t.txHash!)) !== null || (await chain.evmTxKnown(t.chain, t.txHash!)),
					catch: (e) => bankErr('UPSTREAM', `RPC error while confirming: ${String(e)}`, { cause: e }),
				})
				if (late) {
					yield* patchTransfer(t.id, { dropChecks: 0, dropFirstSeenAt: null })
					return t
				}
				return yield* failAndReverse(t, 'Transaction replaced or dropped (nonce consumed; verified over repeated checks)')
			}
			if (!check.r.success) return yield* failAndReverse(t, 'Transaction reverted on-chain')
			if (check.conf < confirmationsFor(t.chain)) return t
			if (t.type === 'fx') {
				const fxmeta = md.fx as { toAccountId: string; toTokenAddress: string; recipient: string } | undefined
				const got = fxmeta ? chain.sumTransfersTo(check.r, fxmeta.toTokenAddress, fxmeta.recipient) : 0n
				return yield* finish(got)
			}
			// Plain transfers must show the expected Transfer(to, amount) log.
			const to = t.toAccount ? (yield* ledger.getAccountById(t.toAccount)).address : t.toExternal!.address
			if (!to || chain.sumTransfersTo(check.r, asset.address, to) < BigInt(t.amountMinor))
				return yield* patchTransfer(t.id, { metadata: mergeMeta(t, { reviewRequired: true, reviewReason: 'receipt lacks expected Transfer log' }) })
			return yield* finish()
		}

		// Solana
		const st = yield* Effect.tryPromise({
			try: async () => {
				const s = await chain.solSignatureStatus(t.txHash!)
				if (s.state === 'unknown') {
					const lv = typeof md.lastValidBlockHeight === 'number' ? (md.lastValidBlockHeight as number) : null
					if (lv !== null && (await chain.solBlockHeight()) > lv + 150) return { state: 'failed' as const, reason: 'blockhash expired before inclusion' }
				}
				return s
			},
			catch: (e) => bankErr('UPSTREAM', `Solana RPC error while confirming: ${String(e)}`, { cause: e }),
		})
		if (st.state === 'failed') return yield* failAndReverse(t, `Solana transaction failed: ${st.reason}`)
		if (st.state === 'finalized') return yield* finish()
		return t
	})

// ------------------------------------------------------------------ shared spend controls (also used by BankFxService)

export const assertRecipientSafe = (asset: BankAsset, address: string): Fx<void> =>
	Effect.tryPromise({
		try: () => chain.assertSafeRecipient(asset, address),
		catch: (e) =>
			e instanceof chain.UnsafeRecipientError
				? bankErr('VALIDATION', e.message)
				: bankErr('UPSTREAM', `Could not verify recipient: ${e instanceof Error ? e.message : String(e)}`, { cause: e }),
	})

/** Per-transfer limit (metadata.limits.perTxMinor) + PolicyService for agent owners. Daily limit: see insertTransferGuarded. */
export const enforceSpendControls = (args: {
	owner: BankOwner
	from: BankAccount
	asset: BankAsset
	amount: bigint
	destination: string
}): Fx<void> =>
	Effect.gen(function* () {
		const { owner, from, asset, amount, destination } = args
		const limits = (from.metadata?.limits ?? {}) as { perTxMinor?: string; dailyMinor?: string }
		if (limits.perTxMinor && amount > BigInt(limits.perTxMinor))
			return yield* Effect.fail(bankErr('LIMIT_EXCEEDED', `Exceeds per-transfer limit of ${limits.perTxMinor}`))
		if (owner.ownerType !== 'agent') return
		const agent = yield* bankDb(async (db) => (await db.select().from(agents).where(eq(agents.id, Number(owner.ownerId))).limit(1))[0])
		if (!agent) return yield* Effect.fail(bankErr('NOT_FOUND', 'Agent not found'))
		const valueUsd = yield* Effect.tryPromise({
			try: async () => {
				const human = Number(amount) / 10 ** asset.decimals
				if (asset.currency === 'USD') return human
				const px = (await fetchTokenPrices([asset.symbol]))[asset.symbol]?.usd
				if (!px) throw new Error(`no USD price for ${asset.symbol}`)
				return human * px
			},
			catch: (e) => bankErr('POLICY_BLOCKED', `Cannot value transfer for policy check: ${String(e)}`),
		})
		const policy = yield* PolicyService
		const verdict = yield* policy
			.evaluate({
				organizationId: agent.organizationId,
				agentId: agent.uuid,
				chain: asset.chain,
				fromToken: asset.address.toLowerCase(),
				destinationAddress: destination.toLowerCase(),
				valueUsd,
			})
			.pipe(Effect.mapError((e) => bankErr('DB', e.message)))
		if (verdict.decision === 'block') return yield* Effect.fail(bankErr('POLICY_BLOCKED', verdict.reason ?? 'Blocked by policy'))
		if (verdict.decision === 'require_approval')
			return yield* Effect.fail(bankErr('POLICY_BLOCKED', `Requires human approval: ${verdict.reason ?? 'policy'}`))
	})

/**
 * Inserts a transfer (onConflictDoNothing on the idempotency key) in one transaction that holds
 * the source account row lock while it checks available balance (ledger - holds, see holds.ts) and the rolling-24h daily limit — concurrent transfers
 * from one account serialise here, so the limit cannot be raced. Returns null when the key already exists.
 */
export const insertTransferGuarded = (values: typeof bankTransfers.$inferInsert, from: BankAccount, consumesHold?: ConsumesHold, feeRow?: typeof bankTransfers.$inferInsert): Fx<BankTransfer | null> =>
	bankDb((db) =>
		db.transaction(async (tx) => {
			const [acct] = await tx
				.select({ metadata: bankAccounts.metadata })
				.from(bankAccounts)
				.where(eq(bankAccounts.id, from.id))
				.for('update')
			if (!acct) throw bankErr('NOT_FOUND', 'Source account not found')
			const daily = ((acct.metadata?.limits ?? {}) as { dailyMinor?: string }).dailyMinor
			if (daily) {
				const r = await tx.execute(
					sql`select coalesce(sum(amount_minor), 0)::text as s from bank_transfers where from_account = ${from.id} and status in ('pending','submitted','confirmed') and created_at > now() - interval '24 hours'`,
				)
				const spent = BigInt((r as unknown as Array<{ s: string }>)[0]?.s ?? '0')
				if (spent + BigInt(values.amountMinor) + BigInt(feeRow?.amountMinor ?? '0') > BigInt(daily)) throw bankErr('LIMIT_EXCEEDED', `Exceeds daily limit of ${daily}`)
			}
			// MONEY-PATH: idempotent replay (key already used) returns null before any balance check.
			const dup = await tx
				.select({ id: bankTransfers.id })
				.from(bankTransfers)
				.where(and(eq(bankTransfers.ownerType, values.ownerType), eq(bankTransfers.ownerId, values.ownerId), eq(bankTransfers.idempotencyKey, values.idempotencyKey)))
				.limit(1)
			if (dup.length > 0) return null
			// MONEY-PATH: under the source-account row lock, reject overdrafts / held funds / unreserved pending transfers (4xx).
			// `consumesHold` is validated server-side (active, on this account, covers amount) inside assertAvailable.
			await assertAvailable(from.id, tx, BigInt(values.amountMinor) + BigInt(feeRow?.amountMinor ?? '0'), consumesHold)
			const [row] = await tx.insert(bankTransfers).values(values).onConflictDoNothing().returning()
			if (row && feeRow) {
				// MONEY-PATH: fee row shares this tx; a key collision aborts the whole unit (principal rolls back too).
				const [f] = await tx.insert(bankTransfers).values(feeRow).onConflictDoNothing().returning({ id: bankTransfers.id })
				if (!f) throw bankErr('CONFLICT', 'partner fee key already used; retry with a new idempotencyKey')
			}
			return row ?? null
		}),
	)

// ------------------------------------------------------------------ service

export const BankTransferServiceLive = Layer.succeed(BankTransferService, {
	sendEvm,

	failTransfer: (id, reason) =>
		Effect.gen(function* () {
			const t = yield* bankDb(async (db) => (await db.select().from(bankTransfers).where(eq(bankTransfers.id, id)).limit(1))[0])
			if (!t) return yield* Effect.fail(bankErr('NOT_FOUND', 'Transfer not found'))
			// Never release funds once a signed tx may be on the network.
			if (t.txHash || t.status === 'confirmed' || t.status === 'failed') return t
			return yield* failAndReverse(t, reason, true)
		}),

	settleTransfer: (id) =>
		Effect.gen(function* () {
			const t = yield* bankDb(async (db) => (await db.select().from(bankTransfers).where(eq(bankTransfers.id, id)).limit(1))[0])
			if (!t) return yield* Effect.fail(bankErr('NOT_FOUND', 'Transfer not found'))
			return yield* settle(t)
		}),

	getTransfer: (owner, id) =>
		bankDb(async (db) => {
			const [t] = await db
				.select()
				.from(bankTransfers)
				.where(and(eq(bankTransfers.id, id), eq(bankTransfers.ownerType, owner.ownerType), eq(bankTransfers.ownerId, owner.ownerId)))
				.limit(1)
			if (!t) throw bankErr('NOT_FOUND', 'Transfer not found')
			return t
		}),

	listTransfers: (owner, opts) =>
		bankDb((db) => {
			const conds = [eq(bankTransfers.ownerType, owner.ownerType), eq(bankTransfers.ownerId, owner.ownerId)]
			if (opts?.accountId)
				conds.push(sql`(${bankTransfers.fromAccount} = ${opts.accountId} or ${bankTransfers.toAccount} = ${opts.accountId})`)
			if (opts?.status) conds.push(eq(bankTransfers.status, opts.status as BankTransfer['status']))
			if (opts?.before) conds.push(lt(bankTransfers.createdAt, new Date(opts.before)))
			return db
				.select()
				.from(bankTransfers)
				.where(and(...conds))
				.orderBy(desc(bankTransfers.createdAt))
				.limit(Math.min(Math.max(opts?.limit ?? 50, 1), 200))
		}),

	transfer: (input) =>
		Effect.gen(function* () {
			const ledger = yield* BankLedgerService
			if (!KEY_RE.test(input.idempotencyKey))
				return yield* Effect.fail(bankErr('VALIDATION', 'idempotencyKey must be 8-128 chars of A-Za-z0-9_.:-'))
			if (!UINT_RE.test(input.amountMinor))
				return yield* Effect.fail(bankErr('VALIDATION', 'amountMinor must be a positive integer string (minor units)'))
			if ((input.toAccountId ? 1 : 0) + (input.toExternal ? 1 : 0) !== 1)
				return yield* Effect.fail(bankErr('VALIDATION', 'Provide exactly one of toAccountId or toExternal'))
			if (input.memo && input.memo.length > 280) return yield* Effect.fail(bankErr('VALIDATION', 'memo too long (max 280)'))
			const amount = BigInt(input.amountMinor)

			const requestHash = createHash('sha256')
				.update(
					JSON.stringify([input.type, input.fromAccountId, input.toAccountId ?? null, input.toExternal?.address.toLowerCase() ?? null, input.amountMinor, input.memo ?? null, ...(input.feeLeg ? [input.feeLeg.toAccountId, input.feeLeg.amountMinor] : [])]),
				)
				.digest('hex')

			if (input.feeLeg) {
				if (!UINT_RE.test(input.feeLeg.amountMinor)) return yield* Effect.fail(bankErr('VALIDATION', 'fee amountMinor must be a positive integer string'))
				if (input.consumesHold) return yield* Effect.fail(bankErr('VALIDATION', 'feeLeg cannot be combined with consumesHold'))
			}

			// Idempotent replay.
			const existing = yield* bankDb(async (db) => {
				const [r] = await db
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
				return r ?? null
			})
			if (existing) {
				if (existing.requestHash !== requestHash)
					return yield* Effect.fail(bankErr('CONFLICT', 'idempotencyKey was already used with different transfer terms'))
				return existing.status === 'pending' ? yield* advance(existing) : existing
			}

			const from = yield* ledger.getAccount(input.owner, input.fromAccountId)
			if (from.status !== 'active') return yield* Effect.fail(bankErr('ACCOUNT_STATE', `Source account is ${from.status}`))
			// MONEY-PATH: escrow/pool accounts are owned by the payer/operator but are not theirs to spend.
			const sysErr = assertSpendable(from, input.systemDebit)
			if (sysErr) return yield* Effect.fail(sysErr)
			const asset = yield* Effect.try({ try: () => requireAsset(from.asset, from.chain), catch: (e) => e as BankError })

			let to: BankAccount | null = null
			if (input.toAccountId) {
				to = yield* ledger.getAccountById(input.toAccountId)
				if (to.ownerType === 'system') return yield* Effect.fail(bankErr('VALIDATION', 'Cannot transfer to a system account'))
				if (to.status !== 'active') return yield* Effect.fail(bankErr('ACCOUNT_STATE', `Destination account is ${to.status}`))
				if (to.id === from.id) return yield* Effect.fail(bankErr('VALIDATION', 'Source and destination are the same account'))
				if (to.asset !== from.asset || to.chain !== from.chain)
					return yield* Effect.fail(bankErr('VALIDATION', 'Asset/chain mismatch between accounts; use /fx for conversions'))
				if (!to.address) return yield* Effect.fail(bankErr('WALLET_UNAVAILABLE', 'Destination account has no wallet address'))
			} else {
				yield* assertRecipientSafe(asset, input.toExternal!.address)
				// MONEY-PATH: sending to the account's own custody address moves nothing on-chain but debits the ledger (permanent drift).
				if (from.address && from.address.toLowerCase() === input.toExternal!.address.toLowerCase())
					return yield* Effect.fail(bankErr('VALIDATION', 'Recipient is this account\'s own wallet address; use toAccountId for moves between your accounts'))
			}

			// Per-tx limit + policy engine (agents). Daily limit is enforced atomically at insert.
			yield* enforceSpendControls({ owner: input.owner, from, asset, amount, destination: to?.address ?? input.toExternal!.address })

			const principalId = newId('xfer')
			let feeRow: typeof bankTransfers.$inferInsert | undefined
			if (input.feeLeg) {
				const feeTo = yield* ledger.getAccountById(input.feeLeg.toAccountId)
				if (feeTo.status !== 'active' || !feeTo.address || feeTo.asset !== from.asset || feeTo.chain !== from.chain || feeTo.id === from.id)
					return yield* Effect.fail(bankErr('VALIDATION', 'Invalid fee destination account'))
				feeRow = {
					id: newId('xfer'),
					ownerType: input.owner.ownerType,
					ownerId: input.owner.ownerId,
					idempotencyKey: feeKeyFor(input.idempotencyKey),
					requestHash: createHash('sha256').update(JSON.stringify(['fee', input.idempotencyKey, from.id, feeTo.id, input.feeLeg.amountMinor])).digest('hex'),
					type: 'internal',
					fromAccount: from.id,
					toAccount: feeTo.id,
					toExternal: null,
					amountMinor: input.feeLeg.amountMinor,
					asset: asset.symbol,
					chain: asset.chain,
					memo: 'partner fee',
					metadata: { ...(input.feeLeg.metadata ?? {}), partnerFee: true, feeOfTransferId: principalId, feeOfKey: input.idempotencyKey },
				}
			}
			const inserted = yield* insertTransferGuarded(
				{
					id: principalId,
					ownerType: input.owner.ownerType,
					ownerId: input.owner.ownerId,
					idempotencyKey: input.idempotencyKey,
					requestHash,
					type: input.type,
					fromAccount: from.id,
					toAccount: to?.id ?? null,
					toExternal: to ? null : { address: input.toExternal!.address, chain: from.chain },
					amountMinor: input.amountMinor,
					asset: asset.symbol,
					chain: asset.chain,
					memo: input.memo ?? null,
					metadata: input.metadata ?? {},
				},
				from,
				input.consumesHold,
				feeRow,
			)
			if (!inserted) {
				// Lost a race on the idempotency key: return the winner.
				return yield* bankDb(async (db) => {
					const [r] = await db
						.select()
						.from(bankTransfers)
						.where(and(eq(bankTransfers.ownerType, input.owner.ownerType), eq(bankTransfers.ownerId, input.owner.ownerId), eq(bankTransfers.idempotencyKey, input.idempotencyKey)))
						.limit(1)
					if (!r) throw bankErr('DB', 'Transfer insert failed')
					return r
				})
			}
			const principal = yield* advance(inserted)
			// MONEY-PATH: best effort only (never an error after principal moved); the poller advances the fee row once the principal confirms.
			if (feeRow && principal.status === 'confirmed') yield* Effect.ignore(bankDb((db) => db.select().from(bankTransfers).where(eq(bankTransfers.id, feeRow!.id!)).limit(1)).pipe(Effect.flatMap((r) => (r[0] ? advance(r[0]) : Effect.void))))
			return principal
		}),

	confirmPending: (opts) =>
		Effect.gen(function* () {
			const rows = yield* bankDb((db) =>
				db
					.select()
					.from(bankTransfers)
					.where(inArray(bankTransfers.status, ['pending', 'submitted']))
					.orderBy(bankTransfers.updatedAt)
					.limit(opts?.limit ?? 50),
			)
			let confirmed = 0
			let failed = 0
			for (const row of rows) {
				const res = yield* Effect.either(settle(row))
				if (res._tag === 'Left') {
					logger.error({ transferId: row.id, err: res.left.message }, '[bank] settle error')
					continue
				}
				if (res.right.status === 'confirmed') confirmed++
				if (res.right.status === 'failed') failed++
			}
			return { checked: rows.length, confirmed, failed }
		}),

	syncDeposit: (owner, accountId) =>
		Effect.gen(function* () {
			const ledger = yield* BankLedgerService
			const acct = yield* ledger.getAccount(owner, accountId)
			if (!acct.address) return yield* Effect.fail(bankErr('VALIDATION', 'Account has no on-chain wallet'))
			// MONEY-PATH: partner-customer deposits are only attributable on a dedicated per-customer address; legacy shared-wallet accounts cannot sync.
			if (owner.ownerType === 'partner_customer' && (acct.metadata as Record<string, unknown> | null)?.dedicatedWallet !== true)
				return yield* Effect.fail(bankErr('POLICY_BLOCKED', 'Deposit sync is disabled for partner accounts on a shared wallet; open a new account (dedicated deposit address)'))
			const asset = requireAsset(acct.asset, acct.chain)
			const address = acct.address
			const onchain = yield* Effect.tryPromise({
				try: () => (asset.family === 'evm' ? chain.evmTokenBalance(asset, address) : chain.solTokenBalance(asset, address)),
				catch: (e) => bankErr('UPSTREAM', `Could not read on-chain balance: ${String(e)}`, { cause: e }),
			})
			const external = yield* ledger.ensureSystemAccount('external', acct.asset, acct.chain)
			// One deposit key per wallet group + observed balance: two accounts sharing a wallet cannot both credit it.
			const key = `deposit:${acct.chain}:${address.toLowerCase()}:${acct.asset}:${onchain}`
			return yield* bankDb((db) =>
				db.transaction(async (tx) => {
					const group = await tx
						.select()
						.from(bankAccounts)
						.where(and(eq(bankAccounts.chain, acct.chain), eq(bankAccounts.address, address), eq(bankAccounts.asset, acct.asset), ne(bankAccounts.status, 'closed')))
						.orderBy(bankAccounts.id)
						.for('update')
					const ids = group.map((g) => g.id)
					let delta = onchain - group.reduce((sum, g) => sum + BigInt(g.balanceMinor), 0n)
					if (delta <= 0n) return { creditedMinor: '0', transfer: null }
					// MONEY-PATH: never skip the whole group (a dust internal transfer or a stuck op must not block deposits).
					// Credit only the part of the wallet delta that no in-flight operation will account for itself:
					//  - outgoing transfers whose submit/reserve leg is posted (ledger already debited, funds may still be on-chain);
					//  - incoming in-flight transfers from outside the group (credited by their own confirm);
					//  - pending earn withdraws / credit draws (credited by their own finalize).
					const idList = sql.join(ids.map((i) => sql`${i}`), sql`, `)
					const pendRows = (await tx.execute(sql`
						select
							coalesce((select sum(t.amount_minor) from bank_transfers t
								where t.status in ('pending','submitted') and t.from_account in (${idList})
								and (t.to_account is null or t.to_account not in (${idList}))
								and exists (select 1 from bank_ledger_entries e where e.transfer_id = t.id and e.phase = 'submit')), 0)::text as outgoing,
							coalesce((select sum(t.amount_minor) from bank_transfers t
								where t.status in ('pending','submitted') and t.to_account in (${idList})
								and (t.from_account is null or t.from_account not in (${idList}))), 0)::text as incoming,
							coalesce((select sum(o.assets_minor) from bank_earn_ops o
								where o.status = 'pending' and o.kind = 'withdraw' and o.checking_account_id in (${idList})), 0)::text as earn,
							coalesce((select sum(co.principal_minor) from bank_credit_ops co join bank_credit_lines cl on cl.id = co.line_id
								where co.status = 'pending' and co.kind = 'draw' and cl.account_id in (${idList})), 0)::text as credit
					`)) as unknown as Array<{ outgoing: string; incoming: string; earn: string; credit: string }>
					const p = pendRows[0]
					if (p) delta -= BigInt(p.outgoing) + BigInt(p.incoming) + BigInt(p.earn) + BigInt(p.credit)
					if (delta <= 0n) return { creditedMinor: '0', transfer: null }
					// Entry count makes the key unique per ledger state: a later identical balance (after spends) is a new deposit.
					const [{ n }] = (await tx
						.select({ n: sql<string>`count(*)::text` })
						.from(bankLedgerEntries)
						.where(inArray(bankLedgerEntries.accountId, ids))) as [{ n: string }]
					const depositKey = createHash('sha256').update(`${key}:${n}`).digest('hex')
					const [t] = await tx
						.insert(bankTransfers)
						.values({
							id: newId('xfer'),
							ownerType: owner.ownerType,
							ownerId: owner.ownerId,
							idempotencyKey: depositKey,
							requestHash: depositKey,
							type: 'onchain',
							toAccount: acct.id,
							amountMinor: delta.toString(),
							asset: acct.asset,
							chain: acct.chain,
							status: 'confirmed',
							confirmedAt: new Date(),
							memo: 'on-chain deposit sync',
							metadata: { deposit: true, onchainBalanceMinor: onchain.toString(), group: ids },
						})
						.onConflictDoNothing()
						.returning()
					if (!t) return { creditedMinor: '0', transfer: null } // this balance was already credited
					await postInTx(tx, {
						transferId: t.id,
						phase: 'deposit',
						legs: [
							{ accountId: external.id, direction: 'debit', amountMinor: delta },
							{ accountId: acct.id, direction: 'credit', amountMinor: delta },
						],
					})
					return { creditedMinor: delta.toString(), transfer: t }
				}),
			)
		}),
})
