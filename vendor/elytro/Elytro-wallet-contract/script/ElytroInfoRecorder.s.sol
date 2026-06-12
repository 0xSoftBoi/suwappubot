// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.13;

import "forge-std/Script.sol";
import "./DeployHelper.sol";
import "@source/tools/ElytroInfoRecorder.sol";

contract ElytroInfoRecorderDeployer is Script, DeployHelper {
    function run() public {
        vm.startBroadcast(privateKey);
        deploy();
    }

    function deploy() private {
        deploy("ElytroInfoRecorder", type(ElytroInfoRecorder).creationCode);
    }
}
