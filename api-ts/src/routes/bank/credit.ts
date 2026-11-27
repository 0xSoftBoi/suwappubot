import { Effect } from 'effect'
import { z } from 'zod'
import { findAsset, toMinor } from '../../services/bank/assets'
import { BankCreditService } from '../../services/bank/BankCreditService'
import { BankLedgerService } from '../../services/bank/BankLedgerService'
import { bankErr } from '../../services/bank/errors'
import { formatZodErrors } from '../validators'
import { readJson } from './core'
import type { BankRouteApp, BankRouteDeps } from './index'

const minor = z.string().regex(/^[1-9][0-9]{0,77}$/, 'positive integer string in minor units')
const human = z.string().regex(/^\d+(\.\d+)?$/, 'decimal string')
const idem = z.string().regex(/^[A-Za-z0-9_.:-]{8,128}$/, '8-128 chars of A-Za-z0-9_.:-')
const accountId = z.string().min(1).max(64)
const lineId = z.string().min(1).max(80)

const OpenLineSchema = z.object({
	idempotencyKey: idem.optional(),
	accountId,
	marketId: z.string().regex(/^0x[0-9a-fA-F]{64}$/, 'Morpho market id (bytes32)'),
	collateral: z.object({
		source: z.enum(['wallet', 'vault_shares']).default('wallet'),
		amountMinor: minor,
		savingsAccountId: z.string().min(1).max(64).optional(),
	}),
})
const AmountSchema = z
	.object({ idempotencyKey: idem.optional(), lineId, amountMinor: minor.optional(), amount: human.optional(), all: z.boolean().optional() })
	.refine((v) => (v.amountMinor ? 1 : 0) + (v.amount ? 1 : 0) + (v.all ? 1 : 0) === 1, { message: 'provide exactly one of amountMinor, amount or all' })
const UnsecuredSchema = z.object({ idempotencyKey: idem.optional(), accountId })
const ReceivableSchema = z.object({ idempotencyKey: idem.optional(), accountId, invoiceId: z.string().min(1).max(64) })

export function register(app: BankRouteApp, deps: BankRouteDeps): void {
	const { resolveOwner, run } = deps
	const bad = (c: Parameters<typeof run>[0], fields: Record<string, string>) =>
		c.json({ error: 'Validation Error', error_code: 'VALIDATION_ERROR', fields }, 400)
	const keyOf = (c: Parameters<typeof run>[0], k: string | undefined) => k ?? c.req.header('Idempotency-Key')?.trim()
	const needKey = (c: Parameters<typeof run>[0]) => bad(c, { idempotencyKey: 'required (body field or Idempotency-Key header)' })

	/** amount string -> minor using the line's loan asset (or collateral decimals for collateral withdrawals). */
	const lineAmount = (owner: Awaited<ReturnType<typeof resolveOwner>>, id: string, b: { amountMinor?: string | undefined; amount?: string | undefined }, side: 'loan' | 'collateral') =>
		Effect.gen(function* () {
			if (b.amountMinor) return b.amountMinor
			const credit = yield* BankCreditService
			const v = yield* credit.getLine(owner, id)
			const decimals = side === 'loan' ? findAsset(v.line.loanAsset, v.line.chain)?.decimals : (v.line.collateralDecimals ?? undefined)
			if (decimals === undefined) return yield* Effect.fail(bankErr('ASSET_UNSUPPORTED', 'Unknown decimals; use amountMinor'))
			return yield* Effect.try({ try: () => toMinor(b.amount!, decimals).toString(), catch: (e) => bankErr('VALIDATION', (e as Error).message) })
		})
	void BankLedgerService

	app.get('/credit/markets', async (c) => {
		const owner = await resolveOwner(c)
		const chain = c.req.query('chain') ?? 'base'
		const loanAsset = c.req.query('asset') ?? 'USDC'
		return run(c, Effect.gen(function* () { return yield* (yield* BankCreditService).listMarkets(owner, { chain, loanAsset, collateral: c.req.query('collateral') }) }))
	})

	app.get('/credit/lines', async (c) => {
		const owner = await resolveOwner(c)
		return run(c, Effect.gen(function* () { return yield* (yield* BankCreditService).listLines(owner) }))
	})

	app.get('/credit/lines/:id', async (c) => {
		const owner = await resolveOwner(c)
		const id = c.req.param('id')
		return run(c, Effect.gen(function* () { return { line: yield* (yield* BankCreditService).getLine(owner, id) } }))
	})

	app.post('/credit/lines', async (c) => {
		const owner = await resolveOwner(c)
		const parsed = OpenLineSchema.safeParse(await readJson(c))
		if (!parsed.success) return bad(c, formatZodErrors(parsed.error))
		const b = parsed.data
		const key = keyOf(c, b.idempotencyKey)
		if (!key) return needKey(c)
		return run(c, Effect.gen(function* () {
			return { line: yield* (yield* BankCreditService).openLine({ owner, idempotencyKey: key, accountId: b.accountId, marketId: b.marketId, collateral: b.collateral }) }
		}))
	})

	app.post('/credit/draw', async (c) => {
		const owner = await resolveOwner(c)
		const parsed = AmountSchema.safeParse(await readJson(c))
		if (!parsed.success) return bad(c, formatZodErrors(parsed.error))
		const b = parsed.data
		if (b.all) return bad(c, { all: 'not valid for draw' })
		const key = keyOf(c, b.idempotencyKey)
		if (!key) return needKey(c)
		return run(c, Effect.gen(function* () {
			const amountMinor = yield* lineAmount(owner, b.lineId, b, 'loan')
			return yield* (yield* BankCreditService).draw({ owner, idempotencyKey: key, lineId: b.lineId, amountMinor })
		}))
	})

	app.post('/credit/repay', async (c) => {
		const owner = await resolveOwner(c)
		const parsed = AmountSchema.safeParse(await readJson(c))
		if (!parsed.success) return bad(c, formatZodErrors(parsed.error))
		const b = parsed.data
		const key = keyOf(c, b.idempotencyKey)
		if (!key) return needKey(c)
		return run(c, Effect.gen(function* () {
			const amountMinor = b.all ? undefined : yield* lineAmount(owner, b.lineId, b, 'loan')
			return yield* (yield* BankCreditService).repay({ owner, idempotencyKey: key, lineId: b.lineId, amountMinor, all: b.all })
		}))
	})

	app.post('/credit/withdraw-collateral', async (c) => {
		const owner = await resolveOwner(c)
		const parsed = AmountSchema.safeParse(await readJson(c))
		if (!parsed.success) return bad(c, formatZodErrors(parsed.error))
		const b = parsed.data
		const key = keyOf(c, b.idempotencyKey)
		if (!key) return needKey(c)
		return run(c, Effect.gen(function* () {
			const amountMinor = b.all ? undefined : yield* lineAmount(owner, b.lineId, b, 'collateral')
			return yield* (yield* BankCreditService).withdrawCollateral({ owner, idempotencyKey: key, lineId: b.lineId, amountMinor, all: b.all })
		}))
	})

	app.get('/credit/events', async (c) => {
		const owner = await resolveOwner(c)
		const limit = c.req.query('limit') ? Number(c.req.query('limit')) : undefined
		return run(c, Effect.gen(function* () { return yield* (yield* BankCreditService).events(owner, { lineId: c.req.query('lineId'), since: c.req.query('since'), limit }) }))
	})

	app.get('/credit/score', async (c) => {
		const owner = await resolveOwner(c)
		const asset = c.req.query('asset') ?? 'USDC'
		const chain = c.req.query('chain') ?? 'base'
		return run(c, Effect.gen(function* () { return yield* (yield* BankCreditService).score(owner, { asset, chain }) }))
	})

	app.post('/credit/unsecured', async (c) => {
		const owner = await resolveOwner(c)
		const parsed = UnsecuredSchema.safeParse(await readJson(c))
		if (!parsed.success) return bad(c, formatZodErrors(parsed.error))
		const b = parsed.data
		const key = keyOf(c, b.idempotencyKey)
		if (!key) return needKey(c)
		return run(c, Effect.gen(function* () { return { line: yield* (yield* BankCreditService).openUnsecuredLine({ owner, idempotencyKey: key, accountId: b.accountId }) } }))
	})

	app.post('/credit/receivables/finance', async (c) => {
		const owner = await resolveOwner(c)
		const parsed = ReceivableSchema.safeParse(await readJson(c))
		if (!parsed.success) return bad(c, formatZodErrors(parsed.error))
		const b = parsed.data
		const key = keyOf(c, b.idempotencyKey)
		if (!key) return needKey(c)
		return run(c, Effect.gen(function* () { return yield* (yield* BankCreditService).financeReceivable({ owner, idempotencyKey: key, accountId: b.accountId, invoiceId: b.invoiceId }) }))
	})
}
