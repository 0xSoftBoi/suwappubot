// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console} from "forge-std/Script.sol";
import {WorldIdGateHook} from "../src/WorldIdGateHook.sol";

address constant HOOK = 0xc72ab4dFd3d6B2C1b3af51816EA8331599e6c080;

contract SetVerified is Script {
    function run() external {
        uint256 pk = vm.envUint("PRIVATE_KEY");
        address account = vm.addr(pk);
        vm.startBroadcast(pk);
        WorldIdGateHook(HOOK).setWorldIdVerified(account, true);
        vm.stopBroadcast();
        console.log("set verified:", account);
    }
}
