// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IOwnerManager} from "@elytro-wallet-core/contracts/interface/IOwnerManager.sol";

interface IElytroOwnerManager is IOwnerManager {
    function addOwners(bytes32[] calldata owners) external;
    function resetOwners(bytes32[] calldata newOwners) external;
}
