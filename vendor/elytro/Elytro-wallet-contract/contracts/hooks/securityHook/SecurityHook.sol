// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IHook, PackedUserOperation} from "@elytro-wallet-core/contracts/interface/IHook.sol";
import {IStandardExecutor} from "@elytro-wallet-core/contracts/interface/IStandardExecutor.sol";
import {IHookManager} from "@elytro-wallet-core/contracts/interface/IHookManager.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

/**
 * @title SecurityHook
 * @notice A security enhancement module that allows users to delegate security controls to trusted organizations
 * @dev This contract implements additional security measures for wallet transactions through trusted verification
 *
 * The SecurityHook enables users to:
 * 1. Add an extra layer of security through mandatory two-factor authentication (2FA)
 * 2. Require verification (email, SMS, or Google Authenticator) for transactions
 * 3. Set up conditional verifications (e.g., 2FA for transactions exceeding $1000/day)
 *
 * Safety Features:
 * - Users can force-uninstall the hook if verification services become unavailable
 * - Implementation of a safety delay period through forcePreUninstall()
 * - After the safety delay (forceUninstallAfter) expires, users can remove the hook without verification
 * - This prevents permanent wallet lockout in case of lost 2FA or unresponsive verification services
 */
contract SecurityHook is IHook, Ownable {
    using ECDSA for bytes32;

    // Thrown when the SecurityHook is already initialized.
    error ALREADY_INITIALIZED();
    // Thrown when the provided safety delay is invalid.
    error INVALID_SAFETY_DELAY();
    // Thrown when deinit is not possible.
    error CANNOT_DEINIT();
    // Thrown when the SecurityHook is not initialized.
    error NOT_INITIALIZED();
    // Thrown when a force uninstall has already been requested.
    error FORCE_UNINSTALL_ALREADY_REQUESTED();
    // Thrown when a force uninstall has not been requested.
    error FORCE_UNINSTALL_NOT_REQUESTED();
    // Thrown when the SecurityHook signature is invalid.
    error INVALID_SECURITYHOOK_SIGNATURE();
    // Thrown when the safety delay has not passed.
    error SAFETY_DELAY_NOT_PASSED();
    // Thrown when the SecurityHook signature is missing.
    error MISSING_SECURITYHOOK_SIGNATURE();

    event signerAdded(address indexed signer);
    event signerRemoved(address indexed signer);
    event forceUninstallRequested(address indexed user, uint64 forceUninstallAfter);

    struct UserData {
        bool initialized;
        /**
         * @notice The safetyDelay specifies a mandatory waiting time before force-uninstalling this Hook
         * if verification methods (e.g., email, SMS) or server responses are unavailable.
         */
        uint32 safetyDelay;
        /**
         * @notice After this timestamp, the user can force-uninstall this Hook without verification.
         */
        uint64 forceUninstallAfter;
    }

    mapping(address => bool) public signers;
    mapping(address => UserData) public userData;

    constructor(address initialOwner, address initialSigner) Ownable(initialOwner) {
        signers[initialSigner] = true;
        emit signerAdded(initialSigner);
    }

    function addSigner(address signer) external onlyOwner {
        signers[signer] = true;
        emit signerAdded(signer);
    }

    function removeSigner(address signer) external onlyOwner {
        signers[signer] = false;
        emit signerRemoved(signer);
    }

    function supportsInterface(bytes4 interfaceId) external pure override returns (bool) {
        return interfaceId == type(IHook).interfaceId;
    }

    function Init(bytes calldata data) external override {
        UserData storage _userData = userData[msg.sender];
        if (_userData.initialized) {
            revert ALREADY_INITIALIZED();
        }
        _userData.initialized = true;
        _userData.forceUninstallAfter = 0;
        uint32 _safetyDelay = uint32(bytes4(data[:4]));
        if (_safetyDelay == 0 || _safetyDelay > 365 days) {
            revert INVALID_SAFETY_DELAY();
        }
        _userData.safetyDelay = _safetyDelay;
    }

    function DeInit() external override {
        UserData storage _userData = userData[msg.sender];
        if (!_userData.initialized) {
            revert CANNOT_DEINIT();
        }
        delete userData[msg.sender];
    }

    /**
     * @dev Initiates the emergency removal process for this hook, acting as an escape hatch.
     * This function is designed for scenarios where 2FA or other verification methods are unavailable,
     * preventing the user from being permanently locked out of their wallet.
     *
     * It is the first step in a two-step process:
     * 1. Call `forcePreUninstall()` to begin a time-lock period specified by `safetyDelay`.
     * 2. After the `safetyDelay` has elapsed, call the wallet's `uninstallHook(address(this))` function
     *    to forcibly remove this hook.
     *
     * The time delay serves as a crucial security measure, providing a window to detect and
     * respond to any unauthorized removal attempts.
     */
    function forcePreUninstall() external {
        UserData storage _userData = userData[msg.sender];
        if (!_userData.initialized) {
            revert NOT_INITIALIZED();
        }
        if (_userData.forceUninstallAfter != 0) {
            revert FORCE_UNINSTALL_ALREADY_REQUESTED();
        }
        uint64 _forceUninstallAfter = uint64(block.timestamp) + uint64(_userData.safetyDelay);
        _userData.forceUninstallAfter = _forceUninstallAfter;
        emit forceUninstallRequested(msg.sender, _forceUninstallAfter);
    }

    /**
     * @dev There’s no need to use ERC-191 (Ethereum Signed Message) here, for the following reasons:
     *   1.	The signer is a dedicated address and should not be used for any other purpose.
     *   2.	When signing, you should never accept an unreadable hash directly — always require users to provide structured, human-readable data, such as PackedUserOperation or EIP-1271 messages in EIP-712 format.
     *   3.	Since there’s no security risk in this context, avoiding ERC-191 keeps the implementation simpler and more efficient.
     */
    function verifySignature(bytes32 hash, bytes calldata hookSignature) private view {
        address recoveredAddress = hash.recover(hookSignature);
        if (!signers[recoveredAddress]) {
            revert INVALID_SECURITYHOOK_SIGNATURE();
        }
    }

    function preIsValidSignatureHook(bytes32 hash, bytes calldata hookSignature) external view override {
        /**
         * - Because the isValidSignature function in Elytro uses EIP-712 (see `function _encodeRawHash(bytes32 rawHash)`),
         *   there is no need to implement protection against cross-account signature replay attacks in this case.
         */
        verifySignature(hash, hookSignature);
    }

    function preUserOpValidationHook(
        PackedUserOperation calldata userOp,
        bytes32 userOpHash,
        uint256 missingAccountFunds,
        bytes calldata hookSignature
    ) external view override {
        (missingAccountFunds);

        if (hookSignature.length > 0) {
            verifySignature(userOpHash, hookSignature);
            return;
        }

        if (userOp.callData.length >= 4 && bytes4(userOp.callData[:4]) == IStandardExecutor.execute.selector) {
            (address target,, bytes memory subData) = abi.decode(userOp.callData[4:], (address, uint256, bytes));
            if (subData.length >= 4) {
                bytes4 methodId;
                assembly ("memory-safe") {
                    methodId := mload(add(subData, 0x20))
                }
                if (target == address(this)) {
                    // force Uninstall step 1.
                    // only allow to call `function forcePreUninstall() external`;
                    if (methodId == SecurityHook.forcePreUninstall.selector) {
                        // allow execution for forcePreUninstall without signature
                        return;
                    }
                } else if (target == msg.sender) {
                    // force Uninstall step 2.
                    // only allow to call `function uninstallHook(address hookAddress) external`;
                    if (methodId == IHookManager.uninstallHook.selector && subData.length == 36) {
                        address hookAddress;
                        assembly ("memory-safe") {
                            hookAddress := mload(add(subData, 0x24 /* 0x20+0x04 */ ))
                        }
                        // only allow if the hookAddress is this contract
                        if (hookAddress == address(this)) {
                            UserData storage _userData = userData[msg.sender];
                            if (!_userData.initialized) {
                                revert NOT_INITIALIZED();
                            }
                            if (_userData.forceUninstallAfter == 0) {
                                revert FORCE_UNINSTALL_NOT_REQUESTED();
                            }
                            // allow if the force-uninstall waiting time has passed
                            if (_userData.forceUninstallAfter > block.timestamp) {
                                revert SAFETY_DELAY_NOT_PASSED();
                            }
                            // allow execution
                            return;
                        }
                    }
                }
            }
        }
        revert MISSING_SECURITYHOOK_SIGNATURE();
    }
}
