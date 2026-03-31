import { Effect, Either } from 'effect'
import { Hono } from 'hono'
import { z } from 'zod'
import type { Agent } from '../db'
import { mapErrorToResponse } from '../errors'
import { agentBearerAuth } from '../middleware'
import { runEffectEither } from '../runtime'
import { HyperliquidService } from '../services/HyperliquidService'

type AgentContext = {
	Variables: {
		agent: Agent
	}
}

const perpsRoutes = new Hono<AgentContext>()

const QuoteSchema = z.object({
	market: z.string(),
	side: z.enum(['long', 'short']),
	size: z.number().positive(),
	leverage: z.number().min(1).max(20),
})

// GET /v1/agent/perps/markets — list available perp markets (public)
perpsRoutes.get('/markets', async (c) => {
	const result = await runEffectEither(
		Effect.gen(function* () {
			const hl = yield* HyperliquidService
			return yield* hl.getMarkets()
		}),
	)

	if (Either.isLeft(result)) {
		const { status, body } = mapErrorToResponse(result.left)
		return c.json(body, status as 200)
	}

	return c.json({ markets: result.right })
})

// POST /v1/agent/perps/quote — get perp position quote
perpsRoutes.post('/quote', agentBearerAuth, async (c) => {
	const body = await c.req.json()
	const parsed = QuoteSchema.safeParse(body)
	if (!parsed.success) {
		return c.json({ error: 'Invalid request', details: parsed.error.issues }, 400)
	}

	const { market, side, size, leverage } = parsed.data

	const result = await runEffectEither(
		Effect.gen(function* () {
			const hl = yield* HyperliquidService
			return yield* hl.getQuote(market, side, size, leverage)
		}),
	)

	if (Either.isLeft(result)) {
		const { status, body } = mapErrorToResponse(result.left)
		return c.json(body, status as 200)
	}

	return c.json(result.right)
})

// GET /v1/agent/perps/positions — list open positions
perpsRoutes.get('/positions', agentBearerAuth, async (c) => {
	const address = c.req.query('address')
	if (!address) {
		return c.json({ error: 'address query parameter required' }, 400)
	}

	const result = await runEffectEither(
		Effect.gen(function* () {
			const hl = yield* HyperliquidService
			return yield* hl.getPositions(address)
		}),
	)

	if (Either.isLeft(result)) {
		const { status, body } = mapErrorToResponse(result.left)
		return c.json(body, status as 200)
	}

	return c.json({ positions: result.right })
})

export { perpsRoutes }
