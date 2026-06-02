import { Effect, Either } from 'effect'
import { Hono } from 'hono'
import type { Agent } from '../db'
import { mapErrorToResponse } from '../errors'
import { runEffectEither } from '../runtime'
import { MorphoService } from '../services/MorphoService'

type AgentContext = {
	Variables: {
		agent: Agent
	}
}

const lendRoutes = new Hono<AgentContext>()

// GET /v1/agent/lend/markets — list lending markets
lendRoutes.get('/markets', async (c) => {
	const chainId = parseInt(c.req.query('chainId') ?? '8453', 10)

	const result = await runEffectEither(
		Effect.gen(function* () {
			const morpho = yield* MorphoService
			return yield* morpho.getMarkets(chainId)
		}),
	)

	if (Either.isLeft(result)) {
		const { status, body } = mapErrorToResponse(result.left)
		return c.json(body, status)
	}

	return c.json({ markets: result.right })
})

// GET /v1/agent/lend/market/:id — market details
lendRoutes.get('/market/:id', async (c) => {
	const id = c.req.param('id')

	const result = await runEffectEither(
		Effect.gen(function* () {
			const morpho = yield* MorphoService
			return yield* morpho.getMarket(id)
		}),
	)

	if (Either.isLeft(result)) {
		const { status, body } = mapErrorToResponse(result.left)
		return c.json(body, status)
	}

	return c.json(result.right)
})

export { lendRoutes }
