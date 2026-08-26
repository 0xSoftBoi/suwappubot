/**
 * zkPass (zkpass.org) TransGate proof verification — native, standalone
 * feature. Stores the RESULT of a client-side zkPass TransGate proof after
 * verifying it server-side. Informational/profile-level only: this is
 * deliberately NOT wired to gate swap, withdrawal, fee, or subscription
 * logic (see task description — do not add such a dependency here).
 *
 * --- Verification (per zkPass docs) ---
 * 1. Allocator check: hash (taskId, schemaId, validatorAddress) via
 *    ABI-encode + keccak256, then EIP-191 personal-sign-recover
 *    `allocatorSignature` over that hash. Recovered address MUST equal the
 *    configured zkPass allocator address.
 * 2. Validator check: hash (taskId, schemaId, uHash, publicFieldsHash[,
 *    recipient]) the same way, then recover `validatorSignature`'s signer.
 *    Recovered address MUST equal `validatorAddress` from the proof itself.
 * Only if BOTH checks pass is the proof valid.
 *
 * AMBIGUITY WARNING: zkPass's own docs describe this in web3.js terms
 * without a full literal code example pinning down the exact ABI parameter
 * types. The types used below (`string` for taskId/schemaId, `address` for
 * validatorAddress/recipient) are a best-effort, natural reading of the
 * field types — NOT confirmed byte-for-byte against zkPass's own source or
 * SDK. This MUST be validated against a real TransGate test proof (from
 * zkpass.org's testnet/demo schema) before this is trusted for anything
 * beyond informational display.
 *
 * This function deliberately FAILS CLOSED: any exception, missing field, or
 * address mismatch results in `{ isValid: false }` rather than failing open.
 */
import {
	type Address,
	encodeAbiParameters,
	isAddress,
	keccak256,
	parseAbiParameters,
	recoverMessageAddress,
} from 'viem'
import { desc, eq } from 'drizzle-orm'
import type { DbClient } from '../db/client'
import { type NewZkpassVerification, zkpassVerifications } from '../db/schema/zkpass'

/** Fixed zkPass allocator address per zkPass docs. Env-overridable. */
export const DEFAULT_ZKPASS_ALLOCATOR_ADDRESS: Address =
	'0x19a567b3b212a5b35bA0E3B600FbEd5c2eE9083d'

export interface ZkPassProofResult {
	taskId: string
	schemaId: string
	uHash: string
	publicFieldsHash: string
	publicFields: Record<string, unknown>
	validatorAddress: string
	validatorSignature: string
	allocatorAddress: string
	allocatorSignature: string
	recipient?: string
}

export interface ZkPassVerifyOutcome {
	isValid: boolean
	reason?: string
}

/** Narrow + defensively validate an arbitrary body into a ZkPassProofResult. */
export function parseZkPassProofBody(body: unknown): ZkPassProofResult | null {
	if (!body || typeof body !== 'object') return null
	const b = body as Record<string, unknown>
	const requiredStrings = [
		'taskId',
		'schemaId',
		'uHash',
		'publicFieldsHash',
		'validatorAddress',
		'validatorSignature',
		'allocatorAddress',
		'allocatorSignature',
	] as const
	for (const key of requiredStrings) {
		if (typeof b[key] !== 'string' || (b[key] as string).length === 0) return null
	}
	if (b.publicFields !== undefined && typeof b.publicFields !== 'object') return null
	if (b.recipient !== undefined && typeof b.recipient !== 'string') return null

	return {
		taskId: b.taskId as string,
		schemaId: b.schemaId as string,
		uHash: b.uHash as string,
		publicFieldsHash: b.publicFieldsHash as string,
		publicFields: (b.publicFields as Record<string, unknown>) ?? {},
		validatorAddress: b.validatorAddress as string,
		validatorSignature: b.validatorSignature as string,
		allocatorAddress: b.allocatorAddress as string,
		allocatorSignature: b.allocatorSignature as string,
		recipient: b.recipient as string | undefined,
	}
}

/**
 * Verify a zkPass TransGate proof result server-side. Fails closed on any
 * exception, missing field, or address mismatch. See file header for the
 * ambiguity caveat on exact ABI types.
 */
export async function verifyZkPassProof(
	proof: ZkPassProofResult,
	allocatorAddress: string,
): Promise<ZkPassVerifyOutcome> {
	try {
		if (!isAddress(proof.validatorAddress)) {
			return { isValid: false, reason: 'validatorAddress is not a valid address' }
		}
		if (!isAddress(allocatorAddress)) {
			return { isValid: false, reason: 'configured allocatorAddress is not a valid address' }
		}
		if (proof.recipient && !isAddress(proof.recipient)) {
			return { isValid: false, reason: 'recipient is not a valid address' }
		}

		// --- Step 1: allocator check ---
		const allocatorParamsHash = keccak256(
			encodeAbiParameters(parseAbiParameters('string, string, address'), [
				proof.taskId,
				proof.schemaId,
				proof.validatorAddress as Address,
			]),
		)
		const recoveredAllocator = await recoverMessageAddress({
			message: { raw: allocatorParamsHash },
			signature: proof.allocatorSignature as `0x${string}`,
		})
		if (recoveredAllocator.toLowerCase() !== allocatorAddress.toLowerCase()) {
			return { isValid: false, reason: 'allocator signature does not match expected allocator address' }
		}

		// --- Step 2: validator check ---
		const validatorParamsHash = proof.recipient
			? keccak256(
					encodeAbiParameters(parseAbiParameters('string, string, string, string, address'), [
						proof.taskId,
						proof.schemaId,
						proof.uHash,
						proof.publicFieldsHash,
						proof.recipient as Address,
					]),
				)
			: keccak256(
					encodeAbiParameters(parseAbiParameters('string, string, string, string'), [
						proof.taskId,
						proof.schemaId,
						proof.uHash,
						proof.publicFieldsHash,
					]),
				)
		const recoveredValidator = await recoverMessageAddress({
			message: { raw: validatorParamsHash },
			signature: proof.validatorSignature as `0x${string}`,
		})
		if (recoveredValidator.toLowerCase() !== proof.validatorAddress.toLowerCase()) {
			return { isValid: false, reason: 'validator signature does not match proof validatorAddress' }
		}

		return { isValid: true }
	} catch (e) {
		// Fail closed: any exception (bad hex, malformed signature, etc.) means
		// the proof is treated as invalid, never valid.
		return { isValid: false, reason: `verification error: ${e instanceof Error ? e.message : String(e)}` }
	}
}

/**
 * Upsert-by-taskId: if a verification row for this taskId already exists,
 * return it unchanged (do not throw on the unique constraint — proof replay
 * against the SAME row is a no-op read, not an error). Otherwise insert a
 * new row for this user.
 */
export async function saveZkPassVerification(
	db: DbClient,
	userId: number,
	proof: ZkPassProofResult,
	isValid: boolean,
): Promise<import('../db/schema/zkpass').ZkpassVerification> {
	const existing = (
		await db
			.select()
			.from(zkpassVerifications)
			.where(eq(zkpassVerifications.taskId, proof.taskId))
			.limit(1)
	)[0]
	if (existing) return existing

	const row: NewZkpassVerification = {
		userId,
		schemaId: proof.schemaId,
		taskId: proof.taskId,
		uHash: proof.uHash,
		publicFieldsHash: proof.publicFieldsHash,
		publicFields: JSON.stringify(proof.publicFields ?? {}),
		validatorAddress: proof.validatorAddress,
		recipient: proof.recipient ?? null,
		isValid,
	}

	try {
		const inserted = (await db.insert(zkpassVerifications).values(row).returning())[0]
		if (inserted) return inserted
	} catch {
		// Race: another request inserted the same taskId first. Return that row.
	}
	const raced = (
		await db
			.select()
			.from(zkpassVerifications)
			.where(eq(zkpassVerifications.taskId, proof.taskId))
			.limit(1)
	)[0]
	if (raced) return raced
	throw new Error('Failed to save zkPass verification')
}

/** Most recent zkPass verification row for a user, or null if none. */
export async function getZkPassStatus(
	db: DbClient,
	userId: number,
): Promise<import('../db/schema/zkpass').ZkpassVerification | null> {
	const row = (
		await db
			.select()
			.from(zkpassVerifications)
			.where(eq(zkpassVerifications.userId, userId))
			.orderBy(desc(zkpassVerifications.verifiedAt))
			.limit(1)
	)[0]
	return row ?? null
}
