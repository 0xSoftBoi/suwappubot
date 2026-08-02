/**
 * AEGIS pattern-based threat matching -- TS port of aegis/scanner/pattern_matcher.py.
 * Pure, synchronous, regex-only (no YARA/ML fallback tiers from the Python side --
 * those aren't in scope for the minimal TS port).
 */

import type { Signature, ThreatMatch } from './types'

// Built via String.fromCharCode (not literal characters or \u escapes in the
// source) so these invisible/zero-width code points stay unambiguous and
// reviewable as plain ASCII in the diff, instead of sitting as raw bytes.
const NBSP_CHAR = String.fromCharCode(0x00a0)
const SOFT_HYPHEN_CHAR = String.fromCharCode(0x00ad)
const VARIATION_SELECTOR_START = String.fromCharCode(0xfe00)
const VARIATION_SELECTOR_END = String.fromCharCode(0xfe0f)

const NBSP_RE = new RegExp(NBSP_CHAR, 'g')
const SOFT_HYPHEN_RE = new RegExp(SOFT_HYPHEN_CHAR, 'g')
const VARIATION_SELECTORS_RE = new RegExp(
	`[${VARIATION_SELECTOR_START}-${VARIATION_SELECTOR_END}]`,
	'g',
)

/**
 * Unicode-normalize text the same way the Python scanner does before matching,
 * to prevent trivial evasion via confusable characters:
 *   - NFC normalization
 *   - NBSP (U+00A0) -> regular space
 *   - soft hyphen (U+00AD) -> removed
 *   - variation selectors (U+FE00-U+FE0F) -> removed
 */
export function normalizeForScan(text: string): string {
	let normalized = text.normalize('NFC')
	normalized = normalized.replace(NBSP_RE, ' ')
	normalized = normalized.replace(SOFT_HYPHEN_RE, '')
	normalized = normalized.replace(VARIATION_SELECTORS_RE, '')
	return normalized
}

const MATCHED_TEXT_MAX_LEN = 200

/**
 * Scan (already-normalized or raw) text against every compiled signature.
 * A match's confidence equals its severity -- mirrors the Python comment:
 * "a match is a match regardless of surrounding text length (prevents
 * dilution via padding attacks)".
 *
 * @param sensitivity Minimum confidence to keep a match (default 0.5, mirrors PatternMatcher's default).
 */
export function scanPatterns(
	text: string,
	signatures: Signature[],
	sensitivity = 0.5,
	preNormalized = false,
): ThreatMatch[] {
	const clampedSensitivity = Math.max(0, Math.min(1, sensitivity))
	const normalized = preNormalized ? text : normalizeForScan(text)
	const matches: ThreatMatch[] = []

	for (const sig of signatures) {
		// Reset lastIndex defensively in case a signature pattern was ever
		// compiled with a global flag elsewhere (compileSignature never sets
		// one, but this keeps `.exec`'s single-match semantics correct if
		// that assumption changes).
		sig.pattern.lastIndex = 0
		const match = sig.pattern.exec(normalized)
		if (match === null) continue

		const confidence = sig.severity
		if (confidence < clampedSensitivity) continue

		matches.push({
			signatureId: sig.id,
			category: sig.category,
			matchedText: match[0].slice(0, MATCHED_TEXT_MAX_LEN),
			severity: sig.severity,
			confidence: Math.round(confidence * 10000) / 10000,
		})
	}

	return matches
}
