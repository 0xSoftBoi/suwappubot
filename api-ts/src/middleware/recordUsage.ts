/**
 * recordUsage — fire-and-forget API usage event recorder.
 *
 * Only fires when an org API key is present (c.get('apiKeyAuth') is set).
 * Captures the response status code by hooking into the response cycle.
 * Uses a non-blocking insert so it never adds latency to the critical path.
 */
import { Effect } from 'effect'
import type { Context, Next } from 'hono'
import { apiUsageEvents, requireDb } from '../db'
import { runEffectEither } from '../runtime'

export function recordUsage() {
	return async (c: Context, next: Next) => {
		await next()

		const apiKeyCtx = c.get('apiKeyAuth') as
			| { orgId: string; scopes: string[]; keyId: string; rateLimitPerMin: number }
			| undefined

		if (!apiKeyCtx) return

		// Fire-and-forget — never block the response
		runEffectEither(
			Effect.gen(function* () {
				const db = yield* requireDb
				yield* Effect.tryPromise({
					try: () =>
						db.insert(apiUsageEvents).values({
							keyId: apiKeyCtx.keyId,
							orgId: apiKeyCtx.orgId,
							endpoint: c.req.path,
							method: c.req.method,
							statusCode: c.res.status,
						}),
					catch: () => new Error('recordUsage insert failed'),
				})
			}).pipe(Effect.catchAll(() => Effect.succeed(undefined))),
		)
	}
}
