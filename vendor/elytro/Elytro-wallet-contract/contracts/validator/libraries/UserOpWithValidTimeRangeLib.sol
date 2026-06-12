// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {PackedUserOpWithValidTimeRange} from "../interfaces/PackedUserOpWithValidTimeRange.sol";

/**
 * Utility functions helpful when working with UserOperation structs.
 */
library UserOpWithValidTimeRangeLib {
    bytes32 internal constant PACKED_USEROP_TYPEHASH = keccak256(
        "PackedUserOperation(address sender,uint256 nonce,bytes initCode,bytes callData,bytes32 accountGasLimits,uint256 preVerificationGas,bytes32 gasFees,bytes paymasterAndData,uint48 validUntil,uint48 validAfter)"
    );

    /**
     * Pack the user operation data into bytes for hashing.
     * @param userOp - The user operation data.
     */
    function encode(PackedUserOpWithValidTimeRange memory userOp) internal pure returns (bytes memory ret) {
        address sender = userOp.sender;
        uint256 nonce = userOp.nonce;
        bytes32 hashInitCode = keccak256(userOp.initCode);
        bytes32 hashCallData = keccak256(userOp.callData);
        bytes32 accountGasLimits = userOp.accountGasLimits;
        uint256 preVerificationGas = userOp.preVerificationGas;
        bytes32 gasFees = userOp.gasFees;
        bytes32 hashPaymasterAndData = keccak256(userOp.paymasterAndData);
        uint48 validUntil = userOp.validUntil;
        uint48 validAfter = userOp.validAfter;

        return abi.encode(
            PACKED_USEROP_TYPEHASH,
            sender,
            nonce,
            hashInitCode,
            hashCallData,
            accountGasLimits,
            preVerificationGas,
            gasFees,
            hashPaymasterAndData,
            validUntil,
            validAfter
        );
    }

    /**
     * Hash the user operation data.
     * @param userOp - The user operation data.
     */
    function hash(PackedUserOpWithValidTimeRange memory userOp) internal pure returns (bytes32) {
        return keccak256(encode(userOp));
    }
}
