// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Script, console} from "forge-std/Script.sol";
import {PassportResolver} from "../src/PassportResolver.sol";

contract DeployPassportResolver is Script {
    function run() external {
        uint256 pk = vm.envUint("PRIVATE_KEY");
        address deployer = vm.addr(pk);
        vm.startBroadcast(pk);
        PassportResolver resolver = new PassportResolver(deployer);
        vm.stopBroadcast();
        console.log("PassportResolver deployed:", address(resolver));
        console.log("owner:", deployer);
    }
}
