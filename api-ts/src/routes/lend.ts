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

function parseChainId(value: string | undefined): number | null {
	const chainId = Number(value ?? '8453')
	return Number.isInteger(chainId) && chainId > 0 ? chainId : null
}

// GET /v1/agent/lend/markets — list lending markets
lendRoutes.get('/markets', async (c) => {
	const chainId = parseChainId(c.req.query('chainId'))
	if (chainId === null) {
		return c.json({ error: 'Validation Error', message: 'chainId must be a positive integer' }, 400)
	}

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
	const chainId = parseChainId(c.req.query('chainId'))
	if (chainId === null) {
		return c.json({ error: 'Validation Error', message: 'chainId must be a positive integer' }, 400)
	}

	const result = await runEffectEither(
		Effect.gen(function* () {
			const morpho = yield* MorphoService
			return yield* morpho.getMarket(id, chainId)
		}),
	)

	if (Either.isLeft(result)) {
		const { status, body } = mapErrorToResponse(result.left)
		return c.json(body, status)
	}

	return c.json(result.right)
})

export { lendRoutes }
