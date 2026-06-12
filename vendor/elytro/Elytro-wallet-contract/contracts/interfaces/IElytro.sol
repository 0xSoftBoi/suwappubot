// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IElytroHookManager} from "../interfaces/IElytroHookManager.sol";
import {IElytroModuleManager} from "../interfaces/IElytroModuleManager.sol";
import {IElytroOwnerManager} from "../interfaces/IElytroOwnerManager.sol";
import {IUpgradable} from "../interfaces/IUpgradable.sol";
import {IStandardExecutor} from "@elytro-wallet-core/contracts/interface/IStandardExecutor.sol";

interface IElytro is IElytroHookManager, IElytroModuleManager, IElytroOwnerManager, IStandardExecutor, IUpgradable {
    function initialize(
        bytes32[] calldata owners,
        address defalutCallbackHandler,
        bytes[] calldata modules,
        bytes[] calldata hooks
    ) external;
}
