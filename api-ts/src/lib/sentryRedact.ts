/**
 * Recursive redaction for Sentry payloads.
 *
 * This API touches wallets, swap execution, x402 billing, and JWTs. Any key
 * matching a sensitive pattern has its VALUE replaced with "[REDACTED]"
 * before the event ever leaves the process. Applied inside `beforeSend` so
 * a coding mistake elsewhere (e.g. an error object carrying a raw private
 * key) can never leak to Sentry's servers.
 */

const SENSITIVE_KEY_PATTERN =
	/(private[_-]?key|secret|mnemonic|seed|passphrase|password|credential|bearer|signature|keystore|xprv|wif|token|api[_-]?key|authorization|cookie|session|encrypted[_-]?key|kms|dek|jwt|x-api-key|dsn)/i

const MAX_DEPTH = 20

/**
 * Value-level patterns. Key matching cannot catch a secret interpolated into a
 * string — `new Error(\`sign failed for ${privKey}\`)` lands in
 * `event.exception.values[0].value` as plain text under a benign key.
 *
 * Ordered most-specific first. The URL rule keeps scheme+host so the error
 * stays diagnosable while dropping the credential, which for Alchemy/Helius
 * style endpoints sits in the URL *path*.
 */
const CREDENTIALED_URL =
	/(https?:\/\/[A-Za-z0-9.-]*\.?(?:alchemy\.com|helius[-.]?(?:rpc|xyz)?\.[a-z]+|infura\.io|quicknode\.(?:pro|com)|blastapi\.io|ankr\.com|chainstack\.com)[^\s"']*)/gi

// Exported so other secret-shaped-value screens (e.g. utils/captureRedaction.ts)
// can reuse the unambiguous patterns (JWT, AWS key) without duplicating them.
export const JWT_PATTERN = /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]+/g
export const AWS_ACCESS_KEY_PATTERN = /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g

const SECRET_VALUE_PATTERNS: RegExp[] = [
	// Telegram bot token
	/\b\d{8,10}:[A-Za-z0-9_-]{35}\b/g,
	// JWT / JWS compact serialization
	JWT_PATTERN,
	// AWS access key id
	AWS_ACCESS_KEY_PATTERN,
	// Long hex runs — EVM keys (64), ed25519 hex (128), any key-length blob.
	// Deliberately not anchored at exactly 64: a \b-anchored 64 pattern cannot
	// match inside a longer hex run, so 128-hex secrets would slip through.
	/\b(?:0x)?[a-fA-F0-9]{40,}\b/g,
	// Solana base58 secret keys (~87-88 chars); base58 excludes 0/O/I/l.
	/\b[1-9A-HJ-NP-Za-km-z]{80,90}\b/g,
]

// Bound the cost of scanning a pathological string (e.g. a multi-MB HTML error
// body captured as an exception value) on the request path.
const MAX_SCRUB_TEXT = 100_000

export function isSensitiveKey(key: string): boolean {
	return SENSITIVE_KEY_PATTERN.test(key)
}

/** Redact secret-shaped substrings inside free text. */
export function redactSecretsInText(text: string): string {
	if (text.length > MAX_SCRUB_TEXT) return '[REDACTED]'
	let out = text.replace(CREDENTIALED_URL, (url) => {
		const parts = url.split('/')
		// ['https:', '', 'host', ...rest]
		return parts.length >= 3 ? `${parts[0]}//${parts[2]}/[REDACTED]` : '[REDACTED]'
	})
	for (const pattern of SECRET_VALUE_PATTERNS) out = out.replace(pattern, '[REDACTED]')
	return out
}

/** Marker used when we refuse to emit a value we could not fully inspect. */
const TRUNCATED = '[REDACTED:depth]'

/**
 * Deep-clones `value`, replacing the VALUE of any object key that matches the
 * sensitive-key pattern with "[REDACTED]". Handles nested objects, arrays and
 * repeated/circular references.
 *
 * This is a security control, so every edge case FAILS CLOSED — when we cannot
 * fully inspect a subtree we drop it rather than pass it through:
 *
 *  - Past MAX_DEPTH we emit a marker instead of the raw value. Returning the
 *    value would let anything nested deeply enough bypass redaction entirely.
 *  - Repeated references return the *already redacted* clone from the cache,
 *    not the original. A WeakSet-style "seen" guard is wrong here: the same
 *    object appearing twice as a sibling is not a cycle, and returning the raw
 *    object on the second visit would leak it unredacted.
 *
 * Note: only plain objects and arrays are traversed. Map/Set contents are not
 * enumerable via Object.entries and collapse to `{}`, which is safe (drops
 * data) rather than leaky.
 */
export function redactSensitiveData<T>(
	value: T,
	depth = 0,
	cache = new WeakMap<object, unknown>(),
): T {
	// Scan primitives too — a secret pasted into a message string is invisible
	// to key matching, which is how the Python side was already catching them.
	if (typeof value === 'string') return redactSecretsInText(value) as unknown as T
	if (value === null || typeof value !== 'object') return value
	if (depth > MAX_DEPTH) return TRUNCATED as unknown as T

	const asObj = value as object
	const cached = cache.get(asObj)
	if (cached !== undefined) return cached as T

	if (Array.isArray(value)) {
		const arr: unknown[] = []
		cache.set(asObj, arr)
		for (const item of value) arr.push(redactSensitiveData(item, depth + 1, cache))
		return arr as unknown as T
	}

	const out: Record<string, unknown> = {}
	cache.set(asObj, out)
	for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
		if (isSensitiveKey(key)) {
			out[key] = '[REDACTED]'
		} else if (typeof val === 'string') {
			out[key] = redactSecretsInText(val)
		} else if (val !== null && typeof val === 'object') {
			out[key] = redactSensitiveData(val, depth + 1, cache)
		} else {
			out[key] = val
		}
	}
	return out as T
}
