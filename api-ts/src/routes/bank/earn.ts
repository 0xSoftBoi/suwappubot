import { Effect } from 'effect'
import { z } from 'zod'
import { findAsset, toMinor } from '../../services/bank/assets'
import { BankEarnService } from '../../services/bank/BankEarnService'
import { BankLedgerService } from '../../services/bank/BankLedgerService'
import { bankErr } from '../../services/bank/errors'
import { formatZodErrors } from '../validators'
import { readJson } from './core'
import type { BankRouteApp, BankRouteDeps } from './index'

const minor = z.string().regex(/^[1-9][0-9]{0,77}$/, 'positive integer string in minor units')
const minor0 = z.string().regex(/^(0|[1-9][0-9]{0,77})$/, 'non-negative integer string in minor units')
const human = z.string().regex(/^\d+(\.\d+)?$/, 'decimal string')
const idem = z.string().regex(/^[A-Za-z0-9_.:-]{8,128}$/, '8-128 chars of A-Za-z0-9_.:-')
const addr = z.string().regex(/^0x[0-9a-fA-F]{40}$/, 'EVM address')

const DepositSchema = z
	.object({ idempotencyKey: idem.optional(), accountId: z.string().min(1).max(64), vault: addr, amountMinor: minor.optional(), amount: human.optional() })
	.refine((v) => (v.amountMinor ? 1 : 0) + (v.amount ? 1 : 0) === 1, { message: 'provide exactly one of amountMinor or amount' })

const WithdrawSchema = z
	.object({ idempotencyKey: idem.optional(), accountId: z.string().min(1).max(64), vault: addr, amountMinor: minor.optional(), amount: human.optional(), all: z.boolean().optional() })
	.refine((v) => (v.amountMinor ? 1 : 0) + (v.amount ? 1 : 0) + (v.all ? 1 : 0) === 1, { message: 'provide exactly one of amountMinor, amount or all' })

const SettingsSchema = z.object({
	accountId: z.string().min(1).max(64),
	vault: addr,
	enabled: z.boolean().default(true),
	floorMinor: minor0.optional(),
	floor: human.optional(),
	minSweepMinor: minor.optional(),
})

export function register(app: BankRouteApp, deps: BankRouteDeps): void {
	const { resolveOwner, run } = deps
	const bad = (c: Parameters<typeof run>[0], fields: Record<string, string>) =>
		c.json({ error: 'Validation Error', error_code: 'VALIDATION_ERROR', fields }, 400)

	const amountFor = (owner: Awaited<ReturnType<typeof resolveOwner>>, accountId: string, b: { amountMinor?: string | undefined; amount?: string | undefined }, field = 'amount') =>
		Effect.gen(function* () {
			if (b.amountMinor) return b.amountMinor
			if (!b.amount) return yield* Effect.fail(bankErr('VALIDATION', `${field} required`))
			const ledger = yield* BankLedgerService
			const a = yield* ledger.getAccount(owner, accountId)
			const asset = findAsset(a.asset, a.chain)
			if (!asset) return yield* Effect.fail(bankErr('ASSET_UNSUPPORTED', 'Unsupported asset'))
			return yield* Effect.try({ try: () => toMinor(b.amount!, asset.decimals).toString(), catch: (e) => bankErr('VALIDATION', (e as Error).message) })
		})

	const idemKey = (c: Parameters<typeof run>[0], bodyKey: string | undefined) => bodyKey ?? c.req.header('Idempotency-Key')?.trim()
	const needKey = (c: Parameters<typeof run>[0]) => bad(c, { idempotencyKey: 'required (body field or Idempotency-Key header)' })

	app.get('/earn/vaults', async (c) => {
		const owner = await resolveOwner(c)
		const asset = c.req.query('asset')
		const chain = c.req.query('chain')
		if (!asset || !chain) return bad(c, { asset: 'required', chain: 'required' })
		return run(c, Effect.gen(function* () { return yield* (yield* BankEarnService).listVaults(owner, { asset, chain }) }))
	})

	app.get('/earn/positions', async (c) => {
		const owner = await resolveOwner(c)
		return run(c, Effect.gen(function* () { return yield* (yield* BankEarnService).positions(owner) }))
	})

	app.get('/earn/history', async (c) => {
		const owner = await resolveOwner(c)
		const limit = c.req.query('limit') ? Number(c.req.query('limit')) : undefined
		return run(c, Effect.gen(function* () { return yield* (yield* BankEarnService).history(owner, { accountId: c.req.query('accountId'), limit }) }))
	})

	app.post('/earn/deposit', async (c) => {
		const owner = await resolveOwner(c)
		const parsed = DepositSchema.safeParse(await readJson(c))
		if (!parsed.success) return bad(c, formatZodErrors(parsed.error))
		const b = parsed.data
		const key = idemKey(c, b.idempotencyKey)
		if (!key) return needKey(c)
		return run(c, Effect.gen(function* () {
			const amountMinor = yield* amountFor(owner, b.accountId, b)
			const op = yield* (yield* BankEarnService).deposit({ owner, idempotencyKey: key, accountId: b.accountId, vault: b.vault, amountMinor })
			return { operation: op }
		}))
	})

	app.post('/earn/withdraw', async (c) => {
		const owner = await resolveOwner(c)
		const parsed = WithdrawSchema.safeParse(await readJson(c))
		if (!parsed.success) return bad(c, formatZodErrors(parsed.error))
		const b = parsed.data
		const key = idemKey(c, b.idempotencyKey)
		if (!key) return needKey(c)
		return run(c, Effect.gen(function* () {
			const amountMinor = b.all ? undefined : yield* amountFor(owner, b.accountId, b)
			const op = yield* (yield* BankEarnService).withdraw({ owner, idempotencyKey: key, accountId: b.accountId, vault: b.vault, amountMinor, all: b.all })
			return { operation: op }
		}))
	})

	app.get('/earn/settings', async (c) => {
		const owner = await resolveOwner(c)
		return run(c, Effect.gen(function* () { return yield* (yield* BankEarnService).getSettings(owner) }))
	})

	app.put('/earn/settings', async (c) => {
		const owner = await resolveOwner(c)
		const parsed = SettingsSchema.safeParse(await readJson(c))
		if (!parsed.success) return bad(c, formatZodErrors(parsed.error))
		const b = parsed.data
		if ((b.floorMinor ? 1 : 0) + (b.floor ? 1 : 0) !== 1) return bad(c, { floor: 'provide exactly one of floorMinor or floor' })
		return run(c, Effect.gen(function* () {
			const floorMinor = b.floorMinor ?? (yield* amountFor(owner, b.accountId, { amount: b.floor }, 'floor'))
			return yield* (yield* BankEarnService).setSettings({ owner, accountId: b.accountId, vault: b.vault, enabled: b.enabled, floorMinor, minSweepMinor: b.minSweepMinor })
		}))
	})
}
