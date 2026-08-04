/**
 * Secret screening for free-text capture destined for the fine-tune dataset
 * (user_intents.raw_text). This is a SEPARATE control from Sentry's
 * `redactSecretsInText` (../lib/sentryRedact.ts) — Sentry redacts secrets
 * IN PLACE for diagnosability across arbitrary error payloads, so its hex
 * pattern deliberately catches anything >=40 hex chars (including plain
 * 20-byte EVM addresses, which are fine to log to Sentry as diagnostic
 * context). Capture is different: a wallet-address-containing trading
 * sentence ("swap to 0x1234...") is exactly the kind of normal input this
 * dataset needs, so a 40-char EVM address must NOT trip this screen. We
 * reuse Sentry's JWT / AWS-key patterns (unambiguous secret shapes) but keep
 * our own key-length-anchored (64 hex) and base58 (64-128) checks instead of
 * Sentry's broader >=40 hex rule.
 */
import { JWT_PATTERN, AWS_ACCESS_KEY_PATTERN } from '../lib/sentryRedact'

export interface SecretScreenResult {
	unsafe: boolean
	reason?: string
}

// BIP-39 wordlist is 2048 words; we don't ship the full list here (capture is
// a heuristic gate, not a wallet-import validator). Instead we detect the
// SHAPE of a mnemonic: N consecutive lowercase alphabetic words (each
// 3-8 chars, space separated) where N is a valid BIP-39 length. This is
// intentionally permissive — false positives just withhold text, which is
// the safe failure mode.
const MNEMONIC_LENGTHS = new Set([12, 15, 18, 21, 24])
const WORD_RE = /^[a-z]{3,8}$/

// Minimum length of a consecutive run of wordlike tokens that is treated as
// an embedded mnemonic even when it is NOT the entire message (e.g. "here is
// my seed phrase: <12 words>"). Ported from bot/utils/capture_redaction.py's
// `_MIN_CONSECUTIVE_WORDLIKE_TOKENS` fallback so the two stacks agree.
const MIN_CONSECUTIVE_WORDLIKE_TOKENS = 11

function looksLikeMnemonic(text: string): boolean {
	const words = text.trim().split(/\s+/).filter(Boolean)
	const lowered = words.map((w) => w.toLowerCase())

	// Whole-message exact-length mnemonic (all tokens wordlike).
	if (MNEMONIC_LENGTHS.has(lowered.length) && lowered.every((w) => WORD_RE.test(w))) {
		return true
	}

	// Consecutive-run fallback: catches a mnemonic embedded in a longer
	// sentence ("here is my seed phrase: <12 words>").
	let run = 0
	let best = 0
	for (const w of lowered) {
		if (WORD_RE.test(w)) {
			run += 1
			best = Math.max(best, run)
		} else {
			run = 0
		}
	}
	return best >= MIN_CONSECUTIVE_WORDLIKE_TOKENS
}

// Raw private key: optional 0x prefix + 64+ hex chars, not part of a longer
// run. Uses lookaround (not \b) so a 128-hex-char hex-encoded ed25519/Solana
// keypair — which \b cannot match mid-run of a longer hex string — is still
// caught. {64,} (not exactly 64) covers 64, 66 (0x+64), 128, and any longer
// hex secret. A 40-hex-char EVM/Tron address is well under the 64-char floor
// and stays unflagged.
const RAW_PRIVATE_KEY_RE = /(?<![0-9a-fA-F])(0x)?[0-9a-fA-F]{64,}(?![0-9a-fA-F])/

// Base58 secret-shaped run (Solana keypairs, WIF-adjacent blobs): 64-128 chars,
// base58 alphabet excludes 0/O/I/l.
const BASE58_SECRET_RE = /[1-9A-HJ-NP-Za-km-z]{64,128}/

function shannonEntropy(s: string): number {
	const counts = new Map<string, number>()
	for (const ch of s) counts.set(ch, (counts.get(ch) ?? 0) + 1)
	let entropy = 0
	for (const count of counts.values()) {
		const p = count / s.length
		entropy -= p * Math.log2(p)
	}
	return entropy
}

// Generic high-entropy token: a single contiguous non-whitespace run of
// >=32 chars with entropy > 3.5 bits/char (catches API keys, JWTs, base64
// secrets that don't match a more specific pattern above).
const TOKEN_RE = /\S{32,}/g

// Pure hex runs (with optional 0x prefix) are handled exclusively by
// RAW_PRIVATE_KEY_RE above (anchored at 64+ chars). A random hex
// string inherently carries ~4 bits/char of entropy, so without this
// exclusion any ordinary EVM address, tx hash, or hex id longer than 32
// chars would trip the generic entropy net as a false positive. Only
// non-hex tokens (base64, mixed-case alphanumeric secrets, etc.) fall
// through to the entropy check.
const HEX_TOKEN_RE = /^(0x)?[0-9a-fA-F]+$/

function hasHighEntropyToken(text: string): boolean {
	const matches = text.match(TOKEN_RE)
	if (!matches) return false
	return matches.some((tok) => !HEX_TOKEN_RE.test(tok) && shannonEntropy(tok) > 3.5)
}

/**
 * Screen free text before it is persisted to the append-only capture tables.
 * Fails closed: on any internal error, treat the text as unsafe.
 */
export function screenForSecrets(text: string): SecretScreenResult {
	try {
		if (!text) return { unsafe: false }

		if (looksLikeMnemonic(text)) {
			return { unsafe: true, reason: 'secret_detected' }
		}

		if (RAW_PRIVATE_KEY_RE.test(text)) {
			return { unsafe: true, reason: 'secret_detected' }
		}

		if (BASE58_SECRET_RE.test(text)) {
			return { unsafe: true, reason: 'secret_detected' }
		}

		// Reuse Sentry's unambiguous secret-value patterns (JWTs, AWS keys). Both
		// are exported with the 'g' flag for Sentry's .replace() use, so build a
		// fresh non-global RegExp per check here — reusing a global regex's
		// .test() across calls would carry stateful lastIndex bugs.
		if (new RegExp(JWT_PATTERN.source).test(text)) {
			return { unsafe: true, reason: 'secret_detected' }
		}
		if (new RegExp(AWS_ACCESS_KEY_PATTERN.source).test(text)) {
			return { unsafe: true, reason: 'secret_detected' }
		}

		if (hasHighEntropyToken(text)) {
			return { unsafe: true, reason: 'secret_detected' }
		}

		return { unsafe: false }
	} catch {
		// Fail closed: an unexpected error while screening must never result in
		// storing unscreened text.
		return { unsafe: true, reason: 'secret_detected' }
	}
}
