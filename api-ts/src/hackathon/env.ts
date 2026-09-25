/**
 * Feature flags for the ETHGlobal Tokyo 2026 trust-layer integration.
 *
 * Config source: the EnvService SCHEMA (src/config/EnvService.ts) — the
 * single source of truth for env validation and defaults. Because these
 * flags are read on the hot money path (plain async functions, not Effect
 * generators), they resolve from a lazily-decoded process-wide snapshot
 * rather than spinning the Effect runtime per request: the values are
 * fixed for the life of the process, exactly like EnvServiceLive's own
 * memoized decode. No raw process.env reads anywhere here.
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
 * Lazily-decoded, process-wide snapshot of the validated env. Decoded once
 * (first flag read) through EnvSchema — same validation and defaults the
 * boot path gets from EnvServiceLive.
 */
let snapshot: Env | undefined
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
