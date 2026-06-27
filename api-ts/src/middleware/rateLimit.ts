import type { Context, Next } from 'hono'
import { HTTPException } from 'hono/http-exception'

interface SlidingWindowEntry {
	timestamps: number[]
	lastCleanup: number
}

const TIER_LIMITS: Record<string, number> = {
	free: 30,
	agent: 100,
	pro: 500,
	premium: 2_000,
	enterprise: 10_000,
}

const WINDOW_MS = 60_000 // 1 minute
const CLEANUP_INTERVAL = 5 * 60_000 // 5 minutes

const windows = new Map<string, SlidingWindowEntry>()
let lastGlobalCleanup = Date.now()

function cleanupExpired() {
	const now = Date.now()
	if (now - lastGlobalCleanup < CLEANUP_INTERVAL) return
	lastGlobalCleanup = now

	for (const [key, entry] of windows) {
		const cutoff = now - WINDOW_MS
		entry.timestamps = entry.timestamps.filter((t) => t > cutoff)
		if (entry.timestamps.length === 0) {
			windows.delete(key)
		}
	}
}

/**
 * Sliding window rate limiter keyed by agent ID.
 * Reads `rateLimitTier` from the agent set by bearer auth middleware.
 */
export function rateLimit() {
	return async (c: Context, next: Next) => {
		const agent = c.get('agent') as { id: number; rateLimitTier?: string } | undefined
		if (!agent) {
			// No agent in context — skip rate limiting (public endpoints)
			await next()
			return
		}

		const tier = agent.rateLimitTier || 'free'
		const limit = TIER_LIMITS[tier] ?? TIER_LIMITS.free ?? 30
		const key = `agent:${agent.id}`
		const now = Date.now()

		// Trigger periodic cleanup
		cleanupExpired()

		let entry = windows.get(key)
		if (!entry) {
			entry = { timestamps: [], lastCleanup: now }
			windows.set(key, entry)
		}

		// Remove timestamps outside the window
		const cutoff = now - WINDOW_MS
		entry.timestamps = entry.timestamps.filter((t) => t > cutoff)

		if (entry.timestamps.length >= limit) {
			const oldestInWindow = entry.timestamps[0] ?? now
			const retryAfter = Math.ceil((oldestInWindow + WINDOW_MS - now) / 1000)

			c.header('Retry-After', String(retryAfter))
			c.header('X-RateLimit-Limit', String(limit))
			c.header('X-RateLimit-Remaining', '0')
			c.header('X-RateLimit-Reset', String(Math.ceil((oldestInWindow + WINDOW_MS) / 1000)))

			throw new HTTPException(429, {
				message: `Rate limit exceeded. ${limit} requests per minute for ${tier} tier. Retry after ${retryAfter}s.`,
			})
		}

		entry.timestamps.push(now)

		c.header('X-RateLimit-Limit', String(limit))
		c.header('X-RateLimit-Remaining', String(limit - entry.timestamps.length))

		await next()
	}
}
