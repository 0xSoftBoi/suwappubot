import { Hono } from 'hono'
import { Effect, Either, Option } from 'effect'
import { UserService, LimitOrderService } from '../services'
import { runEffectEither } from '../runtime'
import { mapErrorToResponse, NotFoundError, ValidationError } from '../errors'

const limitOrderRoutes = new Hono()

// GET /users/:id/limit-orders - List user's limit orders
limitOrderRoutes.get('/:id/limit-orders', async (c) => {
	const userId = Number(c.req.param('id'))
	const status = c.req.query('status') // optional: active, filled, cancelled, expired
	const limit = Math.min(Number(c.req.query('limit') || 20), 100)
	const offset = Number(c.req.query('offset') || 0)

	if (Number.isNaN(userId)) {
		return c.json({ error: 'Invalid user ID' }, 400)
	}

	const result = await runEffectEither(
		Effect.gen(function* () {
			const userService = yield* UserService
			const limitOrderService = yield* LimitOrderService

			// Verify user exists
			const userOption = yield* userService.getUserById(userId)
			if (Option.isNone(userOption)) {
				return yield* Effect.fail(new NotFoundError({ message: 'User not found', resource: 'user' }))
			}

			const orders = yield* limitOrderService.getUserOrders(userId, status, limit, offset)

			return orders.map((order) => ({
				id: order.id,
				fromChain: order.fromChain,
				fromToken: order.fromToken,
				fromTokenSymbol: order.fromTokenSymbol,
				fromAmount: order.fromAmount,
				toChain: order.toChain,
				toToken: order.toToken,
				toTokenSymbol: order.toTokenSymbol,
				targetPrice: order.targetPrice,
				currentPrice: order.currentPrice,
				triggerType: order.triggerType,
				status: order.status,
				createdAt: order.createdAt?.toISOString() ?? null,
				expiresAt: order.expiresAt?.toISOString() ?? null,
				executedAt: order.executedAt?.toISOString() ?? null,
				executedPrice: order.executedPrice,
				executedTxHash: order.executedTxHash,
			}))
		})
	)

	if (Either.isLeft(result)) {
		const { status, body } = mapErrorToResponse(result.left)
		return c.json(body, status as 200)
	}

	return c.json(result.right)
})

// POST /users/:id/limit-orders - Create a new limit order
limitOrderRoutes.post('/:id/limit-orders', async (c) => {
	const userId = Number(c.req.param('id'))

	if (Number.isNaN(userId)) {
		return c.json({ error: 'Invalid user ID' }, 400)
	}

	let body: {
		fromChain: string
		fromToken: string
		fromTokenSymbol: string
		fromAmount: string
		toChain: string
		toToken: string
		toTokenSymbol: string
		targetPrice: number
		triggerType?: 'lte' | 'gte'
		slippage?: number
		walletAddress: string
		expiresInHours?: number
	}

	try {
		body = await c.req.json()
	} catch {
		return c.json({ error: 'Invalid JSON body' }, 400)
	}

	// Validate required fields
	const required = ['fromChain', 'fromToken', 'fromTokenSymbol', 'fromAmount', 'toChain', 'toToken', 'toTokenSymbol', 'targetPrice', 'walletAddress']
	for (const field of required) {
		if (!(field in body)) {
			return c.json({ error: `Missing required field: ${field}` }, 400)
		}
	}

	const result = await runEffectEither(
		Effect.gen(function* () {
			const userService = yield* UserService
			const limitOrderService = yield* LimitOrderService

			// Verify user exists
			const userOption = yield* userService.getUserById(userId)
			if (Option.isNone(userOption)) {
				return yield* Effect.fail(new NotFoundError({ message: 'User not found', resource: 'user' }))
			}

			// Calculate expiration if provided
			let expiresAt: Date | undefined
			if (body.expiresInHours && body.expiresInHours > 0) {
				expiresAt = new Date(Date.now() + body.expiresInHours * 60 * 60 * 1000)
			}

			const order = yield* limitOrderService.createOrder({
				userId,
				fromChain: body.fromChain,
				fromToken: body.fromToken,
				fromTokenSymbol: body.fromTokenSymbol,
				fromAmount: body.fromAmount,
				toChain: body.toChain,
				toToken: body.toToken,
				toTokenSymbol: body.toTokenSymbol,
				targetPrice: body.targetPrice,
				triggerType: body.triggerType || 'lte',
				slippage: body.slippage,
				walletAddress: body.walletAddress,
				expiresAt,
			})

			return {
				id: order.id,
				fromChain: order.fromChain,
				fromToken: order.fromToken,
				fromTokenSymbol: order.fromTokenSymbol,
				fromAmount: order.fromAmount,
				toChain: order.toChain,
				toToken: order.toToken,
				toTokenSymbol: order.toTokenSymbol,
				targetPrice: order.targetPrice,
				triggerType: order.triggerType,
				status: order.status,
				createdAt: order.createdAt?.toISOString() ?? null,
				expiresAt: order.expiresAt?.toISOString() ?? null,
			}
		})
	)

	if (Either.isLeft(result)) {
		const { status, body } = mapErrorToResponse(result.left)
		return c.json(body, status as 200)
	}

	return c.json(result.right, 201)
})

// GET /users/:id/limit-orders/:orderId - Get a specific order
limitOrderRoutes.get('/:id/limit-orders/:orderId', async (c) => {
	const userId = Number(c.req.param('id'))
	const orderId = Number(c.req.param('orderId'))

	if (Number.isNaN(userId) || Number.isNaN(orderId)) {
		return c.json({ error: 'Invalid user ID or order ID' }, 400)
	}

	const result = await runEffectEither(
		Effect.gen(function* () {
			const limitOrderService = yield* LimitOrderService

			const orderOption = yield* limitOrderService.getOrderById(orderId, userId)
			if (Option.isNone(orderOption)) {
				return yield* Effect.fail(new NotFoundError({ message: 'Order not found', resource: 'limit_order' }))
			}

			const order = orderOption.value

			return {
				id: order.id,
				fromChain: order.fromChain,
				fromToken: order.fromToken,
				fromTokenSymbol: order.fromTokenSymbol,
				fromAmount: order.fromAmount,
				toChain: order.toChain,
				toToken: order.toToken,
				toTokenSymbol: order.toTokenSymbol,
				targetPrice: order.targetPrice,
				currentPrice: order.currentPrice,
				triggerType: order.triggerType,
				slippage: order.slippage,
				walletAddress: order.walletAddress,
				status: order.status,
				createdAt: order.createdAt?.toISOString() ?? null,
				updatedAt: order.updatedAt?.toISOString() ?? null,
				expiresAt: order.expiresAt?.toISOString() ?? null,
				executedAt: order.executedAt?.toISOString() ?? null,
				executedPrice: order.executedPrice,
				executedTxHash: order.executedTxHash,
				lastCheckedAt: order.lastCheckedAt?.toISOString() ?? null,
				errorMessage: order.errorMessage,
			}
		})
	)

	if (Either.isLeft(result)) {
		const { status, body } = mapErrorToResponse(result.left)
		return c.json(body, status as 200)
	}

	return c.json(result.right)
})

// DELETE /users/:id/limit-orders/:orderId - Cancel an order
limitOrderRoutes.delete('/:id/limit-orders/:orderId', async (c) => {
	const userId = Number(c.req.param('id'))
	const orderId = Number(c.req.param('orderId'))

	if (Number.isNaN(userId) || Number.isNaN(orderId)) {
		return c.json({ error: 'Invalid user ID or order ID' }, 400)
	}

	const result = await runEffectEither(
		Effect.gen(function* () {
			const limitOrderService = yield* LimitOrderService

			const order = yield* limitOrderService.cancelOrder(orderId, userId)

			return {
				id: order.id,
				status: order.status,
				message: 'Order cancelled successfully',
			}
		})
	)

	if (Either.isLeft(result)) {
		const { status, body } = mapErrorToResponse(result.left)
		return c.json(body, status as 200)
	}

	return c.json(result.right)
})

export { limitOrderRoutes }
