import { createHash } from 'node:crypto'
import type {
	ControlledRouteCandidate,
	InstitutionalRouteDecision,
	RouteEligibilityStatus,
	VenueStatus,
} from './routeFeasibility'
import type { RouteScoreComponents, SettlementType } from './routeDecision'

type CanonicalValue = null | boolean | number | string | CanonicalValue[] | { [key: string]: CanonicalValue }

export interface InstitutionalDecisionAuditMetadata {
	/** Version of the ranking/optimization implementation, independent of policy. */
	optimizerVersion: string
	/** Digest of the approved #939 policy bundle when one exists. */
	policyDigest?: string | null
	/** Deploy/build/git identifier used to reconstruct the executable code. */
	buildVersion?: string | null
}

interface CandidateAuditSnapshot {
	id: string
	rank: number
	fromChain: string
	toChain: string
	provider: string | null
	tool: string | null
	quotedToAmountUsd: number | null
	quotedGasUsd: number | null
	quotedFeeUsd: number | null
	quotedDurationS: number | null
	/** Exact settlement classification consumed by the feasibility/ranking decision. */
	settlementType: SettlementType
	complianceScore: number | null
	quoteTimestampMs: number | null
	expiresAtMs: number | null
	capacityUsd: number | null
	recoveryAvailable: boolean | null
	authorizationSatisfied: boolean | null
	venueStatus: VenueStatus | null
	eligibilityStatus: RouteEligibilityStatus | null
	dataConfidence: number | null
}

interface RankedAuditSnapshot {
	candidateId: string
	settlementType: SettlementType
	score: number
	components: RouteScoreComponents
	missingSignals: string[]
}

export interface InstitutionalDecisionAuditSnapshotV1 {
	schemaVersion: 'institutional-route-decision/v1'
	policyVersion: string
	policyDigest: string | null
	optimizerVersion: string
	buildVersion: string | null
	evaluatedAtMs: number
	candidates: CandidateAuditSnapshot[]
	winner: RankedAuditSnapshot | null
	alternatives: RankedAuditSnapshot[]
	rejected: Array<{
		candidateId: string
		settlementType: SettlementType
		reasonCodes: string[]
	}>
}

export interface InstitutionalDecisionAuditRecord {
	snapshot: InstitutionalDecisionAuditSnapshotV1
	/** Deterministic SHA-256 integrity fingerprint over canonical UTF-8 JSON. */
	digest: string
}

function nullable<T>(value: T | null | undefined): T | null {
	return value ?? null
}

function assertFinite(value: number | null, path: string): void {
	if (value !== null && !Number.isFinite(value)) {
		throw new Error(`Cannot audit non-finite number at ${path}`)
	}
}

function candidateSnapshot(
	candidate: ControlledRouteCandidate,
	resolvedSettlementType: SettlementType,
): CandidateAuditSnapshot {
	const snapshot: CandidateAuditSnapshot = {
		id: candidate.id,
		rank: candidate.rank,
		fromChain: candidate.fromChain,
		toChain: candidate.toChain,
		provider: nullable(candidate.provider),
		tool: nullable(candidate.tool),
		quotedToAmountUsd: nullable(candidate.quotedToAmountUsd),
		quotedGasUsd: nullable(candidate.quotedGasUsd),
		quotedFeeUsd: nullable(candidate.quotedFeeUsd),
		quotedDurationS: nullable(candidate.quotedDurationS),
		settlementType: resolvedSettlementType,
		complianceScore: nullable(candidate.complianceScore),
		quoteTimestampMs: nullable(candidate.quoteTimestampMs),
		expiresAtMs: nullable(candidate.expiresAtMs),
		capacityUsd: nullable(candidate.capacityUsd),
		recoveryAvailable: nullable(candidate.recoveryAvailable),
		authorizationSatisfied: nullable(candidate.authorizationSatisfied),
		venueStatus: nullable(candidate.venueStatus),
		eligibilityStatus: nullable(candidate.eligibilityStatus),
		dataConfidence: nullable(candidate.dataConfidence),
	}

	assertFinite(snapshot.rank, `candidate.${snapshot.id}.rank`)
	assertFinite(snapshot.quotedToAmountUsd, `candidate.${snapshot.id}.quotedToAmountUsd`)
	assertFinite(snapshot.quotedGasUsd, `candidate.${snapshot.id}.quotedGasUsd`)
	assertFinite(snapshot.quotedFeeUsd, `candidate.${snapshot.id}.quotedFeeUsd`)
	assertFinite(snapshot.quotedDurationS, `candidate.${snapshot.id}.quotedDurationS`)
	assertFinite(snapshot.complianceScore, `candidate.${snapshot.id}.complianceScore`)
	assertFinite(snapshot.quoteTimestampMs, `candidate.${snapshot.id}.quoteTimestampMs`)
	assertFinite(snapshot.expiresAtMs, `candidate.${snapshot.id}.expiresAtMs`)
	assertFinite(snapshot.capacityUsd, `candidate.${snapshot.id}.capacityUsd`)
	assertFinite(snapshot.dataConfidence, `candidate.${snapshot.id}.dataConfidence`)

	return snapshot
}

function rankedSnapshot(route: InstitutionalRouteDecision['winner']): RankedAuditSnapshot | null {
	if (!route) return null

	const snapshot: RankedAuditSnapshot = {
		candidateId: route.candidate.id,
		settlementType: route.settlementType,
		score: route.score,
		components: { ...route.components },
		missingSignals: [...route.missingSignals].sort(),
	}
	assertFinite(snapshot.score, `ranked.${snapshot.candidateId}.score`)
	for (const [name, value] of Object.entries(snapshot.components)) {
		assertFinite(value, `ranked.${snapshot.candidateId}.components.${name}`)
	}
	return snapshot
}

function toCanonicalValue(value: unknown, path = '$'): CanonicalValue {
	if (value === null) return null

	switch (typeof value) {
		case 'string':
		case 'boolean':
			return value
		case 'number':
			if (!Number.isFinite(value)) throw new Error(`Cannot canonicalize non-finite number at ${path}`)
			return value
		case 'undefined':
			throw new Error(`Cannot canonicalize undefined at ${path}`)
		case 'bigint':
		case 'function':
		case 'symbol':
			throw new Error(`Unsupported canonical value at ${path}`)
		case 'object': {
			if (Array.isArray(value)) {
				return value.map((item, index) => toCanonicalValue(item, `${path}[${index}]`))
			}

			const prototype = Object.getPrototypeOf(value)
			if (prototype !== Object.prototype && prototype !== null) {
				throw new Error(`Only plain objects can be canonicalized at ${path}`)
			}

			const result: { [key: string]: CanonicalValue } = {}
			for (const key of Object.keys(value as Record<string, unknown>).sort()) {
				const child = (value as Record<string, unknown>)[key]
				if (child === undefined) continue
				result[key] = toCanonicalValue(child, `${path}.${key}`)
			}
			return result
		}
	}

	throw new Error(`Unsupported canonical value at ${path}`)
}

function serializeCanonical(value: CanonicalValue): string {
	if (value === null || typeof value !== 'object') return JSON.stringify(value)
	if (Array.isArray(value)) return `[${value.map(serializeCanonical).join(',')}]`

	return `{${Object.keys(value)
		.sort()
		.map((key) => `${JSON.stringify(key)}:${serializeCanonical(value[key] as CanonicalValue)}`)
		.join(',')}}`
}

/**
 * Deterministic canonical JSON used for decision integrity fingerprints and
 * externally anchored audit-chain checkpoints. This function alone does NOT
 * provide tamper evidence: a privileged writer could alter data and recompute an
 * unanchored hash. See executionAuditCheckpoint.ts for chained/signable heads.
 *
 * The serializer is deliberately stricter than JSON.stringify: non-finite
 * numbers, class instances and unsupported values fail instead of being silently
 * coerced.
 */
export function canonicalAuditJson(value: unknown): string {
	return serializeCanonical(toCanonicalValue(value))
}

/**
 * Build the hashable, non-secret decision envelope that #941 persists.
 * Candidate input order does not affect the digest; candidate IDs must be unique.
 * The returned SHA-256 is an integrity fingerprint, NOT standalone tamper evidence.
 *
 * Settlement type is copied from the actual decision result, not recomputed
 * from provider/tool metadata. Historical replay therefore hashes the exact
 * classification used by feasibility/ranking even if classifier heuristics
 * change in a later build.
 */
export function buildInstitutionalDecisionAuditRecord(
	candidates: ControlledRouteCandidate[],
	decision: InstitutionalRouteDecision,
	metadata: InstitutionalDecisionAuditMetadata,
): InstitutionalDecisionAuditRecord {
	if (!metadata.optimizerVersion.trim()) throw new Error('optimizerVersion is required')
	if (!Number.isFinite(decision.evaluatedAtMs)) throw new Error('evaluatedAtMs must be finite')

	const winner = rankedSnapshot(decision.winner)
	const alternatives = decision.alternatives
		.map((route) => rankedSnapshot(route))
		.filter((route): route is RankedAuditSnapshot => route !== null)

	const resolvedSettlementByCandidateId = new Map<string, SettlementType>()
	if (winner) resolvedSettlementByCandidateId.set(winner.candidateId, winner.settlementType)
	for (const route of alternatives) {
		resolvedSettlementByCandidateId.set(route.candidateId, route.settlementType)
	}
	for (const row of decision.rejected) {
		resolvedSettlementByCandidateId.set(row.candidateId, row.settlementType)
	}

	const candidateIds = new Set<string>()
	const normalizedCandidates = candidates
		.map((candidate) => {
			if (candidateIds.has(candidate.id)) throw new Error(`Duplicate candidate id: ${candidate.id}`)
			candidateIds.add(candidate.id)
			const resolvedSettlementType = resolvedSettlementByCandidateId.get(candidate.id)
			if (!resolvedSettlementType) {
				throw new Error(`Decision is missing settlement classification for candidate id: ${candidate.id}`)
			}
			return candidateSnapshot(candidate, resolvedSettlementType)
		})
		.sort((a, b) => a.id.localeCompare(b.id))

	const referencedIds = [
		...(winner ? [winner.candidateId] : []),
		...alternatives.map((route) => route.candidateId),
		...decision.rejected.map((row) => row.candidateId),
	]
	for (const candidateId of referencedIds) {
		if (!candidateIds.has(candidateId)) {
			throw new Error(`Decision references unknown candidate id: ${candidateId}`)
		}
	}
	if (resolvedSettlementByCandidateId.size !== candidateIds.size) {
		throw new Error('Decision/candidate cardinality mismatch in audit snapshot')
	}

	const snapshot: InstitutionalDecisionAuditSnapshotV1 = {
		schemaVersion: 'institutional-route-decision/v1',
		policyVersion: decision.policyVersion,
		policyDigest: metadata.policyDigest ?? null,
		optimizerVersion: metadata.optimizerVersion,
		buildVersion: metadata.buildVersion ?? null,
		evaluatedAtMs: decision.evaluatedAtMs,
		candidates: normalizedCandidates,
		winner,
		alternatives,
		rejected: decision.rejected
			.map((row) => ({
				candidateId: row.candidateId,
				settlementType: row.settlementType,
				reasonCodes: [...row.reasonCodes].sort(),
			}))
			.sort((a, b) => a.candidateId.localeCompare(b.candidateId)),
	}

	const digest = createHash('sha256').update(canonicalAuditJson(snapshot), 'utf8').digest('hex')
	return { snapshot, digest }
}
