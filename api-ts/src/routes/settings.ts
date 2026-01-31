import { Hono } from 'hono'
import { Effect, Either, Option } from 'effect'
import { telegramAuth } from '../middleware'
import { UserService, SettingsService } from '../services'
import { runEffectEither } from '../runtime'
import type { TelegramUser } from '../services/TelegramAuthService'
import { mapErrorToResponse } from '../errors'
import type { UpdateUserSettingsRequest } from '../db/schema/settings'

const settingsRoutes = new Hono()

// All settings routes require auth
settingsRoutes.use('*', telegramAuth())

/**
 * GET /webapp/settings
 * Get current user's settings
 */
settingsRoutes.get('/', async (c) => {
	const telegramUser = c.get('telegramUser') as TelegramUser

	const result = await runEffectEither(
		Effect.gen(function* () {
			const userService = yield* UserService
			const settingsService = yield* SettingsService

			// Find user by telegram_id
			const userOption = yield* userService.getUserByTelegramId(telegramUser.id)

			if (Option.isNone(userOption)) {
				// Return default settings for non-existent users
				return {
					slippage: 0.5,
					priceAlerts: true,
					txUpdates: true,
					promotions: false,
					language: 'en',
					theme: 'light',
				}
			}

			const user = userOption.value
			return yield* settingsService.getSettings(user.id)
		})
	)

	if (Either.isLeft(result)) {
		const { status, body } = mapErrorToResponse(result.left)
		return c.json(body, status as 200)
	}

	return c.json(result.right)
})

/**
 * PUT /webapp/settings
 * Update current user's settings
 */
settingsRoutes.put('/', async (c) => {
	const telegramUser = c.get('telegramUser') as TelegramUser
	const body = await c.req.json().catch(() => ({})) as UpdateUserSettingsRequest

	const result = await runEffectEither(
		Effect.gen(function* () {
			const userService = yield* UserService
			const settingsService = yield* SettingsService

			// Find or create user
			const { user } = yield* userService.getOrCreateUser({
				telegramId: telegramUser.id,
				username: telegramUser.username,
				firstName: telegramUser.first_name,
				lastName: telegramUser.last_name,
			})

			// Update settings
			return yield* settingsService.updateSettings(user.id, body)
		})
	)

	if (Either.isLeft(result)) {
		const { status, body } = mapErrorToResponse(result.left)
		return c.json(body, status as 200)
	}

	return c.json(result.right)
})

/**
 * PATCH /webapp/settings
 * Partial update of current user's settings (alias for PUT)
 */
settingsRoutes.patch('/', async (c) => {
	const telegramUser = c.get('telegramUser') as TelegramUser
	const body = await c.req.json().catch(() => ({})) as UpdateUserSettingsRequest

	const result = await runEffectEither(
		Effect.gen(function* () {
			const userService = yield* UserService
			const settingsService = yield* SettingsService

			// Find or create user
			const { user } = yield* userService.getOrCreateUser({
				telegramId: telegramUser.id,
				username: telegramUser.username,
				firstName: telegramUser.first_name,
				lastName: telegramUser.last_name,
			})

			// Update settings
			return yield* settingsService.updateSettings(user.id, body)
		})
	)

	if (Either.isLeft(result)) {
		const { status, body } = mapErrorToResponse(result.left)
		return c.json(body, status as 200)
	}

	return c.json(result.right)
})

export { settingsRoutes }
