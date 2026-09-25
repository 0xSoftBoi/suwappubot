/**
 * HACKATHON (ETHGlobal Tokyo 2026) — World ID guardian gate service adapter.
 *
 * Wraps the standalone World ID module (../../../hackathon/tokyo2026) for the
 * api-ts demo routes in src/routes/hackathon.ts. Server-driven flow:
 * start → human scans QR → verify. Nullifier replay protection is in-memory
 * (MemoryNullifierStore); the production path needs the durable unique
 * (action, nullifier) index the hackathon README describes.
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
	type PendingVerification,
	type TradeIntent,
} from '../../../hackathon/tokyo2026/src/world-id/guardianGate'
import { worldIdEnabled } from './env'

export type { TradeIntent }

const nullifierStore = new MemoryNullifierStore()
/** signal → pending verification. Single-process; a multi-replica deploy
 * needs this in Redis/DB keyed by signal. */
const pending = new Map<string, PendingVerification>()

export function worldIdReady(): boolean {
	return worldIdEnabled() && isWorldIdConfigured()
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
	const res = await awaitAndVerifyTradeApproval(cfg, p, nullifierStore)
	if (!res.ok) return { ok: false, reason: res.reason ?? 'verification failed' }
	return { ok: true, nullifier: res.nullifier ?? '' }
}
