// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IAccount, PackedUserOperation} from "@elytro-wallet-core/contracts/interface/IAccount.sol";
import {EntryPointManager} from "@elytro-wallet-core/contracts/base/EntryPointManager.sol";
import {FallbackManager} from "@elytro-wallet-core/contracts/base/FallbackManager.sol";
import {StandardExecutor} from "@elytro-wallet-core/contracts/base/StandardExecutor.sol";
import {ElytroValidatorManager} from "./abstract/ElytroValidatorManager.sol";
import {SignatureDecoder} from "@elytro-wallet-core/contracts/utils/SignatureDecoder.sol";
import {IERC1271} from "@openzeppelin/contracts/interfaces/IERC1271.sol";
import {Errors} from "./libraries/Errors.sol";
import {Initializable} from "@openzeppelin/contracts-upgradeable/contracts/proxy/utils/Initializable.sol";
import "./abstract/ERC1271Handler.sol";
import {ElytroOwnerManager} from "./abstract/ElytroOwnerManager.sol";
import {ElytroModuleManager} from "./abstract/ElytroModuleManager.sol";
import {ElytroHookManager} from "./abstract/ElytroHookManager.sol";
import {ElytroUpgradeManager} from "./abstract/ElytroUpgradeManager.sol";

/**
 * @title Elytro
 * @dev This contract is the main entry point for the Elytro. It implements the IAccount and IERC1271 interfaces,
 * and is compatible with the ERC-4337 standard.
 * It inherits from multiple base contracts and managers to provide the core functionality of the wallet.
 * This includes managing entry points, owners, modules, hooks, and upgrades, as well as handling ERC1271 signatures and providing a fallback function.
 */
contract Elytro is
    Initializable,
    IAccount,
    IERC1271,
    EntryPointManager,
    ElytroOwnerManager,
    ElytroModuleManager,
    ElytroHookManager,
    StandardExecutor,
    ElytroValidatorManager,
    FallbackManager,
    ElytroUpgradeManager,
    ERC1271Handler
{
    // entrypoint v0.8 support
    string public constant VERSION = "1.1.2";
    address internal immutable _DEFAULT_VALIDATOR;

    constructor(address _entryPoint, address defaultValidator) EntryPointManager(_entryPoint) {
        _DEFAULT_VALIDATOR = defaultValidator;
        _disableInitializers();
    }

    /**
     * @notice Initializes the Elytro contract
     * @dev This function can only be called once. It sets the initial owners, default callback handler, modules, and hooks.
     */
    function initialize(
        bytes32[] calldata owners,
        address defalutCallbackHandler,
        bytes[] calldata modules,
        bytes[] calldata hooks
    ) external initializer {
        _addOwners(owners);
        _setFallbackHandler(defalutCallbackHandler);
        _installValidator(_DEFAULT_VALIDATOR, hex"");
        for (uint256 i = 0; i < modules.length;) {
            _addModule(modules[i]);
            unchecked {
                i++;
            }
        }
        for (uint256 i = 0; i < hooks.length;) {
            _installHook(hooks[i]);
            unchecked {
                i++;
            }
        }
    }

    function _uninstallValidator(address validator) internal override {
        require(validator != _DEFAULT_VALIDATOR, "can't uninstall default validator");
        super._uninstallValidator(validator);
    }

    function isValidSignature(bytes32 _hash, bytes calldata signature)
        public
        view
        override
        returns (bytes4 magicValue)
    {
        bytes32 datahash = _encodeRawHash(_hash);

        (address validator, bytes calldata validatorSignature, bytes calldata hookSignature) =
            SignatureDecoder.signatureSplit(signature);
        _preIsValidSignatureHook(datahash, hookSignature);
        return _isValidSignature(datahash, validator, validatorSignature);
    }

    function _decodeSignature(bytes calldata signature)
        internal
        pure
        virtual
        returns (address validator, bytes calldata validatorSignature, bytes calldata hookSignature)
    {
        return SignatureDecoder.signatureSplit(signature);
    }

    function validateUserOp(PackedUserOperation calldata userOp, bytes32 userOpHash, uint256 missingAccountFunds)
        public
        payable
        virtual
        override
        returns (uint256 validationData)
    {
        _onlyEntryPoint();

        assembly ("memory-safe") {
            if missingAccountFunds {
                // ignore failure (its EntryPoint's job to verify, not account.)
                pop(call(gas(), caller(), missingAccountFunds, 0x00, 0x00, 0x00, 0x00))
            }
        }
        (address validator, bytes calldata validatorSignature, bytes calldata hookSignature) =
            _decodeSignature(userOp.signature);

        /*
            Warning!!!
                This function uses `return` to terminate the execution of the entire contract.
                If any `Hook` fails, this function will stop the contract's execution and
                return `SIG_VALIDATION_FAILED`, skipping all the subsequent unexecuted code.
        */
        _preUserOpValidationHook(userOp, userOpHash, missingAccountFunds, hookSignature);

        /*
            When any hook execution fails, this line will not be executed.
         */
        return _validateUserOp(userOp, userOpHash, validator, validatorSignature);
    }

    /*
    The permission to upgrade the logic contract is exclusively granted to modules (UpgradeModule),
    meaning that even the wallet owner cannot directly invoke `upgradeTo` for upgrades.
    This design is implemented for security reasons, ensuring that even if the signer's credentials
    are compromised, attackers cannot upgrade the logic contract, potentially rendering the wallet unusable.
    Users can regain control over their wallet through social recovery mechanisms.
    This approach safeguards the wallet's integrity, maintaining its availability and security.
    */
    function upgradeTo(address newImplementation) external override {
        _onlyModule();
        _upgradeTo(newImplementation);
    }

    /// @notice Handles the upgrade from an old implementation
    /// @param oldImplementation Address of the old implementation
    function upgradeFrom(address oldImplementation) external pure override {
        (oldImplementation);
        revert Errors.NOT_IMPLEMENTED(); //Initial version no need data migration
    }
}
