// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/*//////////////////////////////////////////////////////////////////////////
                    PrimitivesFork — Base-mainnet fork integration tests

    Exercises the three immutable primitives against REAL Base mainnet state:
      - Real Base USDC (6 decimals) as the reserve / unit-of-account / debt asset,
        which is the whole point — it forces reserveScale != 1 in SuwappuTimeCurve
        and exact 6-decimal accounting everywhere else, unlike the 18-decimal
        MockUSD used in test/PrimitivesTest.t.sol.
      - A real, live Base ERC-4626 vault (Gauntlet USDC Prime, a Morpho
        MetaMorpho vault) as SuwappuAmortizingVault's collateral vault, so LTV,
        amortize()'s yield-crystallization, and liquidate() all read a genuine
        external share price instead of a hand-rolled mock.

    Degrades gracefully with no RPC configured: `setUp()` calls `vm.skip(true)`
    when BASE_MAINNET_RPC_URL is unset, so this suite is a no-op in CI/sandboxes
    without a Base RPC, and a real fork run wherever one is configured.

    Run with:
        BASE_MAINNET_RPC_URL=https://mainnet.base.org \
        forge test --match-path test/PrimitivesFork.t.sol -vvv

    Optionally pin a block for determinism:
        BASE_FORK_BLOCK=<blockNumber>
//////////////////////////////////////////////////////////////////////////*/

import "forge-std/Test.sol";
import "../primitives/SuwappuTimeCurve.sol";
import "../primitives/SuwappuAmortizingVault.sol";
import "../primitives/SuwappuMutualCredit.sol";

interface IERC20Fork {
    function balanceOf(address) external view returns (uint256);
    function transfer(address, uint256) external returns (bool);
    function approve(address, uint256) external returns (bool);
    function decimals() external view returns (uint8);
}

interface IERC4626Fork {
    function asset() external view returns (address);
    function deposit(uint256 assets, address receiver) external returns (uint256 shares);
    function balanceOf(address) external view returns (uint256);
    function approve(address, uint256) external returns (bool);
    function convertToAssets(uint256 shares) external view returns (uint256);
}

/// @dev Shared fork bootstrap + real-USDC funding helper for all three
///      primitives' fork suites below.
abstract contract BaseForkTest is Test {
    /// Base mainnet, canonical Circle USDC. 6 decimals — this is the whole
    /// reason to fork rather than use an 18-decimal mock reserve.
    address constant USDC = 0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913;

    /// Compound v3 (Comet) USDC market on Base. Deep, permanent USDC reserves
    /// (>$1M at the time this was written, verified live via `eth_call
    /// balanceOf` against https://mainnet.base.org on 2026-08-11) — used as a
    /// funding whale if `deal()` ever fails to find USDC's proxy storage slot.
    address constant USDC_WHALE = 0xb125E6687d4313864e53df431d5425969c15Eb2F;

    /// Gauntlet USDC Prime (gtUSDCp) — a real, live Morpho MetaMorpho ERC-4626
    /// vault on Base whose `asset()` is the USDC address above. ~$425M TVL at
    /// the time this was written (Morpho public API,
    /// https://blue-api.morpho.org/graphql, chainId 8453, 2026-08-11). Chosen
    /// over deploying our own OZ ERC4626 wrapper specifically so
    /// SuwappuAmortizingVault is tested against a *real* external share-price
    /// surface — which is the primitive's stated residual risk (see
    /// MAINNET_READINESS.md).
    address constant GAUNTLET_USDC_PRIME = 0xeE8F4eC5672F09119b96Ab6fB59C27E1b7e44b61;

    function _tryFork() internal {
        string memory rpc = vm.envOr("BASE_MAINNET_RPC_URL", string(""));
        if (bytes(rpc).length == 0) {
            // No RPC configured in this environment — degrade gracefully.
            // (Would run for real wherever BASE_MAINNET_RPC_URL is set.)
            vm.skip(true);
            return;
        }
        uint256 pinnedBlock = vm.envOr("BASE_FORK_BLOCK", uint256(0));
        if (pinnedBlock > 0) {
            vm.createSelectFork(rpc, pinnedBlock);
        } else {
            vm.createSelectFork(rpc);
        }
    }

    /// @dev Fund `to` with real Base USDC. Tries `deal()` first (fast, doesn't
    ///      depend on any single address's live balance). USDC's storage layout
    ///      (a FiatTokenProxy → FiatTokenV2_2 implementation) has historically
    ///      been deal()-compatible in Foundry, but if that ever regresses (e.g.
    ///      a proxy upgrade forge-std's slot-finder can't see through) this
    ///      falls back to a real peer-to-peer transfer pranked from a live
    ///      USDC whale, which is guaranteed to work against any ERC-20.
    function _fundUSDC(address to, uint256 amount) internal {
        uint256 before = IERC20Fork(USDC).balanceOf(to);
        try this._dealUSDC(to, before + amount) { } catch { }
        if (IERC20Fork(USDC).balanceOf(to) < before + amount) {
            uint256 shortfall = before + amount - IERC20Fork(USDC).balanceOf(to);
            vm.prank(USDC_WHALE);
            require(IERC20Fork(USDC).transfer(to, shortfall), "USDC_WHALE transfer failed");
        }
    }

    /// @dev External so `deal`'s revert-on-slot-not-found path can be caught
    ///      via try/catch from `_fundUSDC` (cheatcodes themselves aren't calls,
    ///      so they can't be try/catch'd directly).
    function _dealUSDC(address to, uint256 newBalance) external {
        deal(USDC, to, newBalance);
    }
}

// ---------------------------------------------------------------------------
// SuwappuTimeCurve — real 6-decimal USDC reserve
// ---------------------------------------------------------------------------
contract TimeCurveForkTest is BaseForkTest {
    SuwappuTimeCurve curve;
    address alice = makeAddr("fork-alice");
    address bob = makeAddr("fork-bob");

    // Same params as the unit-test suite's default curve: 0.01 USD base,
    // 0.001/token slope, 5%/yr decay, 1% sink.
    int256 constant DECAY = -int256(0.05e18) / int256(365 days);

    function setUp() public {
        _tryFork();
        curve = new SuwappuTimeCurve("Fork Curve", "CRV-T", USDC, 0.01e18, 0.001e18, DECAY, 0.01e18);
        _fundUSDC(alice, 1_000_000e6);
        _fundUSDC(bob, 1_000_000e6);
        vm.prank(alice);
        IERC20Fork(USDC).approve(address(curve), type(uint256).max);
        vm.prank(bob);
        IERC20Fork(USDC).approve(address(curve), type(uint256).max);
    }

    /// @notice Full buy -> decay -> sell round trip against real USDC.
    ///         Confirms reserveScale (10^(18-6) = 1e12 here) is applied
    ///         correctly end to end, not just in the 18-decimal mock suite.
    function testForkBuySellRoundTripWithRealUSDC() public {
        uint256 tokenAmount = 100e18; // 100 curve tokens
        uint256 quoted = curve.quoteBuy(tokenAmount);
        assertGt(quoted, 0);

        uint256 aliceBefore = IERC20Fork(USDC).balanceOf(alice);
        uint256 curveBefore = IERC20Fork(USDC).balanceOf(address(curve));

        vm.prank(alice);
        uint256 paid = curve.buy(tokenAmount, type(uint256).max, block.timestamp + 1 hours);

        assertEq(paid, quoted);
        assertEq(curve.balanceOf(alice), tokenAmount);
        // Real USDC actually moved, exactly `paid` units, in both directions.
        assertEq(aliceBefore - IERC20Fork(USDC).balanceOf(alice), paid);
        assertEq(IERC20Fork(USDC).balanceOf(address(curve)) - curveBefore, paid);
        assertEq(curve.reserveBalance(), paid);

        // Let the time-decay multiplier move for real.
        vm.warp(block.timestamp + 90 days);

        uint256 bobBefore = IERC20Fork(USDC).balanceOf(bob);
        vm.prank(alice);
        curve.transfer(bob, tokenAmount);
        vm.prank(bob);
        uint256 refund = curve.sell(tokenAmount, 0, block.timestamp + 1 hours);

        // Never profitable, and the payout is real, received USDC.
        assertLe(refund, paid);
        assertGt(refund, 0);
        assertEq(IERC20Fork(USDC).balanceOf(bob) - bobBefore, refund);
        assertEq(curve.totalSupply(), 0);
        // Sink + decay leave the curve solvent with a real USDC surplus.
        assertGt(curve.reserveBalance(), 0);
        assertGt(curve.totalSunk(), 0);
    }
}

// ---------------------------------------------------------------------------
// SuwappuAmortizingVault — real Gauntlet USDC Prime (Morpho) 4626 collateral
// ---------------------------------------------------------------------------
contract AmortizingVaultForkTest is BaseForkTest {
    SuwappuAmortizingVault vault;
    IERC4626Fork gtUSDCp;
    address lender = makeAddr("fork-lender");
    address borrower = makeAddr("fork-borrower");
    address keeper = makeAddr("fork-keeper");

    // 2%/yr borrow rate, 50% max LTV, 90% liq LTV, 5% bonus — same as the unit suite.
    uint256 constant RATE = uint256(0.02e18) / 365 days;

    function setUp() public {
        _tryFork();
        gtUSDCp = IERC4626Fork(GAUNTLET_USDC_PRIME);
        // Sanity: the vault's real asset() really is Base USDC. If Morpho ever
        // migrated/deprecated this vault, fail loudly here rather than silently
        // testing against the wrong token.
        assertEq(gtUSDCp.asset(), USDC, "GAUNTLET_USDC_PRIME.asset() != USDC, vault address stale?");

        vault = new SuwappuAmortizingVault(address(gtUSDCp), RATE, 0.5e18, 0.9e18, 0.05e18);

        _fundUSDC(lender, 1_000_000e6);
        _fundUSDC(borrower, 200_000e6);

        vm.startPrank(lender);
        IERC20Fork(USDC).approve(address(vault), type(uint256).max);
        vault.supply(500_000e6);
        vm.stopPrank();

        // Borrower deposits real USDC into the real Gauntlet vault to obtain
        // real gtUSDCp collateral shares — no mocking anywhere in this path.
        vm.startPrank(borrower);
        IERC20Fork(USDC).approve(address(gtUSDCp), type(uint256).max);
        gtUSDCp.deposit(100_000e6, borrower);
        gtUSDCp.approve(address(vault), type(uint256).max);
        vm.stopPrank();
    }

    /// @notice supply -> openPosition -> (real yield accrues) -> amortize ->
    ///         repay -> withdrawCollateral, all against the live Morpho vault.
    function testForkSupplyOpenAmortizeRepayWithdraw() public {
        uint256 collateralShares = gtUSDCp.balanceOf(borrower);
        assertGt(collateralShares, 0);

        vm.prank(borrower);
        uint256 id = vault.openPosition(collateralShares, 40_000e6, block.timestamp + 1 hours);
        assertEq(vault.debtOf(id), 40_000e6);
        assertEq(IERC20Fork(USDC).balanceOf(borrower), 100_000e6 + 40_000e6);

        // Real yield: Morpho markets accrue interest lazily as a function of
        // elapsed time, so convertToAssets(shares) should have moved without
        // anyone poking the vault.
        vm.warp(block.timestamp + 60 days);
        uint256 pending = vault.pendingYield(id);
        // Real-world yield can in principle be ~0 over a short window on a
        // conservative vault, so this is a soft check logged for visibility
        // rather than a hard revert-on-zero assumption.
        emit log_named_uint("pendingYield after 60d (6-dec USDC)", pending);

        vm.prank(keeper);
        uint256 applied = vault.amortize(id);
        emit log_named_uint("amortize() applied (6-dec USDC)", applied);
        assertLe(applied, pending);

        uint256 debtAfterAmortize = vault.debtOf(id);
        vm.startPrank(borrower);
        IERC20Fork(USDC).approve(address(vault), type(uint256).max);
        if (debtAfterAmortize > 0) {
            vault.repay(id, debtAfterAmortize);
        }
        assertEq(vault.debtOf(id), 0);

        (, uint256 sharesLeft,,) = vault.positions(id);
        vault.withdrawCollateral(id, sharesLeft, block.timestamp + 1 hours);
        vm.stopPrank();

        (, uint256 sharesAfter,,) = vault.positions(id);
        assertEq(sharesAfter, 0);
        // Borrower ends up holding real gtUSDCp shares again (collateral
        // returned via a real ERC-20 transfer from the vault).
        assertGt(gtUSDCp.balanceOf(borrower), 0);
    }
}

// ---------------------------------------------------------------------------
// SuwappuMutualCredit — real USDC settlement
// ---------------------------------------------------------------------------
contract MutualCreditForkTest is BaseForkTest {
    SuwappuMutualCredit mc;
    address alice = makeAddr("fork-alice-mc");
    address bob = makeAddr("fork-bob-mc");

    function setUp() public {
        _tryFork();
        mc = new SuwappuMutualCredit();
        _fundUSDC(alice, 10_000e6);
    }

    /// @notice proposeLine -> acceptLine -> pay -> settle, with `settle`
    ///         moving real peer-to-peer USDC (this primitive never custodies
    ///         the settlement asset itself — it's a pure bilateral ledger).
    function testForkProposeAcceptPaySettleWithRealUSDC() public {
        vm.prank(alice);
        mc.proposeLine(bob, USDC, 1_000e6, 0, 7 days);
        vm.prank(bob);
        mc.acceptLine(alice, USDC, 500e6);

        vm.prank(alice);
        mc.pay(bob, USDC, 300e6);
        assertEq(mc.owedBy(alice, bob, USDC), 300e6);

        vm.prank(alice);
        IERC20Fork(USDC).approve(address(mc), type(uint256).max);
        uint256 bobBefore = IERC20Fork(USDC).balanceOf(bob);
        vm.prank(alice);
        mc.settle(bob, USDC, 300e6);

        assertEq(mc.owedBy(alice, bob, USDC), 0);
        assertEq(IERC20Fork(USDC).balanceOf(bob) - bobBefore, 300e6);
    }
}
