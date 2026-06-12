// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {ModuleManager} from "@elytro-wallet-core/contracts/base/ModuleManager.sol";
import {IElytroModuleManager} from "../interfaces/IElytroModuleManager.sol";
import {IElytroModule} from "../modules/interfaces/IElytroModule.sol";
import {Errors} from "../libraries/Errors.sol";
import {IERC165} from "@openzeppelin/contracts/utils/introspection/IERC165.sol";

abstract contract ElytroModuleManager is IElytroModuleManager, ModuleManager {
    function installModule(bytes calldata moduleAndData) external override {
        pluginManagementAccess();
        _addModule(moduleAndData);
    }

    /**
     * The current function is inside the
     * `function _installModule(address moduleAddress, bytes memory initData, bytes4[] memory selectors)`
     */
    function _isSupportsModuleInterface(address moduleAddress) internal view override returns (bool supported) {
        bytes memory callData =
            abi.encodeWithSelector(IERC165.supportsInterface.selector, type(IElytroModule).interfaceId);
        assembly ("memory-safe") {
            // memorySafe: The scratch space between memory offset 0 and 64.
            let result := staticcall(gas(), moduleAddress, add(callData, 0x20), mload(callData), 0x00, 0x20)
            if gt(result, 0) { supported := mload(0x00) }
        }
    }

    function _addModule(bytes calldata moduleAndData) internal {
        address moduleAddress = address(bytes20(moduleAndData[:20]));
        IElytroModule aModule = IElytroModule(moduleAddress);
        bytes4[] memory requiredFunctions = aModule.requiredFunctions();
        if (requiredFunctions.length == 0) {
            revert Errors.MODULE_SELECTORS_EMPTY();
        }
        _installModule(address(bytes20(moduleAndData[:20])), moduleAndData[20:], requiredFunctions);
    }
}
