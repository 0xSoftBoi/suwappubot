/**
 * /v1/clob — headless-exchange dev lane.
 *
 * Venue-facing order routes backed by the in-memory engine in
 * `lib/clob.ts` (semantics + settlement-root bytes mirror suwappu-dag's
 * `suwappu-clob` crate). Reads are public; order mutation requires agent
 * bearer auth, and each agent trades as the account derived from its
 * agent id. Dev lane: state is process-local, non-durable, not money.
 */
import { Hono } from 'hono'
import { z } from 'zod'
import type { Agent } from '../db'
import { agentBearerAuth } from '../middleware'
import {
	accountId,
	ClobError,
	getEngine,
	getOrCreateEngine,
	listMarkets,
	type Fill,
} from '../lib/clob'

type AgentContext = {
	Variables: {
		agent: Agent
	}
}

const clobRoutes = new Hono<AgentContext>()

const MARKET_RE = /^[A-Za-z0-9]{2,16}\/[A-Za-z0-9]{2,16}$/

const OrderSchema = z.object({
	market: z.string().regex(MARKET_RE, 'market must look like BASE/QUOTE'),
	side: z.enum(['bid', 'ask']),
	price: z.coerce.bigint().positive(),
	qty: z.coerce.bigint().positive(),
	tif: z.enum(['GTC', 'IOC', 'FOK', 'PostOnly']).default('GTC'),
})

function fillJson(f: Fill) {
	return {
		makerOrder: f.makerOrder.toString(),
		takerOrder: f.takerOrder.toString(),
		makerAccount: f.makerAccount,
		takerAccount: f.takerAccount,
		price: f.price.toString(),
		qty: f.qty.toString(),
		takerSide: f.takerSide,
		seq: f.seq.toString(),
	}
}

function clobErrorResponse(e: unknown) {
	if (e instanceof ClobError) {
		const status = e.code === 'UnknownOrder' ? 404 : e.code === 'NotOrderOwner' ? 403 : 400
		return { status, body: { error: e.code, message: e.message } }
	}
	return undefined
}

// GET /v1/clob/markets — markets that exist in this process
clobRoutes.get('/markets', (c) => c.json({ markets: listMarkets() }))

// GET /v1/clob/book/:base/:quote — book snapshot
clobRoutes.get('/book/:base/:quote', (c) => {
	const symbol = `${c.req.param('base')}/${c.req.param('quote')}`
	if (!MARKET_RE.test(symbol)) {
		return c.json({ error: 'ValidationError', message: 'market must look like BASE/QUOTE' }, 400)
	}
	const engine = getEngine(symbol)
	if (!engine) return c.json({ error: 'UnknownMarket', message: `no market ${symbol.toUpperCase()}` }, 404)
	const levels = Math.min(parseInt(c.req.query('levels') ?? '20', 10) || 20, 100)
	return c.json({
		market: engine.symbol,
		marketId: engine.marketIdHex,
		...engine.snapshot(levels),
	})
})

// POST /v1/clob/orders — submit an order (creates the market on first use)
clobRoutes.post('/orders', agentBearerAuth(), async (c) => {
	let body: unknown
	try {
		body = await c.req.json()
	} catch {
		return c.json({ error: 'ValidationError', message: 'invalid JSON body' }, 400)
	}
	const parsed = OrderSchema.safeParse(body)
	if (!parsed.success) {
		return c.json({ error: 'ValidationError', issues: parsed.error.issues }, 400)
	}
	const agent = c.get('agent')
	const account = accountId(String(agent.id)).toString('hex')
	const engine = getOrCreateEngine(parsed.data.market)
	try {
		const out = engine.submit(
			account,
			parsed.data.side,
			parsed.data.price,
			parsed.data.qty,
			parsed.data.tif,
		)
		return c.json({
			market: engine.symbol,
			account,
			orderId: out.orderId.toString(),
			status: out.status,
			restingQty: out.restingQty.toString(),
			fills: out.fills.map(fillJson),
			canceledResting: out.canceledResting.map((id) => id.toString()),
		})
	} catch (e) {
		const mapped = clobErrorResponse(e)
		if (mapped) return c.json(mapped.body, mapped.status as 400)
		throw e
	}
})

// DELETE /v1/clob/orders/:id?market=BASE/QUOTE — cancel own resting order
clobRoutes.delete('/orders/:id', agentBearerAuth(), (c) => {
	const market = c.req.query('market') ?? ''
	if (!MARKET_RE.test(market)) {
		return c.json({ error: 'ValidationError', message: 'market query param required (BASE/QUOTE)' }, 400)
	}
	const engine = getEngine(market)
	if (!engine) return c.json({ error: 'UnknownMarket', message: `no market ${market.toUpperCase()}` }, 404)
	const rawId = c.req.param('id')
	let id: bigint
	try {
		if (!rawId) throw new Error('missing')
		id = BigInt(rawId)
	} catch {
		return c.json({ error: 'ValidationError', message: 'order id must be an integer' }, 400)
	}
	const agent = c.get('agent')
	try {
		const freed = engine.cancel(id, accountId(String(agent.id)).toString('hex'))
		return c.json({ canceled: id.toString(), freedQty: freed.toString() })
	} catch (e) {
		const mapped = clobErrorResponse(e)
		if (mapped) return c.json(mapped.body, mapped.status as 400)
		throw e
	}
})

// GET /v1/clob/settlement/:base/:quote — net the open fill window + batch root
clobRoutes.get('/settlement/:base/:quote', (c) => {
	const symbol = `${c.req.param('base')}/${c.req.param('quote')}`
	if (!MARKET_RE.test(symbol)) {
		return c.json({ error: 'ValidationError', message: 'market must look like BASE/QUOTE' }, 400)
	}
	const engine = getEngine(symbol)
	if (!engine) return c.json({ error: 'UnknownMarket', message: `no market ${symbol.toUpperCase()}` }, 404)
	const batch = engine.settlementWindow()
	return c.json({
		market: engine.symbol,
		marketId: engine.marketIdHex,
		batchRoot: batch.root,
		fillCount: batch.fillCount.toString(),
		firstSeq: batch.firstSeq.toString(),
		lastSeq: batch.lastSeq.toString(),
		deltas: [...batch.deltas.entries()].map(([account, d]) => ({
			account,
			base: d.base.toString(),
			quote: d.quote.toString(),
		})),
	})
})

export { clobRoutes }
