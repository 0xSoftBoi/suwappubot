// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IModule} from "@elytro-wallet-core/contracts/interface/IModule.sol";

interface IElytroModule is IModule {
    function requiredFunctions() external pure returns (bytes4[] memory);
}
