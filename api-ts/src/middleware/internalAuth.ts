import type { Context, Next } from 'hono'
import { HTTPException } from 'hono/http-exception'

/**
 * Middleware for internal service-to-service authentication.
 * Validates X-Internal-Key header against INTERNAL_API_KEY env var.
 * Used by Python bot to call api-ts internal endpoints.
 */
export function internalAuth(validKey: string | undefined) {
	return async (c: Context, next: Next) => {
		if (!validKey) {
			throw new HTTPException(500, { message: 'Internal API key not configured' })
		}

		const apiKey = c.req.header('X-Internal-Key')

		if (!apiKey) {
			throw new HTTPException(401, { message: 'Missing X-Internal-Key header' })
		}

		if (apiKey !== validKey) {
			throw new HTTPException(401, { message: 'Invalid internal key' })
		}

		await next()
	}
}
