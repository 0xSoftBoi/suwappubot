// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IHookManager} from "@elytro-wallet-core/contracts/interface/IHookManager.sol";

interface IElytroHookManager is IHookManager {
    function installHook(bytes calldata hookAndData, uint8 capabilityFlags) external;
}
