/**
 * Regression test for zkPass TransGate proof verification.
 *
 * The fixture below is NOT invented — it is the exact taskId/schemaId/
 * signature values from zkPass's own published, passing unit test:
 * github.com/zkPassOfficial/zkpass-tutorial-examples,
 * contracts/test/ProofVerifier.js. That test calls the real
 * `ProofVerifier.sol` contract's `verify()` on-chain and asserts `true`.
 * Reproducing it here with `verifyZkPassProof` and asserting the same
 * addresses recover pins our implementation to zkPass's own ground truth,
 * not a guess — if this ever regresses, the hashing/encoding no longer
 * matches what zkPass's real validator nodes sign.
 */

import { describe, expect, it } from 'bun:test'
import { parseZkPassProofBody, verifyZkPassProof } from '../services/ZkPassService'

const REAL_ZKPASS_FIXTURE = {
	taskId: 'b16f527b8891454abe684c6a5f06dfb2',
	schemaId: 'c7eab8b7d7e44b05b41b613fe548edf5',
	uHash: '0xa3a5c8c3dd7dfe4abc91433fb9ad3de08344578713070983c905123b7ea91dda'.slice(0, 66),
	publicFieldsHash: '0xc89efdaa54c0f20c7adf612882df0950f5a951637e0307cdcb4c672f298b8bc6',
	recipient: '0xeCD12972E428a8256c9805b708E007882568d7D6',
	validatorAddress: '0xb1C4C1E1Cdd5Cf69E27A3A08C8f51145c2E12C6a',
	allocatorAddress: '0x19a567b3b212a5b35bA0E3B600FbEd5c2eE9083d',
	allocatorSignature:
		'0x8e789c4c4805d256ec9d332e734888d83dee9126030bd00a52a0d3342c3cc40613f88f8d3145360e5464b908fd82e94814a2f0549a459ac26489e76e1a89bd261b',
	validatorSignature:
		'0x5e47b2237c7208317f36a10039a37f637f33564138458770f87cd1880a45a2580052763accdd97f33a090523fd9220ed31f6ebabbfd51b263635e16fb0a0399a1b',
	publicFields: [],
}

describe('verifyZkPassProof', () => {
	it('accepts the real zkPass ProofVerifier.sol fixture (allocator + validator both recover correctly)', async () => {
		const outcome = await verifyZkPassProof(
			REAL_ZKPASS_FIXTURE,
			'0x19a567b3b212a5b35bA0E3B600FbEd5c2eE9083d',
		)
		expect(outcome.isValid).toBe(true)
	})

	it('fails closed when the allocator signature does not match', async () => {
		const tampered = { ...REAL_ZKPASS_FIXTURE, allocatorSignature: REAL_ZKPASS_FIXTURE.validatorSignature }
		const outcome = await verifyZkPassProof(tampered, REAL_ZKPASS_FIXTURE.allocatorAddress)
		expect(outcome.isValid).toBe(false)
	})

	it('fails closed when the validator signature does not match validatorAddress', async () => {
		const tampered = { ...REAL_ZKPASS_FIXTURE, validatorAddress: REAL_ZKPASS_FIXTURE.recipient }
		const outcome = await verifyZkPassProof(tampered, REAL_ZKPASS_FIXTURE.allocatorAddress)
		expect(outcome.isValid).toBe(false)
	})

	it('fails closed against the wrong configured allocator address', async () => {
		const outcome = await verifyZkPassProof(REAL_ZKPASS_FIXTURE, '0x000000000000000000000000000000000000dEaD')
		expect(outcome.isValid).toBe(false)
	})

	it('fails closed on a taskId/schemaId that overflows bytes32 (dash-formatted 36-char UUID)', async () => {
		const oversized = {
			...REAL_ZKPASS_FIXTURE,
			schemaId: '516a720e-29a4-4307-ae7b-5aec286e446e',
		}
		const outcome = await verifyZkPassProof(oversized, REAL_ZKPASS_FIXTURE.allocatorAddress)
		expect(outcome.isValid).toBe(false)
	})
})

describe('parseZkPassProofBody', () => {
	it('accepts a well-formed body', () => {
		const parsed = parseZkPassProofBody(REAL_ZKPASS_FIXTURE)
		expect(parsed).not.toBeNull()
		expect(parsed?.taskId).toBe(REAL_ZKPASS_FIXTURE.taskId)
		expect(Array.isArray(parsed?.publicFields)).toBe(true)
	})

	it('rejects a body missing schemaId', () => {
		const { schemaId: _schemaId, ...withoutSchema } = REAL_ZKPASS_FIXTURE
		expect(parseZkPassProofBody(withoutSchema)).toBeNull()
	})

	it('rejects publicFields shaped as an object instead of an array', () => {
		expect(parseZkPassProofBody({ ...REAL_ZKPASS_FIXTURE, publicFields: {} })).toBeNull()
	})

	it('rejects a non-object body', () => {
		expect(parseZkPassProofBody(null)).toBeNull()
		expect(parseZkPassProofBody('nope')).toBeNull()
	})
})
