// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IEntryPoint} from "@account-abstraction/contracts/interfaces/IEntryPoint.sol";

interface IEntryPoint_v08 is IEntryPoint {
    function getDomainSeparatorV4() external view returns (bytes32);
}
