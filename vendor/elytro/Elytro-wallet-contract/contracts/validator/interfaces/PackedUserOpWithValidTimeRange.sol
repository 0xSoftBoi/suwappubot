// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;
/**
 * @dev PackedUserOperation with validatorData field for typed data signing
 */

struct PackedUserOpWithValidTimeRange {
    address sender;
    uint256 nonce;
    bytes initCode;
    bytes callData;
    bytes32 accountGasLimits;
    uint256 preVerificationGas;
    bytes32 gasFees;
    bytes paymasterAndData;
    uint48 validUntil;
    uint48 validAfter;
}
