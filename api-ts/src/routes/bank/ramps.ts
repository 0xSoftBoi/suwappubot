import { Effect } from 'effect'
import { z } from 'zod'
import { BANK_ASSETS, toMinor } from '../../services/bank/assets'
import { BankRampService } from '../../services/bank/BankRampService'
import { bankErr } from '../../services/bank/errors'
import { FIAT_DECIMALS, RAIL_INFO, RAILS } from '../../services/bank/ramps/rails'
import { generatePixBrCode, generateUpiUri, generateVietQr, parseQr } from '../../services/bank/ramps/qr'
import { formatZodErrors } from '../validators'
import { readJson } from './core'
import type { BankRouteApp, BankRouteDeps } from './index'

const minor = z.string().regex(/^[1-9][0-9]{0,77}$/, 'positive integer string in minor units')
const human = z.string().regex(/^\d+(\.\d+)?$/, 'decimal string')
const idem = z.string().regex(/^[A-Za-z0-9_.:-]{8,128}$/, '8-128 chars of A-Za-z0-9_.:-')
const provider = z.enum(['bridge', 'due'])
const rail = z.enum(RAILS)

const QuoteSchema = z
	.object({ direction: z.enum(['offramp', 'onramp']), rail, asset: z.string().min(2).max(16), amountMinor: minor.optional(), amount: human.optional(), currency: z.string().min(3).max(8).optional(), externalAccountId: z.string().min(1).max(64).optional() })
	.refine((v) => (v.amountMinor ? 1 : 0) + (v.amount ? 1 : 0) === 1, { message: 'provide exactly one of amountMinor or amount' })

const KycSchema = z.object({ provider: provider.default('bridge'), email: z.string().email(), fullName: z.string().min(1).max(256), type: z.enum(['individual', 'business']).default('individual') })

const ExternalSchema = z.object({
	provider: provider.default('bridge'),
	accountType: z.enum(['us', 'iban', 'clabe']),
	ownerName: z.string().min(1).max(256),
	bankName: z.string().max(256).optional(),
	label: z.string().max(80).optional(),
	account: z.record(z.string(), z.string().max(64)),
	address: z.object({ street_line_1: z.string().min(4).max(35), city: z.string().min(1), country: z.string().length(3), state: z.string().optional(), postal_code: z.string().optional() }).optional(),
})

const VirtualSchema = z.object({ provider: provider.default('bridge'), accountId: z.string().min(1).max(64), sourceCurrency: z.enum(['usd', 'eur', 'mxn', 'brl', 'cop', 'gbp']) })

const OfframpSchema = z.object({ idempotencyKey: idem.optional(), provider: provider.optional(), fromAccountId: z.string().min(1).max(64), externalAccountId: z.string().min(1).max(64), amountMinor: minor, minReceiveMinor: z.string().regex(/^[0-9]{1,78}$/).optional() })

const QrGenSchema = z.discriminatedUnion('kind', [
	z.object({ kind: z.literal('pix'), key: z.string().min(1).max(77), merchantName: z.string().min(1).max(25), merchantCity: z.string().min(1).max(15), amountMinor: minor.optional(), txid: z.string().max(25).optional(), description: z.string().max(40).optional() }),
	z.object({ kind: z.literal('vietqr'), bin: z.string().regex(/^\d{6}$/), account: z.string().min(1).max(19), amountMinor: minor.optional(), purpose: z.string().max(25).optional(), merchantName: z.string().max(25).optional() }),
	z.object({ kind: z.literal('upi'), vpa: z.string().min(3).max(256), payeeName: z.string().max(100).optional(), amountMinor: minor.optional(), note: z.string().max(80).optional(), reference: z.string().max(35).optional() }),
])

export function register(app: BankRouteApp, deps: BankRouteDeps): void {
	const { resolveOwner, run } = deps
	const bad = (c: Parameters<typeof run>[0], fields: Record<string, string>) => c.json({ error: 'Validation Error', error_code: 'VALIDATION_ERROR', fields }, 400)

	app.get('/ramps/rails', (c) =>
		run(c, Effect.gen(function* () {
			const rails = yield* (yield* BankRampService).rails()
			return { rails: rails.map((r) => ({ ...r, currency: RAIL_INFO[r.rail].currency, decimals: FIAT_DECIMALS[RAIL_INFO[r.rail].currency] ?? 2 })), fiatDecimals: FIAT_DECIMALS }
		})),
	)

	app.get('/ramps/providers', (c) =>
		run(c, Effect.gen(function* () {
			const ps = yield* (yield* BankRampService).providers()
			return { providers: ps.map((p) => ({ id: p.id, configured: p.missingConfig() === null, missing: p.missingConfig(), capabilities: p.capabilities() })) }
		})),
	)

	app.post('/ramps/quote', async (c) => {
		const quoteOwner = await resolveOwner(c)
		const parsed = QuoteSchema.safeParse(await readJson(c))
		if (!parsed.success) return bad(c, formatZodErrors(parsed.error))
		const b = parsed.data
		return run(c, Effect.gen(function* () {
			let amountMinor = b.amountMinor
			if (!amountMinor) {
				const dec = BANK_ASSETS.find((a) => a.symbol === b.asset.toUpperCase())?.decimals
				if (dec === undefined) return yield* Effect.fail(bankErr('ASSET_UNSUPPORTED', `Unsupported asset ${b.asset}`))
				amountMinor = yield* Effect.try({ try: () => toMinor(b.amount as string, dec).toString(), catch: (e) => bankErr('VALIDATION', (e as Error).message) })
			}
			const fiat = (b.currency ?? RAIL_INFO[b.rail].currency).toUpperCase()
				const routed = yield* (yield* BankRampService).quote({ direction: b.direction, rail: b.rail, asset: b.asset, amountMinor, currency: b.currency, ...(b.externalAccountId ? { externalAccountId: b.externalAccountId, owner: quoteOwner } : {}) })
				// provider/quoteId/expiresAt: the quote offramp would execute against (best of the executing provider when externalAccountId is given). Pass receiveAmountMinor back as minReceiveMinor to refuse worse terms.
				return { routed, fiatCurrency: fiat, decimals: FIAT_DECIMALS[fiat] ?? 2, provider: routed.best.provider, quoteId: routed.best.quoteId, expiresAt: routed.best.expiresAt, receiveAmountMinor: routed.best.receiveAmountMinor }
		}))
	})

	app.post('/ramps/kyc', async (c) => {
		const owner = await resolveOwner(c)
		const parsed = KycSchema.safeParse(await readJson(c))
		if (!parsed.success) return bad(c, formatZodErrors(parsed.error))
		const { provider: p, ...rest } = parsed.data
		return run(c, Effect.gen(function* () { return { customer: yield* (yield* BankRampService).startKyc(owner, p, rest) } }))
	})

	app.get('/ramps/kyc/:provider', async (c) => {
		const owner = await resolveOwner(c)
		const p = provider.safeParse(c.req.param('provider'))
		if (!p.success) return bad(c, { provider: 'bridge | due' })
		return run(c, Effect.gen(function* () { return { customer: yield* (yield* BankRampService).refreshKyc(owner, p.data) } }))
	})

	app.post('/ramps/external-accounts', async (c) => {
		const owner = await resolveOwner(c)
		const parsed = ExternalSchema.safeParse(await readJson(c))
		if (!parsed.success) return bad(c, formatZodErrors(parsed.error))
		const { provider: p, ...rest } = parsed.data
		return run(c, Effect.gen(function* () {
			const svc = yield* BankRampService
			return { externalAccount: yield* svc.registerExternalAccount(owner, p, { accountType: rest.accountType, ownerName: rest.ownerName, account: rest.account, label: rest.label, ...(rest.bankName ? { bankName: rest.bankName } : {}), ...(rest.address ? { address: rest.address } : {}) }) }
		}))
	})

	app.get('/ramps/external-accounts', async (c) => {
		const owner = await resolveOwner(c)
		return run(c, Effect.gen(function* () { return { externalAccounts: yield* (yield* BankRampService).listExternalAccounts(owner) } }))
	})

	app.post('/ramps/virtual-accounts', async (c) => {
		const owner = await resolveOwner(c)
		const parsed = VirtualSchema.safeParse(await readJson(c))
		if (!parsed.success) return bad(c, formatZodErrors(parsed.error))
		const b = parsed.data
		return run(c, Effect.gen(function* () { return { virtualAccount: yield* (yield* BankRampService).createVirtualAccount(owner, b.provider, b.accountId, b.sourceCurrency) } }))
	})

	app.get('/ramps/virtual-accounts', async (c) => {
		const owner = await resolveOwner(c)
		return run(c, Effect.gen(function* () { return { virtualAccounts: yield* (yield* BankRampService).listVirtualAccounts(owner) } }))
	})

	app.post('/ramps/offramp', async (c) => {
		const owner = await resolveOwner(c)
		const parsed = OfframpSchema.safeParse(await readJson(c))
		if (!parsed.success) return bad(c, formatZodErrors(parsed.error))
		const b = parsed.data
		const idempotencyKey = b.idempotencyKey ?? c.req.header('Idempotency-Key')?.trim()
		if (!idempotencyKey) return bad(c, { idempotencyKey: 'required (body field or Idempotency-Key header)' })
		return run(c, Effect.gen(function* () {
			return yield* (yield* BankRampService).offramp({ owner, provider: b.provider, fromAccountId: b.fromAccountId, externalAccountId: b.externalAccountId, amountMinor: b.amountMinor, idempotencyKey, minReceiveMinor: b.minReceiveMinor })
		}))
	})

	app.get('/ramps/transfers', async (c) => {
		const owner = await resolveOwner(c)
		return run(c, Effect.gen(function* () { return { transfers: yield* (yield* BankRampService).listRampTransfers(owner, Number(c.req.query('limit') ?? 50)) } }))
	})

	app.get('/ramps/transfers/:id', async (c) => {
		const owner = await resolveOwner(c)
		return run(c, Effect.gen(function* () { return { transfer: yield* (yield* BankRampService).getRampTransfer(owner, c.req.param('id')) } }))
	})

	// Pure QR codecs: a scanned QR becomes a payout request (feed it to /ramps/quote + /remittance/send).
	app.post('/ramps/qr/parse', async (c) => {
		await resolveOwner(c)
		const parsed = z.object({ text: z.string().min(8).max(2048) }).safeParse(await readJson(c))
		if (!parsed.success) return bad(c, formatZodErrors(parsed.error))
		try {
			return c.json({ success: true, payout: parseQr(parsed.data.text) })
		} catch (e) {
			return c.json({ success: false, error: 'Invalid QR', error_code: 'QR_INVALID', message: (e as Error).message }, 400)
		}
	})

	app.post('/ramps/qr/generate', async (c) => {
		await resolveOwner(c)
		const parsed = QrGenSchema.safeParse(await readJson(c))
		if (!parsed.success) return bad(c, formatZodErrors(parsed.error))
		const b = parsed.data
		try {
			const payload = b.kind === 'pix' ? generatePixBrCode(b) : b.kind === 'vietqr' ? generateVietQr(b) : generateUpiUri(b)
			return c.json({ success: true, kind: b.kind, payload })
		} catch (e) {
			return c.json({ success: false, error: 'Invalid input', error_code: 'QR_INVALID', message: (e as Error).message }, 400)
		}
	})
}
