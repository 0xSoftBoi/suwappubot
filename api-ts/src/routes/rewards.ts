import { Effect, Either, Option } from 'effect'
import { Hono } from 'hono'
import { logger } from '../lib/logger'
import { telegramAuth } from '../middleware'
import { runEffectEither } from '../runtime'
import { RewardsService, UserService } from '../services'
import type { TelegramUser } from '../services/TelegramAuthService'

// On-chain fee-cashback rewards — read API for the Mini App (Rewards v1).
// Mounted at /webapp/rewards. All endpoints require Telegram auth; every lookup
// is keyed to the AUTHENTICATED user (never a caller-supplied id).
//
// Writes (custodial credit, epoch lifecycle) live in the Python bot; the only
// "write" a user performs here is submitting the claim tx from their own wallet,
// using the payload from GET /claim/:epochIndex.

const rewardsRoutes = new Hono()
rewardsRoutes.use('*', telegramAuth())

// GET /webapp/rewards/summary — accruing + claimable + history rollup
rewardsRoutes.get('/summary', async (c) => {
	const telegramUser = c.get('telegramUser') as TelegramUser

	const result = await runEffectEither(
		Effect.gen(function* () {
			const userService = yield* UserService
			const rewardsService = yield* RewardsService

			const userOption = yield* userService.getUserByTelegramId(telegramUser.id)
			if (Option.isNone(userOption)) {
				return null
			}
			return yield* rewardsService.getSummary(userOption.value.id)
		}),
	)

	if (Either.isLeft(result)) {
		logger.error({ err: result.left }, 'rewards summary error')
		return c.json({ error: 'Failed to load rewards' }, 500)
	}
	if (result.right === null) {
		return c.json({ error: 'User not found' }, 404)
	}
	return c.json(result.right)
})

// GET /webapp/rewards/claim/:epochIndex — wallet-claim payload (Merkle proof)
// Returns 404 unless the authenticated user holds an on-chain leaf in that
// epoch AND the epoch is published (status 'onchain').
rewardsRoutes.get('/claim/:epochIndex', async (c) => {
	const telegramUser = c.get('telegramUser') as TelegramUser
	const epochIndex = Number.parseInt(c.req.param('epochIndex'), 10)
	if (!Number.isInteger(epochIndex) || epochIndex < 0) {
		return c.json({ error: 'Invalid epoch index' }, 400)
	}

	const result = await runEffectEither(
		Effect.gen(function* () {
			const userService = yield* UserService
			const rewardsService = yield* RewardsService

			const userOption = yield* userService.getUserByTelegramId(telegramUser.id)
			if (Option.isNone(userOption)) {
				return null
			}
			return yield* rewardsService.getClaimPayload(userOption.value.id, epochIndex)
		}),
	)

	if (Either.isLeft(result)) {
		logger.error({ err: result.left }, 'rewards claim payload error')
		return c.json({ error: 'Failed to load claim payload' }, 500)
	}
	if (result.right === null) {
		return c.json({ error: 'No on-chain claim available for this epoch' }, 404)
	}
	return c.json(result.right)
})

export { rewardsRoutes }
