import type { Context, Next } from 'hono'
import { HTTPException } from 'hono/http-exception'
import { Effect, Option } from 'effect'
import { TelegramAuthService, type TelegramUser } from '../services'
import { runEffect } from '../runtime'

// Extend Hono context to include telegramUser
declare module 'hono' {
	interface ContextVariableMap {
		telegramUser: TelegramUser
	}
}

/**
 * Middleware to validate X-Telegram-Init-Data header and extract user
 */
export function telegramAuth() {
	return async (c: Context, next: Next) => {
		const initData = c.req.header('X-Telegram-Init-Data')

		if (!initData) {
			throw new HTTPException(401, { message: 'Missing Telegram authentication' })
		}

		const userOption = await runEffect(
			Effect.gen(function* () {
				const authService = yield* TelegramAuthService
				return yield* authService.validateInitData(initData)
			})
		)

		if (Option.isNone(userOption)) {
			throw new HTTPException(401, { message: 'Invalid Telegram authentication' })
		}

		c.set('telegramUser', userOption.value)
		await next()
	}
}
