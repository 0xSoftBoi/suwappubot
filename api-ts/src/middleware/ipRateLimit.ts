import type { Context, Next } from 'hono'
import { HTTPException } from 'hono/http-exception'

interface SlidingWindowEntry {
	timestamps: number[]
	lastCleanup: number
}

const DEFAULT_LIMIT = 10
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
 * IP-based sliding window rate limiter for public endpoints.
 * Keyed by client IP from x-forwarded-for header.
 */
export function ipRateLimit(limit: number = DEFAULT_LIMIT) {
	return async (c: Context, next: Next) => {
		// Prefer Cloudflare's header; otherwise take the rightmost XFF hop
		// (the hop added by our own proxy, not attacker-controlled).
		const cfIp = c.req.header('cf-connecting-ip')
		const forwarded = c.req.header('x-forwarded-for')
		const ip = cfIp ?? forwarded?.split(',').at(-1)?.trim() ?? 'unknown'
		const key = `ip:${ip}`
		const now = Date.now()

		cleanupExpired()

		let entry = windows.get(key)
		if (!entry) {
			entry = { timestamps: [], lastCleanup: now }
			windows.set(key, entry)
		}

		const cutoff = now - WINDOW_MS
		entry.timestamps = entry.timestamps.filter((t) => t > cutoff)

		if (entry.timestamps.length >= limit) {
			const oldestInWindow = entry.timestamps[0]
			const retryAfter = Math.ceil((oldestInWindow + WINDOW_MS - now) / 1000)

			c.header('Retry-After', String(retryAfter))
			c.header('X-RateLimit-Limit', String(limit))
			c.header('X-RateLimit-Remaining', '0')
			c.header('X-RateLimit-Reset', String(Math.ceil((oldestInWindow + WINDOW_MS) / 1000)))

			throw new HTTPException(429, {
				message: `Rate limit exceeded. ${limit} requests per minute. Retry after ${retryAfter}s.`,
			})
		}

		entry.timestamps.push(now)

		c.header('X-RateLimit-Limit', String(limit))
		c.header('X-RateLimit-Remaining', String(limit - entry.timestamps.length))

		await next()
	}
}
