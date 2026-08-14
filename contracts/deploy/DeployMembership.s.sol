// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { Script, console } from "forge-std/Script.sol";
import { SuwappuMembership } from "../SuwappuMembership.sol";

/**
 * @title DeployMembership — Suwappu subscriptions as NFTs on Robinhood Chain
 *
 * Robinhood Chain (Arbitrum Orbit, native gas ETH):
 *   Mainnet: 4663 — USDG (canonical, 6dp): 0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168
 *   Testnet: 46630 — no canonical USDG; pass a test ERC-20 via MEMBERSHIP_USDG.
 *
 * Post-deploy:
 *   1. setBaseURI(<membership metadata endpoint>)
 *   2. Create the Alchemy Gas Manager policy sponsoring `mintFree()` only
 *      (docs.robinhood.com/chain/account-abstraction), so the free mint is
 *      genuinely free for users in Robinhood Wallet.
 *   3. Set SUWAPPU_MEMBERSHIP_CONTRACT in the bot env — get_tier starts taking
 *      max(db, chain) immediately, fail-open to the DB.
 *
 * Usage:
 *   export DEPLOYER_PRIVATE_KEY=0x...
 *   export MEMBERSHIP_TREASURY=0x...       # multisig recommended
 *   export MEMBERSHIP_USDG=0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168   # mainnet
 *   forge script contracts/deploy/DeployMembership.s.sol \
 *     --rpc-url https://rpc.mainnet.chain.robinhood.com --broadcast -vvvv
 */
contract DeployMembership is Script {
    address constant USDG_MAINNET = 0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168;

    function run() external {
        uint256 pk = vm.envUint("DEPLOYER_PRIVATE_KEY");
        address deployer = vm.addr(pk);
        address treasury = vm.envAddress("MEMBERSHIP_TREASURY");
        address usdg = vm.envOr("MEMBERSHIP_USDG", USDG_MAINNET);

        require(
            block.chainid == 4663 || block.chainid == 46630,
            "wrong chain: expected Robinhood Chain (4663) or its testnet (46630)"
        );
        if (block.chainid == 4663) {
            require(usdg == USDG_MAINNET, "mainnet must use canonical USDG");
        }

        vm.startBroadcast(pk);
        SuwappuMembership membership = new SuwappuMembership(usdg, treasury, deployer);
        vm.stopBroadcast();

        console.log("SuwappuMembership:", address(membership));
        console.log("chain id:", block.chainid);
        console.log("treasury:", treasury);
        console.log("prices (USDG 6dp): free=0 pro=9.99 premium=29.99 enterprise=99.99");
        console.log("next: setBaseURI, Gas Manager policy for mintFree(), bot env var");
    }
}
