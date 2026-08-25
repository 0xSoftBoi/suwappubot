import { keccak256, type Hex } from 'viem'
import { ExecutionLifecycleError } from './executionLifecycle'

export interface EvmSubmissionIdentity {
	externalTxHash: Hex
}

/**
 * Derive the canonical EVM transaction hash from fully signed serialized bytes.
 *
 * This is intentionally a PRE-broadcast operation. If the process times out or
 * crashes after sendRawTransaction, the system still has the exact chain
 * identity required to query RPC/indexers and reconcile the existing economic
 * instruction. Never accept unsigned transaction payloads here: their hash is
 * not the eventual transaction identity.
 */
export function deriveEvmSubmissionIdentity(serializedSignedTransaction: Hex): EvmSubmissionIdentity {
	if (!/^0x[0-9a-fA-F]+$/.test(serializedSignedTransaction) || serializedSignedTransaction.length <= 2) {
		throw new ExecutionLifecycleError('Signed EVM transaction bytes are required for submission identity')
	}
	return { externalTxHash: keccak256(serializedSignedTransaction) }
}
