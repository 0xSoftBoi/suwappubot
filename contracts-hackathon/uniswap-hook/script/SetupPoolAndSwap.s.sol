// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console} from "forge-std/Script.sol";
import {IPoolManager} from "v4-core/src/interfaces/IPoolManager.sol";
import {PoolKey} from "v4-core/src/types/PoolKey.sol";
import {Currency} from "v4-core/src/types/Currency.sol";
import {IHooks} from "v4-core/src/interfaces/IHooks.sol";
import {ModifyLiquidityParams, SwapParams} from "v4-core/src/types/PoolOperation.sol";
import {PoolSwapTest} from "v4-core/src/test/PoolSwapTest.sol";
import {PoolModifyLiquidityTest} from "v4-core/src/test/PoolModifyLiquidityTest.sol";
import {MockERC20} from "../src/MockERC20.sol";

address constant SEPOLIA_POOL_MANAGER = 0xE03A1074c86CFeDd5C142C4F04F1a1536e203543;
address constant SEPOLIA_POOL_SWAP_TEST = 0x9B6b46e2c869aa39918Db7f52f5557FE577B6eEe;
address constant SEPOLIA_POOL_MODIFY_LIQUIDITY_TEST = 0x0C478023803a644c94c4CE1C1e7b9A087e411B0A;
address constant HOOK = 0xc72ab4dFd3d6B2C1b3af51816EA8331599e6c080;

contract SetupPoolAndSwap is Script {
    function run() external {
        uint256 pk = vm.envUint("PRIVATE_KEY");
        address me = vm.addr(pk);

        vm.startBroadcast(pk);

        MockERC20 tokenA = new MockERC20("Agent Passport Token A", "APTA", 1_000_000 ether);
        MockERC20 tokenB = new MockERC20("Agent Passport Token B", "APTB", 1_000_000 ether);
        console.log("tokenA:", address(tokenA));
        console.log("tokenB:", address(tokenB));

        (Currency currency0, Currency currency1) = address(tokenA) < address(tokenB)
            ? (Currency.wrap(address(tokenA)), Currency.wrap(address(tokenB)))
            : (Currency.wrap(address(tokenB)), Currency.wrap(address(tokenA)));

        PoolKey memory key = PoolKey({
            currency0: currency0,
            currency1: currency1,
            fee: 3000,
            tickSpacing: 60,
            hooks: IHooks(HOOK)
        });

        uint160 sqrtPriceX96_1_1 = 79228162514264337593543950336; // 1:1 price, Q64.96
        IPoolManager(SEPOLIA_POOL_MANAGER).initialize(key, sqrtPriceX96_1_1);
        console.log("pool initialized");

        tokenA.approve(SEPOLIA_POOL_MODIFY_LIQUIDITY_TEST, type(uint256).max);
        tokenB.approve(SEPOLIA_POOL_MODIFY_LIQUIDITY_TEST, type(uint256).max);
        tokenA.approve(SEPOLIA_POOL_SWAP_TEST, type(uint256).max);
        tokenB.approve(SEPOLIA_POOL_SWAP_TEST, type(uint256).max);

        PoolModifyLiquidityTest(SEPOLIA_POOL_MODIFY_LIQUIDITY_TEST).modifyLiquidity(
            key,
            ModifyLiquidityParams({tickLower: -600, tickUpper: 600, liquidityDelta: 1e18, salt: bytes32(0)}),
            bytes("")
        );
        console.log("liquidity added");

        PoolSwapTest(SEPOLIA_POOL_SWAP_TEST).swap(
            key,
            SwapParams({zeroForOne: true, amountSpecified: -1e15, sqrtPriceLimitX96: 4295128740}),
            PoolSwapTest.TestSettings({takeClaims: false, settleUsingBurn: false}),
            abi.encode(me)
        );
        console.log("swap executed by:", me);

        vm.stopBroadcast();
    }
}
