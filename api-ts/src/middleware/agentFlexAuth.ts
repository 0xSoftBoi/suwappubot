/**
 * agentFlexAuth — dual-auth middleware for the /v1/agent/* surface.
 *
 * Auth priority:
 *   1. X-API-Key: sk_live_xxx  OR  Authorization: Bearer sk_live_xxx
 *      → validated against the api_keys + organizations + subscriptions tables
 *      → sets c.set('apiKeyAuth', { orgId, scopes, keyId, rateLimitPerMin })
 *   2. Authorization: Bearer suwappu_sk_xxx  (existing agent bearer token)
 *      → delegates to agentBearerAuth(), sets c.set('agent', agent)
 *
 * Downstream handlers should check c.get('apiKeyAuth') || c.get('agent') to
 * determine the auth context. Routes that require an agent (wallets, billing,
 * swap execution with managed wallets) must explicitly reject if only
 * apiKeyAuth is set.
 */
import type { Context, Next } from 'hono'
import { apiKeyAuth } from './apiKeyAuth'
import { agentBearerAuth } from './auth'

export function agentFlexAuth() {
	return async (c: Context, next: Next) => {
		const xApiKey = c.req.header('X-API-Key')
		const authHeader = c.req.header('Authorization')
		const isOrgKey =
			xApiKey?.startsWith('sk_live_') || authHeader?.startsWith('Bearer sk_live_')

		if (isOrgKey) {
			// Route through org API key validation. apiKeyAuth() is a no-op if
			// the key is absent; we've confirmed one is present, so it will
			// either authenticate and call next(), or return an error response.
			return apiKeyAuth()(c, next)
		}

		// Fall back to per-agent bearer auth (suwappu_sk_* tokens).
		return agentBearerAuth()(c, next)
	}
}
