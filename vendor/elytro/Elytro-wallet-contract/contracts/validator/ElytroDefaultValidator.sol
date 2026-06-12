// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IValidator} from "@elytro-wallet-core/contracts/interface/IValidator.sol";
import {PackedUserOpWithValidTimeRange} from "./interfaces/PackedUserOpWithValidTimeRange.sol";
import {IOwnable} from "@elytro-wallet-core/contracts/interface/IOwnable.sol";
import {PackedUserOperation} from "@account-abstraction/contracts/interfaces/PackedUserOperation.sol";
import "@account-abstraction/contracts/core/Helpers.sol";
import "./libraries/ValidatorSigDecoder.sol";
import "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {MessageHashUtils} from "@openzeppelin/contracts/utils/cryptography/MessageHashUtils.sol";
import {Errors} from "../libraries/Errors.sol";
import {TypeConversion} from "../libraries/TypeConversion.sol";
import {WebAuthn} from "../libraries/WebAuthn.sol";
import {IEntryPoint_v08} from "./interfaces/IEntryPoint_v08.sol";
import {UserOpWithValidTimeRangeLib} from "./libraries/UserOpWithValidTimeRangeLib.sol";

/**
 * @title ElytroDefaultValidator
 * @dev A contract that implements the IValidator interface for validating user operations and signatures.
 */
contract ElytroDefaultValidator is IValidator {
    using MessageHashUtils for bytes32;
    using TypeConversion for address;
    using UserOpWithValidTimeRangeLib for PackedUserOpWithValidTimeRange;

    // Magic value indicating a valid signature for ERC-1271 contracts
    // bytes4(keccak256("isValidSignature(bytes32,bytes)")
    bytes4 internal constant MAGICVALUE = 0x1626ba7e;
    // Constants indicating different invalid states
    bytes4 internal constant INVALID_ID = 0xffffffff;
    bytes4 internal constant INVALID_TIME_RANGE = 0xfffffffe;

    // EntryPoint contract address
    address public immutable entryPoint;
    bytes32 private immutable _entryPointV08DomainSeparatorV4;

    constructor(address _entryPoint) {
        entryPoint = _entryPoint;
        _entryPointV08DomainSeparatorV4 = IEntryPoint_v08(entryPoint).getDomainSeparatorV4();
    }

    function getDomainSeparatorV4() public view returns (bytes32) {
        return _entryPointV08DomainSeparatorV4;
    }

    function validateUserOp(PackedUserOperation calldata userOp, bytes32 userOpHash, bytes calldata validatorSignature)
        external
        view
        override
        returns (uint256 validationData)
    {
        uint8 signatureType;
        bytes calldata signature;
        (signatureType, validationData, signature) = ValidatorSigDecoder.decodeValidatorSignature(validatorSignature);

        bytes32 hash;
        if (signatureType == 0x0 || signatureType == 0x2) {
            // For types 0x0 and 0x2, use userOpHash directly
            hash = userOpHash;
        } else if (signatureType == 0x1 || signatureType == 0x3) {
            // For types 0x1 and 0x3, create a new PackedUserOperationWithValidatorData
            ValidationData memory _validationData = _parseValidationData(validationData);
            PackedUserOpWithValidTimeRange memory userOpWithValidTimeRange = PackedUserOpWithValidTimeRange({
                sender: userOp.sender,
                nonce: userOp.nonce,
                initCode: userOp.initCode,
                callData: userOp.callData,
                accountGasLimits: userOp.accountGasLimits,
                preVerificationGas: userOp.preVerificationGas,
                gasFees: userOp.gasFees,
                paymasterAndData: userOp.paymasterAndData,
                validUntil: _validationData.validUntil,
                validAfter: _validationData.validAfter
            });
            // Get the typed data hash
            hash = getTypedDataHash(userOpWithValidTimeRange);
        }

        bytes32 recovered;
        bool success;
        (recovered, success) = recover(signatureType, hash, signature);
        if (!success) {
            return SIG_VALIDATION_FAILED;
        }
        bool ownerCheck = _isOwner(recovered);
        if (!ownerCheck) {
            return SIG_VALIDATION_FAILED;
        }
        return validationData;
    }

    function validateSignature(address, /*unused sender*/ bytes32 rawHash, bytes calldata validatorSignature)
        external
        view
        override
        returns (bytes4 magicValue)
    {
        uint8 signatureType;
        bytes calldata signature;
        uint256 validationData;
        (signatureType, validationData, signature) = ValidatorSigDecoder.decodeValidatorSignature(validatorSignature);

        bytes32 hash = _pack1271SignatureHash(rawHash, signatureType, validationData);
        bytes32 recovered;
        bool success;
        (recovered, success) = recover(signatureType, hash, signature);
        if (!success) {
            return INVALID_ID;
        }
        bool ownerCheck = _isOwner(recovered);
        if (!ownerCheck) {
            return INVALID_ID;
        }

        if (validationData > 0) {
            ValidationData memory _validationData = _parseValidationData(validationData);
            bool outOfTimeRange =
                (block.timestamp > _validationData.validUntil) || (block.timestamp < _validationData.validAfter);
            if (outOfTimeRange) {
                return INVALID_TIME_RANGE;
            }
        }
        return MAGICVALUE;
    }

    function _pack1271SignatureHash(bytes32 hash, uint8 signatureType, uint256 validationData)
        internal
        pure
        returns (bytes32)
    {
        if (signatureType == 0x0 || signatureType == 0x2) {
            // For types 0x0 and 0x2, return hash as is, userOpHash can be generated using eth_signTypedData_v4, therefore no need to use toEthSignedMessageHash
            return hash;
        } else if (signatureType == 0x1 || signatureType == 0x3) {
            // For types 0x1 and 0x3, return keccak256(abi.encodePacked(hash, validationData))
            return keccak256(abi.encodePacked(hash, validationData));
        } else {
            revert Errors.INVALID_SIGNTYPE();
        }
    }

    function _isOwner(bytes32 recovered) private view returns (bool isOwner) {
        return IOwnable(address(msg.sender)).isOwner(recovered);
    }

    function recover(uint8 signatureType, bytes32 rawHash, bytes calldata rawSignature)
        internal
        view
        returns (bytes32 recovered, bool success)
    {
        if (signatureType == 0x0 || signatureType == 0x1) {
            //ecdas recover
            (address recoveredAddr, ECDSA.RecoverError error,) = ECDSA.tryRecover(rawHash, rawSignature);
            if (error != ECDSA.RecoverError.NoError) {
                success = false;
            } else {
                success = true;
            }
            recovered = recoveredAddr.toBytes32();
        } else if (signatureType == 0x2 || signatureType == 0x3) {
            bytes32 publicKey = WebAuthn.recover(rawHash, rawSignature);
            if (publicKey == 0) {
                recovered = publicKey;
                success = false;
            } else {
                recovered = publicKey;
                success = true;
            }
        } else {
            revert Errors.INVALID_SIGNTYPE();
        }
    }

    function supportsInterface(bytes4 interfaceId) public view virtual override returns (bool) {
        return interfaceId == type(IValidator).interfaceId;
    }

    function Init(bytes calldata) external override {}

    function DeInit() external override {}

    /**
     * @dev Get the typed data hash for a PackedUserOpWithValidTimeRange
     * @param userOpWithValidTimeRange The user operation with validator data
     * @return The typed data hash
     */
    function getTypedDataHash(PackedUserOpWithValidTimeRange memory userOpWithValidTimeRange)
        public
        view
        returns (bytes32)
    {
        return MessageHashUtils.toTypedDataHash(getDomainSeparatorV4(), userOpWithValidTimeRange.hash());
    }
}
