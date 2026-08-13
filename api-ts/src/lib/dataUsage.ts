/**
 * Per-API-key usage counters for the /v1/data/* market-data surface
 * (Phase 3, docs/plans/market-data-parity.md).
 *
 * IN-MEMORY, PER-INSTANCE ONLY. Counts reset on deploy/restart and are NOT
 * shared across Railway replicas — this is a lightweight metering signal for
 * GET /v1/data/usage, not a billing ledger. If /v1/data/* ever needs
 * durable, cross-replica metering, promote it to the apiUsageEvents table
 * (see middleware/recordUsage.ts), which already persists org-API-key
 * traffic to Postgres and would just need agent-bearer callers added.
 */

interface UsageEntry {
	count: number
	firstSeenAt: number
	lastSeenAt: number
	byEndpoint: Map<string, number>
}

const usage = new Map<string, UsageEntry>()

// Bound memory in case of a very long-running instance with many distinct
// callers — evict the least-recently-seen entry once over capacity.
const MAX_TRACKED_KEYS = 50_000

/** Record one /v1/data/* request against the caller's usage counter. */
export function recordDataUsage(callerKey: string, endpoint: string): void {
	const now = Date.now()
	let entry = usage.get(callerKey)
	if (!entry) {
		if (usage.size >= MAX_TRACKED_KEYS) {
			let oldestKey: string | undefined
			let oldestSeen = Infinity
			for (const [key, e] of usage) {
				if (e.lastSeenAt < oldestSeen) {
					oldestSeen = e.lastSeenAt
					oldestKey = key
				}
			}
			if (oldestKey) usage.delete(oldestKey)
		}
		entry = { count: 0, firstSeenAt: now, lastSeenAt: now, byEndpoint: new Map() }
		usage.set(callerKey, entry)
	}
	entry.count += 1
	entry.lastSeenAt = now
	entry.byEndpoint.set(endpoint, (entry.byEndpoint.get(endpoint) ?? 0) + 1)
}

export interface DataUsageSnapshot {
	total_requests: number
	first_seen_at: string | null
	last_seen_at: string | null
	by_endpoint: Record<string, number>
}

/** Read the current usage snapshot for a caller key (never mutates). */
export function getDataUsage(callerKey: string): DataUsageSnapshot {
	const entry = usage.get(callerKey)
	if (!entry) {
		return { total_requests: 0, first_seen_at: null, last_seen_at: null, by_endpoint: {} }
	}
	return {
		total_requests: entry.count,
		first_seen_at: new Date(entry.firstSeenAt).toISOString(),
		last_seen_at: new Date(entry.lastSeenAt).toISOString(),
		by_endpoint: Object.fromEntries(entry.byEndpoint),
	}
}
