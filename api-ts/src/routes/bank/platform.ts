import { and, asc, eq, gte, lt, sql } from 'drizzle-orm'
import { Effect } from 'effect'
import { Hono, type Context } from 'hono'
import { HTTPException } from 'hono/http-exception'
import { z } from 'zod'
import { bankLedgerEntries, organizationMembers, requireDb } from '../../db'
import { runEffectEither } from '../../runtime'
import { authorize } from '../../services/bank/BankOrgService'
import { findAsset } from '../../services/bank/assets'
import { BankLedgerService } from '../../services/bank/BankLedgerService'
import { BankPartnerService } from '../../services/bank/BankPartnerService'
import { BankPaymentNetworkService } from '../../services/bank/BankPaymentNetworkService'
import { BankStablecoinService } from '../../services/bank/BankStablecoinService'
import { bankDb } from '../../services/bank/db'
import { bankErr } from '../../services/bank/errors'
import { type Statement, parsePain001, serialiseCamt053, serialisePain001 } from '../../services/bank/iso20022'
import { formatZodErrors } from '../validators'
import { readJson } from './core'
import type { BankRouteApp, BankRouteDeps } from './index'

const minor = z.string().regex(/^[1-9][0-9]{0,77}$/, 'positive integer string in minor units')
const idem = z.string().regex(/^[A-Za-z0-9_.:-]{8,128}$/)
const Config = z.object({ feeBpsTransfer: z.number().int().min(0).max(1000).optional(), feeBpsFx: z.number().int().min(0).max(1000).optional(), webhookUrl: z.url().nullable().optional() })
const Customer = z.object({ externalRef: z.string().min(1).max(128), displayName: z.string().max(200).optional(), email: z.email().optional(), country: z.string().length(2).optional() })
const OpenAcct = z.object({ asset: z.string().min(2).max(16), chain: z.string().min(2).max(32), kind: z.enum(['checking', 'savings']).optional(), label: z.string().max(80).optional() })
const Xfer = z.object({ customerId: z.string().max(64), fromAccountId: z.string().max(64), toAccountId: z.string().max(64).optional(), toExternal: z.object({ address: z.string().min(20).max(128) }).optional(), amountMinor: minor, idempotencyKey: idem, memo: z.string().max(280).optional() })
const Fx = z.object({ customerId: z.string().max(64), fromAccountId: z.string().max(64), toAccountId: z.string().max(64), amountMinor: minor, idempotencyKey: idem, slippage: z.number().min(0.0001).max(0.05).optional() })
const Mint = z.object({ asset: z.string().min(2).max(16), amountMinor: minor, destinationAccountId: z.string().max(64), idempotencyKey: idem })
const Redeem = z.object({ asset: z.string().min(2).max(16), amountMinor: minor, sourceAccountId: z.string().max(64), idempotencyKey: idem })
const Yield = z.object({ asset: z.string().min(2).max(16), chain: z.string().max(32).optional(), from: z.string(), to: z.string(), totalYieldMinor: z.string().regex(/^\d{1,78}$/).optional(), holderShareBps: z.number().int().min(0).max(10_000) })
const Publish = z.object({ handle: z.string().min(2).max(63), institutionName: z.string().min(1).max(120), domain: z.string().min(3).max(253).optional(), accountIds: z.array(z.string().max(64)).min(1).max(20), compliance: z.object({ kycLevel: z.enum(['none', 'basic', 'full']), travelRuleSupported: z.boolean(), sanctionsScreened: z.boolean(), jurisdictions: z.array(z.string().length(2)).max(50) }), ttlDays: z.number().int().min(1).max(365).optional(), signature: z.string().regex(/^0x[0-9a-fA-F]{130}$/).optional() })
const Resolve = z.object({ address: z.string().min(5).max(320), asset: z.string().min(2).max(16), amountMinor: minor, chains: z.array(z.string().max(32)).max(12).optional() })

const dateParam = (s: string | undefined, d: Date): Date => {
	if (!s) return d
	const t = Date.parse(s)
	if (Number.isNaN(t)) throw bankErr('VALIDATION', `Invalid date ${s}`)
	return new Date(t)
}

async function wellKnownPay(c: Context): Promise<Response> {
	const { runEffectEither } = await import('../../runtime')
	const r = await runEffectEither(Effect.gen(function* () { return yield* (yield* BankPaymentNetworkService).getLocal(c.req.param('handle') as string) }))
	if (r._tag === 'Left') return c.json({ error: 'NOT_FOUND' }, 404)
	return c.json(r.right.document)
}

/** Public: `app.route('/public/bank/network', bankNetworkPublicRoutes)` -> GET /public/bank/network/.well-known/suwappu-pay/:handle. Only this handler. */
export const bankNetworkPublicRoutes = new Hono()
bankNetworkPublicRoutes.get('/.well-known/suwappu-pay/:handle', wellKnownPay)

export function register(app: BankRouteApp, deps: BankRouteDeps): void {
	const { resolveOwner, run } = deps
	/** Partner identity = org API key (sk_live_*). Agent bearer tokens and webapp sessions are not partners. */
	// MONEY-PATH: dedicated scopes. GET needs bank:platform:read (or write); every other method needs bank:platform:write. No scopes = refused ('*' is not honoured here).
	const partnerId = (c: Context): string => {
		const k = c.get('apiKeyAuth') as { orgId?: string; scopes?: string[] } | undefined
		if (!k?.orgId) throw new HTTPException(403, { message: 'Platform endpoints require an organization API key (sk_live_*)' })
		const scopes = k.scopes ?? []
		const isRead = c.req.method === 'GET' || c.req.method === 'HEAD'
		const ok = scopes.includes('bank:platform:write') || (isRead && scopes.includes('bank:platform:read'))
		if (!ok) throw new HTTPException(403, { message: `Missing required scope: ${isRead ? 'bank:platform:read' : 'bank:platform:write'}` })
		return k.orgId
	}
	/**
	 * Read-only self-service for the Mini App: a webapp session that is OWNER/ADMIN of the org named by `?orgId=` may use the
	 * GET config/usage/customers endpoints. Authorised by bank org membership (`org.manage`: owner/admin only) or, failing that,
	 * an owner/admin row in the enterprise organization_members table. API keys keep the strict scope gate. All money-moving and
	 * customer-creating endpoints stay API-key + bank:platform:write only (they call partnerId directly).
	 */
	const readPartnerId = async (c: Context): Promise<string> => {
		if ((c.get('apiKeyAuth') as { orgId?: string } | undefined)?.orgId) return partnerId(c)
		const orgId = c.req.query('orgId')
		if (!orgId) throw new HTTPException(400, { message: 'orgId query parameter required' })
		const o = await resolveOwner(c)
		const r = await runEffectEither(
			authorize(o, orgId, 'org.manage').pipe(
				Effect.asVoid,
				Effect.catchAll((e) =>
					o.ownerType !== 'user' || !/^[0-9]{1,18}$/.test(o.ownerId)
						? Effect.fail(e)
						: Effect.gen(function* () {
								const db = yield* requireDb
								const rows = yield* Effect.tryPromise({ try: () => db.select({ role: organizationMembers.role }).from(organizationMembers).where(and(eq(organizationMembers.organizationId, orgId), eq(organizationMembers.userId, Number(o.ownerId)))).limit(1), catch: () => e })
								if (!rows[0] || !['owner', 'admin'].includes(rows[0].role)) return yield* Effect.fail(e)
							}),
				),
			),
		)
		if (r._tag === 'Left') throw new HTTPException(403, { message: 'Only an owner or admin of this organization can view platform data' })
		return orgId
	}
	const bad = (c: Context, e: z.ZodError) => c.json({ error: 'Validation Error', error_code: 'VALIDATION_ERROR', fields: formatZodErrors(e) }, 400)
	const P = Effect.gen(function* () { return yield* BankPartnerService })

	app.put('/platform/config', async (c) => {
		const pid = partnerId(c)
		const p = Config.safeParse(await readJson(c))
		if (!p.success) return bad(c, p.error)
		return run(c, Effect.gen(function* () { return yield* (yield* P).configure(pid, p.data as never) }))
	})
	app.get('/platform/config', async (c) => { const pid = await readPartnerId(c); return run(c, Effect.gen(function* () { return { partner: yield* (yield* P).getPartner(pid) } })) })
	app.post('/platform/customers', async (c) => {
		const pid = partnerId(c)
		const p = Customer.safeParse(await readJson(c))
		if (!p.success) return bad(c, p.error)
		return run(c, Effect.gen(function* () { return { customer: yield* (yield* P).createCustomer(pid, p.data as never) } }))
	})
	app.get('/platform/customers', async (c) => { const pid = await readPartnerId(c); return run(c, Effect.gen(function* () { return { customers: yield* (yield* P).listCustomers(pid) } })) })
	app.post('/platform/customers/:cid/accounts', async (c) => {
		const pid = partnerId(c)
		const p = OpenAcct.safeParse(await readJson(c))
		if (!p.success) return bad(c, p.error)
		return run(c, Effect.gen(function* () { return { account: yield* (yield* P).openAccount(pid, c.req.param('cid'), p.data as never) } }))
	})
	app.get('/platform/customers/:cid/accounts', (c) => { const pid = partnerId(c); return run(c, Effect.gen(function* () { return { accounts: yield* (yield* P).listAccounts(pid, c.req.param('cid')) } })) })
	app.post('/platform/transfers', async (c) => {
		const pid = partnerId(c)
		const p = Xfer.safeParse(await readJson(c))
		if (!p.success) return bad(c, p.error)
		return run(c, Effect.gen(function* () { return yield* (yield* P).partnerTransfer(pid, p.data as never) }))
	})
	app.get('/platform/transfers', (c) => { const pid = partnerId(c); return run(c, Effect.gen(function* () { return { transfers: yield* (yield* P).listTransfers(pid, c.req.query('customerId') ?? undefined) } })) })
	app.post('/platform/fx', async (c) => {
		const pid = partnerId(c)
		const p = Fx.safeParse(await readJson(c))
		if (!p.success) return bad(c, p.error)
		return run(c, Effect.gen(function* () { return yield* (yield* P).executeFx(pid, p.data as never) }))
	})
	app.get('/platform/usage', async (c) => {
		const pid = await readPartnerId(c)
		return run(c, Effect.gen(function* () {
			const to = yield* Effect.try({ try: () => dateParam(c.req.query('to'), new Date()), catch: (e) => e as never })
			const from = yield* Effect.try({ try: () => dateParam(c.req.query('from'), new Date(to.getTime() - 30 * 86_400_000)), catch: (e) => e as never })
			return { usage: yield* (yield* P).usage(pid, from, to) }
		}))
	})
	app.get('/platform/events', (c) => { const pid = partnerId(c); return run(c, Effect.gen(function* () { return { events: yield* (yield* P).listEvents(pid) } })) })

	// ---- bank-core connector (ISO 20022-style)
	app.post('/platform/connector/convert', async (c) => {
		partnerId(c)
		const b = (await readJson(c)) as { xml?: string; batch?: unknown } | undefined
		return run(c, Effect.gen(function* () {
			if (b?.xml) return { batch: yield* Effect.try({ try: () => parsePain001(b.xml!), catch: (e) => e as never }) }
			if (b?.batch) return { xml: yield* Effect.try({ try: () => serialisePain001(b.batch as never), catch: (e) => e as never }) }
			return yield* Effect.fail(bankErr('VALIDATION', 'provide xml (pain.001 -> JSON) or batch (JSON -> pain.001 XML)'))
		}))
	})
	app.post('/platform/connector/pain001', async (c) => {
		const pid = partnerId(c)
		const b = (await readJson(c)) as { customerId?: string; xml?: string; batch?: unknown } | undefined
		return run(c, Effect.gen(function* () {
			if (!b?.customerId) return yield* Effect.fail(bankErr('VALIDATION', 'customerId required'))
			if (!b.xml && !b.batch) return yield* Effect.fail(bankErr('VALIDATION', 'provide xml or batch'))
			const batch = yield* Effect.try({ try: () => (b.xml ? parsePain001(b.xml) : (b.batch as never)), catch: (e) => e as never })
			if (!b.xml) yield* Effect.try({ try: () => serialisePain001(batch), catch: (e) => e as never }) // validates a JSON batch
			return yield* (yield* P).importCreditTransfers(pid, batch, b.customerId)
		}))
	})
	app.get('/platform/connector/camt053/:cid/:accountId', (c) => {
		const pid = partnerId(c)
		const cid = c.req.param('cid')
		const wantXml = (c.req.query('format') ?? 'json') === 'xml'
		const eff = Effect.gen(function* () {
			yield* (yield* P).assertCustomer(pid, cid)
			const acct = yield* (yield* BankLedgerService).getAccount({ ownerType: 'partner_customer', ownerId: cid }, c.req.param('accountId'))
			const asset = findAsset(acct.asset, acct.chain)
			if (!asset) return yield* Effect.fail(bankErr('ASSET_UNSUPPORTED', 'Unsupported asset'))
			const to = yield* Effect.try({ try: () => dateParam(c.req.query('to'), new Date()), catch: (e) => e as never })
			const from = yield* Effect.try({ try: () => dateParam(c.req.query('from'), new Date(to.getTime() - 31 * 86_400_000)), catch: (e) => e as never })
			const { entries, opening, closing } = yield* bankDb(async (db) => {
				const rows = await db.select().from(bankLedgerEntries).where(and(eq(bankLedgerEntries.accountId, acct.id), gte(bankLedgerEntries.createdAt, from), lt(bankLedgerEntries.createdAt, to))).orderBy(asc(bankLedgerEntries.createdAt), asc(bankLedgerEntries.id)).limit(5000)
				const prior = await db.select({ b: bankLedgerEntries.balanceAfter }).from(bankLedgerEntries).where(and(eq(bankLedgerEntries.accountId, acct.id), lt(bankLedgerEntries.createdAt, from))).orderBy(sql`${bankLedgerEntries.createdAt} desc, ${bankLedgerEntries.id} desc`).limit(1)
				const open = prior[0]?.b ?? '0'
				const close = rows.length ? (rows[rows.length - 1]!.balanceAfter ?? open) : open
				return { entries: rows, opening: open, closing: close }
			})
			const st: Statement = { messageId: `STMT-${acct.id}-${to.getTime()}`.slice(0, 35), createdAt: new Date().toISOString(), accountId: acct.id, currency: asset.currency, asset: asset.symbol, chain: asset.chain, decimals: asset.decimals, from: from.toISOString(), to: to.toISOString(), openingMinor: opening, closingMinor: closing, entries: entries.map((e) => ({ reference: e.id, direction: e.direction, amountMinor: e.amountMinor, bookedAt: e.createdAt.toISOString(), phase: e.phase, transferId: e.transferId, balanceAfterMinor: e.balanceAfter })) }
			return wantXml ? { format: 'camt.053', xml: serialiseCamt053(st) } : { format: 'camt.053-json', statement: st, xml: serialiseCamt053(st) }
		})
		return run(c, eff)
	})

	// ---- branded stablecoin
	const S = Effect.gen(function* () { return yield* BankStablecoinService })
	app.post('/platform/stablecoin/mint', async (c) => {
		const pid = partnerId(c)
		const p = Mint.safeParse(await readJson(c))
		if (!p.success) return bad(c, p.error)
		return run(c, Effect.gen(function* () { return yield* (yield* S).mint(p.data, pid) }))
	})
	app.post('/platform/stablecoin/redeem', async (c) => {
		const pid = partnerId(c)
		const p = Redeem.safeParse(await readJson(c))
		if (!p.success) return bad(c, p.error)
		return run(c, Effect.gen(function* () { return yield* (yield* S).redeem(p.data, pid) }))
	})
	app.get('/platform/stablecoin/reserve/:asset', (c) => { partnerId(c); return run(c, Effect.gen(function* () { return { reserve: yield* (yield* S).reserveReport(c.req.param('asset')) } })) })
	app.post('/platform/stablecoin/yield-share', async (c) => {
		const pid = partnerId(c)
		const p = Yield.safeParse(await readJson(c))
		if (!p.success) return bad(c, p.error)
		return run(c, Effect.gen(function* () {
			const from = yield* Effect.try({ try: () => dateParam(p.data.from, new Date()), catch: (e) => e as never })
			const to = yield* Effect.try({ try: () => dateParam(p.data.to, new Date()), catch: (e) => e as never })
			return { allocation: yield* (yield* S).yieldShare({ ...p.data, from, to }, pid) }
		}))
	})

	// ---- open payment network
	const N = Effect.gen(function* () { return yield* BankPaymentNetworkService })
	app.put('/network/address', async (c) => {
		const owner = await resolveOwner(c)
		const p = Publish.safeParse(await readJson(c))
		if (!p.success) return bad(c, p.error)
		return run(c, Effect.gen(function* () { return yield* (yield* N).publish(owner, p.data) }))
	})
	app.get('/network/address/:handle', (c) => run(c, Effect.gen(function* () { return yield* (yield* N).getLocal(c.req.param('handle')) })))
	app.get('/network/.well-known/suwappu-pay/:handle', wellKnownPay)
	app.post('/network/resolve', async (c) => {
		await resolveOwner(c)
		const p = Resolve.safeParse(await readJson(c))
		if (!p.success) return bad(c, p.error)
		return run(c, Effect.gen(function* () { return { resolution: yield* (yield* N).resolve(p.data) } }))
	})
}
