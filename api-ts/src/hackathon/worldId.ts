/**
 * HACKATHON (ETHGlobal Tokyo 2026) — World ID guardian gate service adapter.
 *
 * Wraps the standalone World ID module (../../../hackathon/tokyo2026) for the
 * api-ts demo routes in src/routes/hackathon.ts. Server-driven flow:
 * start → human scans QR → verify.
 *
 * Nullifier replay protection is DURABLE: PostgresNullifierStore records
 * (action, nullifier) with a UNIQUE index, and consume() is an atomic
 * INSERT ... ON CONFLICT DO NOTHING — concurrent consumes of the same proof
 * let exactly one win. Falls back to MemoryNullifierStore only when
 * DATABASE_URL is unset (single-process demo mode), with a warning.
 *
 * This does NOT touch ApprovalService: adding World ID as a first-class
 * step-up method needs a `method` column on approval_step_up_challenges
 * (dual-ORM migration), which is a venue-with-DB job, not a blind edit.
 */

import {
	isWorldIdConfigured,
	loadWorldIdConfig,
} from './tokyo2026/world-id/config'
import {
	MemoryNullifierStore,
	awaitAndVerifyTradeApproval,
	startTradeVerification,
	type NullifierStore,
	type PendingVerification,
	type TradeIntent,
} from './tokyo2026/world-id/guardianGate'
import { worldIdEnabled, hackathonEnv } from './env'
import { PostgresNullifierStore } from './worldIdNullifiers'
import { logger } from '../lib/logger'
import type { Env } from '../config/EnvService'

export type { TradeIntent }

/**
 * Lazily-initialized nullifier store. Postgres when DATABASE_URL is set
 * (durable, atomic, cross-replica); in-memory fallback otherwise.
 */
let storePromise: Promise<NullifierStore> | null = null

function nullifierStore(): Promise<NullifierStore> {
	if (storePromise === null) {
		storePromise = (async () => {
			const url = process.env.DATABASE_URL
			if (!url) {
				logger.warn(
					'[world-id] DATABASE_URL unset — nullifier replay protection is in-memory only (restarts lose it)',
				)
				return new MemoryNullifierStore()
			}
			const { createDbClient } = await import('../db/client')
			return new PostgresNullifierStore(createDbClient(url))
		})()
	}
	return storePromise
}

/**
 * Terminal verification outcome, keyed by signal. Populated by the
 * background task kicked off in startWorldIdGate; polled (never re-awaited)
 * by verifyWorldIdGate. TTL-bounded so a client that never polls doesn't
 * leak memory.
 */
type GateResult =
	| { status: 'pending' }
	| { status: 'verified'; ok: true; nullifier: string }
	| { status: 'failed'; ok: false; reason: string }

interface GateEntry {
	result: GateResult
	expiresAt: number
}

/** signal → verification state. Single-process; a multi-replica deploy
 * needs this in Redis/DB keyed by signal. */
const results = new Map<string, GateEntry>()

const RESULT_TTL_MS = 10 * 60 * 1000
const MAX_ENTRIES = 5_000

function pruneResults(): void {
	if (results.size <= MAX_ENTRIES) return
	const now = Date.now()
	for (const [signal, entry] of results) {
		if (entry.expiresAt <= now) results.delete(signal)
	}
	// Still over budget (e.g. burst of live entries): evict oldest first.
	while (results.size > MAX_ENTRIES) {
		const oldest = results.keys().next().value
		if (oldest === undefined) break
		results.delete(oldest)
	}
}

export function worldIdReady(env: Env = hackathonEnv()): boolean {
	return worldIdEnabled(env) && isWorldIdConfigured()
}

/**
 * `stepUp` requests the step-up action (cfg.stepUpAction) instead of the
 * gate action — the step-up is a distinct authorization with its own
 * nullifier namespace (see WorldIdConfig.stepUpAction).
 *
 * Starts the human's IDKit request (fast — returns the QR connectorURI), then
 * kicks off the poll+verify in the background so a slow/absent human never
 * blocks this call or the eventual /verify poll past Cloudflare's ~100s
 * proxy timeout. The result lands in `results` keyed by signal once settled.
 */
export async function startWorldIdGate(
	intent: TradeIntent,
	stepUp = false,
): Promise<{ connectorURI: string; signal: string }> {
	const cfg = loadWorldIdConfig()
	const action = stepUp ? cfg.stepUpAction : cfg.action
	const p = await startTradeVerification(cfg, intent, action)

	pruneResults()
	results.set(p.signal, { result: { status: 'pending' }, expiresAt: Date.now() + RESULT_TTL_MS })

	void (async () => {
		try {
			const store = await nullifierStore()
			const res = await awaitAndVerifyTradeApproval(cfg, p, store, action)
			const result: GateResult = res.ok
				? { status: 'verified', ok: true, nullifier: res.nullifier ?? '' }
				: { status: 'failed', ok: false, reason: res.reason ?? 'verification failed' }
			results.set(p.signal, { result, expiresAt: Date.now() + RESULT_TTL_MS })
		} catch (e) {
			logger.warn('[world-id] background verification failed for signal %s: %s', p.signal, String(e))
			results.set(p.signal, {
				result: { status: 'failed', ok: false, reason: 'verification error' },
				expiresAt: Date.now() + RESULT_TTL_MS,
			})
		}
	})()

	return { connectorURI: p.connectorURI, signal: p.signal }
}

/**
 * Poll the in-memory result for a signal. Non-blocking, idempotent — returns
 * the same terminal result on repeat calls until TTL expiry. Unknown signal
 * (never started, or expired/evicted) is reported as a terminal failure so
 * the client can stop polling instead of spinning forever.
 */
export function pollWorldIdGate(signal: string): GateResult {
	const entry = results.get(signal)
	if (!entry || entry.expiresAt <= Date.now()) {
		return { status: 'failed', ok: false, reason: 'unknown or expired signal' }
	}
	return entry.result
}
