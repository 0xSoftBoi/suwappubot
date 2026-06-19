import { randomBytes } from 'crypto'
import { Effect, Either } from 'effect'
import { Hono } from 'hono'
import type { Agent } from '../db'
import { ExternalServiceError, mapErrorToResponse, ValidationError } from '../errors'
import { buildClobAuthMessage, buildOrderTypedData, hashEip712Order, ZERO_BYTES32, type ClobOrderData } from '../lib/polymarket-eip712'
import { agentBearerAuth } from '../middleware'
import { runEffectEither } from '../runtime'
import { PolymarketService } from '../services/PolymarketService'
import { PolymarketCredentialService } from '../services/PolymarketCredentialService'
import { TurnkeyService } from '../services/TurnkeyService'
import { formatZodErrors, PlaceOrderSchema } from './validators'

type AgentContext = {
	Variables: {
		agent: Agent
	}
}

const predictRoutes = new Hono<AgentContext>()

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
		return c.json(body, status)
	}

	return c.json({ markets: result.right })
})

// GET /v1/agent/predict/events — search/browse prediction events
predictRoutes.get('/events', async (c) => {
	const query = c.req.query('query')
	const limit = parseInt(c.req.query('limit') ?? '20', 10)

	const result = await runEffectEither(
		Effect.gen(function* () {
			const pm = yield* PolymarketService
			return yield* pm.getEvents(query, limit)
		}),
	)

	if (Either.isLeft(result)) {
		const { status, body } = mapErrorToResponse(result.left)
		return c.json(body, status)
	}

	return c.json({ events: result.right })
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
		return c.json(body, status)
	}

	return c.json(result.right)
})

// GET /v1/agent/predict/market/:id/book — orderbook for all outcomes
predictRoutes.get('/market/:id/book', async (c) => {
	const id = c.req.param('id')

	const result = await runEffectEither(
		Effect.gen(function* () {
			const pm = yield* PolymarketService
			const market = yield* pm.getMarket(id)

			if (market.tokens.length === 0) {
				return { marketId: id, question: market.question, outcomes: [] }
			}

			const books = yield* Effect.all(
				market.tokens.map((t) =>
					Effect.map(pm.getOrderbook(t.tokenId), (book) => ({
						outcome: t.outcome,
						tokenId: t.tokenId,
						...book,
					}))
				),
				{ concurrency: 'unbounded' },
			)

			return { marketId: id, question: market.question, outcomes: books }
		}),
	)

	if (Either.isLeft(result)) {
		const { status, body } = mapErrorToResponse(result.left)
		return c.json(body, status)
	}

	return c.json(result.right)
})

// GET /v1/agent/predict/market/:id/price — live CLOB midpoint prices
predictRoutes.get('/market/:id/price', async (c) => {
	const id = c.req.param('id')

	const result = await runEffectEither(
		Effect.gen(function* () {
			const pm = yield* PolymarketService
			const market = yield* pm.getMarket(id)

			if (market.tokens.length === 0) {
				return { marketId: id, question: market.question, prices: [] }
			}

			const prices = yield* Effect.all(
				market.tokens.map((t) =>
					Effect.map(pm.getMidpoint(t.tokenId), (midData) => ({
						outcome: t.outcome,
						tokenId: t.tokenId,
						mid: midData.mid,
					}))
				),
				{ concurrency: 'unbounded' },
			)

			return { marketId: id, question: market.question, prices }
		}),
	)

	if (Either.isLeft(result)) {
		const { status, body } = mapErrorToResponse(result.left)
		return c.json(body, status)
	}

	return c.json(result.right)
})

// GET /v1/agent/predict/market/:id/trades — recent trades across outcomes
predictRoutes.get('/market/:id/trades', async (c) => {
	const id = c.req.param('id')
	const limit = parseInt(c.req.query('limit') ?? '20', 10)

	const result = await runEffectEither(
		Effect.gen(function* () {
			const pm = yield* PolymarketService
			const market = yield* pm.getMarket(id)

			if (market.tokens.length === 0) {
				return { marketId: id, question: market.question, trades: [] }
			}

			const allTrades = yield* Effect.all(
				market.tokens.map((t) =>
					Effect.map(pm.getTrades(t.tokenId, limit), (trades) =>
						trades.map((tr) => ({ ...tr, outcome: t.outcome, tokenId: t.tokenId }))
					)
				),
				{ concurrency: 'unbounded' },
			)

			const merged = allTrades
				.flat()
				.sort((a, b) => (b.timestamp > a.timestamp ? 1 : -1))
				.slice(0, limit)

			return { marketId: id, question: market.question, trades: merged }
		}),
	)

	if (Either.isLeft(result)) {
		const { status, body } = mapErrorToResponse(result.left)
		return c.json(body, status)
	}

	return c.json(result.right)
})

// ---------- Trade execution endpoints (require agentBearerAuth) ----------

// POST /v1/agent/predict/order — place a prediction market order
predictRoutes.post('/order', agentBearerAuth(), async (c) => {
	const agent = c.get('agent')

	const body = await c.req.json().catch(() => null)
	if (!body) return c.json({ error: 'Invalid JSON body' }, 400)

	const parsed = PlaceOrderSchema.safeParse(body)
	if (!parsed.success) {
		return c.json(
			{ error: 'Validation Error', fields: formatZodErrors(parsed.error) },
			400,
		)
	}

	const orderParams = parsed.data
	const agentId = String(agent.id)

	const result = await runEffectEither(
		Effect.gen(function* () {
			const pm = yield* PolymarketService
			const credService = yield* PolymarketCredentialService
			const turnkey = yield* TurnkeyService

			// Step 1: Get or lazy-init CLOB API credentials
			let credentials = yield* credService.getCredentials(agentId)

			if (!credentials) {
				// Need to create CLOB API credentials via wallet signature
				const walletAddress = (agent.metadata as Record<string, string> | null)?.walletAddress
				if (!walletAddress) {
					return yield* Effect.fail(
						new ValidationError({ message: 'Agent has no wallet address configured for Polymarket trading' }),
					)
				}

				const subOrgId = (agent.metadata as Record<string, string> | null)?.subOrgId
				if (!subOrgId) {
					return yield* Effect.fail(
						new ValidationError({ message: 'Agent has no Turnkey sub-org configured' }),
					)
				}

				const timestamp = Math.floor(Date.now() / 1000)
				const authMessage = buildClobAuthMessage(timestamp)

				// Sign the auth message via Turnkey
				const authSig = yield* turnkey.signRawPayload(
					subOrgId,
					authMessage,
					walletAddress,
					'HASH_FUNCTION_KECCAK256',
					'PAYLOAD_ENCODING_TEXT_UTF8',
				)

				// Create API credentials
				const newCreds = yield* pm.createApiCredentials(
					walletAddress,
					String(timestamp),
					authSig.signature,
				).pipe(
					Effect.mapError((e) => new ExternalServiceError({
						message: `Failed to create CLOB API credentials: ${e.message}`,
						service: 'polymarket-clob',
					})),
				)

				// Store credentials
				yield* credService.storeCredentials(agentId, walletAddress, newCreds)
				credentials = newCreds
			}

			// Step 2: Build EIP712 order and sign.
			// v2 Polymarket CTF Exchange order schema (see lib/polymarket-eip712.ts):
			// no taker/expiration/nonce/feeRateBps — instead timestamp (ms), metadata,
			// and a bytes32 builder code. Builder defaults to none; set
			// POLYMARKET_BUILDER_CODE (32-byte hex) once enrolled in the builder program
			// to earn the on-chain maker/taker rebate.
			const salt = BigInt('0x' + randomBytes(8).toString('hex')).toString()
			const walletAddress = (agent.metadata as Record<string, string> | null)?.walletAddress || ''
			const subOrgId = (agent.metadata as Record<string, string> | null)?.subOrgId || ''
			const builderCode = process.env.POLYMARKET_BUILDER_CODE || ZERO_BYTES32

			// CLOB amount math (6-decimal base units for both collateral and shares).
			// pUSD collateral = 6dp; outcome (share) tokens = 6dp. `price` is the
			// per-share price in pUSD (0..1), `size` is the number of shares.
			//   BUY  -> maker gives pUSD, taker gives shares:
			//             makerAmount = size * price (pUSD)   takerAmount = size (shares)
			//   SELL -> maker gives shares, taker gives pUSD:
			//             makerAmount = size (shares)         takerAmount = size * price (pUSD)
			// Both legs scaled by 1e6. Math.round (not floor) avoids dropping a base
			// unit from float rounding; the signed amounts and the POSTed amounts are
			// the same strings (placeOrder serializes this exact struct).
			const size = parseFloat(orderParams.size)
			const price = parseFloat(orderParams.price)
			const sharesBase = String(Math.round(size * 1e6))
			const usdBase = String(Math.round(size * price * 1e6))
			const orderData: ClobOrderData = {
				salt,
				maker: walletAddress,
				signer: walletAddress,
				tokenId: orderParams.tokenId,
				makerAmount: orderParams.side === 'BUY' ? usdBase : sharesBase,
				takerAmount: orderParams.side === 'BUY' ? sharesBase : usdBase,
				side: orderParams.side === 'BUY' ? 0 : 1,
				signatureType: 0,
				timestamp: String(Date.now()),
				metadata: ZERO_BYTES32,
				builder: builderCode,
			}

			const typedData = buildOrderTypedData(orderData)
			const orderHash = hashEip712Order(typedData)

			// Sign via Turnkey (pre-hashed, use NO_OP)
			const hashHex = orderHash.startsWith('0x') ? orderHash.slice(2) : orderHash
			const sig = yield* turnkey.signRawPayload(
				subOrgId,
				hashHex,
				walletAddress,
				'HASH_FUNCTION_NO_OP',
				'PAYLOAD_ENCODING_HEXADECIMAL',
			)

			// Step 3: Submit to CLOB. Pass the SAME signed order object that produced
			// the digest above so the serialized REST body matches the signature.
			// orderType defaults to GTC (resting limit order); FOK/FAK/GTD can be
			// surfaced later via the request schema.
			const clobOrder = yield* pm.placeOrder(credentials, walletAddress, {
				order: orderData,
				signature: sig.signature,
				orderType: 'GTC',
			}).pipe(
				Effect.mapError((e) => new ExternalServiceError({
					message: `CLOB order placement failed: ${e.message}`,
					service: 'polymarket-clob',
				})),
			)

			return clobOrder
		}),
	)

	if (Either.isLeft(result)) {
		const { status, body } = mapErrorToResponse(result.left)
		return c.json(body, status)
	}

	return c.json({ order: result.right })
})

// DELETE /v1/agent/predict/order/:id — cancel a prediction market order
predictRoutes.delete('/order/:id', agentBearerAuth(), async (c) => {
	const agent = c.get('agent')
	const orderId = c.req.param('id')
	const agentId = String(agent.id)
	const walletAddress = (agent.metadata as Record<string, string> | null)?.walletAddress || ''

	const result = await runEffectEither(
		Effect.gen(function* () {
			const pm = yield* PolymarketService
			const credService = yield* PolymarketCredentialService

			const credentials = yield* credService.getCredentials(agentId)
			if (!credentials) {
				return yield* Effect.fail(
					new ValidationError({ message: 'No Polymarket credentials found. Place an order first to initialize.' }),
				)
			}

			return yield* pm.cancelOrder(credentials, walletAddress, orderId).pipe(
				Effect.mapError((e) => new ExternalServiceError({
					message: `CLOB cancel failed: ${e.message}`,
					service: 'polymarket-clob',
				})),
			)
		}),
	)

	if (Either.isLeft(result)) {
		const { status, body } = mapErrorToResponse(result.left)
		return c.json(body, status)
	}

	return c.json(result.right)
})

// GET /v1/agent/predict/positions — list positions with market enrichment + PnL
predictRoutes.get('/positions', agentBearerAuth(), async (c) => {
	const agent = c.get('agent')
	const agentId = String(agent.id)
	const walletAddress = (agent.metadata as Record<string, string> | null)?.walletAddress || ''

	const result = await runEffectEither(
		Effect.gen(function* () {
			const pm = yield* PolymarketService
			const credService = yield* PolymarketCredentialService

			const credentials = yield* credService.getCredentials(agentId)
			if (!credentials) {
				return yield* Effect.fail(
					new ValidationError({ message: 'No Polymarket credentials found. Place an order first to initialize.' }),
				)
			}

			const positions = yield* pm.getPositions(credentials, walletAddress).pipe(
				Effect.mapError((e) => new ExternalServiceError({
					message: `CLOB positions fetch failed: ${e.message}`,
					service: 'polymarket-clob',
				})),
			)

			// Enrich positions with market data and PnL calculation
			const enriched = yield* Effect.all(
				positions.map((pos) =>
					Effect.gen(function* () {
						const mid = yield* pm.getMidpoint(pos.asset).pipe(
							Effect.catchAll(() => Effect.succeed({ mid: '0' })),
						)
						const currentPrice = mid.mid

						const avgPrice = parseFloat(pos.avgPrice || '0')
						const size = parseFloat(pos.size || '0')
						const curPrice = parseFloat(currentPrice)
						const unrealizedPnl = size * (curPrice - avgPrice)

						return {
							...pos,
							currentPrice,
							unrealizedPnl: unrealizedPnl.toFixed(6),
						}
					})
				),
				{ concurrency: 'unbounded' },
			)

			return enriched
		}),
	)

	if (Either.isLeft(result)) {
		const { status, body } = mapErrorToResponse(result.left)
		return c.json(body, status)
	}

	return c.json({ positions: result.right })
})

// GET /v1/agent/predict/orders — list open/matched orders
predictRoutes.get('/orders', agentBearerAuth(), async (c) => {
	const agent = c.get('agent')
	const agentId = String(agent.id)
	const status = c.req.query('status')
	const walletAddress = (agent.metadata as Record<string, string> | null)?.walletAddress || ''

	const result = await runEffectEither(
		Effect.gen(function* () {
			const pm = yield* PolymarketService
			const credService = yield* PolymarketCredentialService

			const credentials = yield* credService.getCredentials(agentId)
			if (!credentials) {
				return yield* Effect.fail(
					new ValidationError({ message: 'No Polymarket credentials found. Place an order first to initialize.' }),
				)
			}

			return yield* pm.getOrders(credentials, walletAddress, status).pipe(
				Effect.mapError((e) => new ExternalServiceError({
					message: `CLOB orders fetch failed: ${e.message}`,
					service: 'polymarket-clob',
				})),
			)
		}),
	)

	if (Either.isLeft(result)) {
		const { status: errStatus, body } = mapErrorToResponse(result.left)
		return c.json(body, errStatus)
	}

	return c.json({ orders: result.right })
})

export { predictRoutes }
