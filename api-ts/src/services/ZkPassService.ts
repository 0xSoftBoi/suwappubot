/**
 * zkPass (zkpass.org) TransGate proof verification — native, standalone
 * feature. Stores the RESULT of a client-side zkPass TransGate proof after
 * verifying it server-side. Informational/profile-level only: this is
 * deliberately NOT wired to gate swap, withdrawal, fee, or subscription
 * logic (see task description — do not add such a dependency here).
 *
 * --- Verification: VERIFIED against zkPass's own primary sources, not the
 * (lossy, paraphrased) hosted docs. Ground truth used:
 *   - github.com/zkPassOfficial/Transgate-JS-SDK, lib/types.d.ts and
 *     lib/index.js (`checkTaskInfoForEVM` / `verifyEVMMessageSignature`) —
 *     the shipped SDK's own client-side reference checks.
 *   - github.com/zkPassOfficial/zkpass-tutorial-examples,
 *     contracts/contracts/ProofVerifier.sol + Common.sol (the `Proof`
 *     struct field order) and contracts/test/ProofVerifier.js — a REAL,
 *     PASSING unit test with a real taskId/schemaId/signature fixture.
 *   - Reproduced that exact fixture locally with viem (see PR description /
 *     commit message): both `allocatorSignature` and `validatorSignature`
 *     recover to the exact expected addresses. This is not a best-effort
 *     reading of a doc summary — it is a byte-for-byte confirmed match
 *     against zkPass's own shipped, tested reference implementation.
 *
 * 1. Allocator check: encode (taskId as bytes32, schemaId as bytes32,
 *    validatorAddress as address) via standard ABI encoding (`abi.encode`,
 *    i.e. NOT packed), keccak256 it, then EIP-191 personal-sign-recover
 *    `allocatorSignature` over that 32-byte hash. Recovered address MUST
 *    equal the fixed zkPass allocator address.
 * 2. Validator check: same ABI-encode + keccak256 + EIP-191-recover over
 *    (taskId, schemaId, uHash, publicFieldsHash, recipient) — ALWAYS five
 *    fields in that exact order (per the `ProofVerifier.sol` Solidity
 *    struct/function signature); `recipient` is the zero address when the
 *    client didn't bind a wallet address into the proof (Solidity's
 *    `address` type has no "absent" state — it defaults to zero). Recovered
 *    address MUST equal `validatorAddress` from the proof itself.
 * Only if BOTH checks pass is the proof valid.
 *
 * taskId/schemaId encoding: zkPass's real schema/task IDs are 32-character,
 * no-dash hex-look-alike strings (e.g. "c7eab8b7d7e44b05b41b613fe548edf5"),
 * NOT the dash-formatted 36-char UUIDs shown as illustrative examples in
 * some docs pages — encoding a 36-char UUID as bytes32 overflows and
 * throws (confirmed by executing the real `web3.eth.abi.encodeParameters`
 * call against the actual pinned `web3` dependency). We hex-encode the raw
 * UTF-8 bytes and require the result to fit exactly in 32 bytes; anything
 * that doesn't fit throws and is caught by the fail-closed wrapper below.
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
	stringToHex,
	zeroAddress,
} from 'viem'
import { desc, eq } from 'drizzle-orm'
import type { DbClient } from '../db/client'
import { type NewZkpassVerification, zkpassVerifications } from '../db/schema/zkpass'

/** Fixed zkPass allocator address (Transgate-JS-SDK `constants.ts`: EVMTaskAllocator). Env-overridable. */
export const DEFAULT_ZKPASS_ALLOCATOR_ADDRESS: Address =
	'0x19a567b3b212a5b35bA0E3B600FbEd5c2eE9083d'

export interface ZkPassProofResult {
	taskId: string
	// Not part of the SDK's `launch()` return value (confirmed via
	// Transgate-JS-SDK's `Result` type) — the caller must supply the
	// schemaId it used to call `launch(schemaId, ...)` alongside the result.
	schemaId: string
	uHash: string
	publicFieldsHash: string
	// Confirmed array, not object, per Transgate-JS-SDK `Result.publicFields: any[]`.
	publicFields: unknown[]
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
	if (b.publicFields !== undefined && !Array.isArray(b.publicFields)) return null
	if (b.recipient !== undefined && typeof b.recipient !== 'string') return null

	return {
		taskId: b.taskId as string,
		schemaId: b.schemaId as string,
		uHash: b.uHash as string,
		publicFieldsHash: b.publicFieldsHash as string,
		publicFields: (b.publicFields as unknown[]) ?? [],
		validatorAddress: b.validatorAddress as string,
		validatorSignature: b.validatorSignature as string,
		allocatorAddress: b.allocatorAddress as string,
		allocatorSignature: b.allocatorSignature as string,
		recipient: b.recipient as string | undefined,
	}
}

/**
 * Hex-encode a zkPass taskId/schemaId string as a bytes32 ABI value.
 * Real IDs are exactly 32 UTF-8 bytes (see file header) — anything else
 * throws, which the caller treats as a fail-closed invalid proof rather
 * than silently truncating or padding to a different value than whatever
 * the validator actually signed.
 */
function idToBytes32(value: string): `0x${string}` {
	return stringToHex(value, { size: 32 })
}

/**
 * Verify a zkPass TransGate proof result server-side. Fails closed on any
 * exception, missing field, or address mismatch. See file header for the
 * verified source of the hashing/encoding algorithm.
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
		if (!/^0x[0-9a-fA-F]{64}$/.test(proof.uHash)) {
			return { isValid: false, reason: 'uHash is not a 32-byte hex value' }
		}
		if (!/^0x[0-9a-fA-F]{64}$/.test(proof.publicFieldsHash)) {
			return { isValid: false, reason: 'publicFieldsHash is not a 32-byte hex value' }
		}

		const taskIdHex = idToBytes32(proof.taskId)
		const schemaIdHex = idToBytes32(proof.schemaId)
		// Solidity's `address recipient` field has no "absent" state — it
		// defaults to the zero address when the client didn't bind a wallet
		// address into the proof. Matches Common.sol's `Proof` struct.
		const recipient = (proof.recipient as Address | undefined) ?? zeroAddress

		// --- Step 1: allocator check --- (taskId, schemaId, validatorAddress)
		const allocatorParamsHash = keccak256(
			encodeAbiParameters(parseAbiParameters('bytes32, bytes32, address'), [
				taskIdHex,
				schemaIdHex,
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

		// --- Step 2: validator check --- (taskId, schemaId, uHash, publicFieldsHash, recipient)
		const validatorParamsHash = keccak256(
			encodeAbiParameters(parseAbiParameters('bytes32, bytes32, bytes32, bytes32, address'), [
				taskIdHex,
				schemaIdHex,
				proof.uHash as `0x${string}`,
				proof.publicFieldsHash as `0x${string}`,
				recipient,
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
		publicFields: JSON.stringify(proof.publicFields ?? []),
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
