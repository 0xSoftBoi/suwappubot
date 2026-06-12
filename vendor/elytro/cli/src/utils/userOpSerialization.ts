import { toHex } from 'viem';
import type { ElytroUserOperation } from '../types';

/**
 * Serialize UserOp for JSON storage (e.g. pending OTP state).
 */
export function serializeUserOpForPending(op: ElytroUserOperation): Record<string, string | null> {
  return {
    sender: op.sender,
    nonce: toHex(op.nonce),
    factory: op.factory,
    factoryData: op.factoryData,
    callData: op.callData,
    callGasLimit: toHex(op.callGasLimit),
    verificationGasLimit: toHex(op.verificationGasLimit),
    preVerificationGas: toHex(op.preVerificationGas),
    maxFeePerGas: toHex(op.maxFeePerGas),
    maxPriorityFeePerGas: toHex(op.maxPriorityFeePerGas),
    paymaster: op.paymaster,
    paymasterVerificationGasLimit: op.paymasterVerificationGasLimit ? toHex(op.paymasterVerificationGasLimit) : null,
    paymasterPostOpGasLimit: op.paymasterPostOpGasLimit ? toHex(op.paymasterPostOpGasLimit) : null,
    paymasterData: op.paymasterData,
    signature: op.signature,
  };
}
