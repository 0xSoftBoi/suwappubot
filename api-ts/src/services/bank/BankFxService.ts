/**
 * BankFxService (M1) — convert between two of an owner's stablecoin accounts
 * (e.g. EURC -> BRZ) directly via the existing SwapService (LI.FI aggregator).
 * No USD hop is forced: whatever route the aggregator returns for the direct pair
 * is used and reported (`route`, `steps`, `direct`). MONEY-PATH.
 *
 * Scope: same-chain EVM conversions. Cross-chain / Solana conversions return a typed
 * error (ASSET_UNSUPPORTED) rather than pretending.
 *
 * Ledger: submit  = debit FROM / credit fx(fromAsset)
 *         confirm = debit fx(toAsset) / credit TO   (amount = actual Transfer logs in the receipt)
 * Settlement is performed by BankTransferService.confirmPending() (type 'fx').
 */
import { createHash } from 'node:crypto'
import { and, eq } from 'drizzle-orm'
import { Context, Effect, Layer } from 'effect'
import type { EnvService } from '../../config/EnvService'
import { type BankTransfer, bankTransfers } from '../../db'
import { SwapService, type SwapQuote } from '../SwapService'
import { BankLedgerService } from './BankLedgerService'
import { type BankDeps, BankTransferService } from './BankTransferService'
import { findAsset, fromMinor } from './assets'
import { erc20ApproveData, evmAllowance, evmReceipt } from './chain'
import { type BankOwner, bankDb, newId } from './db'
import { type BankError, bankErr } from './errors'

type Deps = BankDeps | BankTransferService | EnvService | SwapService
type Fx<A> = Effect.Effect<A, BankError, Deps>

export interface FxRequest {
	owner: BankOwner
	fromAccountId: string
	toAccountId: string
	/** Integer minor units of the FROM asset. */
	amountMinor: string
	/** Default 0.005 (0.5%). */
	slippage?: number | undefined
	/** Reject routes that touch any third token. */
	requireDirect?: boolean | undefined
}

export interface FxQuote {
	fromAccountId: string
	toAccountId: string
	fromAsset: string
	toAsset: string
	chain: string
	fromAmountMinor: string
	expectedToMinor: string
	minToMinor: string
	fromAmount: string
	expectedTo: string
	minTo: string
	rate: string
	route: string
	/** Token symbols along the aggregator route, in order. */
	steps: string[]
	direct: boolean
	estimatedGasUsd: string
	slippage: number
}

export interface FxExecuteRequest extends FxRequest {
	idempotencyKey: string
	/** Execution aborts if the fresh route's guaranteed minimum is below this (from a prior quote's minToMinor). */
	minToMinor?: string | undefined
}

export interface BankFxServiceInterface {
	readonly quote: (req: FxRequest) => Fx<FxQuote>
	readonly execute: (req: FxExecuteRequest) => Fx<{ transfer: BankTransfer; quote: FxQuote }>
}

export class BankFxService extends Context.Tag('BankFxService')<BankFxService, BankFxServiceInterface>() {}

const DEFAULT_SLIPPAGE = 0.005

const prepare = (req: FxRequest) =>
	Effect.gen(function* () {
		const ledger = yield* BankLedgerService
		if (!/^[1-9][0-9]{0,77}$/.test(req.amountMinor))
			return yield* Effect.fail(bankErr('VALIDATION', 'amountMinor must be a positive integer string'))
		const from = yield* ledger.getAccount(req.owner, req.fromAccountId)
		const to = yield* ledger.getAccount(req.owner, req.toAccountId)
		if (from.status !== 'active' || to.status !== 'active') return yield* Effect.fail(bankErr('ACCOUNT_STATE', 'Both accounts must be active'))
		if (from.asset === to.asset) return yield* Effect.fail(bankErr('VALIDATION', 'Accounts hold the same asset; use a transfer'))
		if (from.chain !== to.chain)
			return yield* Effect.fail(bankErr('ASSET_UNSUPPORTED', 'Cross-chain conversion is not supported yet; accounts must be on the same chain'))
		const fa = findAsset(from.asset, from.chain)
		const ta = findAsset(to.asset, to.chain)
		if (!fa || !ta) return yield* Effect.fail(bankErr('ASSET_UNSUPPORTED', 'Unsupported asset'))
		if (fa.family !== 'evm') return yield* Effect.fail(bankErr('ASSET_UNSUPPORTED', 'Only EVM conversions are supported'))
		if (!from.address || !to.address) return yield* Effect.fail(bankErr('WALLET_UNAVAILABLE', 'Account has no wallet address'))

		const swap = yield* SwapService
		const q = yield* swap
			.getQuote({
				fromChain: from.chain,
				toChain: to.chain,
				fromToken: fa.address,
				toToken: ta.address,
				fromAmount: req.amountMinor,
				fromAddress: from.address,
				toAddress: to.address,
				slippage: req.slippage ?? DEFAULT_SLIPPAGE,
				order: 'RECOMMENDED',
				...(req.owner.ownerType === 'user' ? { userId: from.walletUserId } : { agentId: Number(req.owner.ownerId) }),
			})
			.pipe(Effect.mapError((e) => bankErr('UPSTREAM', `No route available: ${e.message}`, { cause: e })))

		const steps: string[] = []
		for (const s of q._rawQuote.includedSteps ?? []) {
			const a = s.action as { fromToken?: { symbol?: string }; toToken?: { symbol?: string } }
			if (steps.length === 0 && a.fromToken?.symbol) steps.push(a.fromToken.symbol)
			if (a.toToken?.symbol) steps.push(a.toToken.symbol)
		}
		const direct = steps.length > 0 ? steps.length === 2 && steps[0] === fa.symbol && steps[steps.length - 1] === ta.symbol : false
		const quote: FxQuote = {
			fromAccountId: from.id,
			toAccountId: to.id,
			fromAsset: fa.symbol,
			toAsset: ta.symbol,
			chain: from.chain,
			fromAmountMinor: req.amountMinor,
			expectedToMinor: q.toAmount,
			minToMinor: q.toAmountMin,
			fromAmount: fromMinor(BigInt(req.amountMinor), fa.decimals),
			expectedTo: fromMinor(BigInt(q.toAmount), ta.decimals),
			minTo: fromMinor(BigInt(q.toAmountMin), ta.decimals),
			rate: q.exchangeRate,
			route: q.route,
			steps,
			direct,
			estimatedGasUsd: q.estimatedGasUsd,
			slippage: q.slippage,
		}
		if (req.requireDirect && !direct)
			return yield* Effect.fail(bankErr('VALIDATION', `Aggregator has no direct ${fa.symbol}->${ta.symbol} route (got ${steps.join(' > ') || q.route})`))
		return { from, to, fa, ta, q, quote }
	})

const waitReceipt = (chainKey: string, hash: string) =>
	Effect.tryPromise({
		try: async () => {
			for (let i = 0; i < 30; i++) {
				const r = await evmReceipt(chainKey, hash)
				if (r) return r.success
				await new Promise((res) => setTimeout(res, 3000))
			}
			return null
		},
		catch: (e) => bankErr('UPSTREAM', `RPC error waiting for approval: ${String(e)}`),
	})

const hex = (v: string | undefined): bigint | undefined => (v ? BigInt(v) : undefined)

export const BankFxServiceLive = Layer.succeed(BankFxService, {
	quote: (req) => prepare(req).pipe(Effect.map((p) => p.quote)),

	execute: (req) =>
		Effect.gen(function* () {
			if (!/^[A-Za-z0-9_.:-]{8,128}$/.test(req.idempotencyKey))
				return yield* Effect.fail(bankErr('VALIDATION', 'idempotencyKey must be 8-128 chars of A-Za-z0-9_.:-'))
			const ledger = yield* BankLedgerService
			const transfers = yield* BankTransferService
			const requestHash = createHash('sha256')
				.update(JSON.stringify(['fx', req.fromAccountId, req.toAccountId, req.amountMinor]))
				.digest('hex')

			const existing = yield* bankDb(async (db) => {
				const [r] = await db
					.select()
					.from(bankTransfers)
					.where(and(eq(bankTransfers.ownerType, req.owner.ownerType), eq(bankTransfers.ownerId, req.owner.ownerId), eq(bankTransfers.idempotencyKey, req.idempotencyKey)))
					.limit(1)
				return r ?? null
			})
			const p = yield* prepare(req)
			if (existing) {
				if (existing.requestHash !== requestHash) return yield* Effect.fail(bankErr('CONFLICT', 'idempotencyKey already used with different terms'))
				return { transfer: existing, quote: p.quote }
			}
			if (req.minToMinor && BigInt(p.quote.minToMinor) < BigInt(req.minToMinor))
				return yield* Effect.fail(bankErr('LIMIT_EXCEEDED', `Route minimum ${p.quote.minToMinor} is below requested floor ${req.minToMinor}; re-quote`))

			const amount = BigInt(req.amountMinor)
			const fxFrom = yield* ledger.ensureSystemAccount('fx', p.fa.symbol, p.from.chain)
			const inserted = yield* bankDb(async (db) => {
				const [row] = await db
					.insert(bankTransfers)
					.values({
						id: newId('xfer'),
						ownerType: req.owner.ownerType,
						ownerId: req.owner.ownerId,
						idempotencyKey: req.idempotencyKey,
						requestHash,
						type: 'fx',
						fromAccount: p.from.id,
						toAccount: p.to.id,
						amountMinor: req.amountMinor,
						asset: p.fa.symbol,
						chain: p.from.chain,
						memo: `${p.fa.symbol}->${p.ta.symbol}`,
						metadata: {
							clearingAccountId: fxFrom.id,
							fx: {
								toAccountId: p.to.id,
								toAsset: p.ta.symbol,
								toTokenAddress: p.ta.address,
								recipient: p.to.address,
								quotedToMinor: p.quote.expectedToMinor,
								minToMinor: p.quote.minToMinor,
								route: p.quote.route,
								steps: p.quote.steps,
								direct: p.quote.direct,
							},
						},
					})
					.onConflictDoNothing()
					.returning()
				return row ?? null
			})
			if (!inserted) return yield* Effect.fail(bankErr('CONFLICT', 'Concurrent request with the same idempotencyKey; retry'))

			// Reserve funds before any signing.
			const reserve = yield* Effect.either(
				ledger.post({
					transferId: inserted.id,
					phase: 'submit',
					legs: [
						{ accountId: p.from.id, direction: 'debit', amountMinor: amount },
						{ accountId: fxFrom.id, direction: 'credit', amountMinor: amount },
					],
				}),
			)
			if (reserve._tag === 'Left') {
				yield* bankDb((db) => db.update(bankTransfers).set({ status: 'failed', failureReason: reserve.left.message, updatedAt: new Date() }).where(eq(bankTransfers.id, inserted.id)))
				return yield* Effect.fail(reserve.left)
			}

			const tx = p.q.transactionRequest
			const fail = (reason: string) => transfers.failTransfer(inserted.id, reason)

			// Approval (exact amount) when the aggregator spender lacks allowance.
			const spender = p.q._rawQuote.estimate.approvalAddress
			if (spender) {
				const allowance = yield* Effect.tryPromise({
					try: () => evmAllowance(p.fa, p.from.address!, spender),
					catch: (e) => bankErr('UPSTREAM', `Allowance check failed: ${String(e)}`),
				}).pipe(Effect.catchAll((e) => fail(e.message).pipe(Effect.zipRight(Effect.fail(e)))))
				if (allowance < amount) {
					const appr = yield* transfers
						.sendEvm({ account: p.from, to: p.fa.address, data: erc20ApproveData(spender, amount) })
						.pipe(Effect.catchAll((e) => fail(`Approval failed: ${e.message}`).pipe(Effect.zipRight(Effect.fail(e)))))
					if (appr.outcome === 'rejected') {
						const t = yield* fail(`Approval rejected: ${appr.message}`)
						return { transfer: t, quote: p.quote }
					}
					const ok = yield* waitReceipt(p.from.chain, appr.txHash).pipe(Effect.catchAll((e) => fail(e.message).pipe(Effect.zipRight(Effect.fail(e)))))
					if (ok !== true) {
						const t = yield* fail(ok === false ? 'Approval transaction reverted' : 'Approval not confirmed in time')
						return { transfer: t, quote: p.quote }
					}
				}
			}

			const sent = yield* transfers
				.sendEvm({
					account: p.from,
					to: tx.to,
					data: tx.data,
					valueHex: tx.value,
					...(hex(tx.gasLimit) !== undefined ? { gas: hex(tx.gasLimit)! } : {}),
					onSigned: ({ txHash, nonce }) =>
						bankDb((db) =>
							db
								.update(bankTransfers)
								.set({ status: 'submitted', txHash, metadata: { ...inserted.metadata, nonce }, updatedAt: new Date() })
								.where(eq(bankTransfers.id, inserted.id)),
						).pipe(Effect.asVoid),
				})
				.pipe(
					Effect.catchAll((e) =>
						// If the hash was persisted the outcome is unknown: leave it to the reconciler.
						bankDb(async (db) => (await db.select().from(bankTransfers).where(eq(bankTransfers.id, inserted.id)).limit(1))[0]!).pipe(
							Effect.flatMap((row) => (row.txHash ? Effect.succeed(null) : fail(e.message).pipe(Effect.zipRight(Effect.fail(e))))),
						),
					),
				)
			if (sent && sent.outcome === 'rejected') {
				const t = yield* fail(`Broadcast rejected: ${sent.message}`)
				return { transfer: t, quote: p.quote }
			}
			const final = yield* bankDb(async (db) => (await db.select().from(bankTransfers).where(eq(bankTransfers.id, inserted.id)).limit(1))[0]!)
			return { transfer: final, quote: p.quote }
		}),
})
