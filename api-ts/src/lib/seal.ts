/**
 * Commit–reveal sealing for autonomous trading decisions.
 *
 * The autopilot publishes a *commitment* to its thesis BEFORE it executes, and
 * reveals the plaintext thesis afterwards. Anyone can recompute the hash from
 * the revealed thesis and check it against the commitment that was published
 * (and optionally anchored on-chain) ahead of the trade. That makes "the agent
 * said this before it traded" verifiable instead of a claim.
 *
 * Canonicalisation is deterministic (RFC 8785-style key ordering) so the same
 * thesis always hashes identically regardless of property insertion order.
 *
 * STRING ENCODING IS PART OF THE SPEC. Strings are serialised exactly as
 * ECMAScript `JSON.stringify` does: raw UTF-8, with only the escapes JSON
 * requires. Non-ASCII characters are NOT \uXXXX-escaped. This matters because
 * several languages escape by default and would compute a different digest from
 * identical data — Python's `json.dumps` needs `ensure_ascii=False`, and Go's
 * `encoding/json` needs an Encoder with `SetEscapeHTML(false)`. A thesis
 * containing an em dash is enough to diverge, which looks to a third-party
 * verifier exactly like a forged commitment.
 */
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'

export const SEAL_ALGO = 'sha256-canonical-v1' as const

export type JsonValue = string | number | boolean | null | JsonValue[] | { [k: string]: JsonValue }

/**
 * Deterministic JSON: object keys sorted lexicographically, no insignificant
 * whitespace, `undefined` object properties dropped, non-finite numbers
 * rejected (they would serialise as `null` and silently change the digest).
 */
export function canonicalize(value: unknown): string {
	if (value === null) return 'null'

	const t = typeof value
	if (t === 'string') return JSON.stringify(value)
	if (t === 'boolean') return value ? 'true' : 'false'
	if (t === 'number') {
		if (!Number.isFinite(value as number)) {
			throw new Error('canonicalize: non-finite number cannot be sealed')
		}
		return JSON.stringify(value)
	}
	if (t === 'bigint') return JSON.stringify((value as bigint).toString())
	if (t === 'undefined' || t === 'function' || t === 'symbol') {
		throw new Error(`canonicalize: unsupported value of type ${t}`)
	}

	if (Array.isArray(value)) {
		return `[${value.map((v) => canonicalize(v === undefined ? null : v)).join(',')}]`
	}

	const obj = value as Record<string, unknown>
	const parts: string[] = []
	for (const key of Object.keys(obj).sort()) {
		const v = obj[key]
		if (v === undefined) continue
		parts.push(`${JSON.stringify(key)}:${canonicalize(v)}`)
	}
	return `{${parts.join(',')}}`
}

/** 32 bytes of hex — the blinding factor that keeps a commitment opaque. */
export function generateNonce(): string {
	return randomBytes(32).toString('hex')
}

/**
 * commitment = sha256("<algo>|<nonce>|<canonical thesis>")
 *
 * The algo tag is inside the pre-image so a future scheme change can never
 * produce a colliding commitment for an old thesis.
 */
export function computeCommitment(thesis: unknown, nonce: string): string {
	if (!nonce) throw new Error('computeCommitment: nonce is required')
	const preimage = `${SEAL_ALGO}|${nonce}|${canonicalize(thesis)}`
	return createHash('sha256').update(preimage, 'utf8').digest('hex')
}

export interface Seal {
	readonly algo: typeof SEAL_ALGO
	readonly commitment: string
	readonly nonce: string
	/** Canonical thesis bytes that were hashed — kept for the reveal payload. */
	readonly payload: string
}

/** Seal a thesis: returns the commitment to publish now and the nonce to reveal later. */
export function seal(thesis: unknown, nonce: string = generateNonce()): Seal {
	return {
		algo: SEAL_ALGO,
		commitment: computeCommitment(thesis, nonce),
		nonce,
		payload: canonicalize(thesis),
	}
}

/** Constant-time commitment check. Returns false on any malformed input. */
export function verifySeal(thesis: unknown, nonce: string, commitment: string): boolean {
	if (typeof nonce !== 'string' || typeof commitment !== 'string') return false
	if (!/^[0-9a-f]{64}$/i.test(commitment)) return false
	let recomputed: string
	try {
		recomputed = computeCommitment(thesis, nonce)
	} catch {
		return false
	}
	const a = Buffer.from(recomputed, 'hex')
	const b = Buffer.from(commitment.toLowerCase(), 'hex')
	if (a.length !== b.length) return false
	return timingSafeEqual(a, b)
}

/**
 * The memo we anchor on-chain (Solana Memo program / EVM calldata) at seal time.
 * Deliberately tiny and self-describing so a third party can parse it without
 * our API: `suwappu-autopilot:v1:<algo>:<commitment>`.
 */
export function sealMemo(commitment: string): string {
	return `suwappu-autopilot:v1:${SEAL_ALGO}:${commitment}`
}

export function parseSealMemo(memo: string): { algo: string; commitment: string } | null {
	const m = /^suwappu-autopilot:v1:([a-z0-9-]+):([0-9a-f]{64})$/i.exec(memo.trim())
	if (!m || !m[1] || !m[2]) return null
	return { algo: m[1], commitment: m[2].toLowerCase() }
}
