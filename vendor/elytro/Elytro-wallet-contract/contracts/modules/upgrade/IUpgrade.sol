// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

interface IUpgrade {
    event Upgrade(address indexed newLogic, address indexed oldLogic);

    function upgrade(address wallet) external;
}
