// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {HookManager} from "@elytro-wallet-core/contracts/base/HookManager.sol";
import {IElytroHookManager} from "../interfaces/IElytroHookManager.sol";

abstract contract ElytroHookManager is IElytroHookManager, HookManager {
    function _installHook(bytes calldata hookAndDataWithFlag) internal virtual {
        _installHook(
            address(bytes20(hookAndDataWithFlag[:20])),
            hookAndDataWithFlag[20:hookAndDataWithFlag.length - 1],
            uint8(bytes1((hookAndDataWithFlag[hookAndDataWithFlag.length - 1:hookAndDataWithFlag.length])))
        );
    }

    function installHook(bytes calldata hookAndData, uint8 capabilityFlags) external virtual override {
        pluginManagementAccess();
        _installHook(address(bytes20(hookAndData[:20])), hookAndData[20:], capabilityFlags);
    }
}
