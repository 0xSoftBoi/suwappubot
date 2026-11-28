import { Effect } from 'effect'
import { z } from 'zod'
import { BankLedgerService } from '../../services/bank/BankLedgerService'
import { BankRemittanceService } from '../../services/bank/BankRemittanceService'
import { findAsset, toMinor } from '../../services/bank/assets'
import { bankErr } from '../../services/bank/errors'
import { RAILS } from '../../services/bank/ramps/rails'
import { formatZodErrors } from '../validators'
import { readJson } from './core'
import type { BankRouteApp, BankRouteDeps } from './index'

const minor = z.string().regex(/^[1-9][0-9]{0,77}$/, 'positive integer string in minor units')
const human = z.string().regex(/^\d+(\.\d+)?$/, 'decimal string')
const idem = z.string().regex(/^[A-Za-z0-9_.:-]{8,128}$/, '8-128 chars of A-Za-z0-9_.:-')

const amountRefine = <T extends { amountMinor?: string | undefined; amount?: string | undefined }>(v: T) => (v.amountMinor ? 1 : 0) + (v.amount ? 1 : 0) === 1

const QuoteSchema = z
	.object({ fromAccountId: z.string().min(1).max(64), amountMinor: minor.optional(), amount: human.optional(), rail: z.enum(RAILS).optional(), currency: z.string().min(3).max(8).optional() })
	.refine(amountRefine, { message: 'provide exactly one of amountMinor or amount' })

const SendSchema = z
	.object({
		idempotencyKey: idem.optional(),
		fromAccountId: z.string().min(1).max(64),
		amountMinor: minor.optional(),
		amount: human.optional(),
		memo: z.string().max(280).optional(),
		autoEarn: z.boolean().optional(),
		recipient: z.discriminatedUnion('kind', [
			z.object({ kind: z.literal('user'), telegramId: z.number().int().positive().optional(), username: z.string().min(1).max(64).optional() }),
			z.object({ kind: z.literal('address'), address: z.string().min(20).max(128) }),
			z.object({ kind: z.literal('claim'), label: z.string().max(80).optional(), telegramId: z.number().int().positive().optional(), username: z.string().min(1).max(64).optional() }),
			z.object({ kind: z.literal('payout'), rail: z.enum(RAILS), externalAccountId: z.string().min(1).max(64) }),
		]),
	})
	.refine(amountRefine, { message: 'provide exactly one of amountMinor or amount' })

const ClaimSchema = z.object({ accountId: z.string().min(1).max(64).optional(), choice: z.enum(['keep', 'cashout']).default('keep'), externalAccountId: z.string().min(1).max(64).optional() })

export function register(app: BankRouteApp, deps: BankRouteDeps): void {
	const { resolveOwner, run } = deps
	const bad = (c: Parameters<typeof run>[0], fields: Record<string, string>) => c.json({ error: 'Validation Error', error_code: 'VALIDATION_ERROR', fields }, 400)

	const amountOf = (owner: Parameters<typeof resolveOwner> extends never ? never : Awaited<ReturnType<typeof resolveOwner>>, b: { fromAccountId: string; amountMinor?: string | undefined; amount?: string | undefined }) =>
		Effect.gen(function* () {
			if (b.amountMinor) return b.amountMinor
			const a = yield* (yield* BankLedgerService).getAccount(owner, b.fromAccountId)
			const asset = findAsset(a.asset, a.chain)
			if (!asset) return yield* Effect.fail(bankErr('ASSET_UNSUPPORTED', 'Unsupported asset'))
			return yield* Effect.try({ try: () => toMinor(b.amount as string, asset.decimals).toString(), catch: (e) => bankErr('VALIDATION', (e as Error).message) })
		})

	app.post('/remittance/quote', async (c) => {
		const owner = await resolveOwner(c)
		const parsed = QuoteSchema.safeParse(await readJson(c))
		if (!parsed.success) return bad(c, formatZodErrors(parsed.error))
		const b = parsed.data
		return run(c, Effect.gen(function* () {
			const amountMinor = yield* amountOf(owner, b)
			return { quote: yield* (yield* BankRemittanceService).quote(owner, { fromAccountId: b.fromAccountId, amountMinor, rail: b.rail, currency: b.currency }) }
		}))
	})

	app.post('/remittance/send', async (c) => {
		const owner = await resolveOwner(c)
		const parsed = SendSchema.safeParse(await readJson(c))
		if (!parsed.success) return bad(c, formatZodErrors(parsed.error))
		const b = parsed.data
		const idempotencyKey = b.idempotencyKey ?? c.req.header('Idempotency-Key')?.trim()
		if (!idempotencyKey) return bad(c, { idempotencyKey: 'required (body field or Idempotency-Key header)' })
		return run(c, Effect.gen(function* () {
			const amountMinor = yield* amountOf(owner, b)
			return yield* (yield* BankRemittanceService).send(owner, { idempotencyKey, fromAccountId: b.fromAccountId, amountMinor, recipient: b.recipient, memo: b.memo, autoEarn: b.autoEarn })
		}))
	})

	// Public-ish preview of a claim link (token is the capability; no owner needed).
	app.get('/remittance/claim/:token', (c) =>
		run(c, Effect.gen(function* () { return { claim: yield* (yield* BankRemittanceService).claimPreview(c.req.param('token')) } })),
	)

	app.post('/remittance/claim/:token', async (c) => {
		const owner = await resolveOwner(c)
		const parsed = ClaimSchema.safeParse((await readJson(c)) ?? {})
		if (!parsed.success) return bad(c, formatZodErrors(parsed.error))
		const b = parsed.data
		return run(c, Effect.gen(function* () { return yield* (yield* BankRemittanceService).claim(owner, { token: c.req.param('token'), accountId: b.accountId, choice: b.choice, externalAccountId: b.externalAccountId }) }))
	})

	app.post('/remittance/:id/cancel', async (c) => {
		const owner = await resolveOwner(c)
		return run(c, Effect.gen(function* () { return { remittance: yield* (yield* BankRemittanceService).cancel(owner, c.req.param('id')) } }))
	})

	app.get('/remittance', async (c) => {
		const owner = await resolveOwner(c)
		return run(c, Effect.gen(function* () { return yield* (yield* BankRemittanceService).list(owner, Number(c.req.query('limit') ?? 50)) }))
	})

	app.get('/remittance/identity', async (c) => {
		const owner = await resolveOwner(c)
		return run(c, Effect.gen(function* () { return { identity: yield* (yield* BankRemittanceService).identity(owner) } }))
	})

	app.get('/remittance/corridors', async (c) => {
		await resolveOwner(c)
		return run(c, Effect.gen(function* () { return { corridors: yield* (yield* BankRemittanceService).corridorStats() } }))
	})

	app.get('/remittance/:id', async (c) => {
		const owner = await resolveOwner(c)
		return run(c, Effect.gen(function* () { return { remittance: yield* (yield* BankRemittanceService).get(owner, c.req.param('id')) } }))
	})
}
