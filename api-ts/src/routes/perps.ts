import { Effect, Either } from 'effect'
import { Hono, type Context, type Next } from 'hono'
import type { Agent } from '../db'
import { mapErrorToResponse } from '../errors'
import { agentBearerAuth, flexAuth } from '../middleware'
import { runEffectEither } from '../runtime'
import { HyperliquidService } from '../services/HyperliquidService'
import { PerpsQuoteSchema } from './validators'

type AgentContext = {
	Variables: {
		agent: Agent
	}
}

const perpsRoutes = new Hono<AgentContext>()

// The perps positions path serves two existing callers with different credential
// classes: SDK/A2A clients use a suwappu_sk_* agent key, while the first-party
// terminal uses its user-session JWT/cookie. Keep both paths explicit instead of
// passing an agent key to flexAuth(), which only understands user-session tokens.
function perpsPositionsAuth() {
	return async (c: Context<AgentContext>, next: Next) => {
		const authorization = c.req.header('Authorization')
		const bearerToken = authorization?.startsWith('Bearer ')
			? authorization.slice(7).trim()
			: undefined
		if (bearerToken?.startsWith('suwappu_sk_')) {
			return agentBearerAuth()(c, next)
		}
		return flexAuth()(c, next)
	}
}

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
		return c.json(body, status)
	}

	return c.json({ markets: result.right })
})

// POST /v1/agent/perps/quote — get perp position quote
perpsRoutes.post('/quote', agentBearerAuth(), async (c) => {
	const body = await c.req.json()
	const parsed = PerpsQuoteSchema.safeParse(body)
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
		return c.json(body, status)
	}

	return c.json(result.right)
})

// GET /v1/agent/perps/positions — list open positions
perpsRoutes.get('/positions', perpsPositionsAuth(), async (c) => {
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
		return c.json(body, status)
	}

	return c.json({ positions: result.right })
})

export { perpsRoutes }
