// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { Script, console } from "forge-std/Script.sol";
import { SuwappuFeathers } from "../SuwappuFeathers.sol";

/**
 * @title DeployFeathers — Suwappu Feathers on Robinhood Chain
 *
 * Robinhood Chain (Arbitrum Orbit, native gas ETH):
 *   Mainnet: chain id 4663,  explorer https://robinhoodchain.blockscout.com
 *   Testnet: chain id 46630, rpc https://rpc.testnet.chain.robinhood.com
 *            faucet https://faucet.testnet.chain.robinhood.com
 *
 * PROVENANCE must match provenance_hash in nft/robinhood-10k/provenance.json.
 *
 * Usage (testnet first, per repo policy):
 *   export DEPLOYER_PRIVATE_KEY=0x...
 *   export FEATHERS_BASE_URI=ipfs://<metadata-dir-CID>/
 *   forge script contracts/deploy/DeployFeathers.s.sol \
 *     --rpc-url https://rpc.testnet.chain.robinhood.com \
 *     --broadcast -vvvv
 */
contract DeployFeathers is Script {
    // sha256 provenance of the full 10k image set (nft/robinhood-10k/provenance.json)
    bytes32 constant PROVENANCE =
        0x1892dc53a3677f255d644842f80fd2b01535734dd6fd5a09264249af01254071;

    function run() external {
        uint256 pk = vm.envUint("DEPLOYER_PRIVATE_KEY");
        address deployer = vm.addr(pk);
        string memory baseURI = vm.envString("FEATHERS_BASE_URI");

        require(
            block.chainid == 4663 || block.chainid == 46630,
            "wrong chain: expected Robinhood Chain (4663) or its testnet (46630)"
        );

        vm.startBroadcast(pk);
        SuwappuFeathers feathers = new SuwappuFeathers(baseURI, PROVENANCE, deployer);
        vm.stopBroadcast();

        console.log("SuwappuFeathers deployed:", address(feathers));
        console.log("chain id:", block.chainid);
        console.log("owner:", deployer);
        console.logBytes32(feathers.provenanceHash());
    }
}
