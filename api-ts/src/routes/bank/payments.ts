import { Effect } from 'effect'
import { Either } from 'effect'
import { Hono } from 'hono'
import { z } from 'zod'
import { runEffectEither } from '../../runtime'
import { BankError } from '../../services/bank/errors'
import { BankEscrowService } from '../../services/bank/BankEscrowService'
import { BankPaymentsService } from '../../services/bank/BankPaymentsService'
import { BankStreamService } from '../../services/bank/BankStreamService'
import { parseEip681, parseSolanaPay } from '../../services/bank/paymentRequest'
import { formatZodErrors } from '../validators'
import { readJson } from './core'
import type { BankRouteApp, BankRouteDeps } from './index'
import { setRetryAfter } from './retry'

const minor = z.string().regex(/^[1-9][0-9]{0,77}$/, 'positive integer string in minor units')
const idem = z.string().regex(/^[A-Za-z0-9_.:-]{8,128}$/, '8-128 chars of A-Za-z0-9_.:-')
const owner = z.object({ ownerType: z.enum(['user', 'agent', 'org', 'partner_customer']), ownerId: z.string().min(1).max(64) })
const date = z.string().refine((s) => !Number.isNaN(Date.parse(s)), 'ISO date').transform((s) => new Date(s))
const id = z.string().min(1).max(64)

const InvoiceCreate = z.object({
	payeeAccountId: id,
	payer: owner.optional(),
	amountMinor: minor.optional(),
	lineItems: z.array(z.object({ description: z.string().min(1).max(200), quantity: z.number().int().positive().max(1_000_000), unitAmountMinor: minor })).max(100).optional(),
	dueAt: date.optional(),
	memo: z.string().max(280).optional(),
	metadata: z.record(z.string(), z.unknown()).optional(),
	idempotencyKey: idem.optional(),
	publish: z.boolean().optional(),
})
const InvoicePay = z.object({ invoiceId: id.optional(), slug: z.string().min(8).max(32).optional(), fromAccountId: id, amountMinor: minor.optional(), idempotencyKey: idem })
const EscrowCreate = z.object({
	idempotencyKey: idem,
	payee: owner,
	payerAccountId: id,
	payeeAccountId: id,
	amountMinor: minor.optional(),
	milestones: z.array(z.object({ amountMinor: minor, description: z.string().max(280).optional(), deliverBy: date.optional() })).min(1).max(50).optional(),
	arbiter: owner.optional(),
	description: z.string().max(280).optional(),
	deliverBy: date.optional(),
	autoReleaseSeconds: z.number().int().optional(),
})
const StreamCreate = z.object({
	idempotencyKey: idem,
	payerAccountId: id,
	payeeAccountId: id,
	kind: z.enum(['rate', 'metered']),
	rateMinor: minor.optional(),
	periodSeconds: z.number().int().positive().optional(),
	unitPriceMinor: minor.optional(),
	capMinor: minor,
	dustMinor: minor.optional(),
	ewaBps: z.number().int().min(1).max(10_000).optional(),
	metadata: z.record(z.string(), z.unknown()).optional(),
})

export function register(app: BankRouteApp, deps: BankRouteDeps): void {
	const { resolveOwner, run } = deps

	const bad = (c: Parameters<typeof run>[0], fields: Record<string, string>) => c.json({ error: 'Validation Error', error_code: 'VALIDATION_ERROR', fields }, 400)
	const withBody = async <S extends z.ZodType>(c: Parameters<typeof run>[0], schema: S): Promise<{ ok: true; data: z.output<S> } | { ok: false; res: Response }> => {
		const p = schema.safeParse(await readJson(c))
		return p.success ? { ok: true, data: p.data } : { ok: false, res: bad(c, formatZodErrors(p.error)) }
	}
	const idemOf = (c: Parameters<typeof run>[0], b?: string) => b ?? c.req.header('Idempotency-Key')?.trim()

	// ---- invoices
	app.post('/payments/invoices', async (c) => {
		const o = await resolveOwner(c)
		const b = await withBody(c, InvoiceCreate)
		if (!b.ok) return b.res
		return run(c, Effect.gen(function* () { return yield* (yield* BankPaymentsService).createInvoice(o, { ...b.data, idempotencyKey: idemOf(c, b.data.idempotencyKey) }) }))
	})
	app.get('/payments/invoices', async (c) => {
		const o = await resolveOwner(c)
		const role = c.req.query('role') === 'payer' ? 'payer' : 'payee'
		return run(c, Effect.gen(function* () { return { invoices: yield* (yield* BankPaymentsService).listInvoices(o, { role, status: c.req.query('status') }) } }))
	})
	app.post('/payments/invoices/pay', async (c) => {
		const o = await resolveOwner(c)
		const b = await withBody(c, InvoicePay.extend({ idempotencyKey: idem.optional() }))
		if (!b.ok) return b.res
		const key = idemOf(c, b.data.idempotencyKey)
		if (!key) return bad(c, { idempotencyKey: 'required (body field or Idempotency-Key header)' })
		return run(c, Effect.gen(function* () { return yield* (yield* BankPaymentsService).payInvoice(o, { ...b.data, idempotencyKey: key }) }))
	})
	app.get('/payments/invoices/:id', async (c) => {
		const o = await resolveOwner(c)
		return run(c, Effect.gen(function* () { return yield* (yield* BankPaymentsService).getInvoice(o, c.req.param('id')) }))
	})
	app.post('/payments/invoices/:id/publish', async (c) => {
		const o = await resolveOwner(c)
		return run(c, Effect.gen(function* () { return yield* (yield* BankPaymentsService).publishInvoice(o, c.req.param('id')) }))
	})
	app.post('/payments/invoices/:id/void', async (c) => {
		const o = await resolveOwner(c)
		return run(c, Effect.gen(function* () { return yield* (yield* BankPaymentsService).voidInvoice(o, c.req.param('id')) }))
	})
	/** Pure: decode an EIP-681 or Solana Pay URI. */
	app.get('/payments/request/parse', async (c) => {
		await resolveOwner(c)
		const uri = c.req.query('uri') ?? ''
		try {
			if (uri.startsWith('solana:')) {
				const r = parseSolanaPay(uri)
				return c.json({ success: true, standard: 'solana-pay', request: r })
			}
			const r = parseEip681(uri)
			return c.json({ success: true, standard: 'eip-681', request: { ...r, amountMinor: r.amountMinor?.toString() } })
		} catch (e) {
			return bad(c, { uri: (e as Error).message })
		}
	})

	// ---- escrow
	app.post('/escrows', async (c) => {
		const o = await resolveOwner(c)
		const b = await withBody(c, EscrowCreate.extend({ idempotencyKey: idem.optional() }))
		if (!b.ok) return b.res
		const key = idemOf(c, b.data.idempotencyKey)
		if (!key) return bad(c, { idempotencyKey: 'required (body field or Idempotency-Key header)' })
		return run(c, Effect.gen(function* () { return yield* (yield* BankEscrowService).createEscrow(o, { ...b.data, idempotencyKey: key }) }))
	})
	app.get('/escrows', async (c) => {
		const o = await resolveOwner(c)
		const r = c.req.query('role')
		const role = r === 'payer' || r === 'payee' || r === 'arbiter' ? r : undefined
		return run(c, Effect.gen(function* () { return { escrows: yield* (yield* BankEscrowService).listEscrows(o, role) } }))
	})
	app.get('/escrows/:id', async (c) => {
		const o = await resolveOwner(c)
		return run(c, Effect.gen(function* () { return yield* (yield* BankEscrowService).getEscrow(o, c.req.param('id')) }))
	})
	const seqOf = (c: Parameters<typeof run>[0]) => Number.parseInt(c.req.param('seq') ?? '', 10)
	const escrowAction = (path: string, schema: z.ZodType | null, f: (svc: BankEscrowService['Type'], o: Awaited<ReturnType<typeof resolveOwner>>, id: string, seq: number, body: any) => ReturnType<BankEscrowService['Type']['confirmRelease']>) =>
		app.post(`/escrows/:id/milestones/:seq/${path}`, async (c) => {
			const o = await resolveOwner(c)
			const seq = seqOf(c)
			if (!Number.isInteger(seq) || seq < 1) return bad(c, { seq: 'must be a positive integer' })
			let body: unknown = {}
			if (schema) {
				const p = schema.safeParse(await readJson(c))
				if (!p.success) return bad(c, formatZodErrors(p.error))
				body = p.data
			}
			return run(c, Effect.gen(function* () { return yield* f(yield* BankEscrowService, o, c.req.param('id'), seq, body) }))
		})
	escrowAction('deliver', z.object({ proof: z.string().min(1).max(4000) }), (s, o, i, q, b) => s.markDelivered(o, i, q, b.proof))
	escrowAction('confirm', null, (s, o, i, q) => s.confirmRelease(o, i, q))
	escrowAction('dispute', z.object({ reason: z.string().min(1).max(1000) }), (s, o, i, q, b) => s.dispute(o, i, q, b.reason))
	escrowAction('resolve', z.object({ releaseMinor: z.string().regex(/^(0|[1-9][0-9]{0,77})$/), note: z.string().max(1000).optional() }), (s, o, i, q, b) => s.resolveDispute(o, i, q, b.releaseMinor, b.note))
	escrowAction('refund', null, (s, o, i, q) => s.refund(o, i, q))

	// ---- streams / metered
	app.post('/streams', async (c) => {
		const o = await resolveOwner(c)
		const b = await withBody(c, StreamCreate.extend({ idempotencyKey: idem.optional() }))
		if (!b.ok) return b.res
		const key = idemOf(c, b.data.idempotencyKey)
		if (!key) return bad(c, { idempotencyKey: 'required (body field or Idempotency-Key header)' })
		return run(c, Effect.gen(function* () { return yield* (yield* BankStreamService).createStream(o, { ...b.data, idempotencyKey: key }) }))
	})
	app.get('/streams', async (c) => {
		const o = await resolveOwner(c)
		const r = c.req.query('role')
		return run(c, Effect.gen(function* () { return { streams: yield* (yield* BankStreamService).listStreams(o, r === 'payer' || r === 'payee' ? r : undefined) } }))
	})
	app.get('/streams/:id', async (c) => {
		const o = await resolveOwner(c)
		return run(c, Effect.gen(function* () { return yield* (yield* BankStreamService).getStream(o, c.req.param('id')) }))
	})
	for (const act of ['pause', 'resume', 'cancel', 'settle'] as const) {
		app.post(`/streams/:id/${act}`, async (c) => {
			const o = await resolveOwner(c)
			return run(c, Effect.gen(function* () { return yield* (yield* BankStreamService)[act](o, c.req.param('id')) }))
		})
	}
	app.post('/streams/:id/usage', async (c) => {
		const o = await resolveOwner(c)
		const b = await withBody(c, z.object({ units: minor, idempotencyKey: idem.optional() }))
		if (!b.ok) return b.res
		const key = idemOf(c, b.data.idempotencyKey)
		if (!key) return bad(c, { idempotencyKey: 'required (body field or Idempotency-Key header)' })
		return run(c, Effect.gen(function* () { return yield* (yield* BankStreamService).reportUsage(c.req.param('id'), b.data.units, { actor: o, idempotencyKey: key }) }))
	})
}

/**
 * Public, unauthenticated invoice lookup. MUST be mounted outside the authed bank apps, e.g. in app.ts:
 *   app.route('/public/bank', bankPublicRoutes)   ->   GET /public/bank/invoices/:slug
 */
export const bankPublicRoutes = new Hono()
bankPublicRoutes.get('/invoices/:slug', async (c) => {
	const slug = c.req.param('slug')
	if (!/^[A-Za-z0-9_-]{8,32}$/.test(slug)) return c.json({ success: false, error: 'NOT_FOUND', message: 'Invoice not found' }, 404)
	const r = await runEffectEither(Effect.gen(function* () { return yield* (yield* BankPaymentsService).getPublicInvoice(slug) }))
	if (Either.isLeft(r)) {
		const e = r.left as unknown
		if (e instanceof BankError) { setRetryAfter(c, e); return c.json({ success: false, error: e.code, message: e.message }, e.status as 404) }
		return c.json({ success: false, error: 'INTERNAL', message: 'Could not load invoice' }, 500)
	}
	c.header('Cache-Control', 'no-store')
	return c.json({ success: true, invoice: r.right })
})
