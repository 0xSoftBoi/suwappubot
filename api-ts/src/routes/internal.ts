import { Effect, Either, Option } from 'effect'
import { Hono } from 'hono'
import { runEffectEither } from '../runtime'
import { SwapService, UserService, EventBus } from '../services'
import type { QuoteParams } from '../services/SwapService'

/**
 * Internal API routes for service-to-service communication.
 * Authenticated via X-Internal-Key header (internalAuth middleware).
 * Called by the Python bot to consolidate logic in api-ts.
 */
export const internalRoutes = new Hono()

// ─── Swap Routes ────────────────────────────────────────────

/**
 * GET /internal/swap/quote
 * Get a swap quote (same as webapp/swap/quote but for internal use)
 */
internalRoutes.get('/swap/quote', async (c) => {
	const params: QuoteParams = {
		fromChain: c.req.query('fromChain') || '',
		toChain: c.req.query('toChain') || '',
		fromToken: c.req.query('fromToken') || '',
		toToken: c.req.query('toToken') || '',
		fromAmount: c.req.query('fromAmount') || '',
		fromAddress: c.req.query('fromAddress') || '',
		slippage: parseFloat(c.req.query('slippage') || '0.03'),
		order: (c.req.query('order') as QuoteParams['order']) || 'RECOMMENDED',
	}

	const result = await runEffectEither(
		Effect.gen(function* () {
			const swapService = yield* SwapService
			return yield* swapService.getQuote(params)
		}),
	)

	if (Either.isLeft(result)) {
		return c.json({ error: String(result.left) }, 400)
	}

	return c.json(result.right)
})

/**
 * GET /internal/swap/status/:swapId
 * Check swap status
 */
internalRoutes.get('/swap/status/:swapId', async (c) => {
	const swapId = parseInt(c.req.param('swapId'), 10)
	if (isNaN(swapId)) {
		return c.json({ error: 'Invalid swapId' }, 400)
	}

	const result = await runEffectEither(
		Effect.gen(function* () {
			const swapService = yield* SwapService
			return yield* swapService.checkAndUpdateSwapStatus(swapId)
		}),
	)

	if (Either.isLeft(result)) {
		return c.json({ error: String(result.left) }, 500)
	}

	if (!result.right) {
		return c.json({ error: 'Swap not found' }, 404)
	}

	return c.json(result.right)
})

/**
 * POST /internal/swap/record
 * Create a swap record in the database
 */
internalRoutes.post('/swap/record', async (c) => {
	const body = await c.req.json()

	const result = await runEffectEither(
		Effect.gen(function* () {
			const swapService = yield* SwapService
			return yield* swapService.createSwapRecord(body)
		}),
	)

	if (Either.isLeft(result)) {
		return c.json({ error: String(result.left) }, 500)
	}

	return c.json(result.right, 201)
})

/**
 * PATCH /internal/swap/:swapId
 * Update swap status
 */
internalRoutes.patch('/swap/:swapId', async (c) => {
	const swapId = parseInt(c.req.param('swapId'), 10)
	if (isNaN(swapId)) {
		return c.json({ error: 'Invalid swapId' }, 400)
	}

	const body = await c.req.json()
	const { status, txHash, errorMessage } = body

	const result = await runEffectEither(
		Effect.gen(function* () {
			const swapService = yield* SwapService
			return yield* swapService.updateSwapStatus(swapId, status, txHash, errorMessage)
		}),
	)

	if (Either.isLeft(result)) {
		return c.json({ error: String(result.left) }, 500)
	}

	return c.json(result.right)
})

// ─── User Routes ────────────────────────────────────────────

/**
 * GET /internal/user/:userId
 * Get user by ID
 */
internalRoutes.get('/user/:userId', async (c) => {
	const userId = parseInt(c.req.param('userId'), 10)
	if (isNaN(userId)) {
		return c.json({ error: 'Invalid userId' }, 400)
	}

	const result = await runEffectEither(
		Effect.gen(function* () {
			const userService = yield* UserService
			return yield* userService.getUserById(userId)
		}),
	)

	if (Either.isLeft(result)) {
		return c.json({ error: String(result.left) }, 500)
	}

	const user = result.right
	if (Option.isNone(user)) {
		return c.json({ error: 'User not found' }, 404)
	}

	return c.json(user.value)
})

/**
 * POST /internal/user/sync
 * Create or update user from bot data
 */
internalRoutes.post('/user/sync', async (c) => {
	const body = await c.req.json()

	const result = await runEffectEither(
		Effect.gen(function* () {
			const userService = yield* UserService
			return yield* userService.getOrCreateUser(body)
		}),
	)

	if (Either.isLeft(result)) {
		return c.json({ error: String(result.left) }, 500)
	}

	return c.json(result.right)
})

// ─── Event Publishing ───────────────────────────────────────

/**
 * POST /internal/events/publish
 * Allow the Python bot to publish events via HTTP (fallback if Redis pub/sub unavailable)
 */
internalRoutes.post('/events/publish', async (c) => {
	const body = await c.req.json()
	const { type, data } = body

	if (!type || !data) {
		return c.json({ error: 'type and data are required' }, 400)
	}

	const result = await runEffectEither(
		Effect.gen(function* () {
			const eventBus = yield* EventBus
			yield* eventBus.publish({ type, data } as any).pipe(
				Effect.catchAll(() => Effect.void),
			)
		}),
	)

	if (Either.isLeft(result)) {
		return c.json({ error: String(result.left) }, 500)
	}

	return c.json({ ok: true })
})


// ─── Payment Verification ──────────────────────────────────

/**
 * POST /internal/verify-payment
 * Verify an on-chain payment for MPP 402 flow.
 * Proxies to Python x402_service for actual chain verification.
 */
internalRoutes.post('/verify-payment', async (c) => {
	const body = await c.req.json()
	const { tx_hash, chain, expected_amount, expected_token, expected_recipient } = body as {
		tx_hash: string
		chain: string
		expected_amount: string
		expected_token: string
		expected_recipient: string
	}

	if (!tx_hash || !expected_recipient) {
		return c.json({ verified: false, error: 'tx_hash and expected_recipient are required' }, 400)
	}

	// Proxy to Python internal API for chain verification
	try {
		const pythonUrl = process.env.INTERNAL_API_URL || 'http://localhost:8000'
		const res = await fetch(`${pythonUrl}/internal/x402/verify`, {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				'X-Internal-Key': process.env.INTERNAL_API_KEY || '',
			},
			body: JSON.stringify({
				tx_hash,
				chain: chain || 'tempo',
				expected_amount,
				expected_token: expected_token || 'pathUSD',
				expected_recipient,
			}),
			signal: AbortSignal.timeout(15_000),
		})

		if (!res.ok) {
			const errText = await res.text().catch(() => res.statusText)
			return c.json({ verified: false, error: `Verification service error: ${errText}` }, 502)
		}

		const result = await res.json()
		return c.json(result)
	} catch (e: any) {
		return c.json({ verified: false, error: `Verification failed: ${e.message}` }, 500)
	}
})

// ─── Token Routes ───────────────────────────────────────────

/**
 * GET /internal/token/price
 * Get token price
 */
internalRoutes.get('/token/price', async (c) => {
	const chain = c.req.query('chain') || ''
	const address = c.req.query('address') || ''

	if (!chain || !address) {
		return c.json({ error: 'chain and address are required' }, 400)
	}

	// TODO: Implement via TokenService once price endpoint is available
	return c.json({ error: 'Not yet implemented' }, 501)
})

// ─── Health ─────────────────────────────────────────────────

/**
 * GET /internal/health
 * Internal health check with service status
 */
internalRoutes.get('/health', async (c) => {
	const result = await runEffectEither(
		Effect.gen(function* () {
			const eventBus = yield* EventBus
			return {
				status: 'ok' as const,
				service: 'api-ts' as const,
				eventBus: eventBus.isConnected(),
				timestamp: new Date().toISOString(),
			}
		}),
	)

	if (Either.isLeft(result)) {
		return c.json({ status: 'ok', service: 'api-ts', eventBus: false })
	}

	return c.json(result.right)
})
