// SPDX-License-Identifier: MIT
pragma solidity 0.8.27;

import { Script, console } from "forge-std/Script.sol";
import { SuwappuTimeCurve } from "../primitives/SuwappuTimeCurve.sol";
import { SuwappuAmortizingVault } from "../primitives/SuwappuAmortizingVault.sol";
import { SuwappuMutualCredit } from "../primitives/SuwappuMutualCredit.sol";

uint256 constant WAD = 1e18;
uint256 constant YEAR = 365 days;

/**
 * @title DeployPrimitives — deploy the immutable core primitives
 *
 * Each primitive is independent; deploy only what you need. Every parameter is
 * IMMUTABLE and fixed forever at deployment — there is no owner, pause, or
 * upgrade path. Read MAINNET_READINESS.md before deploying with real funds:
 * these carry no independent audit / testnet soak / bug bounty yet.
 *
 * Common:
 *   export DEPLOYER_PRIVATE_KEY=0x...
 *   export RPC_URL=https://mainnet.base.org
 *
 * ── SuwappuTimeCurve ────────────────────────────────────────────────────────
 *   export CURVE_NAME="Suwappu Curve"
 *   export CURVE_SYMBOL="sCRV"
 *   export CURVE_RESERVE=0x...            # ERC-20 reserve (<=18 decimals, standard token)
 *   export CURVE_BASE_PRICE=10000000000000000        # WAD price at s=0,t=0 (e.g. 0.01)
 *   export CURVE_SLOPE=1000000000000000              # WAD price per whole token of supply
 *   export CURVE_RATE_PER_YEAR_NEG=50000000000000000 # WAD magnitude of yearly decay (0.05 = 5%/yr); rate must be <= 0
 *   export CURVE_SINK=10000000000000000              # WAD sink fraction of gross sell (0.01 = 1%)
 *   forge script contracts/deploy/DeployPrimitives.s.sol:DeployTimeCurve --rpc-url $RPC_URL --broadcast --verify -vvvv
 *
 * ── SuwappuAmortizingVault ──────────────────────────────────────────────────
 *   export VAULT_COLLATERAL_4626=0x...    # a VETTED ERC-4626 (its share price IS this vault's oracle — see readiness doc)
 *   export VAULT_BORROW_RATE_PER_YEAR=20000000000000000  # WAD nominal simple rate (0.02 = 2%/yr)
 *   export VAULT_MAX_LTV=500000000000000000              # WAD (0.5 = 50%)
 *   export VAULT_LIQ_LTV=900000000000000000              # WAD (0.9 = 90%)
 *   export VAULT_LIQ_BONUS=50000000000000000             # WAD (0.05 = 5%)
 *   forge script contracts/deploy/DeployPrimitives.s.sol:DeployAmortizingVault --rpc-url $RPC_URL --broadcast --verify -vvvv
 *
 * ── SuwappuMutualCredit ─────────────────────────────────────────────────────
 *   (no constructor params)
 *   forge script contracts/deploy/DeployPrimitives.s.sol:DeployMutualCredit --rpc-url $RPC_URL --broadcast --verify -vvvv
 */

contract DeployTimeCurve is Script {
    function run() external returns (SuwappuTimeCurve curve) {
        uint256 pk = vm.envUint("DEPLOYER_PRIVATE_KEY");
        string memory name_ = vm.envString("CURVE_NAME");
        string memory symbol_ = vm.envString("CURVE_SYMBOL");
        address reserve = vm.envAddress("CURVE_RESERVE");
        uint256 basePrice = vm.envUint("CURVE_BASE_PRICE");
        uint256 slope = vm.envUint("CURVE_SLOPE");
        // Yearly decay magnitude in WAD; converted to a per-second signed rate <= 0.
        uint256 yearlyDecay = vm.envUint("CURVE_RATE_PER_YEAR_NEG");
        uint256 sink = vm.envUint("CURVE_SINK");

        require(reserve != address(0), "reserve=0");
        require(basePrice > 0, "basePrice=0");
        require(sink < WAD, "sink>=100%");
        require(slope <= 1e24, "slope too large");
        int256 ratePerSec = -int256(yearlyDecay / YEAR);
        require(ratePerSec >= -1e24, "decay too large");

        vm.startBroadcast(pk);
        curve = new SuwappuTimeCurve(name_, symbol_, reserve, basePrice, slope, ratePerSec, sink);
        vm.stopBroadcast();

        console.log("SuwappuTimeCurve:", address(curve));
        console.log("  reserve:", reserve);
        console.log("  basePrice(WAD):", basePrice);
        console.log("  slope(WAD):", slope);
        console.logInt(ratePerSec);
        console.log("  sinkRate(WAD):", sink);
    }
}

contract DeployAmortizingVault is Script {
    function run() external returns (SuwappuAmortizingVault vault) {
        uint256 pk = vm.envUint("DEPLOYER_PRIVATE_KEY");
        address collateral4626 = vm.envAddress("VAULT_COLLATERAL_4626");
        uint256 borrowRatePerYear = vm.envUint("VAULT_BORROW_RATE_PER_YEAR");
        uint256 maxLtv = vm.envUint("VAULT_MAX_LTV");
        uint256 liqLtv = vm.envUint("VAULT_LIQ_LTV");
        uint256 liqBonus = vm.envUint("VAULT_LIQ_BONUS");

        require(collateral4626 != address(0), "collateral=0");
        require(maxLtv > 0 && maxLtv < liqLtv && liqLtv < WAD, "ltv bounds");
        require(liqBonus <= 0.5e18, "bonus>50%");
        uint256 borrowRatePerSec = borrowRatePerYear / YEAR;
        require(borrowRatePerSec <= 1e12, "borrow rate too large");

        vm.startBroadcast(pk);
        vault = new SuwappuAmortizingVault(collateral4626, borrowRatePerSec, maxLtv, liqLtv, liqBonus);
        vm.stopBroadcast();

        console.log("SuwappuAmortizingVault:", address(vault));
        console.log("  collateral 4626:", collateral4626);
        console.log("  borrowRate/sec(WAD):", borrowRatePerSec);
        console.log("  maxLtv/liqLtv/bonus(WAD):", maxLtv, liqLtv, liqBonus);
        console.log("  !! the 4626 share price IS this vault's oracle - vet it (MAINNET_READINESS.md)");
    }
}

contract DeployMutualCredit is Script {
    function run() external returns (SuwappuMutualCredit mc) {
        uint256 pk = vm.envUint("DEPLOYER_PRIVATE_KEY");
        vm.startBroadcast(pk);
        mc = new SuwappuMutualCredit();
        vm.stopBroadcast();
        console.log("SuwappuMutualCredit:", address(mc));
    }
}
