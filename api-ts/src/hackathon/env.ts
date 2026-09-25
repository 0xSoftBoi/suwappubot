/**
 * Feature flags for the ETHGlobal Tokyo 2026 trust-layer integration.
 *
 * Config source: the EnvService SCHEMA (src/config/EnvService.ts) — the
 * single source of truth for env validation and defaults. Because these
 * flags are read on the hot money path (plain async functions, not Effect
 * generators), they resolve from a process-wide snapshot rather than
 * spinning the Effect runtime per request: the values are fixed for the
 * life of the process, exactly like EnvServiceLive's own memoized decode.
 *
 * Seeding: src/index.ts seeds the snapshot from the already-decoded
 * EnvService value at boot, before the server accepts requests. The lazy
 * fallback below (decoding process.env through EnvSchema) only runs in
 * contexts that never boot the server — tests, scripts — and goes through
 * the same validation and defaults. Production request paths never read
 * process.env directly here.
 *
 * Everything is additive and OFF by default: with no env vars set, the
 * only runtime cost is a boolean check per call site. The master flag
 * HACKATHON_TRUST_LAYER gates the whole layer; per-sponsor flags default to
 * the master and can be toggled independently.
 *
 * Money-path note: these gates sit AFTER the institutional PolicyService and
 * can only ever escalate a verdict (allow → require_approval → block), never
 * downgrade it. See src/hackathon/gates.ts.
 */
import { Schema } from '@effect/schema'
import { EnvSchema, type Env } from '../config/EnvService'

/**
 * Process-wide snapshot of the validated env. Seeded at boot from the
 * decoded EnvService value (see src/index.ts); lazily decoded from
 * process.env through EnvSchema on first use only when never seeded
 * (tests / scripts that don't boot the server).
 */
let snapshot: Env | undefined

/** Seed the snapshot. Called once at boot from the EnvService value. */
export function initHackathonEnv(env: Env): void {
	snapshot = env
}

export function hackathonEnv(): Env {
	if (!snapshot) snapshot = Schema.decodeUnknownSync(EnvSchema)(process.env)
	return snapshot
}

const on = (v: string | undefined, def: boolean): boolean =>
	v === undefined ? def : v.toLowerCase() === 'true' || v === '1'

/** Master switch for the hackathon trust layer. Default off. */
export function trustLayerEnabled(env: Env = hackathonEnv()): boolean {
	return on(env.HACKATHON_TRUST_LAYER, false)
}

/** Intercepta counterparty / x402-payer screening. Defaults to the master flag. */
export function interceptaEnabled(env: Env = hackathonEnv()): boolean {
	if (!trustLayerEnabled(env)) return false
	return on(env.HACKATHON_INTERCEPTA, true)
}

/** ENSv2 onchain agent-policy caps. Defaults to the master flag. */
export function ensv2Enabled(env: Env = hackathonEnv()): boolean {
	if (!trustLayerEnabled(env)) return false
	return on(env.HACKATHON_ENSV2, true)
}

/** World ID demo routes (/hackathon/world-id/*). Defaults to the master flag. */
export function worldIdEnabled(env: Env = hackathonEnv()): boolean {
	if (!trustLayerEnabled(env)) return false
	return on(env.HACKATHON_WORLD_ID, true)
}

/**
 * Uniswap Trading API comparison quote in the SwapService route race.
 * Explicit opt-in ONLY (default off) — unlike the KyberSwap race, this is
 * hackathon code and must not change default quote-path behavior.
 * Also requires UNISWAP_API_KEY (checked at call time).
 */
export function uniswapComparisonEnabled(env: Env): boolean {
	return on(env.UNISWAP_COMPARISON_ENABLED, false)
}
