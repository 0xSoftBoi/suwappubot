import type { Context, Next } from 'hono'
import { agentBearerAuth } from './auth'
import { mppPaymentAuth } from './mppAuth'

/**
 * Combined auth middleware: tries bearer auth first, falls back to MPP payment.
 * - If Authorization header with suwappu_sk_* is present → bearer auth
 * - If X-Payment-Proof header is present → MPP payment verification
 * - Otherwise → MPP 402 challenge (if enabled) or 401
 */
export function agentOrMppAuth() {
	const bearerMiddleware = agentBearerAuth()
	const mppMiddleware = mppPaymentAuth()

	return async (c: Context, next: Next) => {
		const authHeader = c.req.header('Authorization')

		// If bearer token is present, use bearer auth (don't fall through to MPP)
		if (authHeader?.startsWith('Bearer ')) {
			await bearerMiddleware(c, next)
			return
		}

		// No bearer token — try MPP payment auth
		await mppMiddleware(c, next)
	}
}
