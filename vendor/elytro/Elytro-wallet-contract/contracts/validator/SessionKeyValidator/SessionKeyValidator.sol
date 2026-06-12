// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IValidator} from "@elytro-wallet-core/contracts/interface/IValidator.sol";
import {PackedUserOperation} from "@account-abstraction/contracts/interfaces/PackedUserOperation.sol";
import "@account-abstraction/contracts/core/Helpers.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {Errors} from "../../libraries/Errors.sol";
import {MerkleProof} from "@openzeppelin/contracts/utils/cryptography/MerkleProof.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IStandardExecutor, Execution} from "@elytro-wallet-core/contracts/interface/IStandardExecutor.sol";

/**
 * @title SessionKeyValidator
 * @dev A contract that implements the IValidator interface for validating user operations and signatures.
 */
contract SessionKeyValidator is IValidator {
    event SessionKeySeted(address indexed wallet, address indexed sessionKey, uint32 validUntil, bytes32 merkleRoot);

    // Magic value indicating a valid signature for ERC-1271 contracts
    // bytes4(keccak256("isValidSignature(bytes32,bytes)")
    bytes4 internal constant MAGICVALUE = 0x1626ba7e;
    // Constants indicating different invalid states
    bytes4 internal constant INVALID_ID = 0xffffffff;
    bytes4 internal constant INVALID_TIME_RANGE = 0xfffffffe;

    // session key

    struct SessionKeyInfo {
        address sessionKey;
        uint48 validUntil;
        /*
            merkle tree structure for session management
                - leaf node type 0x1: approved Target
                    keccak256(bytes32(abi.encodePacked(0x01, approvedTargetAddress(bytes20))))
                - leaf node type 0x2: approved Target+Method
                    keccak256(bytes32(abi.encodePacked(0x02, approvedTargetAddress(bytes20), method(bytes4)))
                - #TODO leaf node type 0x3: erc20Limit
                - leaf node type 0x4: approved validateSignature Target
                    keccak256(bytes32(abi.encodePacked(0x04, approvedTargetAddress(bytes20))))
        */
        bytes32 merkleRoot;
    }

    // key: walletAddress, value: SessionKeyInfo. [Associated storage]
    mapping(address => SessionKeyInfo) public sessionKeys;

    function setSessionKey(address sessionKey, uint32 validUntil, bytes32 merkleRoot) external {
        address walletAddress = msg.sender;
        SessionKeyInfo storage sessionKeyInfo = sessionKeys[walletAddress];
        sessionKeyInfo.validUntil = validUntil;
        sessionKeyInfo.merkleRoot = merkleRoot;
        sessionKeyInfo.sessionKey = sessionKey;
        emit SessionKeySeted(walletAddress, sessionKey, validUntil, merkleRoot);
    }

    function validateUserOp(PackedUserOperation calldata userOp, bytes32 userOpHash, bytes calldata validatorSignature)
        external
        view
        override
        returns (uint256 validationData)
    {
        (address recoveredAddr, ECDSA.RecoverError error,) = ECDSA.tryRecover(userOpHash, validatorSignature[0:65]);
        if (error != ECDSA.RecoverError.NoError) {
            return SIG_VALIDATION_FAILED;
        }
        address walletAddress = userOp.sender;
        SessionKeyInfo memory sessionKeyInfo = sessionKeys[walletAddress];
        if (recoveredAddr != sessionKeyInfo.sessionKey) {
            return SIG_VALIDATION_FAILED;
        }
        if (_validateSessionKey(userOp, validatorSignature[65:]) == false) {
            return SIG_VALIDATION_FAILED;
        }
        return uint256(sessionKeys[walletAddress].validUntil) << 160;
    }

    function _validateSessionKey(PackedUserOperation calldata userOp, bytes calldata sessionKeyData)
        private
        view
        returns (bool isValid)
    {
        bytes32[] memory proof;
        bool[] memory proofFlags;
        bytes32[] memory leaves;
        (proof, proofFlags, leaves) = abi.decode(sessionKeyData, (bytes32[], bool[], bytes32[]));

        bytes32[] memory leavesHash = new bytes32[](leaves.length);
        for (uint256 i = 0; i < leaves.length; i++) {
            leavesHash[i] = keccak256(abi.encodePacked(leaves[i]));
        }

        address walletAddress = msg.sender;
        bytes32 merkleRoot = sessionKeys[walletAddress].merkleRoot;
        if (merkleRoot == bytes32(0)) {
            return false;
        }
        if (MerkleProof.multiProofVerify(proof, proofFlags, merkleRoot, leavesHash) == false) {
            return false;
        }

        bytes4 selector = bytes4(userOp.callData);

        if (IStandardExecutor.execute.selector == selector) {
            // function execute(address target, uint256 value, bytes calldata data)
            (address target, uint256 value, bytes memory data) =
                abi.decode(userOp.callData[4:], (address, uint256, bytes));
            (value);
            if (_validateTarget(leaves, target, data) == false) {
                return false;
            }
        } else if (IStandardExecutor.executeBatch.selector == selector) {
            // function executeBatch(Execution[] calldata executions)
            (Execution[] memory executions) = abi.decode(userOp.callData[4:], (Execution[]));
            for (uint256 i = 0; i < executions.length; i++) {
                (address target, uint256 value, bytes memory data) =
                    (executions[i].target, executions[i].value, executions[i].data);
                (value);
                if (_validateTarget(leaves, target, data) == false) {
                    return false;
                }
            }
        }
        return true;
    }

    function _validateTarget(bytes32[] memory leaves, address target, bytes memory data)
        private
        pure
        returns (bool isValid)
    {
        for (uint256 i = 0; i < leaves.length; i++) {
            bytes32 leaf = leaves[i];
            uint8 leafType = uint8(uint256(leaf) >> (31 * 8));
            if (leafType == 0x01 || leafType == 0x02) {
                address approvedTarget = address(uint160(uint256(leaf) >> (11 * 8) & type(uint160).max));
                if (leafType == 0x01) {
                    // keccak256(bytes32(abi.encodePacked(0x01, approvedTargetAddress(bytes20))))
                    if (approvedTarget == target) {
                        return true;
                    }
                } else {
                    // keccak256(bytes32(abi.encodePacked(0x02, approvedTargetAddress(bytes20), method(bytes4)))
                    if (approvedTarget != target) {
                        continue;
                    }
                    bytes4 method = bytes4(uint32(uint256(leaf) >> (7 * 8) & type(uint32).max));
                    if (method == bytes4(data)) {
                        return true;
                    }
                }
            }
        }
        return false;
    }

    function validateSignature(address sender, bytes32 rawHash, bytes calldata validatorSignature)
        external
        view
        override
        returns (bytes4 magicValue)
    {
        (address recoveredAddr, ECDSA.RecoverError error,) = ECDSA.tryRecover(rawHash, validatorSignature[0:65]);
        if (error != ECDSA.RecoverError.NoError) {
            return INVALID_ID;
        }
        address walletAddress = msg.sender;
        SessionKeyInfo memory sessionKeyInfo = sessionKeys[walletAddress];
        if (recoveredAddr != sessionKeyInfo.sessionKey) {
            return INVALID_ID;
        }
        if (_validateEIP1271SessionKey(sender, validatorSignature[65:]) == false) {
            return INVALID_ID;
        }

        if (block.timestamp < sessionKeys[walletAddress].validUntil) {
            return MAGICVALUE;
        } else {
            return INVALID_ID;
        }
    }

    function _validateEIP1271SessionKey(address caller, bytes calldata sessionKeyData)
        private
        view
        returns (bool isValid)
    {
        bytes32[] memory proof;
        bool[] memory proofFlags;
        bytes32[] memory leaves;
        (proof, proofFlags, leaves) = abi.decode(sessionKeyData, (bytes32[], bool[], bytes32[]));

        bytes32[] memory leavesHash = new bytes32[](leaves.length);
        for (uint256 i = 0; i < leaves.length; i++) {
            leavesHash[i] = keccak256(abi.encodePacked(leaves[i]));
        }

        address walletAddress = msg.sender;
        bytes32 merkleRoot = sessionKeys[walletAddress].merkleRoot;
        if (merkleRoot == bytes32(0)) {
            return false;
        }
        if (MerkleProof.multiProofVerify(proof, proofFlags, merkleRoot, leavesHash) == false) {
            return false;
        }

        if (_validateEIP1271Target(leaves, caller) == false) {
            return false;
        }
        return true;
    }

    function _validateEIP1271Target(bytes32[] memory leaves, address target) private pure returns (bool isValid) {
        for (uint256 i = 0; i < leaves.length; i++) {
            bytes32 leaf = leaves[i];
            uint8 leafType = uint8(uint256(leaf) >> (31 * 8));
            if (leafType == 0x04) {
                address approvedTarget = address(uint160(uint256(leaf) >> (11 * 8) & type(uint160).max));
                // keccak256(bytes32(abi.encodePacked(0x04, approvedTargetAddress(bytes20))))
                if (approvedTarget == target) {
                    return true;
                }
            }
        }
        return false;
    }

    function supportsInterface(bytes4 interfaceId) public view virtual override returns (bool) {
        return interfaceId == type(IValidator).interfaceId;
    }

    function Init(bytes calldata) external override {}

    function DeInit() external override {}
}
