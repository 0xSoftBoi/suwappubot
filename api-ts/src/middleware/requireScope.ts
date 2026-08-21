/**
 * requireScope — gate an API-key-authenticated request on a named scope.
 *
 * Scopes are only enforced when the request is authenticated via an org API
 * key (c.get('apiKeyAuth') is set). Telegram / agent bearer token paths
 * bypass scope checks entirely — they already carry their own capability model.
 *
 * The wildcard scope '*' grants all access.
 */
import type { Context, Next } from 'hono'
import { documentationUrlForAgentError } from '../lib/agentError'

export function requireScope(scope: string) {
	return async (c: Context, next: Next) => {
		const apiKeyCtx = c.get('apiKeyAuth') as
			| { orgId: string; scopes: string[]; keyId: string; rateLimitPerMin: number }
			| undefined

		// Not an API-key request — skip scope enforcement
		if (!apiKeyCtx) return next()

		const { scopes } = apiKeyCtx
		if (!scopes.includes(scope) && !scopes.includes('*')) {
			return c.json(
				{
					error: `Missing required scope: ${scope}`,
					error_code: 'INSUFFICIENT_SCOPE',
					required_scope: scope,
					documentation_url: documentationUrlForAgentError('INSUFFICIENT_SCOPE'),
				},
				403,
			)
		}

		return next()
	}
}
