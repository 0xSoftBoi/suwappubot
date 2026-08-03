/**
 * AEGIS scanner types — TypeScript port (subset) of the Python `aegis-shield`
 * package's scanner tier. See docs/plans/aegis-fork-extend.md Phase 3.
 *
 * NO ML, NO embeddings, NO network — regex signatures + pure-string semantic
 * heuristics only. Mirrors:
 *   - aegis/scanner/signatures/__init__.py  (Signature loading)
 *   - aegis/scanner/pattern_matcher.py      (regex matching)
 *   - aegis/scanner/semantic.py             (pure-string heuristic subset)
 */

/** A single compiled threat-detection signature. */
export interface Signature {
	id: string
	category: string
	/** Compiled with the `i` flag (case-insensitive), mirroring Python's `(?i)` prefix convention. */
	pattern: RegExp
	severity: number
	description: string
}

/** Raw (uncompiled) signature shape as read from YAML. */
export interface RawSignature {
	id: string
	category: string
	pattern: string
	severity: number
	description: string
}

/** A single regex signature match against scanned text. */
export interface ThreatMatch {
	signatureId: string
	category: string
	matchedText: string
	severity: number
	/** confidence === severity for a pattern match (see pattern_matcher.py comment). */
	confidence: number
}

/** A single semantic-heuristic finding (boundary_violations, etc.). */
export interface SemanticFinding {
	module: SemanticModuleName
	description: string
	severity: number
	evidence: string
}

export const SEMANTIC_MODULE_NAMES = [
	'boundary_violations',
	'conversation_injection',
	'privilege_escalation',
	'chain_propagation',
] as const

export type SemanticModuleName = (typeof SEMANTIC_MODULE_NAMES)[number]

export interface SemanticResult {
	findings: SemanticFinding[]
	/** Weighted combination of per-module max severities; capped at 0.5 when <2 modules fire. */
	aggregateScore: number
	perModuleScores: Partial<Record<SemanticModuleName, number>>
}

/** Final verdict returned by `scan()` — the public contract for callers. */
export interface ScanResult {
	isThreat: boolean
	score: number
	signatureIds: string[]
	categories: string[]
}

/** Default sensitivity/confidence-threshold — mirrors aegis.yaml's `scanner.confidence_threshold: 0.8`. */
export const DEFAULT_CONFIDENCE_THRESHOLD = 0.8
