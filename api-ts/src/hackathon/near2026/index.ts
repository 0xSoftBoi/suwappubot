/**
 * Suwappu Arbiter (NEAR HACKATHON 2026) — attested milestone escrow.
 *
 * Status: demo wiring for NEAR testnet. Everything is honest about its state:
 *  - fixture replays are exactly the recorded arbiter-wasm runs checked into the repo
 *  - live testnet path requires NEAR_ARBITER_CONTRACT + NEAR_ARBITER_WASM_URL/HASH in env
 *  - no mainnet funds, no production payment paths; mounted only when HACKATHON_ARBITER=true
 *
 * @see docs/arbiter-attestation-v1.md
 */
import { hackathonEnv } from '../env'

export const ARBITER_VERSION = '0.1.0'

export interface ArbiterStatus {
	version: string
	fmt: 'suwappu.arbiter/v1'
	live: boolean
	fixtureReplay: boolean
	contract: string | null
	wasmUrl: string | null
	wasmHash: string | null
}

/** Report what the mounted surface can actually do. Never throws. */
export function arbiterStatus(): ArbiterStatus {
	const env = hackathonEnv()
	const contract = env.NEAR_ARBITER_CONTRACT ?? ''
	const wasmUrl = env.NEAR_ARBITER_WASM_URL ?? ''
	const wasmHash = env.NEAR_ARBITER_WASM_HASH ?? ''
	const live = Boolean(contract && wasmUrl && wasmHash)
	return {
		version: ARBITER_VERSION,
		fmt: 'suwappu.arbiter/v1',
		live,
		fixtureReplay: true,
		contract: contract || null,
		wasmUrl: wasmUrl || null,
		wasmHash: wasmHash || null,
	}
}
