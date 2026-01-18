import type { Context, Next } from 'hono'
import { HTTPException } from 'hono/http-exception'

/**
 * Middleware to validate X-Agent-Key header
 */
export function agentKeyAuth(validKey: string | undefined) {
	return async (c: Context, next: Next) => {
		if (!validKey) {
			throw new HTTPException(500, { message: 'Agent API key not configured' })
		}

		const apiKey = c.req.header('X-Agent-Key')

		if (!apiKey) {
			throw new HTTPException(401, { message: 'Missing X-Agent-Key header' })
		}

		if (apiKey !== validKey) {
			throw new HTTPException(401, { message: 'Invalid API key' })
		}

		await next()
	}
}

/**
 * Middleware to validate X-Admin-Key header
 */
export function adminKeyAuth(validKey: string | undefined) {
	return async (c: Context, next: Next) => {
		if (!validKey) {
			throw new HTTPException(500, { message: 'Admin API key not configured' })
		}

		const apiKey = c.req.header('X-Admin-Key')

		if (!apiKey) {
			throw new HTTPException(401, { message: 'Missing X-Admin-Key header' })
		}

		if (apiKey !== validKey) {
			throw new HTTPException(401, { message: 'Invalid admin key' })
		}

		await next()
	}
}
