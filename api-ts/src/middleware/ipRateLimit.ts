import type { Context, Next } from 'hono'
import { getConnInfo } from 'hono/bun'
import { HTTPException } from 'hono/http-exception'

interface SlidingWindowEntry {
	timestamps: number[]
	lastCleanup: number
}

const DEFAULT_LIMIT = 10
const WINDOW_MS = 60_000 // 1 minute
const CLEANUP_INTERVAL = 5 * 60_000 // 5 minutes

/**
 * Number of trusted reverse-proxy hops in front of this service.
 *
 * The service runs behind a TLS-terminating load balancer (AWS ALB) on ECS
 * Fargate; the container port is only reachable through that proxy. A trusting
 * proxy *appends* the real client IP to the right of `x-forwarded-for`, so the
 * spoof-resistant client address is the entry `TRUSTED_PROXY_COUNT` hops from
 * the right of the chain. Anything the client sets ends up to the *left* of the
 * proxy-appended value and must be ignored.
 *
 * Configurable via TRUSTED_PROXY_COUNT for multi-hop topologies (e.g. CloudFront
 * -> ALB). Defaults to 1 (single ALB hop).
 */
const TRUSTED_PROXY_COUNT = Math.max(1, Number(process.env.TRUSTED_PROXY_COUNT) || 1)

/**
 * Resolve the rate-limiting client IP in a spoof-resistant way.
 *
 * `forwarded` is the raw `x-forwarded-for` header value (or undefined).
 * `socketIp` is the connection peer address (the proxy, in production).
 *
 * We take the entry `trustedProxyCount` hops from the *right* of the
 * `x-forwarded-for` chain rather than the leftmost entry. For legitimate
 * single-hop traffic the chain is just `<client>` (the proxy appends it), so
 * leftmost === rightmost and behavior is unchanged. The only case where the
 * result differs is when an attacker pads the header with extra leftmost
 * entries to rotate keys — which is exactly the spoof we are closing.
 *
 * If the header is missing or has fewer entries than trusted hops (i.e. it was
 * not set by our trusted proxy), we fall back to the socket IP, then 'unknown'.
 */
export function resolveClientIp(
	forwarded: string | undefined,
	socketIp: string | undefined,
	trustedProxyCount: number = TRUSTED_PROXY_COUNT,
): string {
	const chain =
		forwarded
			?.split(',')
			.map((part) => part.trim())
			.filter((part) => part.length > 0) ?? []

	if (chain.length >= trustedProxyCount) {
		const clientIp = chain[chain.length - trustedProxyCount]
		if (clientIp) return clientIp
	}

	return socketIp?.trim() || 'unknown'
}

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
 *
 * Keyed by the spoof-resistant client IP. The `x-forwarded-for` header is only
 * trusted up to the configured number of trusted-proxy hops (see
 * resolveClientIp / TRUSTED_PROXY_COUNT); otherwise we fall back to the socket
 * connection IP. This prevents attackers from bypassing the limit by spoofing
 * or padding `x-forwarded-for` to rotate the rate-limit key.
 */
export function ipRateLimit(limit: number = DEFAULT_LIMIT) {
	return async (c: Context, next: Next) => {
		const forwarded = c.req.header('x-forwarded-for')
		let socketIp: string | undefined
		try {
			socketIp = getConnInfo(c).remote.address
		} catch {
			// Connection info unavailable (e.g. non-Bun runtime in tests); fall back below.
			socketIp = undefined
		}
		const ip = resolveClientIp(forwarded, socketIp)
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
