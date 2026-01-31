import { Hono } from 'hono'
import { Effect, Either } from 'effect'
import { TokenService, PriceService } from '../services'
import { runEffectEither } from '../runtime'

const tokensRoutes = new Hono()

/**
 * GET /tokens
 * Get list of supported tokens with optional filtering
 * Query params:
 *   - chain: Filter by chain (ethereum, arbitrum, polygon, etc.)
 *   - search: Search by symbol, name, or address
 *   - page: Page number (default: 1)
 *   - pageSize: Results per page (default: 50, max: 100)
 */
tokensRoutes.get('/', async (c) => {
	const chain = c.req.query('chain')
	const search = c.req.query('search')
	const page = Math.max(1, Number(c.req.query('page') || 1))
	const pageSize = Math.min(100, Math.max(1, Number(c.req.query('pageSize') || 50)))

	const result = await runEffectEither(
		Effect.gen(function* () {
			const tokenService = yield* TokenService
			return yield* tokenService.getTokens({ chain, search, page, pageSize })
		})
	)

	if (Either.isLeft(result)) {
		return c.json({ error: result.left.message }, 500)
	}

	return c.json(result.right)
})

/**
 * GET /tokens/chains
 * Get list of supported chains
 */
tokensRoutes.get('/chains', async (c) => {
	const result = await runEffectEither(
		Effect.gen(function* () {
			const tokenService = yield* TokenService
			return yield* tokenService.getChains()
		})
	)

	if (Either.isLeft(result)) {
		return c.json({ error: result.left.message }, 500)
	}

	return c.json({ chains: result.right })
})

/**
 * GET /tokens/prices
 * Get price data for tokens
 * Query params:
 *   - ids: Comma-separated list of token IDs or symbols (e.g., "eth,btc,sol")
 *   - top: Number of top tokens to return if no IDs specified (default: 50)
 */
tokensRoutes.get('/prices', async (c) => {
	const idsParam = c.req.query('ids')
	const top = Math.min(100, Math.max(1, Number(c.req.query('top') || 50)))

	const result = await runEffectEither(
		Effect.gen(function* () {
			const priceService = yield* PriceService

			if (idsParam) {
				const ids = idsParam.split(',').map((id) => id.trim()).filter(Boolean)
				return yield* priceService.getPrices(ids)
			}

			return yield* priceService.getTopTokens(top)
		})
	)

	if (Either.isLeft(result)) {
		return c.json({ error: result.left.message }, 500)
	}

	return c.json({ prices: result.right })
})

/**
 * GET /tokens/prices/:id
 * Get price for a specific token
 */
tokensRoutes.get('/prices/:id', async (c) => {
	const id = c.req.param('id')

	const result = await runEffectEither(
		Effect.gen(function* () {
			const priceService = yield* PriceService
			return yield* priceService.getPrice(id)
		})
	)

	if (Either.isLeft(result)) {
		return c.json({ error: result.left.message }, 500)
	}

	if (!result.right) {
		return c.json({ error: 'Token not found' }, 404)
	}

	return c.json(result.right)
})

/**
 * GET /tokens/search
 * Search for tokens by name or symbol
 * Query params:
 *   - q: Search query (min 2 characters)
 */
tokensRoutes.get('/search', async (c) => {
	const query = c.req.query('q') || ''

	if (query.length < 2) {
		return c.json({ error: 'Search query must be at least 2 characters' }, 400)
	}

	const result = await runEffectEither(
		Effect.gen(function* () {
			const priceService = yield* PriceService
			return yield* priceService.searchTokens(query)
		})
	)

	if (Either.isLeft(result)) {
		return c.json({ error: result.left.message }, 500)
	}

	return c.json({ results: result.right })
})

/**
 * GET /tokens/:chain/:address
 * Get token info by chain and address
 */
tokensRoutes.get('/:chain/:address', async (c) => {
	const chain = c.req.param('chain')
	const address = c.req.param('address')

	const result = await runEffectEither(
		Effect.gen(function* () {
			const tokenService = yield* TokenService
			return yield* tokenService.getToken(chain, address)
		})
	)

	if (Either.isLeft(result)) {
		return c.json({ error: result.left.message }, 500)
	}

	if (!result.right) {
		return c.json({ error: 'Token not found' }, 404)
	}

	return c.json(result.right)
})

export { tokensRoutes }
