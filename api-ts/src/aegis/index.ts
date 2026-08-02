/**
 * AEGIS TS scanner -- minimal port of the Python `aegis-shield` regex + pure
 * semantic-heuristic tiers, for the api-ts agent-facing surfaces (REST
 * /execute, A2A message/send, MCP tools/call). See
 * docs/plans/aegis-fork-extend.md Phase 3.
 *
 * Lives at api-ts/src/aegis/ rather than packages/aegis-ts/ -- see the
 * package-location note in that plan doc / the implementer's report for why
 * (no workspace linkage exists yet between api-ts and packages/*).
 */

export { scan, _resetSignatureCacheForTests, type ScanOptions } from './scan'
export { loadSignatures, type LoadSignaturesOptions } from './signatures'
export { scanPatterns, normalizeForScan } from './patternMatcher'
export { analyzeSemantics } from './semantic'
export type {
	Signature,
	RawSignature,
	ThreatMatch,
	SemanticFinding,
	SemanticModuleName,
	SemanticResult,
	ScanResult,
} from './types'
export { DEFAULT_CONFIDENCE_THRESHOLD, SEMANTIC_MODULE_NAMES } from './types'
