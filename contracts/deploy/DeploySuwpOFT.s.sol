// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { Script, console } from "forge-std/Script.sol";
import { SuwpOFT } from "../SuwpOFT.sol";
import { IOAppCore } from "@layerzerolabs/oapp-evm/contracts/oapp/interfaces/IOAppCore.sol";
import { EnforcedOptionParam } from "@layerzerolabs/oapp-evm/contracts/oapp/libs/OAppOptionsType3.sol";

/**
 * @dev Deploy SuwpOFT on a single chain.
 *      Set env vars before running:
 *        LZ_ENDPOINT=<chain endpoint address>
 *        ADMIN=<multisig address>
 *        DEPLOYER=<deployer private key>
 *
 * Usage:
 *   forge script contracts/deploy/DeploySuwpOFT.s.sol \
 *     --rpc-url base-sepolia --broadcast --verify
 */
contract DeploySuwpOFT is Script {
    // LayerZero V2 endpoints
    address constant BASE_MAINNET_ENDPOINT    = 0x1a44076050125825900e736c501f859c50fE728c;
    address constant BASE_SEPOLIA_ENDPOINT    = 0x6EDCE65403992e310A62460808c4b910D972f10f;
    address constant ARB_MAINNET_ENDPOINT     = 0x1a44076050125825900e736c501f859c50fE728c;
    address constant ARB_SEPOLIA_ENDPOINT     = 0x6EDCE65403992e310A62460808c4b910D972f10f;
    address constant POLYGON_MAINNET_ENDPOINT = 0x1a44076050125825900e736c501f859c50fE728c;

    function run() external {
        address endpoint = vm.envAddress("LZ_ENDPOINT");
        address admin = vm.envAddress("ADMIN");
        // CANONICAL=true ONLY on Base (where minting happens); false on every other chain.
        bool isCanonical = vm.envOr("CANONICAL", false);

        vm.startBroadcast();
        SuwpOFT oft = new SuwpOFT(endpoint, admin, admin, isCanonical);
        console.log("SuwpOFT deployed at:", address(oft));
        console.log("isCanonicalChain:", isCanonical);
        vm.stopBroadcast();
    }
}
