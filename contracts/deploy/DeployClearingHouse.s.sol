// SPDX-License-Identifier: MIT
pragma solidity 0.8.27;

import { Script, console } from "forge-std/Script.sol";
import { CommonsClearingHouse } from "../commons/CommonsClearingHouse.sol";

/**
 * Deploys CommonsClearingHouse (Commons v2, layer 1). No constructor args, no
 * owner, nothing to configure afterwards — the deployer has no privileges.
 *
 *   export DEPLOYER_PRIVATE_KEY=0x...      # funded with Base Sepolia ETH
 *   export BASE_SEPOLIA_RPC_URL=https://sepolia.base.org
 *   export BASESCAN_API_KEY=...            # optional, for --verify
 *   cd contracts
 *   ~/.foundry/bin/forge script deploy/DeployClearingHouse.s.sol:DeployClearingHouse \
 *     --rpc-url base_sepolia --broadcast --verify -vvvv
 *
 * Same command with --rpc-url hyperevm_testnet for HyperEVM (Cancun verified
 * on-chain 2026-11-06; see docs/plans/commons-v2.md §9.2 and DEPLOY_HYPEREVM.md
 * for the big-blocks prerequisite).
 */
contract DeployClearingHouse is Script {
    function run() external returns (CommonsClearingHouse ch) {
        uint256 pk = vm.envUint("DEPLOYER_PRIVATE_KEY");
        vm.startBroadcast(pk);
        ch = new CommonsClearingHouse();
        vm.stopBroadcast();
        console.log("CommonsClearingHouse:", address(ch));
        console.log("chainId:", block.chainid);
        console.logBytes32(ch.domainSeparator());
    }
}
