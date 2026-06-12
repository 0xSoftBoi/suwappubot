import {
  type Address,
  type Hex,
  encodeFunctionData,
  encodeAbiParameters,
  parseAbiParameters,
  zeroHash,
} from 'viem';
import { ABI_SocialRecoveryModule } from '@elytro/abi';
import { GUARDIAN_INFO_KEY } from '../../constants/recovery';

/**
 * ABI for InfoRecorder.recordData(bytes32 category, bytes data).
 * Matches extension's ABI_RECOVERY_INFO_RECORDER.
 */
const ABI_INFO_RECORDER = [
  {
    inputs: [
      { internalType: 'bytes32', name: 'category', type: 'bytes32' },
      { internalType: 'bytes', name: 'data', type: 'bytes' },
    ],
    name: 'recordData',
    outputs: [],
    stateMutability: 'nonpayable',
    type: 'function',
  },
] as const;

/**
 * Encode `setGuardian(bytes32 guardianHash)` calldata.
 *
 * Target: SocialRecoveryModule contract.
 * Used as an internal tx in a UserOp batch for guardian setup.
 */
export function encodeSetGuardian(
  guardianHash: string,
  recoveryModuleAddress: Address,
): { to: Address; value: string; data: Hex } {
  const callData = encodeFunctionData({
    abi: ABI_SocialRecoveryModule,
    functionName: 'setGuardian',
    args: [guardianHash],
  });

  return { to: recoveryModuleAddress, value: '0', data: callData };
}

/**
 * Encode `InfoRecorder.recordData(GUARDIAN_INFO_KEY, guardianData)` calldata.
 *
 * Target: InfoRecorder contract.
 * Writes plaintext guardian info as an event log for later retrieval.
 * The data is ABI-encoded as (address[], uint256, bytes32).
 *
 * Extension reference: sdk.ts#generateRecoveryInfoRecordTx
 */
export function encodeRecordGuardianInfo(
  contacts: Address[],
  threshold: number,
  salt: Hex = zeroHash,
  infoRecorderAddress: Address,
): { to: Address; value: string; data: Hex } {
  const guardianData = encodeAbiParameters(
    parseAbiParameters(['address[]', 'uint256', 'bytes32']),
    [contacts, BigInt(threshold), salt],
  );

  const callData = encodeFunctionData({
    abi: ABI_INFO_RECORDER,
    functionName: 'recordData',
    args: [GUARDIAN_INFO_KEY, guardianData],
  });

  return { to: infoRecorderAddress, value: '0', data: callData };
}
