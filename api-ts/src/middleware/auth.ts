import type { Context, Next } from 'hono'
import { HTTPException } from 'hono/http-exception'
import { Effect, Either, Option } from 'effect'
import { AgentService } from '../services'
import { runEffectEither } from '../runtime'

/**
 * Middleware to validate X-Agent-Key header (legacy - for internal tools)
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
				cause: { hint: 'Use Authorization: Bearer YOUR_API_KEY' }
			})
		}

		if (!authHeader.startsWith('Bearer ')) {
			throw new HTTPException(401, { 
				message: 'Invalid Authorization header format',
				cause: { hint: 'Use Authorization: Bearer YOUR_API_KEY' }
			})
		}

		const apiKey = authHeader.slice(7) // Remove 'Bearer ' prefix

		if (!apiKey || !apiKey.startsWith('suwappu_sk_')) {
			throw new HTTPException(401, { 
				message: 'Invalid API key format',
				cause: { hint: 'API key should start with suwappu_sk_' }
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
				
				// Update last active timestamp (fire and forget)
				yield* agentService.updateAgentActivity(agent.id).pipe(
					Effect.catchAll(() => Effect.succeed(undefined))
				)
				
				return agent
			})
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
				cause: { hint: 'Use Authorization: Bearer YOUR_API_KEY' }
			})
		}

		if (!authHeader.startsWith('Bearer ')) {
			throw new HTTPException(401, {
				message: 'Invalid Authorization header format',
				cause: { hint: 'Use Authorization: Bearer YOUR_API_KEY' }
			})
		}

		const apiKey = authHeader.slice(7)

		if (!apiKey || !apiKey.startsWith('suwappu_sk_')) {
			throw new HTTPException(401, {
				message: 'Invalid API key format',
				cause: { hint: 'API key should start with suwappu_sk_' }
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
			})
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
