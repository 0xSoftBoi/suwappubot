// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {Script, console} from "forge-std/Script.sol";
import {Aqua} from "@1inch/aqua/Aqua.sol";
import {IAqua} from "@1inch/aqua/interfaces/IAqua.sol";
import {WorldIdGatedXYCSwap} from "../src/WorldIdGatedXYCSwap.sol";
import {SimpleTaker} from "../src/SimpleTaker.sol";
import {MockERC20} from "../src/MockERC20.sol";

contract DeployAndDemo is Script {
    function run() external {
        uint256 pk = vm.envUint("PRIVATE_KEY");
        address me = vm.addr(pk);

        vm.startBroadcast(pk);

        Aqua aqua = new Aqua();
        console.log("Aqua deployed at:", address(aqua));

        WorldIdGatedXYCSwap app = new WorldIdGatedXYCSwap(IAqua(address(aqua)), me);
        console.log("WorldIdGatedXYCSwap deployed at:", address(app));

        MockERC20 tokenA = new MockERC20("Agent Passport Aqua Token A", "APAA", 1_000_000 ether);
        MockERC20 tokenB = new MockERC20("Agent Passport Aqua Token B", "APAB", 1_000_000 ether);
        console.log("tokenA:", address(tokenA));
        console.log("tokenB:", address(tokenB));

        SimpleTaker taker = new SimpleTaker(IAqua(address(aqua)));
        console.log("taker deployed at:", address(taker));

        // Verify the taker contract itself for World ID (demo: this taker acts on
        // behalf of our already-verified test wallet).
        app.setWorldIdVerified(address(taker), true);
        console.log("taker set as World ID verified");

        // Ship a strategy: maker = me, providing initial liquidity for both tokens.
        WorldIdGatedXYCSwap.Strategy memory strategy = WorldIdGatedXYCSwap.Strategy({
            maker: me,
            token0: address(tokenA),
            token1: address(tokenB),
            feeBps: 30,
            salt: bytes32(0)
        });

        tokenA.approve(address(aqua), type(uint256).max);
        tokenB.approve(address(aqua), type(uint256).max);

        address[] memory tokens = new address[](2);
        tokens[0] = address(tokenA);
        tokens[1] = address(tokenB);
        uint256[] memory amounts = new uint256[](2);
        amounts[0] = 1000 ether;
        amounts[1] = 1000 ether;

        bytes32 strategyHash = aqua.ship(address(app), abi.encode(strategy), tokens, amounts);
        console.log("strategy shipped, hash:");
        console.logBytes32(strategyHash);

        // Fund the taker with tokenA so it can swap for tokenB.
        tokenA.transfer(address(taker), 10 ether);
        taker.approveToken(address(tokenA));

        uint256 amountOut = taker.swap(app, strategy, true, 1 ether);
        console.log("swap executed, amountOut:", amountOut);

        vm.stopBroadcast();
    }
}
