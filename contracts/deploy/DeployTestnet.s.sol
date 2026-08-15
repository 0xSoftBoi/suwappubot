// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { Script, console } from "forge-std/Script.sol";
import { SUWP } from "../SUWP.sol";
import { SuwppuStaking } from "../SuwppuStaking.sol";
import { SuwppuBonds } from "../SuwppuBonds.sol";

/**
 * @title DeployTestnet — Base Sepolia deployment
 *
 * Superfluid on Base Sepolia:
 *   Host:  0x109412E3C84f0539b43d39dB691B08c90f58dC7c
 *   GDA:   0x68Ae1b4ba46d276e0fDFb7DCa7e93f5A2B1e6Ed6
 *   USDCx: 0x8aE68021f6170E5a766bE613cEA0d75236ECCa9a
 *
 * Uniswap v3 on Base Sepolia:
 *   Position Manager: 0x27F971cb582BF9E50F397e4d29a5C7A34f11faA2
 *
 * Usage:
 *   export DEPLOYER_PRIVATE_KEY=0x...
 *   export BASE_SEPOLIA_RPC_URL=https://sepolia.base.org
 *   export BASESCAN_API_KEY=...
 *
 *   forge script contracts/deploy/DeployTestnet.s.sol \
 *     --rpc-url $BASE_SEPOLIA_RPC_URL \
 *     --broadcast \
 *     --verify \
 *     -vvvv
 */
contract DeployTestnet is Script {
    // ─── Superfluid Base Sepolia ───────────────────────────────────────────────
    address constant SF_HOST  = 0x109412E3C84f0539b43d39dB691B08c90f58dC7c;
    address constant SF_GDA   = 0x68aE1b4ba46d276e0FDfB7dCa7E93f5A2B1E6Ed6;
    address constant SF_USDCX = 0x8aE68021f6170E5a766bE613cEA0d75236ECCa9a;

    // ─── Uniswap v3 Base Sepolia ──────────────────────────────────────────────
    address constant UNISWAP_POSITION_MANAGER = 0x27F971cb582BF9E50F397e4d29a5C7A34f11faA2;
    address constant UNISWAP_FACTORY          = 0x4752ba5DBc23f44D87826276BF6Fd6b1C372aD24;

    // ─── Testnet USDC (Base Sepolia) ──────────────────────────────────────────
    // Official Circle testnet USDC on Base Sepolia
    address constant USDC = 0x036CbD53842c5426634e7929541eC2318f3dCF7e;

    function run() external {
        uint256 deployerKey = vm.envUint("DEPLOYER_PRIVATE_KEY");
        address deployer = vm.addr(deployerKey);
        console.log("Deployer:", deployer);
        console.log("Balance:", deployer.balance);

        vm.startBroadcast(deployerKey);

        // 1. Deploy SUWP token
        SUWP suwp = new SUWP(deployer);
        console.log("SUWP deployed at:", address(suwp));

        // 2. Deploy SuwppuStaking (Superfluid GDA pool)
        SuwppuStaking staking = new SuwppuStaking(
            address(suwp),
            USDC,
            SF_USDCX,
            SF_HOST,
            SF_GDA,
            deployer
        );
        console.log("SuwppuStaking deployed at:", address(staking));

        // 3. Deploy SuwppuBonds
        SuwppuBonds bonds = new SuwppuBonds(
            address(suwp),
            USDC,
            UNISWAP_POSITION_MANAGER,
            UNISWAP_FACTORY,
            deployer
        );
        console.log("SuwppuBonds deployed at:", address(bonds));

        // 4. Grant MINTER_ROLE on SUWP to both Staking and Bonds
        bytes32 MINTER_ROLE = keccak256("MINTER_ROLE");
        suwp.grantRole(MINTER_ROLE, address(staking));
        console.log("Granted MINTER_ROLE to Staking");
        suwp.grantRole(MINTER_ROLE, address(bonds));
        console.log("Granted MINTER_ROLE to Bonds");

        // 5. Mint 1,000,000 SUWP to deployer (for testing)
        suwp.mint(deployer, 1_000_000e18, "testnet_initial_supply");
        console.log("Minted 1M SUWP to deployer");

        vm.stopBroadcast();

        // ─── Summary ──────────────────────────────────────────────────────────
        console.log("\n=== DEPLOYMENT COMPLETE ===");
        console.log("SUWP:           ", address(suwp));
        console.log("SuwppuStaking:  ", address(staking));
        console.log("SuwppuBonds:    ", address(bonds));
        console.log("\nAdd to Railway env:");
        console.log("SUWP_CONTRACT_ADDRESS=", address(suwp));
        console.log("STAKING_CONTRACT_ADDRESS=", address(staking));
        console.log("BONDS_CONTRACT_ADDRESS=", address(bonds));
    }
}
