import { Effect, Either } from 'effect'
import { Hono, type Context } from 'hono'
import { z } from 'zod'
import { runEffectEither } from '../../runtime'
import { BankAgentPayService } from '../../services/bank/BankAgentPayService'
import { BankError } from '../../services/bank/errors'
import { formatZodErrors } from '../validators'
import { readJson } from './core'
import type { BankRouteApp, BankRouteDeps } from './index'
import { setRetryAfter } from './retry'

const minor = z.string().regex(/^[1-9][0-9]{0,77}$/, 'positive integer string in minor units')
const idem = z.string().regex(/^[A-Za-z0-9_.:-]{8,128}$/)
const Open = z.object({
	asset: z.string().min(2).max(16),
	chain: z.string().min(2).max(32),
	label: z.string().max(80).optional(),
	mandate: z.object({
		perCallMaxMinor: minor,
		dailyCapMinor: minor,
		allowedHosts: z.array(z.string().min(1).max(255)).max(50).optional(),
		allowedPayees: z.array(z.string().regex(/^0x[0-9a-fA-F]{40}$/)).max(50).optional(),
		allowedAssets: z.array(z.string().min(2).max(16)).min(1).max(20),
		expiresAt: z.string().optional(),
	}),
})
const Pay = z.object({
	mandateId: z.string().min(1).max(64),
	url: z.url().max(2048),
	method: z.enum(['GET', 'POST', 'PUT', 'DELETE']).optional(),
	body: z.string().max(100_000).optional(),
	headers: z.record(z.string(), z.string()).optional(),
	idempotencyKey: idem.optional(),
})
const Register = z.object({ accountId: z.string().min(1).max(64), title: z.string().min(1).max(120), description: z.string().max(2000).optional(), upstreamUrl: z.url().max(2048), priceMinor: minor, slug: z.string().max(40).optional() })
const Stream = z.object({ payerAccountId: z.string().max(64), payeeAccountId: z.string().max(64), unitPriceMinor: minor, unit: z.string().min(1).max(32), idempotencyKey: idem })
const Usage = z.object({ streamId: z.string().max(64), units: minor, idempotencyKey: idem })

// x402 server: paywalled proxy. Returns 402 + requirements, settles via the facilitator, credits the seller.
// Shared by the authed route and the public mount (payers are third parties, authenticated by x402 payment).
async function servePaywall(c: Context): Promise<Response> {
	const headers: Record<string, string> = {}
	c.req.raw.headers.forEach((v, k) => { headers[k.toLowerCase()] = v })
	const body = c.req.method === 'POST' ? await c.req.text() : undefined
	const r = await runEffectEither(Effect.gen(function* () { return yield* (yield* BankAgentPayService).servePaidResource(c.req.param('slug') as string, { method: c.req.method, url: c.req.url, headers, body }) }))
	if (Either.isLeft(r)) {
		const e = r.left as unknown
		if (e instanceof BankError) setRetryAfter(c, e)
		if (e instanceof BankError) return c.json({ success: false, error: e.code, message: e.message, ...(e.missing ? { missing: e.missing } : {}) }, e.status as 400)
		return c.json({ success: false, error: 'INTERNAL', message: String(e) }, 500)
	}
	return new Response(r.right.body, { status: r.right.status, headers: r.right.headers })
}

/** Public x402 paywall: `app.route('/x402/bank', bankX402PublicRoutes)` -> ALL /x402/bank/pay/:slug. Only this handler. */
export const bankX402PublicRoutes = new Hono()
bankX402PublicRoutes.all('/pay/:slug', servePaywall)

export function register(app: BankRouteApp, deps: BankRouteDeps): void {
	const { resolveOwner, run } = deps
	const bad = (c: Parameters<typeof run>[0], e: z.ZodError) => c.json({ error: 'Validation Error', error_code: 'VALIDATION_ERROR', fields: formatZodErrors(e) }, 400)

	app.post('/agents/accounts', async (c) => {
		const owner = await resolveOwner(c)
		const p = Open.safeParse(await readJson(c))
		if (!p.success) return bad(c, p.error)
		return run(c, Effect.gen(function* () { return yield* (yield* BankAgentPayService).openAgentAccount(owner, p.data as never) }))
	})
	app.get('/agents/mandates', async (c) => {
		const owner = await resolveOwner(c)
		return run(c, Effect.gen(function* () { return { mandates: yield* (yield* BankAgentPayService).listMandates(owner) } }))
	})
	app.delete('/agents/mandates/:id', async (c) => {
		const owner = await resolveOwner(c)
		return run(c, Effect.gen(function* () { return { mandate: yield* (yield* BankAgentPayService).revokeMandate(owner, c.req.param('id')) } }))
	})
	app.post('/agents/pay', async (c) => {
		const owner = await resolveOwner(c)
		const p = Pay.safeParse(await readJson(c))
		if (!p.success) return bad(c, p.error)
		// MONEY-PATH: key from body or Idempotency-Key header (optional; absent => result.idempotent=false).
		const hk = c.req.header('Idempotency-Key')?.trim()
		if (!p.data.idempotencyKey && hk && !idem.safeParse(hk).success) return c.json({ error: 'Validation Error', error_code: 'VALIDATION_ERROR', fields: { 'Idempotency-Key': 'must match [A-Za-z0-9_.:-]{8,128}' } }, 400)
		const input = { ...p.data, idempotencyKey: p.data.idempotencyKey ?? hk }
		return run(c, Effect.gen(function* () { return { result: yield* (yield* BankAgentPayService).payForResource(owner, input as never) } }))
	})
	app.post('/agents/resources', async (c) => {
		const owner = await resolveOwner(c)
		const p = Register.safeParse(await readJson(c))
		if (!p.success) return bad(c, p.error)
		return run(c, Effect.gen(function* () { return { resource: yield* (yield* BankAgentPayService).registerResource(owner, p.data as never) } }))
	})
	app.get('/agents/resources', async (c) => {
		const owner = await resolveOwner(c)
		return run(c, Effect.gen(function* () {
			const s = yield* BankAgentPayService
			yield* s.creditSales(owner)
			return { resources: yield* s.listMyResources(owner) }
		}))
	})
	app.post('/agents/resources/:id/:action{enable|disable}', async (c) => {
		const owner = await resolveOwner(c)
		const status = c.req.param('action') === 'enable' ? 'active' : 'disabled'
		return run(c, Effect.gen(function* () { return { resource: yield* (yield* BankAgentPayService).setResourceStatus(owner, c.req.param('id'), status) } }))
	})
	// Agent-to-agent directory (priced resources discoverable via GET).
	app.get('/agents/directory', (c) =>
		run(c, Effect.gen(function* () { return { resources: yield* (yield* BankAgentPayService).directory({ asset: c.req.query('asset') ?? undefined, limit: Number(c.req.query('limit') ?? 50) || 50 }) } })),
	)
	// x402 server: paywalled proxy. Returns 402 + requirements, settles via the facilitator, credits the seller.
	app.all('/agents/pay/:slug', servePaywall)
	// Metered agent<->agent settlement (delegates to the payments module's BankStreamService).
	app.post('/agents/streams', async (c) => {
		const owner = await resolveOwner(c)
		const p = Stream.safeParse(await readJson(c))
		if (!p.success) return bad(c, p.error)
		return run(c, Effect.gen(function* () { return yield* (yield* BankAgentPayService).openMeteredStream(owner, p.data) }))
	})
	app.post('/agents/streams/usage', async (c) => {
		const owner = await resolveOwner(c)
		const p = Usage.safeParse(await readJson(c))
		if (!p.success) return bad(c, p.error)
		return run(c, Effect.gen(function* () { return yield* (yield* BankAgentPayService).reportMeteredUsage(owner, p.data) }))
	})
}
