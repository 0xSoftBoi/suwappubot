/**
 * Shared in-memory cache with TTL and max size eviction.
 * Consolidates the scattered caching patterns across agent.ts, swap.ts, and tokens.ts.
 */

interface CacheEntry<T> {
	value: T
	expiry: number
}

export class TTLCache<T> {
	private store = new Map<string, CacheEntry<T>>()
	private cleanupTimer: ReturnType<typeof setInterval>

	constructor(
		private readonly ttlMs: number,
		private readonly maxSize: number = 10_000,
		cleanupIntervalMs: number = 60_000,
	) {
		this.cleanupTimer = setInterval(() => this.cleanup(), cleanupIntervalMs)
	}

	get(key: string): T | null {
		const entry = this.store.get(key)
		if (!entry) return null
		if (Date.now() > entry.expiry) {
			this.store.delete(key)
			return null
		}
		return entry.value
	}

	set(key: string, value: T, ttlOverride?: number): void {
		// Evict oldest entries if over capacity
		if (this.store.size >= this.maxSize) {
			const entries = [...this.store.entries()].sort((a, b) => a[1].expiry - b[1].expiry)
			const toRemove = entries.slice(0, Math.max(1, entries.length - this.maxSize + 1))
			for (const [k] of toRemove) {
				this.store.delete(k)
			}
		}

		this.store.set(key, {
			value,
			expiry: Date.now() + (ttlOverride ?? this.ttlMs),
		})
	}

	delete(key: string): boolean {
		return this.store.delete(key)
	}

	has(key: string): boolean {
		return this.get(key) !== null
	}

	get size(): number {
		return this.store.size
	}

	private cleanup(): void {
		const now = Date.now()
		for (const [key, entry] of this.store) {
			if (now > entry.expiry) {
				this.store.delete(key)
			}
		}
	}

	dispose(): void {
		clearInterval(this.cleanupTimer)
		this.store.clear()
	}
}

/**
 * Shared sliding window rate limiter.
 * Consolidates rateLimit.ts and ipRateLimit.ts into a single reusable class.
 */

interface WindowEntry {
	timestamps: number[]
}

export class SlidingWindowRateLimiter {
	private windows = new Map<string, WindowEntry>()
	private cleanupTimer: ReturnType<typeof setInterval>

	constructor(
		private readonly windowMs: number = 60_000,
		cleanupIntervalMs: number = 60_000,
	) {
		this.cleanupTimer = setInterval(() => this.cleanup(), cleanupIntervalMs)
	}

	/**
	 * Check if a request is allowed. Returns { allowed, remaining, retryAfterMs }.
	 * If allowed, the request is counted.
	 */
	check(key: string, limit: number): { allowed: boolean; remaining: number; retryAfterMs: number; limit: number; resetAt: number } {
		const now = Date.now()
		const cutoff = now - this.windowMs

		let entry = this.windows.get(key)
		if (!entry) {
			entry = { timestamps: [] }
			this.windows.set(key, entry)
		}

		// Remove expired timestamps
		entry.timestamps = entry.timestamps.filter((t) => t > cutoff)

		if (entry.timestamps.length >= limit) {
			const oldestInWindow = entry.timestamps[0] ?? now
			const retryAfterMs = oldestInWindow + this.windowMs - now
			return {
				allowed: false,
				remaining: 0,
				retryAfterMs: Math.max(0, retryAfterMs),
				limit,
				resetAt: Math.ceil((oldestInWindow + this.windowMs) / 1000),
			}
		}

		entry.timestamps.push(now)
		return {
			allowed: true,
			remaining: limit - entry.timestamps.length,
			retryAfterMs: 0,
			limit,
			resetAt: Math.ceil((now + this.windowMs) / 1000),
		}
	}

	private cleanup(): void {
		const cutoff = Date.now() - this.windowMs
		for (const [key, entry] of this.windows) {
			entry.timestamps = entry.timestamps.filter((t) => t > cutoff)
			if (entry.timestamps.length === 0) {
				this.windows.delete(key)
			}
		}
	}

	dispose(): void {
		clearInterval(this.cleanupTimer)
		this.windows.clear()
	}
}
