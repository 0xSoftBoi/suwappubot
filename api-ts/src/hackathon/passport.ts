/**
 * HACKATHON (ETHGlobal Tokyo 2026) — "Agent Swap Passport" orchestration.
 *
 * Server-driven flow, mirroring worldId.ts's start → background verify
 * pattern, extended with a provisioning step and swap-job tracking:
 *
 *   POST /passport/start   → World ID QR for action `suwappu-passport`
 *   POST /passport/verify  → poll; on success, kicks off provisionPassport()
 *                             in the background; poll again for 'ready'
 *   POST /passport/swap    → simulate (sync) + send (background job)
 *   GET  /passport/:wallet → chain-read merged with in-memory tx history
 *
 * State is process-local (Map), same single-replica assumption as
 * worldId.ts's `results` map — a multi-replica deploy needs this in
 * Redis/DB keyed by signal/wallet/jobId. Acceptable for the demo: this is
 * a from-scratch hackathon integration, not a production money path.
 */
import { randomUUID } from 'node:crypto'
import { loadWorldIdConfig } from './tokyo2026/world-id/config'
import {
	awaitAndVerifyTradeApproval,
	normalizeNullifier,
	startVerification,
	REPLAY_REJECTED_REASON,
	type NullifierStore,
} from './tokyo2026/world-id/guardianGate'
import {
	provisionPassport,
	readPassport,
	sendSwapThroughHook,
	simulateSwapThroughHook,
	type ProvisionResult,
} from './tokyo2026/passportChain'
import { logger } from '../lib/logger'

export const PASSPORT_ACTION = 'suwappu-passport'

function passportSignal(wallet: string): string {
	return `passport:${wallet.toLowerCase()}`
}

export function isValidWallet(wallet: unknown): wallet is string {
	return typeof wallet === 'string' && /^0x[0-9a-fA-F]{40}$/.test(wallet)
}

// ---------------------------------------------------------------------------
// Gate state: signal -> verification/provisioning status
// ---------------------------------------------------------------------------

type PassportGateResult =
	| { status: 'pending' }
	| { status: 'provisioning'; wallet: string; nullifier: string }
	| { status: 'ready'; wallet: string; nullifier: string; ens: ProvisionResult['ens']; hook: ProvisionResult['hook'] }
	| { status: 'existing'; wallet: string; nullifier: string; ens: ProvisionResult['ens']; hook: ProvisionResult['hook'] }
	| { status: 'failed'; reason: string }

interface GateEntry {
	result: PassportGateResult
	expiresAt: number
}

const gateResults = new Map<string, GateEntry>()
/** nullifier (normalized decimal) -> wallet, for replay idempotency. */
const nullifierToWallet = new Map<string, string>()
const TTL_MS = 30 * 60 * 1000
const MAX_ENTRIES = 5_000

function prune(): void {
	if (gateResults.size <= MAX_ENTRIES) return
	const now = Date.now()
	for (const [k, v] of gateResults) if (v.expiresAt <= now) gateResults.delete(k)
	while (gateResults.size > MAX_ENTRIES) {
		const oldest = gateResults.keys().next().value
		if (oldest === undefined) break
		gateResults.delete(oldest)
	}
}

function setGate(signal: string, result: PassportGateResult): void {
	gateResults.set(signal, { result, expiresAt: Date.now() + TTL_MS })
}

let storePromise: Promise<NullifierStore> | null = null
async function nullifierStore(): Promise<NullifierStore> {
	if (storePromise === null) {
		storePromise = (async () => {
			const url = process.env.DATABASE_URL
			if (!url) {
				logger.warn('[passport] DATABASE_URL unset — nullifier replay protection is in-memory only')
				const { MemoryNullifierStore } = await import('./tokyo2026/world-id/guardianGate')
				return new MemoryNullifierStore()
			}
			const { createDbClient } = await import('../db/client')
			const { PostgresNullifierStore } = await import('./worldIdNullifiers')
			return new PostgresNullifierStore(createDbClient(url))
		})()
	}
	return storePromise
}

async function runProvisioning(signal: string, wallet: string, nullifier: string): Promise<void> {
	setGate(signal, { status: 'provisioning', wallet, nullifier })
	try {
		const provisioned = await provisionPassport(wallet)
		nullifierToWallet.set(normalizeNullifier(nullifier), wallet)
		setGate(signal, { status: 'ready', wallet, nullifier, ens: provisioned.ens, hook: provisioned.hook })
	} catch (e) {
		logger.warn('[passport] provisioning failed for %s: %s', wallet, String(e))
		setGate(signal, { status: 'failed', reason: e instanceof Error ? e.message : String(e) })
	}
}

/** Step 1: start the World ID proof for this wallet's passport. */
export async function startPassportGate(wallet: string): Promise<{ connectorURI: string; signal: string }> {
	const cfg = loadWorldIdConfig()
	const signal = passportSignal(wallet)
	const pending = await startVerification(cfg, signal, PASSPORT_ACTION)

	prune()
	setGate(signal, { status: 'pending' })

	void (async () => {
		try {
			const store = await nullifierStore()
			const res = await awaitAndVerifyTradeApproval(cfg, pending, store, PASSPORT_ACTION)
			if (res.ok && res.nullifier) {
				void runProvisioning(signal, wallet, res.nullifier)
				return
			}
			if (res.reason === REPLAY_REJECTED_REASON && res.nullifier) {
				// Same human, same action, already used — one human, one passport.
				// Idempotent re-scan: return the existing record instead of erroring.
				const existingWallet = findWalletByNullifier(res.nullifier) ?? wallet
				try {
					const state = await readPassport(existingWallet)
					setGate(signal, {
						status: 'existing',
						wallet: existingWallet,
						nullifier: res.nullifier,
						ens: { name: state.ensName, txHash: null, existing: state.ensResolvesToWallet },
						hook: { allowlistTx: null, existing: state.hookAllowlisted },
					})
				} catch (e) {
					setGate(signal, { status: 'failed', reason: e instanceof Error ? e.message : String(e) })
				}
				return
			}
			setGate(signal, { status: 'failed', reason: res.reason ?? 'verification failed' })
		} catch (e) {
			logger.warn('[passport] background verification failed for %s: %s', signal, String(e))
			setGate(signal, { status: 'failed', reason: 'verification error' })
		}
	})()

	return { connectorURI: pending.connectorURI, signal }
}

/** Step 2: poll for verification + provisioning status. Non-blocking, idempotent. */
export function pollPassportGate(signal: string): PassportGateResult {
	const entry = gateResults.get(signal)
	if (!entry || entry.expiresAt <= Date.now()) {
		return { status: 'failed', reason: 'unknown or expired signal' }
	}
	return entry.result
}

// ---------------------------------------------------------------------------
// Swap jobs
// ---------------------------------------------------------------------------

type SwapJob =
	| { status: 'submitted' }
	| { status: 'executed'; txHash: string; blockNumber: number }
	| { status: 'failed'; reason: string }

const swapJobs = new Map<string, { job: SwapJob; expiresAt: number }>()
const swapHistory = new Map<string, Array<{ txHash: string; blockNumber: number }>>()

function setSwapJob(jobId: string, job: SwapJob): void {
	swapJobs.set(jobId, { job, expiresAt: Date.now() + TTL_MS })
}

export type SwapStart =
	| { status: 'blocked'; reason: 'SwapperNotVerified'; detail: string }
	| { status: 'submitted'; jobId: string }

/**
 * Simulates synchronously (free, ~1 Sepolia RPC round trip) so a blocked
 * outcome (unverified wallet) is returned directly from the request handler
 * with zero gas spent. Only when the simulate succeeds does it hand off to a
 * background job for the send + receipt wait.
 */
export async function startPassportSwap(wallet: string): Promise<SwapStart> {
	const sim = await simulateSwapThroughHook(wallet)
	if ('status' in sim && sim.status === 'blocked') {
		return sim
	}

	const jobId = randomUUID()
	setSwapJob(jobId, { status: 'submitted' })
	void (async () => {
		try {
			const result = await sendSwapThroughHook(wallet)
			if (result.status === 'blocked') {
				// Re-simulate raced with something changing on-chain between the
				// sync check and the background send (e.g. concurrent revoke) —
				// surface it as a failed job rather than pretending it executed.
				setSwapJob(jobId, { status: 'failed', reason: `${result.reason}: ${result.detail}` })
				return
			}
			setSwapJob(jobId, { status: 'executed', txHash: result.txHash, blockNumber: result.blockNumber })
			const history = swapHistory.get(wallet.toLowerCase()) ?? []
			history.push({ txHash: result.txHash, blockNumber: result.blockNumber })
			swapHistory.set(wallet.toLowerCase(), history)
		} catch (e) {
			logger.warn('[passport] swap job %s failed: %s', jobId, String(e))
			setSwapJob(jobId, { status: 'failed', reason: e instanceof Error ? e.message : String(e) })
		}
	})()
	return { status: 'submitted', jobId }
}

export function getSwapJob(jobId: string): SwapJob {
	const entry = swapJobs.get(jobId)
	if (!entry || entry.expiresAt <= Date.now()) {
		return { status: 'failed', reason: 'unknown or expired job' }
	}
	return entry.job
}

/** GET /passport/:wallet — chain reads merged with in-memory tx history. */
export async function getPassport(wallet: string) {
	const state = await readPassport(wallet)
	return {
		...state,
		swaps: swapHistory.get(wallet.toLowerCase()) ?? [],
		explorer: 'https://sepolia.etherscan.io/tx/',
	}
}

/** Nullifier replay lookup — returns the wallet's current passport record if
 * this nullifier has already provisioned one, so a re-scan is idempotent
 * instead of erroring. */
export function findWalletByNullifier(nullifier: string): string | null {
	try {
		return nullifierToWallet.get(normalizeNullifier(nullifier)) ?? null
	} catch {
		return null
	}
}
