import { Effect, Either, Option } from 'effect'
import type { Context, Next } from 'hono'
import { HTTPException } from 'hono/http-exception'
import { inArray } from 'drizzle-orm'
import { requireDb } from '../db/DrizzleService'
import { agents } from '../db/schema'
import { runEffect, runEffectEither } from '../runtime'
import { AgentService } from '../services'

// Batch agent activity updates: collect IDs and flush every 60s
const pendingActivityUpdates = new Set<number>()

setInterval(async () => {
	if (pendingActivityUpdates.size === 0) return
	const ids = [...pendingActivityUpdates]
	pendingActivityUpdates.clear()
	try {
		await runEffect(
			Effect.gen(function* () {
				const db = yield* requireDb
				yield* Effect.tryPromise({
					try: () =>
						db
							.update(agents)
							.set({ lastActiveAt: new Date(), updatedAt: new Date() })
							.where(inArray(agents.id, ids)),
					catch: () => new Error('batch activity update failed'),
				})
			}).pipe(Effect.catchAll(() => Effect.succeed(undefined))),
		)
	} catch {
		// silently ignore - activity tracking is non-critical
	}
}, 60_000)

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

/**
 * Middleware to validate Bearer token for registered agents (A2A)
 * Extracts API key from Authorization: Bearer <key> header
 * Sets c.set('agent', agent) on success
 */
export function agentBearerAuth() {
	return async (c: Context, next: Next) => {
		const authHeader = c.req.header('Authorization')

		if (!authHeader) {
			throw new HTTPException(401, {
				message: 'Missing Authorization header',
				cause: { hint: 'Use Authorization: Bearer YOUR_API_KEY' },
			})
		}

		if (!authHeader.startsWith('Bearer ')) {
			throw new HTTPException(401, {
				message: 'Invalid Authorization header format',
				cause: { hint: 'Use Authorization: Bearer YOUR_API_KEY' },
			})
		}

		const apiKey = authHeader.slice(7).trim()

		const API_KEY_MIN_LENGTH = 32
		const API_KEY_PATTERN = /^suwappu_sk_[a-zA-Z0-9_-]+$/

		if (!apiKey || apiKey.length < API_KEY_MIN_LENGTH || !API_KEY_PATTERN.test(apiKey)) {
			throw new HTTPException(401, {
				message: 'Invalid API key format',
				cause: {
					hint: 'API key must start with suwappu_sk_ followed by at least 21 alphanumeric characters',
				},
			})
		}

		// Look up agent by API key
		const result = await runEffectEither(
			Effect.gen(function* () {
				const agentService = yield* AgentService
				const agentOption = yield* agentService.getAgentByApiKey(apiKey)

				if (Option.isNone(agentOption)) {
					return null
				}

				const agent = agentOption.value

				// Batch activity update instead of per-request DB write
				pendingActivityUpdates.add(agent.id)

				return agent
			}),
		)

		if (Either.isLeft(result)) {
			throw new HTTPException(500, { message: 'Internal error validating API key' })
		}

		const agent = result.right
		if (!agent) {
			throw new HTTPException(401, { message: 'Invalid or inactive API key' })
		}

		// Store agent in context for route handlers
		c.set('agent', agent)

		await next()
	}
}

/**
 * Like agentBearerAuth() but allows inactive agents.
 * Used for reactivation endpoint.
 */
export function agentBearerAuthAllowInactive() {
	return async (c: Context, next: Next) => {
		const authHeader = c.req.header('Authorization')

		if (!authHeader) {
			throw new HTTPException(401, {
				message: 'Missing Authorization header',
				cause: { hint: 'Use Authorization: Bearer YOUR_API_KEY' },
			})
		}

		if (!authHeader.startsWith('Bearer ')) {
			throw new HTTPException(401, {
				message: 'Invalid Authorization header format',
				cause: { hint: 'Use Authorization: Bearer YOUR_API_KEY' },
			})
		}

		const apiKey = authHeader.slice(7).trim()

		const API_KEY_MIN_LENGTH = 32
		const API_KEY_PATTERN = /^suwappu_sk_[a-zA-Z0-9_-]+$/

		if (!apiKey || apiKey.length < API_KEY_MIN_LENGTH || !API_KEY_PATTERN.test(apiKey)) {
			throw new HTTPException(401, {
				message: 'Invalid API key format',
				cause: {
					hint: 'API key must start with suwappu_sk_ followed by at least 21 alphanumeric characters',
				},
			})
		}

		const result = await runEffectEither(
			Effect.gen(function* () {
				const agentService = yield* AgentService
				const agentOption = yield* agentService.getAgentByApiKeyIncludingInactive(apiKey)

				if (Option.isNone(agentOption)) {
					return null
				}

				return agentOption.value
			}),
		)

		if (Either.isLeft(result)) {
			throw new HTTPException(500, { message: 'Internal error validating API key' })
		}

		const agent = result.right
		if (!agent) {
			throw new HTTPException(401, { message: 'Invalid API key' })
		}

		c.set('agent', agent)

		await next()
	}
}
