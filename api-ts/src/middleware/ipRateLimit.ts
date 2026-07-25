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

// Trusted reverse-proxy hops in front of this service. A trusting proxy APPENDS the
// real client IP to the right of x-forwarded-for, so the spoof-resistant address is the
// entry TRUSTED_PROXY_COUNT hops from the right; anything a client sets lands further
// left and must be ignored. Configurable for multi-hop topologies (CloudFront -> ALB).
const TRUSTED_PROXY_COUNT = Math.max(1, Number(process.env.TRUSTED_PROXY_COUNT) || 1)

/**
 * Resolve the rate-limiting client IP in a spoof-resistant way: take the entry
 * `trustedProxyCount` hops from the RIGHT of x-forwarded-for (the proxy-appended hop),
 * not the client-controllable leftmost. Falls back to the socket IP, then 'unknown'.
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

// `cf-connecting-ip` is trivially spoofable by any direct caller UNLESS the request
// actually transited Cloudflare. Only trust it when the caller also presents a shared
// secret that only a configured Cloudflare Worker/Transform Rule attaches at the edge
// (`cf-provenance: <secret>`). If CF_PROVENANCE_SECRET is unset, cf-connecting-ip is
// ignored entirely and we fall through to the XFF/trusted-proxy-hop logic — a
// direct-to-origin request (raw Railway URL) then cannot forge an identity to farm
// starter credits or dodge per-IP limits.
const CF_PROVENANCE_SECRET = process.env.CF_PROVENANCE_SECRET?.trim() || ''

/**
 * Resolve the client IP, honoring `cf-connecting-ip` only on requests with verified
 * Cloudflare provenance; otherwise falling back to the spoof-resistant XFF
 * trusted-proxy hop (then socket IP). Shared by the rate limiter and by the
 * starter-credit anti-farm guard so the two can never disagree.
 */
export function resolveTrustedClientIp(
	cfIp: string | undefined,
	forwarded: string | undefined,
	socketIp: string | undefined,
	trustedProxyCount: number = TRUSTED_PROXY_COUNT,
	provenanceHeader?: string,
): string {
	const provenanceOk =
		!!CF_PROVENANCE_SECRET && provenanceHeader?.trim() === CF_PROVENANCE_SECRET
	const trimmedCf = cfIp?.trim()
	if (provenanceOk && trimmedCf) return trimmedCf
	return resolveClientIp(forwarded, socketIp, trustedProxyCount)
}

/**
 * Resolve the trusted client IP straight from a Hono Context. Use this rather than
 * re-deriving the headers at each call site, so the rate limiter and the
 * starter-credit anti-farm guard can never disagree about who the caller is.
 */
export function resolveRequestIp(c: Context): string {
	let socketIp: string | undefined
	try {
		socketIp = getConnInfo(c).remote.address
	} catch {
		// Connection info unavailable (e.g. non-Bun runtime in tests); fall back below.
		socketIp = undefined
	}
	return resolveTrustedClientIp(
		c.req.header('cf-connecting-ip'),
		c.req.header('x-forwarded-for'),
		socketIp,
		undefined,
		c.req.header('cf-provenance'),
	)
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
 * Keyed by client IP from x-forwarded-for header.
 */
export function ipRateLimit(limit: number = DEFAULT_LIMIT) {
	return async (c: Context, next: Next) => {
		const cfIp = c.req.header('cf-connecting-ip')
		const forwarded = c.req.header('x-forwarded-for')
		let socketIp: string | undefined
		try {
			socketIp = getConnInfo(c).remote.address
		} catch {
			// Connection info unavailable (e.g. non-Bun runtime in tests); fall back below.
			socketIp = undefined
		}
		const ip = resolveTrustedClientIp(
			cfIp,
			forwarded,
			socketIp,
			undefined,
			c.req.header('cf-provenance'),
		)
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
			const oldestInWindow = entry.timestamps[0] ?? now
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
