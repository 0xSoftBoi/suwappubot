import { Effect, Either } from 'effect'
import { Hono } from 'hono'
import { z } from 'zod'
import type { Agent } from '../db'
import { mapErrorToResponse } from '../errors'
import { agentBearerAuth } from '../middleware'
import { runEffectEither } from '../runtime'
import { PolymarketService } from '../services/PolymarketService'

type AgentContext = {
	Variables: {
		agent: Agent
	}
}

const predictRoutes = new Hono<AgentContext>()

// ---- Validation schemas ----

const PlaceOrderSchema = z.object({
	tokenId: z.string().min(1),
	side: z.enum(['BUY', 'SELL']),
	price: z.number().min(0.001).max(0.999),
	size: z.number().positive(),
	orderType: z.enum(['GTC', 'GTD', 'FOK']).optional(),
})

const ClobCredsSchema = z.object({
	apiKey: z.string().min(1),
	secret: z.string().min(1),
	passphrase: z.string().min(1),
})

// ---- Public endpoints (no auth) ----

// GET /v1/agent/predict/markets — list active prediction markets
predictRoutes.get('/markets', async (c) => {
	const query = c.req.query('query')
	const limit = parseInt(c.req.query('limit') ?? '20', 10)

	const result = await runEffectEither(
		Effect.gen(function* () {
			const pm = yield* PolymarketService
			return yield* pm.getMarkets(query, limit)
		}),
	)

	if (Either.isLeft(result)) {
		const { status, body } = mapErrorToResponse(result.left)
		return c.json(body, status as 200)
	}

	return c.json({ markets: result.right })
})

// GET /v1/agent/predict/market/:id — market details
predictRoutes.get('/market/:id', async (c) => {
	const id = c.req.param('id')

	const result = await runEffectEither(
		Effect.gen(function* () {
			const pm = yield* PolymarketService
			return yield* pm.getMarket(id)
		}),
	)

	if (Either.isLeft(result)) {
		const { status, body } = mapErrorToResponse(result.left)
		return c.json(body, status as 200)
	}

	return c.json(result.right)
})

// GET /v1/agent/predict/orderbook?token_id=... — orderbook for a token
predictRoutes.get('/orderbook', async (c) => {
	const tokenId = c.req.query('token_id')
	if (!tokenId) return c.json({ error: 'token_id query parameter required' }, 400)

	const result = await runEffectEither(
		Effect.gen(function* () {
			const pm = yield* PolymarketService
			return yield* pm.getOrderbook(tokenId)
		}),
	)

	if (Either.isLeft(result)) {
		const { status, body } = mapErrorToResponse(result.left)
		return c.json(body, status as 200)
	}

	return c.json(result.right)
})

// GET /v1/agent/predict/midpoint?token_id=... — midpoint price
predictRoutes.get('/midpoint', async (c) => {
	const tokenId = c.req.query('token_id')
	if (!tokenId) return c.json({ error: 'token_id query parameter required' }, 400)

	const result = await runEffectEither(
		Effect.gen(function* () {
			const pm = yield* PolymarketService
			return yield* pm.getMidpoint(tokenId)
		}),
	)

	if (Either.isLeft(result)) {
		const { status, body } = mapErrorToResponse(result.left)
		return c.json(body, status as 200)
	}

	return c.json({ midpoint: result.right })
})

// ---- Authenticated endpoints ----

// POST /v1/agent/predict/order — place a buy/sell order
predictRoutes.post('/order', agentBearerAuth(), async (c) => {
	const body = await c.req.json()

	const orderParsed = PlaceOrderSchema.safeParse(body)
	if (!orderParsed.success) {
		return c.json({ error: 'Invalid order', details: orderParsed.error.issues }, 400)
	}

	const credsParsed = ClobCredsSchema.safeParse(body.clobCreds)
	if (!credsParsed.success) {
		return c.json({
			error: 'Missing CLOB credentials',
			message: 'Include clobCreds: { apiKey, secret, passphrase } — obtain via POST /v1/agent/predict/auth',
		}, 400)
	}

	const maker = body.maker as string
	if (!maker || !maker.startsWith('0x')) {
		return c.json({ error: 'maker address required (0x...)' }, 400)
	}

	const signature = body.signature as string
	if (!signature) {
		return c.json({ error: 'signature required — sign the order EIP712 typed data with your wallet' }, 400)
	}

	const result = await runEffectEither(
		Effect.gen(function* () {
			const pm = yield* PolymarketService
			return yield* pm.placeOrder(
				credsParsed.data,
				orderParsed.data,
				maker,
				async () => signature, // Pre-signed by client
			)
		}),
	)

	if (Either.isLeft(result)) {
		const { status, body: errBody } = mapErrorToResponse(result.left)
		return c.json(errBody, status as 200)
	}

	return c.json(result.right)
})

// DELETE /v1/agent/predict/order/:id — cancel an order
predictRoutes.delete('/order/:id', agentBearerAuth(), async (c) => {
	const orderId = c.req.param('id')

	const body = await c.req.json().catch(() => ({}))
	const credsParsed = ClobCredsSchema.safeParse(body.clobCreds ?? body)
	if (!credsParsed.success) {
		return c.json({ error: 'Missing CLOB credentials' }, 400)
	}

	const result = await runEffectEither(
		Effect.gen(function* () {
			const pm = yield* PolymarketService
			return yield* pm.cancelOrder(credsParsed.data, orderId)
		}),
	)

	if (Either.isLeft(result)) {
		const { status, body: errBody } = mapErrorToResponse(result.left)
		return c.json(errBody, status as 200)
	}

	return c.json({ cancelled: true, orderId })
})

// DELETE /v1/agent/predict/orders — cancel all orders
predictRoutes.delete('/orders', agentBearerAuth(), async (c) => {
	const body = await c.req.json().catch(() => ({}))
	const credsParsed = ClobCredsSchema.safeParse(body.clobCreds ?? body)
	if (!credsParsed.success) {
		return c.json({ error: 'Missing CLOB credentials' }, 400)
	}

	const result = await runEffectEither(
		Effect.gen(function* () {
			const pm = yield* PolymarketService
			return yield* pm.cancelAll(credsParsed.data)
		}),
	)

	if (Either.isLeft(result)) {
		const { status, body: errBody } = mapErrorToResponse(result.left)
		return c.json(errBody, status as 200)
	}

	return c.json({ cancelled: true })
})

// GET /v1/agent/predict/orders — list open orders
predictRoutes.get('/orders', agentBearerAuth(), async (c) => {
	const apiKey = c.req.query('apiKey')
	const secret = c.req.query('secret')
	const passphrase = c.req.query('passphrase')

	if (!apiKey || !secret || !passphrase) {
		return c.json({ error: 'CLOB credentials required as query params: apiKey, secret, passphrase' }, 400)
	}

	const creds = { apiKey, secret, passphrase }

	const result = await runEffectEither(
		Effect.gen(function* () {
			const pm = yield* PolymarketService
			return yield* pm.getOpenOrders(creds)
		}),
	)

	if (Either.isLeft(result)) {
		const { status, body } = mapErrorToResponse(result.left)
		return c.json(body, status as 200)
	}

	return c.json({ orders: result.right })
})

// GET /v1/agent/predict/positions — list positions with PnL
predictRoutes.get('/positions', agentBearerAuth(), async (c) => {
	const apiKey = c.req.query('apiKey')
	const secret = c.req.query('secret')
	const passphrase = c.req.query('passphrase')

	if (!apiKey || !secret || !passphrase) {
		return c.json({ error: 'CLOB credentials required as query params: apiKey, secret, passphrase' }, 400)
	}

	const creds = { apiKey, secret, passphrase }

	const result = await runEffectEither(
		Effect.gen(function* () {
			const pm = yield* PolymarketService
			return yield* pm.getPositions(creds)
		}),
	)

	if (Either.isLeft(result)) {
		const { status, body } = mapErrorToResponse(result.left)
		return c.json(body, status as 200)
	}

	return c.json({ positions: result.right })
})

export { predictRoutes }
