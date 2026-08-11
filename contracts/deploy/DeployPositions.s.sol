// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { Script, console } from "forge-std/Script.sol";
import { SuwappuPositions } from "../SuwappuPositions.sol";

/**
 * @title DeployPositions — Suwappu Positions on Robinhood Chain
 *
 * Robinhood Chain (Arbitrum Orbit, native gas ETH):
 *   Mainnet: chain id 4663,  explorer https://robinhoodchain.blockscout.com
 *   Testnet: chain id 46630, rpc https://rpc.testnet.chain.robinhood.com
 *            faucet https://faucet.testnet.chain.robinhood.com
 *
 * Constructor args come from nft/position-cards/deploy_args.json:
 *   python3 nft/position-cards/build_deploy_args.py
 * They are read here with vm.parseJson rather than pasted, so the on-chain
 * ticker order can never drift from the registry the bot indexes by.
 *
 * Post-deploy order matters:
 *   1. setOracle(<IPositionOracle>)  — MUST be live before minting, or early
 *      cards stamp entryPrice = 0 and are permanently unpriced.
 *   2. sealRegistry()                — locks ticker -> ERC-20 before mint
 *   3. setBaseURI(<renderer>/), setMintPrice(...), setMintOpen(true)
 *
 * Usage (testnet first):
 *   export DEPLOYER_PRIVATE_KEY=0x...
 *   export POSITIONS_RENDER_URI=https://suwappu.bot/positions/meta/
 *   forge script contracts/deploy/DeployPositions.s.sol \
 *     --rpc-url https://rpc.testnet.chain.robinhood.com --broadcast -vvvv
 */
contract DeployPositions is Script {
    function run() external {
        uint256 pk = vm.envUint("DEPLOYER_PRIVATE_KEY");
        address deployer = vm.addr(pk);
        string memory renderURI = vm.envString("POSITIONS_RENDER_URI");

        require(
            block.chainid == 4663 || block.chainid == 46630,
            "wrong chain: expected Robinhood Chain (4663) or its testnet (46630)"
        );

        string memory json = vm.readFile("nft/position-cards/deploy_args.json");
        uint256[] memory rawCaps = vm.parseJsonUintArray(json, ".caps");
        address[] memory rawTokens = vm.parseJsonAddressArray(json, ".tokens");
        require(rawCaps.length == 96 && rawTokens.length == 96, "deploy_args must have 96 entries");

        uint16[96] memory caps;
        address[96] memory tokens;
        uint256 sum;
        for (uint256 i = 0; i < 96; i++) {
            require(rawCaps[i] > 0 && rawCaps[i] <= type(uint16).max, "cap out of range");
            require(rawTokens[i] != address(0), "zero token address");
            caps[i] = uint16(rawCaps[i]);
            tokens[i] = rawTokens[i];
            sum += rawCaps[i];
        }
        require(sum == 10_000, "caps must sum to 10000");

        vm.startBroadcast(pk);
        SuwappuPositions pos = new SuwappuPositions(caps, tokens, renderURI, deployer);
        vm.stopBroadcast();

        console.log("SuwappuPositions:", address(pos));
        console.log("chain id:", block.chainid);
        console.log("owner:", deployer);
        console.log("next: setOracle -> sealRegistry -> setMintPrice -> setMintOpen");
    }
}
