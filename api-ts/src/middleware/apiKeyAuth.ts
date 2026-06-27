import { createHash } from 'node:crypto'
import { eq, and, isNull } from 'drizzle-orm'
import { Effect } from 'effect'
import type { Context, Next } from 'hono'
import { requireDb, apiKeys, organizations } from '../db'
import { runEffectEither } from '../runtime'
import { Either } from 'effect'

const WINDOW_MS = 60_000
const rateLimitWindows = new Map<string, number[]>()

/**
 * Authenticate a request using an org API key.
 *
 * Reads: Authorization: Bearer sk_live_xxx  OR  X-API-Key: sk_live_xxx
 * Attaches { orgId, scopes, keyId, rateLimitPerMin } to the Hono context.
 * Updates lastUsedAt fire-and-forget (no await).
 *
 * Returns 401 if missing/unknown, 403 if revoked/expired.
 * If no API key header is present the middleware is a no-op (falls through).
 */
export function apiKeyAuth() {
	return async (c: Context, next: Next) => {
		const authHeader = c.req.header('Authorization')
		const xApiKey = c.req.header('X-API-Key')

		let rawKey: string | undefined
		if (xApiKey?.startsWith('sk_live_')) {
			rawKey = xApiKey
		} else if (authHeader?.startsWith('Bearer sk_live_')) {
			rawKey = authHeader.slice(7)
		}

		if (!rawKey) {
			// No API key — let other auth middleware handle the request
			await next()
			return
		}

		const keyHash = createHash('sha256').update(rawKey).digest('hex')

		const result = await runEffectEither(
			Effect.gen(function* () {
				const db = yield* requireDb

				const rows = yield* Effect.tryPromise({
					try: () =>
						db
							.select({
								id: apiKeys.id,
								organizationId: apiKeys.organizationId,
								scopes: apiKeys.scopes,
								rateLimitPerMin: apiKeys.rateLimitPerMin,
								revokedAt: apiKeys.revokedAt,
								expiresAt: apiKeys.expiresAt,
								orgRateLimit: organizations.apiRateLimitPerMin,
								orgTier: organizations.tier,
							})
							.from(apiKeys)
							.innerJoin(organizations, eq(apiKeys.organizationId, organizations.id))
							.where(eq(apiKeys.keyHash, keyHash))
							.limit(1),
					catch: (e) => (e instanceof Error ? e : new Error(String(e))),
				})

				return rows[0] ?? null
			}),
		)

		if (Either.isLeft(result)) {
			return c.json({ error: 'Internal error validating API key' }, 500)
		}

		const row = result.right
		if (!row) {
			return c.json({ error: 'Invalid API key' }, 401)
		}

		if (row.revokedAt) {
			return c.json({ error: 'API key has been revoked' }, 403)
		}

		if (row.expiresAt && new Date(row.expiresAt).getTime() < Date.now()) {
			return c.json({ error: 'API key has expired' }, 403)
		}

		// Per-key (or per-org fallback) rate limit
		const limit = row.rateLimitPerMin ?? row.orgRateLimit ?? 1000
		const windowKey = `apikey:${row.id}`
		const now = Date.now()
		const cutoff = now - WINDOW_MS

		let timestamps = rateLimitWindows.get(windowKey) ?? []
		timestamps = timestamps.filter((t) => t > cutoff)

		if (timestamps.length >= limit) {
			const retryAfter = Math.ceil(((timestamps[0] ?? now) + WINDOW_MS - now) / 1000)
			c.header('Retry-After', String(retryAfter))
			c.header('X-RateLimit-Limit', String(limit))
			c.header('X-RateLimit-Remaining', '0')
			return c.json({ error: `Rate limit exceeded. Retry after ${retryAfter}s.` }, 429)
		}

		timestamps.push(now)
		rateLimitWindows.set(windowKey, timestamps)

		c.header('X-RateLimit-Limit', String(limit))
		c.header('X-RateLimit-Remaining', String(limit - timestamps.length))

		// Attach to context for downstream handlers
		c.set('apiKeyAuth', {
			orgId: row.organizationId,
			scopes: row.scopes ?? [],
			keyId: row.id,
			rateLimitPerMin: limit,
		})

		// Fire-and-forget lastUsedAt update
		runEffectEither(
			Effect.gen(function* () {
				const db = yield* requireDb
				yield* Effect.tryPromise({
					try: () =>
						db
							.update(apiKeys)
							.set({ lastUsedAt: new Date() })
							.where(eq(apiKeys.id, row.id)),
					catch: (e) => (e instanceof Error ? e : new Error(String(e))),
				})
			}),
		)

		await next()
	}
}
