import { randomUUID } from 'node:crypto'
import { Effect } from 'effect'
import { findAsset, fromMinor, listAssets, toMinor } from '../../services/bank/assets'
import { BankLedgerService } from '../../services/bank/BankLedgerService'
import { BankTransferService } from '../../services/bank/BankTransferService'
import { bankErr } from '../../services/bank/errors'
import { formatZodErrors } from '../validators'
import type { BankRouteApp, BankRouteDeps } from './index'
import { OpenAccountSchema, TransferSchema } from './schemas'

export const presentAccount = <T extends { balanceMinor: string; asset: string; chain: string }>(a: T) => {
	const asset = findAsset(a.asset, a.chain)
	return { ...a, balance: asset ? fromMinor(BigInt(a.balanceMinor), asset.decimals) : null, decimals: asset?.decimals ?? null }
}

export async function readJson(c: { req: { json: () => Promise<unknown> } }): Promise<unknown | undefined> {
	try {
		return await c.req.json()
	} catch {
		return undefined
	}
}

export function register(app: BankRouteApp, deps: BankRouteDeps): void {
	const { resolveOwner, run } = deps
	const bad = (c: Parameters<typeof run>[0], fields: Record<string, string>) =>
		c.json({ error: 'Validation Error', error_code: 'VALIDATION_ERROR', fields }, 400)

	app.get('/assets', (c) => c.json({ assets: listAssets({ chain: c.req.query('chain'), currency: c.req.query('currency') }) }))

	app.post('/accounts', async (c) => {
		const owner = await resolveOwner(c)
		const parsed = OpenAccountSchema.safeParse(await readJson(c))
		if (!parsed.success) return bad(c, formatZodErrors(parsed.error))
		const b = parsed.data
		return run(
			c,
			Effect.gen(function* () {
				const asset = findAsset(b.asset, b.chain)
				if (!asset) return yield* Effect.fail(bankErr('ASSET_UNSUPPORTED', `Unsupported asset ${b.asset} on ${b.chain}`))
				const ledger = yield* BankLedgerService
				const wallet = yield* ledger.resolveCustodyWallet(owner, asset.family)
				const acct = yield* ledger.openAccount({ owner, kind: b.kind, asset: asset.symbol, chain: asset.chain, label: b.label, segmentProfile: b.segmentProfile, wallet })
				return { account: presentAccount(acct) }
			}),
		)
	})

	app.get('/accounts', async (c) => {
		const owner = await resolveOwner(c)
		return run(
			c,
			Effect.gen(function* () {
				const ledger = yield* BankLedgerService
				return { accounts: (yield* ledger.getAccounts(owner)).map(presentAccount) }
			}),
		)
	})

	app.get('/accounts/:id', async (c) => {
		const owner = await resolveOwner(c)
		return run(
			c,
			Effect.gen(function* () {
				const ledger = yield* BankLedgerService
				return { account: presentAccount(yield* ledger.getAccount(owner, c.req.param('id'))) }
			}),
		)
	})

	app.get('/accounts/:id/statement', async (c) => {
		const owner = await resolveOwner(c)
		const limit = c.req.query('limit') ? Number(c.req.query('limit')) : undefined
		if (limit !== undefined && !Number.isInteger(limit)) return bad(c, { limit: 'must be an integer' })
		return run(
			c,
			Effect.gen(function* () {
				const ledger = yield* BankLedgerService
				return yield* ledger.statement(owner, c.req.param('id'), { limit, cursor: c.req.query('cursor') })
			}),
		)
	})

	app.get('/accounts/:id/reconcile', async (c) => {
		const owner = await resolveOwner(c)
		return run(
			c,
			Effect.gen(function* () {
				const ledger = yield* BankLedgerService
				return yield* ledger.reconcile(owner, c.req.param('id'))
			}),
		)
	})

	app.post('/accounts/:id/sync-deposit', async (c) => {
		const owner = await resolveOwner(c)
		return run(
			c,
			Effect.gen(function* () {
				const t = yield* BankTransferService
				return yield* t.syncDeposit(owner, c.req.param('id'))
			}),
		)
	})

	app.post('/transfers', async (c) => {
		const owner = await resolveOwner(c)
		const parsed = TransferSchema.safeParse(await readJson(c))
		if (!parsed.success) return bad(c, formatZodErrors(parsed.error))
		const b = parsed.data
		const idempotencyKey = b.idempotencyKey ?? c.req.header('Idempotency-Key')?.trim() ?? undefined
		if (!idempotencyKey) return bad(c, { idempotencyKey: 'required (body field or Idempotency-Key header)' })
		return run(
			c,
			Effect.gen(function* () {
				const ledger = yield* BankLedgerService
				const transfers = yield* BankTransferService
				let amountMinor = b.amountMinor
				if (!amountMinor) {
					const from = yield* ledger.getAccount(owner, b.fromAccountId)
					const asset = findAsset(from.asset, from.chain)
					if (!asset) return yield* Effect.fail(bankErr('ASSET_UNSUPPORTED', 'Unsupported asset'))
					amountMinor = yield* Effect.try({
						try: () => toMinor(b.amount!, asset.decimals).toString(),
						catch: (e) => bankErr('VALIDATION', (e as Error).message),
					})
				}
				const t = yield* transfers.transfer({
					owner,
					idempotencyKey,
					type: b.toAccountId ? 'internal' : deps.audience === 'agent' ? 'agent' : 'onchain',
					fromAccountId: b.fromAccountId,
					toAccountId: b.toAccountId,
					toExternal: b.toExternal,
					amountMinor,
					memo: b.memo,
				})
				return { transfer: t }
			}),
		)
	})

	app.get('/transfers/:id', async (c) => {
		const owner = await resolveOwner(c)
		return run(
			c,
			Effect.gen(function* () {
				const t = yield* BankTransferService
				return { transfer: yield* t.getTransfer(owner, c.req.param('id')) }
			}),
		)
	})

	app.get('/transfers', async (c) => {
		const owner = await resolveOwner(c)
		const limit = c.req.query('limit') ? Number(c.req.query('limit')) : undefined
		return run(
			c,
			Effect.gen(function* () {
				const t = yield* BankTransferService
				return { transfers: yield* t.listTransfers(owner, { accountId: c.req.query('accountId'), status: c.req.query('status'), limit, before: c.req.query('before') }) }
			}),
		)
	})
}

export const newIdempotencyKey = () => `auto_${randomUUID()}`
