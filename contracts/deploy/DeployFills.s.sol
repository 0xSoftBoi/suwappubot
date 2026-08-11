// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { Script, console } from "forge-std/Script.sol";
import { SuwappuFills } from "../SuwappuFills.sol";

/**
 * @title DeployFills — Suwappu Fills on Robinhood Chain
 *
 * Robinhood Chain (Arbitrum Orbit, native gas ETH):
 *   Mainnet: chain id 4663,  explorer https://robinhoodchain.blockscout.com
 *   Testnet: chain id 46630, rpc https://rpc.testnet.chain.robinhood.com
 *            faucet https://faucet.testnet.chain.robinhood.com
 *
 * Both commitments below are produced by the collection tooling and MUST match:
 *   PROVENANCE  = provenance_hash in nft/fills/provenance.json   (python3 nft/fills/generate.py)
 *   TRAITS      = nft/fills/traits_commitment.txt                (python3 nft/fills/pack_traits.py)
 *
 * Post-deploy order matters:
 *   1. appendTraits() x10   — chunks from nft/fills/traits_calldata.json
 *   2. sealTraits()         — reverts unless the blob hashes to TRAITS
 *   3. setBaseURI(ipfs://<metadata-CID>/)
 *   4. mint out, then commitReveal(), wait REVEAL_DELAY blocks, drawStartingIndex()
 *   5. freezeMetadata()
 *
 * Usage (testnet first):
 *   export DEPLOYER_PRIVATE_KEY=0x...
 *   export FILLS_UNREVEALED_URI=ipfs://<placeholder-CID>
 *   forge script contracts/deploy/DeployFills.s.sol \
 *     --rpc-url https://rpc.testnet.chain.robinhood.com --broadcast -vvvv
 */
contract DeployFills is Script {
    bytes32 constant PROVENANCE = 0x91c0ec0e3e7bd108175c9443d32b0dd16f78b89d5af23c9e7a02f42d6008c124;
    bytes32 constant TRAITS = 0xb3479dd822b01a4b5d365f06d06480902473ac10f40f09a4253a74f4d9e70887;

    function run() external {
        uint256 pk = vm.envUint("DEPLOYER_PRIVATE_KEY");
        address deployer = vm.addr(pk);
        string memory unrevealed = vm.envString("FILLS_UNREVEALED_URI");

        require(
            block.chainid == 4663 || block.chainid == 46630,
            "wrong chain: expected Robinhood Chain (4663) or its testnet (46630)"
        );

        vm.startBroadcast(pk);
        SuwappuFills fills = new SuwappuFills(unrevealed, PROVENANCE, TRAITS, deployer);
        vm.stopBroadcast();

        console.log("SuwappuFills:", address(fills));
        console.log("chain id:", block.chainid);
        console.log("owner:", deployer);
        console.log("next: appendTraits x10 -> sealTraits -> setBaseURI");
    }
}
