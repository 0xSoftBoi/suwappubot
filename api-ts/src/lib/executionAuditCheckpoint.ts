import { createHash } from 'node:crypto'
import { canonicalAuditJson } from './routeDecisionAudit'
import { ExecutionLifecycleError } from './executionLifecycle'

export interface ExecutionAuditChainEntry {
	schemaVersion: 'execution-audit-chain/v1'
	sequence: number
	parentOrderId: string
	decisionDigest: string
	previousChainDigest: string | null
	chainDigest: string
}

export interface AuditCheckpointSigner {
	readonly keyId: string
	/** Sign raw UTF-8 bytes of the canonical checkpoint payload with a key outside the execution DB. */
	sign(payload: Uint8Array): Promise<string>
}

export interface SignedExecutionAuditCheckpoint {
	schemaVersion: 'execution-audit-checkpoint/v1'
	sequence: number
	chainDigest: string
	keyId: string
	signature: string
	signedAt: string
}

function sha256Utf8(value: string): string {
	return createHash('sha256').update(value, 'utf8').digest('hex')
}

/**
 * Builds a hash-chain entry over a deterministic decision digest. This detects
 * insertion/deletion/reordering once a later chain head is anchored elsewhere.
 * By itself it is NOT tamper evidence against a privileged DB writer, because
 * that writer could recompute the chain. Use createSignedAuditCheckpoint() and
 * persist/anchor the signed checkpoint outside the execution database.
 */
export function buildExecutionAuditChainEntry(input: {
	sequence: number
	parentOrderId: string
	decisionDigest: string
	previousChainDigest?: string | null
}): ExecutionAuditChainEntry {
	if (!Number.isInteger(input.sequence) || input.sequence < 0) {
		throw new ExecutionLifecycleError('Audit chain sequence must be a non-negative integer')
	}
	if (!input.parentOrderId.trim()) throw new ExecutionLifecycleError('parentOrderId is required')
	if (!/^[0-9a-f]{64}$/i.test(input.decisionDigest)) {
		throw new ExecutionLifecycleError('decisionDigest must be a SHA-256 hex digest')
	}
	const previousChainDigest = input.previousChainDigest?.trim() || null
	if (previousChainDigest !== null && !/^[0-9a-f]{64}$/i.test(previousChainDigest)) {
		throw new ExecutionLifecycleError('previousChainDigest must be a SHA-256 hex digest')
	}

	const payload = {
		schemaVersion: 'execution-audit-chain/v1' as const,
		sequence: input.sequence,
		parentOrderId: input.parentOrderId,
		decisionDigest: input.decisionDigest.toLowerCase(),
		previousChainDigest: previousChainDigest?.toLowerCase() ?? null,
	}
	return {
		...payload,
		chainDigest: sha256Utf8(canonicalAuditJson(payload)),
	}
}

/**
 * Sign a chain head using an injected key boundary (KMS/HSM/etc.). A signed
 * checkpoint should be copied to storage with independent retention/access
 * controls. Only that external signature/anchor upgrades a hash chain from an
 * integrity aid to meaningful tamper-evidence.
 */
export async function createSignedAuditCheckpoint(
	entry: ExecutionAuditChainEntry,
	signer: AuditCheckpointSigner,
	signedAt = new Date(),
): Promise<SignedExecutionAuditCheckpoint> {
	if (!signer.keyId.trim()) throw new ExecutionLifecycleError('Audit signer keyId is required')
	const payload = {
		schemaVersion: 'execution-audit-checkpoint/v1' as const,
		sequence: entry.sequence,
		chainDigest: entry.chainDigest,
		keyId: signer.keyId,
		signedAt: signedAt.toISOString(),
	}
	const bytes = new TextEncoder().encode(canonicalAuditJson(payload))
	const signature = await signer.sign(bytes)
	if (!signature.trim()) throw new ExecutionLifecycleError('Audit signer returned an empty signature')
	return { ...payload, signature }
}
