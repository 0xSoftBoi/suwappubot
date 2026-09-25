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
} from '../../../hackathon/tokyo2026/src/world-id/config'
import {
	MemoryNullifierStore,
	awaitAndVerifyTradeApproval,
	startTradeVerification,
	type NullifierStore,
	type PendingVerification,
	type TradeIntent,
} from '../../../hackathon/tokyo2026/src/world-id/guardianGate'
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

/** signal → pending verification. Single-process; a multi-replica deploy
 * needs this in Redis/DB keyed by signal. */
const pending = new Map<string, PendingVerification>()

export function worldIdReady(env: Env = hackathonEnv()): boolean {
	return worldIdEnabled(env) && isWorldIdConfigured()
}

export async function startWorldIdGate(
	intent: TradeIntent,
): Promise<{ connectorURI: string; signal: string }> {
	const cfg = loadWorldIdConfig()
	const p = await startTradeVerification(cfg, intent)
	pending.set(p.signal, p)
	return { connectorURI: p.connectorURI, signal: p.signal }
}

export async function awaitWorldIdGate(
	signal: string,
): Promise<{ ok: true; nullifier: string } | { ok: false; reason: string }> {
	const cfg = loadWorldIdConfig()
	const p = pending.get(signal)
	if (!p) return { ok: false, reason: 'unknown or expired signal' }
	pending.delete(signal)
	const store = await nullifierStore()
	const res = await awaitAndVerifyTradeApproval(cfg, p, store)
	if (!res.ok) return { ok: false, reason: res.reason ?? 'verification failed' }
	return { ok: true, nullifier: res.nullifier ?? '' }
}
