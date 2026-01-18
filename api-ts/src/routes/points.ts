import { Hono } from 'hono'
import { Effect, Either, Option } from 'effect'
import { UserService, PointsService } from '../services'
import { runEffectEither } from '../runtime'
import { mapErrorToResponse, NotFoundError, ValidationError } from '../errors'
import type { PointAction } from '../db'

const pointsRoutes = new Hono()

// GET /users/:id/points/stats - Get user's comprehensive points stats
pointsRoutes.get('/:id/points/stats', async (c) => {
	const userId = Number(c.req.param('id'))

	if (Number.isNaN(userId)) {
		return c.json({ error: 'Invalid user ID' }, 400)
	}

	const result = await runEffectEither(
		Effect.gen(function* () {
			const userService = yield* UserService
			const pointsService = yield* PointsService

			// Verify user exists
			const userOption = yield* userService.getUserById(userId)
			if (Option.isNone(userOption)) {
				return yield* Effect.fail(new NotFoundError({ message: 'User not found', resource: 'user' }))
			}

			const stats = yield* pointsService.getUserStats(userId)

			return {
				...stats,
				lastCheckin: stats.lastCheckin?.toISOString() ?? null,
			}
		})
	)

	if (Either.isLeft(result)) {
		const { status, body } = mapErrorToResponse(result.left)
		return c.json(body, status as 200)
	}

	return c.json(result.right)
})

// POST /users/:id/points/checkin - Daily check-in
pointsRoutes.post('/:id/points/checkin', async (c) => {
	const userId = Number(c.req.param('id'))

	if (Number.isNaN(userId)) {
		return c.json({ error: 'Invalid user ID' }, 400)
	}

	const result = await runEffectEither(
		Effect.gen(function* () {
			const userService = yield* UserService
			const pointsService = yield* PointsService

			// Verify user exists
			const userOption = yield* userService.getUserById(userId)
			if (Option.isNone(userOption)) {
				return yield* Effect.fail(new NotFoundError({ message: 'User not found', resource: 'user' }))
			}

			return yield* pointsService.dailyCheckin(userId)
		})
	)

	if (Either.isLeft(result)) {
		const { status, body } = mapErrorToResponse(result.left)
		return c.json(body, status as 200)
	}

	return c.json(result.right)
})

// GET /users/:id/points/leaderboard - Get leaderboard
pointsRoutes.get('/:id/points/leaderboard', async (c) => {
	const limit = Math.min(Number(c.req.query('limit') || 10), 100)

	const result = await runEffectEither(
		Effect.gen(function* () {
			const pointsService = yield* PointsService
			return yield* pointsService.getLeaderboard(limit)
		})
	)

	if (Either.isLeft(result)) {
		const { status, body } = mapErrorToResponse(result.left)
		return c.json(body, status as 200)
	}

	return c.json(result.right)
})

// POST /users/:id/points/swap - Award points for a swap
pointsRoutes.post('/:id/points/swap', async (c) => {
	const userId = Number(c.req.param('id'))

	if (Number.isNaN(userId)) {
		return c.json({ error: 'Invalid user ID' }, 400)
	}

	let body: { swapAmountUsd: number; swapId?: number }
	try {
		body = await c.req.json()
	} catch {
		return c.json({ error: 'Invalid JSON body' }, 400)
	}

	if (typeof body.swapAmountUsd !== 'number' || body.swapAmountUsd < 0) {
		return c.json({ error: 'swapAmountUsd must be a positive number' }, 400)
	}

	const result = await runEffectEither(
		Effect.gen(function* () {
			const userService = yield* UserService
			const pointsService = yield* PointsService

			// Verify user exists
			const userOption = yield* userService.getUserById(userId)
			if (Option.isNone(userOption)) {
				return yield* Effect.fail(new NotFoundError({ message: 'User not found', resource: 'user' }))
			}

			return yield* pointsService.awardSwapPoints(userId, body.swapAmountUsd, body.swapId)
		})
	)

	if (Either.isLeft(result)) {
		const { status, body } = mapErrorToResponse(result.left)
		return c.json(body, status as 200)
	}

	return c.json(result.right)
})

// GET /users/:id/points/rewards - Get available rewards
pointsRoutes.get('/:id/points/rewards', async (c) => {
	const result = await runEffectEither(
		Effect.gen(function* () {
			const pointsService = yield* PointsService
			const rewards = yield* pointsService.getAvailableRewards()

			return rewards.map((reward) => ({
				id: reward.id,
				name: reward.name,
				description: reward.description,
				emoji: reward.emoji,
				pointsCost: reward.pointsCost,
				rewardType: reward.rewardType,
				rewardValue: reward.rewardValue,
				stock: reward.stock,
				durationDays: reward.durationDays,
			}))
		})
	)

	if (Either.isLeft(result)) {
		const { status, body } = mapErrorToResponse(result.left)
		return c.json(body, status as 200)
	}

	return c.json(result.right)
})

// POST /users/:id/points/redeem/:rewardId - Redeem points for reward
pointsRoutes.post('/:id/points/redeem/:rewardId', async (c) => {
	const userId = Number(c.req.param('id'))
	const rewardId = Number(c.req.param('rewardId'))

	if (Number.isNaN(userId)) {
		return c.json({ error: 'Invalid user ID' }, 400)
	}

	if (Number.isNaN(rewardId)) {
		return c.json({ error: 'Invalid reward ID' }, 400)
	}

	const result = await runEffectEither(
		Effect.gen(function* () {
			const userService = yield* UserService
			const pointsService = yield* PointsService

			// Verify user exists
			const userOption = yield* userService.getUserById(userId)
			if (Option.isNone(userOption)) {
				return yield* Effect.fail(new NotFoundError({ message: 'User not found', resource: 'user' }))
			}

			const redemption = yield* pointsService.redeemReward(userId, rewardId)

			return {
				id: redemption.id,
				pointsSpent: redemption.pointsSpent,
				rewardType: redemption.rewardType,
				rewardValue: redemption.rewardValue,
				status: redemption.status,
				createdAt: redemption.createdAt.toISOString(),
				expiresAt: redemption.expiresAt?.toISOString() ?? null,
			}
		})
	)

	if (Either.isLeft(result)) {
		const { status, body } = mapErrorToResponse(result.left)
		return c.json(body, status as 200)
	}

	return c.json(result.right)
})

// GET /users/:id/points/history - Get point transaction history
pointsRoutes.get('/:id/points/history', async (c) => {
	const userId = Number(c.req.param('id'))
	const limit = Math.min(Number(c.req.query('limit') || 20), 100)
	const offset = Number(c.req.query('offset') || 0)
	const action = c.req.query('action') as PointAction | undefined

	if (Number.isNaN(userId)) {
		return c.json({ error: 'Invalid user ID' }, 400)
	}

	const result = await runEffectEither(
		Effect.gen(function* () {
			const userService = yield* UserService
			const pointsService = yield* PointsService

			// Verify user exists
			const userOption = yield* userService.getUserById(userId)
			if (Option.isNone(userOption)) {
				return yield* Effect.fail(new NotFoundError({ message: 'User not found', resource: 'user' }))
			}

			const history = yield* pointsService.getPointHistory(userId, limit, offset, action)

			return history.map((tx) => ({
				id: tx.id,
				amount: tx.amount,
				action: tx.action,
				description: tx.description,
				metadata: tx.metadata,
				createdAt: tx.createdAt.toISOString(),
			}))
		})
	)

	if (Either.isLeft(result)) {
		const { status, body } = mapErrorToResponse(result.left)
		return c.json(body, status as 200)
	}

	return c.json(result.right)
})

// POST /users/:id/points/award - Award arbitrary points (admin/internal use)
pointsRoutes.post('/:id/points/award', async (c) => {
	const userId = Number(c.req.param('id'))

	if (Number.isNaN(userId)) {
		return c.json({ error: 'Invalid user ID' }, 400)
	}

	let body: { action: PointAction; amount?: number; description?: string }
	try {
		body = await c.req.json()
	} catch {
		return c.json({ error: 'Invalid JSON body' }, 400)
	}

	if (!body.action) {
		return c.json({ error: 'action is required' }, 400)
	}

	const result = await runEffectEither(
		Effect.gen(function* () {
			const userService = yield* UserService
			const pointsService = yield* PointsService

			// Verify user exists
			const userOption = yield* userService.getUserById(userId)
			if (Option.isNone(userOption)) {
				return yield* Effect.fail(new NotFoundError({ message: 'User not found', resource: 'user' }))
			}

			return yield* pointsService.awardPoints(userId, body.action, body.amount, body.description)
		})
	)

	if (Either.isLeft(result)) {
		const { status, body } = mapErrorToResponse(result.left)
		return c.json(body, status as 200)
	}

	return c.json(result.right)
})

export { pointsRoutes }
