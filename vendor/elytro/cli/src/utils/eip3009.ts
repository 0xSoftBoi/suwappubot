import { randomBytes } from 'node:crypto';
import type { Address, Hex } from 'viem';
import { hashTypedData } from 'viem';

export interface TransferAuthorizationDomain {
  name: string;
  version: string;
  chainId: number;
  verifyingContract: Address;
}

export interface TransferAuthorizationMessage {
  from: Address;
  to: Address;
  value: bigint | string;
  validAfter: string;
  validBefore: string;
  nonce: Hex;
}

const TRANSFER_TYPES = {
  TransferWithAuthorization: [
    { name: 'from', type: 'address' },
    { name: 'to', type: 'address' },
    { name: 'value', type: 'uint256' },
    { name: 'validAfter', type: 'uint256' },
    { name: 'validBefore', type: 'uint256' },
    { name: 'nonce', type: 'bytes32' },
  ],
} as const;

export function randomAuthorizationNonce(): Hex {
  return `0x${randomBytes(32).toString('hex')}` as Hex;
}

export function hashTransferAuthorizationTypedData(
  domain: TransferAuthorizationDomain,
  message: TransferAuthorizationMessage
): Hex {
  return hashTypedData({
    domain,
    types: TRANSFER_TYPES,
    primaryType: 'TransferWithAuthorization',
    message,
  }) as Hex;
}
