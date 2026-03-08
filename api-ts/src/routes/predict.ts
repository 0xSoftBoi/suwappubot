import { Effect, Either } from 'effect'
import { Hono } from 'hono'
import type { Agent } from '../db'
import { mapErrorToResponse } from '../errors'
import { runEffectEither } from '../runtime'
import { PolymarketService } from '../services/PolymarketService'

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

export { predictRoutes }
