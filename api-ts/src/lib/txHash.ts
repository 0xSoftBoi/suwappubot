/**
 * Canonical transaction-hash handling. [MONEY-PATH]
 *
 * Mirrors `bot/utils/tx_hash.py` -- keep the two behaviorally identical.
 *
 * Why this module exists
 * ----------------------
 * The Python bot's EVM executors persisted `HexBytes.hex()`, which from
 * hexbytes 1.x onward returns the digest WITHOUT the `0x` prefix. So
 * `swap_transactions.tx_hash` / `bridge_tx_hash` / `destination_tx_hash` hold
 * a MIX of bare and `0x`-prefixed 64-hex hashes, while hashes from provider
 * APIs and explorers are `0x`-prefixed.
 *
 * That mix breaks:
 *  1. Equality / dedupe checks: `stored === supplied` never matches across
 *     spellings, silently turning guards (including payment-replay guards)
 *     into no-ops.
 *  2. Raw JSON-RPC calls. Node tolerance is provider-dependent (verified live):
 *       ethereum-rpc.publicnode.com  bare -> accepted
 *       eth.drpc.org                 bare -> {"error":"json: cannot unmarshal
 *                                    hex string without 0x prefix ..."}
 *     Li.Fi `/v1/status` likewise says "Transaction hash is not found in any
 *     chain" for a bare hash.
 *
 * Canonical form: `0x` + 64 lowercase hex.
 *
 * Policy: normalize on WRITE, stay tolerant on READ. Existing rows are NOT
 * rewritten, so every read path that compares a hash must match against
 * `txHashVariants(...)` rather than `===` / `eq()`.
 *
 * Chain-awareness (critical): TRON txids are canonically BARE 64-hex (same
 * shape as a bare EVM hash, so shape alone cannot tell them apart) and Solana
 * signatures are base58 and case-sensitive. A blind "prepend 0x to any 64-hex
 * string" would corrupt TRON. Therefore `canonicalTxHash` only adds a missing
 * prefix when the chain is KNOWN to be hex-prefixed, and refuses to guess on a
 * bare hash when the chain is unknown. `rpcTxHash` is only for call sites that
 * are EVM-only by construction (e.g. an `eth_*` JSON-RPC param).
 */

const EVM_HASH_HEX_LEN = 64

// Starknet felts may be shorter than 64 hex chars: prefix-normalized, never length-checked.
const HEX_PREFIXED_CHAIN_TYPES = new Set(['evm', 'starknet'])
const PASSTHROUGH_CHAIN_TYPES = new Set(['solana', 'tron'])

/** Lowercase hex body with any `0x` stripped, or null when the value is not hex (e.g. base58). */
function hexBody(value: string): string | null {
	const body = /^0x/i.test(value) ? value.slice(2) : value
	if (!body || !/^[0-9a-fA-F]+$/.test(body)) return null
	return body.toLowerCase()
}

/** True when `value` has the SHAPE of an EVM tx hash. A bare TRON txid also matches. */
export function looksLikeEvmTxHash(value: unknown): boolean {
	if (typeof value !== 'string') return false
	const body = hexBody(value.trim())
	return body !== null && body.length === EVM_HASH_HEX_LEN
}

/**
 * Canonical spelling of a tx hash: `0x` + lowercase for hex-prefixed chains
 * (evm, starknet) or any already-`0x`-prefixed value; solana/tron pass through
 * (trimmed only). Bare hex on an unknown chain is returned unchanged (trimmed) --
 * we refuse to guess. Non-strings are returned as-is. Never throws.
 */
export function canonicalTxHash<T>(value: T, chainType?: string | null): T | string {
	if (typeof value !== 'string') return value
	const trimmed = value.trim()
	if (!trimmed) return value

	const type = chainType ? chainType.trim().toLowerCase() : null
	if (type && PASSTHROUGH_CHAIN_TYPES.has(type)) return trimmed

	const body = hexBody(trimmed)
	if (body === null) return trimmed // base58 / junk: leave alone

	if (/^0x/i.test(trimmed)) return `0x${body}` // already prefixed: only fold case
	if (type && HEX_PREFIXED_CHAIN_TYPES.has(type)) return `0x${body}`

	// Bare hex, unknown chain: EVM (needs 0x) or TRON (must not get one). Don't guess.
	return trimmed
}

/**
 * Spelling for an `eth_*` / `starknet_*` JSON-RPC param. ONLY for call sites
 * that are EVM/Starknet-only by construction: a bare hex value is then
 * unambiguously an EVM hash and strict nodes (drpc) reject it without `0x`.
 */
export function rpcTxHash<T>(value: T): T | string {
	if (typeof value !== 'string') return value
	const trimmed = value.trim()
	const body = hexBody(trimmed)
	if (body === null) return trimmed
	return `0x${body}`
}

/**
 * Every spelling `value` may have been persisted under: as given (trimmed),
 * plus for hex values the bare and `0x` lowercase forms. Use for ALL
 * comparisons against stored hashes (`inArray(col, txHashVariants(h))`).
 * Empty array for a non-string/empty input (an `inArray` on [] must be guarded).
 */
export function txHashVariants(value: unknown): string[] {
	if (typeof value !== 'string') return []
	const trimmed = value.trim()
	if (!trimmed) return []
	const variants = new Set<string>([trimmed])
	const body = hexBody(trimmed)
	if (body !== null) {
		variants.add(body)
		variants.add(`0x${body}`)
	}
	return [...variants]
}
