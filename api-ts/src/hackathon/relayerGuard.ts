/**
 * Relayer-gas guard for the Agent Swap Passport demo (ETHGlobal Tokyo 2026).
 *
 * The relayer wallet backing /hackathon/passport/* has a fixed, non-refillable
 * Sepolia balance (~0.0237 ETH ≈ 20 passports' worth of gas: ENS mint,
 * setWorldIdVerified, swap). Every call that can cause the relayer to send a
 * real tx — passport provisioning (ENS mint + hook allowlist) and the gated
 * swap — must be reserved here BEFORE the tx is dispatched, so we fail fast
 * with 429 instead of quietly draining the wallet to zero.
 *
 * Two independent limits:
 *  - Per-wallet cooldown: one relayer-tx-triggering call per wallet per
 *    COOLDOWN_MS. Stops a single caller from re-triggering (re-)provisioning
 *    or repeat swaps in a tight loop.
 *  - Global concurrency cap: at most MAX_IN_FLIGHT relayer jobs in flight at
 *    once, across all wallets. Stops a burst of *different* wallets from
 *    exhausting the gas budget in one shot; new requests over the cap are
 *    rejected outright (never queued unboundedly).
 *
 * Process-local (Map/counter), same single-replica assumption as the rest of
 * the hackathon demo state (see passport.ts).
 */

// Cooldowns are per (wallet, kind). A single shared key made the demo's own
// happy path fail: provisioning reserved the wallet for 5 min, so the judge's
// Beat 3 swap moments later was refused with "wallet on cooldown".
export type RelayerJobKind = 'provision' | 'swap'
const COOLDOWN_MS: Record<RelayerJobKind, number> = {
	provision: 5 * 60_000, // ENS mint + allowlist: once per wallet per 5 min
	swap: 20_000, // a gated swap: enough to stop a tight loop, not a retry
}
const MAX_IN_FLIGHT = 5 // relayer gas covers ~20 passports total; keep bursts small

const walletCooldownUntil = new Map<string, number>()
let inFlightCount = 0

export interface RelayerReservation {
	release(): void
}

export type ReserveResult =
	| { ok: true; reservation: RelayerReservation }
	| { ok: false; error: string }

/**
 * Reserve a relayer-tx slot for `wallet`. Call this immediately before
 * dispatching a real relayer transaction (ENS mint/provisioning, gated
 * swap send) — never after. On success, call `reservation.release()` once
 * the job (success or failure) is fully settled.
 */
export function reserveRelayerSlot(wallet: string, kind: RelayerJobKind): ReserveResult {
	const key = `${kind}:${wallet.toLowerCase()}`
	const now = Date.now()

	if (inFlightCount >= MAX_IN_FLIGHT) {
		return { ok: false, error: 'relayer busy, try again shortly' }
	}

	const cooldownUntil = walletCooldownUntil.get(key)
	if (cooldownUntil && cooldownUntil > now) {
		const retryAfterSec = Math.ceil((cooldownUntil - now) / 1000)
		return {
			ok: false,
			error: `wallet on cooldown, try again in ${retryAfterSec}s`,
		}
	}

	walletCooldownUntil.set(key, now + COOLDOWN_MS[kind])
	inFlightCount += 1

	let released = false
	return {
		ok: true,
		reservation: {
			release() {
				if (released) return
				released = true
				inFlightCount = Math.max(0, inFlightCount - 1)
			},
		},
	}
}
