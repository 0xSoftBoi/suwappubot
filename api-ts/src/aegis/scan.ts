/**
 * AEGIS scan() -- the public entry point for the TS scanner port.
 *
 * Pure, synchronous, fast: no ML, no embeddings, no network. Combines the
 * regex pattern-matcher tier and the pure-string semantic-heuristic tier
 * into one verdict.
 *
 * Score fusion (mirrors the Python Scanner._compute_threat_score contract
 * described in docs/plans/aegis-fork-extend.md Phase 3 for this minimal
 * port): score = max(pattern match confidences, semantic aggregate score).
 * `isThreat` when score >= confidenceThreshold (default 0.8). The semantic
 * tier's own aggregate is separately capped at 0.5 when fewer than two of
 * its sub-modules fire (see semantic.ts) -- the "single-heuristic capped at
 * 0.5" behavior mirrored from aegis/scanner/semantic.py.
 */

import { loadSignatures } from './signatures'
import { scanPatterns } from './patternMatcher'
import { analyzeSemantics } from './semantic'
import { DEFAULT_CONFIDENCE_THRESHOLD, type ScanResult, type Signature } from './types'

export interface ScanOptions {
	/** is_threat when the fused score is >= this. Defaults to 0.8, mirroring aegis.yaml's scanner.confidence_threshold. */
	confidenceThreshold?: number
	/** Minimum per-match confidence to keep a pattern match. Defaults to 0.5, mirroring PatternMatcher's default sensitivity. */
	sensitivity?: number
	/** Override the signature set (mainly for tests). Defaults to the lazily-loaded, memoized bundled+crypto set. */
	signatures?: Signature[]
}

let cachedSignatures: Signature[] | null = null

/** Lazily load + memoize the default signature set (bundled + in-repo crypto pack). */
function getDefaultSignatures(): Signature[] {
	if (cachedSignatures === null) {
		try {
			cachedSignatures = loadSignatures()
		} catch (err) {
			console.warn('[aegis] loadSignatures() failed, scanning with zero signatures (fail-open)', err)
			cachedSignatures = []
		}
	}
	return cachedSignatures
}

/**
 * Scan a piece of untrusted text for prompt-injection / social-engineering /
 * chain-propagation threats. Pure and synchronous -- safe to call inline on
 * any request path. Never throws by construction (both sub-scanners are pure
 * regex/string logic with no I/O), but callers on a request path should
 * still wrap this in the fail-open middleware helper
 * (`../middleware/aegisScan.ts`) rather than assume that guarantee forever.
 */
export function scan(text: string, options: ScanOptions = {}): ScanResult {
	const {
		confidenceThreshold = DEFAULT_CONFIDENCE_THRESHOLD,
		sensitivity = 0.5,
		signatures = getDefaultSignatures(),
	} = options

	if (!text) {
		return { isThreat: false, score: 0, signatureIds: [], categories: [] }
	}

	const matches = scanPatterns(text, signatures, sensitivity)
	const semanticResult = analyzeSemantics(text)

	const patternMaxConfidence = matches.reduce((max, m) => Math.max(max, m.confidence), 0)
	const score = Math.max(patternMaxConfidence, semanticResult.aggregateScore)

	const categories = new Set<string>()
	for (const m of matches) categories.add(m.category)
	for (const f of semanticResult.findings) categories.add(f.module)

	return {
		isThreat: score >= confidenceThreshold,
		score: Math.round(score * 10000) / 10000,
		signatureIds: matches.map((m) => m.signatureId),
		categories: Array.from(categories).sort(),
	}
}

/** Reset the memoized signature cache. Test-only escape hatch. */
export function _resetSignatureCacheForTests(): void {
	cachedSignatures = null
}
