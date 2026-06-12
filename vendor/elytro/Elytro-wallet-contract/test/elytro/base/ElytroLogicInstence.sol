// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "@source/Elytro.sol";

contract ElytroLogicInstence {
    Elytro public elytroLogic;

    constructor(address _entryPoint, address defaultValidator) {
        elytroLogic = new Elytro(_entryPoint, defaultValidator);
    }
}
