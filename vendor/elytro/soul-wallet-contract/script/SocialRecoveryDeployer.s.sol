// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.13;

import "forge-std/Script.sol";
import "@source/modules/socialRecovery/SocialRecoveryModule.sol";
import "./DeployHelper.sol";

contract SocialRecoveryDeployer is Script, DeployHelper {
    function run() public {
        vm.startBroadcast(privateKey);
        deploy("SocialRecoveryModule", type(SocialRecoveryModule).creationCode);
    }
}
