import { Effect, Option } from 'effect'
import type { Context, Next } from 'hono'
import { HTTPException } from 'hono/http-exception'
import { runEffect } from '../runtime'
import { TelegramAuthService, type TelegramUser } from '../services'

// Extend Hono context to include telegramUser
declare module 'hono' {
	interface ContextVariableMap {
		telegramUser: TelegramUser
	}
}

/**
 * Middleware to validate X-Telegram-Init-Data header and extract user
 * In development mode (NODE_ENV=development), allows X-Dev-User-Id header to bypass Telegram auth
 */
export function telegramAuth() {
	return async (c: Context, next: Next) => {
		const initData = c.req.header('X-Telegram-Init-Data')

		// Development mode: allow bypass with dev user ID
		// SECURITY: Only allowed when BOTH NODE_ENV=development AND DEV_AUTH_ENABLED=true
		if (process.env.NODE_ENV !== 'production' && process.env.NODE_ENV === 'development' && process.env.DEV_AUTH_ENABLED === 'true') {
			console.warn('DEV AUTH BYPASS ACTIVE')
			const devUserId = c.req.header('X-Dev-User-Id')
			if (devUserId) {
				c.set('telegramUser', {
					id: parseInt(devUserId, 10),
					first_name: 'Dev',
					last_name: 'User',
					username: 'devuser',
					language_code: 'en',
					is_premium: false,
				})
				await next()
				return
			}
		}

		if (!initData) {
			throw new HTTPException(401, { message: 'Missing Telegram authentication' })
		}

		const userOption = await runEffect(
			Effect.gen(function* () {
				const authService = yield* TelegramAuthService
				return yield* authService.validateInitData(initData)
			}),
		)

		if (Option.isNone(userOption)) {
			throw new HTTPException(401, { message: 'Invalid Telegram authentication' })
		}

		c.set('telegramUser', userOption.value)
		await next()
	}
}
