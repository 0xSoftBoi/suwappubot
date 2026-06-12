// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IValidatorManager} from "@elytro-wallet-core/contracts/interface/IValidatorManager.sol";

interface IElytroValidatorManager is IValidatorManager {
    function installValidator(bytes calldata validatorAndData) external;
}
