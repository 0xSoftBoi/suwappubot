// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Test.sol";
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/token/ERC20/extensions/ERC4626.sol";
import "../primitives/SuwappuTimeCurve.sol";
import "../primitives/SuwappuAmortizingVault.sol";
import "../primitives/SuwappuMutualCredit.sol";

contract MockUSD is ERC20 {
    constructor() ERC20("Mock USD", "mUSD") {}

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }
}

contract MockYieldVault is ERC4626 {
    constructor(IERC20 asset_) ERC4626(asset_) ERC20("Yield mUSD", "ymUSD") {}
}

// ---------------------------------------------------------------------------
// SuwappuTimeCurve
// ---------------------------------------------------------------------------
contract TimeCurveTest is Test {
    MockUSD usd;
    SuwappuTimeCurve curve;
    address alice = makeAddr("alice");
    address bob = makeAddr("bob");

    // base 0.01 mUSD, slope 0.001/token, 5%/yr decay, 1% sink
    int256 constant DECAY = -int256(0.05e18) / int256(365 days);

    function setUp() public {
        usd = new MockUSD();
        curve = new SuwappuTimeCurve("Curve", "CRV-T", address(usd), 0.01e18, 0.001e18, DECAY, 0.01e18);
        usd.mint(alice, 1_000_000e18);
        usd.mint(bob, 1_000_000e18);
        vm.prank(alice);
        usd.approve(address(curve), type(uint256).max);
        vm.prank(bob);
        usd.approve(address(curve), type(uint256).max);
    }

    function testBuyMintsAndPullsReserve() public {
        vm.prank(alice);
        uint256 paid = curve.buy(100e18, type(uint256).max);
        assertEq(curve.balanceOf(alice), 100e18);
        assertEq(curve.reserveBalance(), paid);
        assertGt(paid, 0);
    }

    function testPriceRisesWithSupply() public {
        uint256 q1 = curve.quoteBuy(10e18);
        vm.prank(alice);
        curve.buy(1000e18, type(uint256).max);
        uint256 q2 = curve.quoteBuy(10e18);
        assertGt(q2, q1);
    }

    function testPriceDecaysWithTime() public {
        uint256 p1 = curve.spotPrice();
        vm.warp(block.timestamp + 365 days);
        uint256 p2 = curve.spotPrice();
        assertLt(p2, p1);
        // ~5% lower after a year
        assertApproxEqRel(p2, (p1 * 95) / 100, 0.01e18);
    }

    function testSellSolventAfterDecay() public {
        vm.prank(alice);
        curve.buy(1000e18, type(uint256).max);
        vm.warp(block.timestamp + 180 days);
        vm.prank(alice);
        uint256 out = curve.sell(1000e18, 0);
        assertGt(out, 0);
        // decay + sink guarantee the curve keeps a surplus
        assertGt(curve.reserveBalance(), 0);
        assertEq(curve.totalSupply(), 0);
    }

    function testSinkBurnsWithoutRefund() public {
        vm.prank(alice);
        uint256 paid = curve.buy(100e18, type(uint256).max);
        vm.prank(alice);
        uint256 refund = curve.sell(100e18, 0);
        assertEq(curve.totalSunk(), 1e18); // 1% of 100
        assertLt(refund, paid);
    }

    function testSlippageGuards() public {
        vm.prank(alice);
        vm.expectRevert(SuwappuTimeCurve.SlippageExceeded.selector);
        curve.buy(100e18, 1);
        vm.prank(alice);
        curve.buy(100e18, type(uint256).max);
        vm.prank(alice);
        vm.expectRevert(SuwappuTimeCurve.SlippageExceeded.selector);
        curve.sell(100e18, type(uint256).max);
    }

    function testGrowthCurveCappedByReserve() public {
        SuwappuTimeCurve growth = new SuwappuTimeCurve(
            "G", "G", address(usd), 0.01e18, 0.001e18, int256(1e18) / int256(365 days), 0.05e18
        );
        vm.startPrank(alice);
        usd.approve(address(growth), type(uint256).max);
        growth.buy(1000e18, type(uint256).max);
        vm.warp(block.timestamp + 3650 days);
        // quote never exceeds the actual reserve — hard solvency guard
        assertLe(growth.quoteSell(1000e18), growth.reserveBalance());
        growth.sell(1000e18, 0);
        vm.stopPrank();
    }

    function testFuzzRoundTripNeverProfitable(uint96 amount) public {
        uint256 amt = bound(uint256(amount), 1e15, 100_000e18);
        usd.mint(alice, curve.quoteBuy(amt));
        vm.startPrank(alice);
        uint256 paid = curve.buy(amt, type(uint256).max);
        uint256 refund = curve.sell(amt, 0);
        vm.stopPrank();
        assertLe(refund, paid);
    }
}

// ---------------------------------------------------------------------------
// SuwappuAmortizingVault
// ---------------------------------------------------------------------------
contract AmortizingVaultTest is Test {
    MockUSD usd;
    MockYieldVault yv;
    SuwappuAmortizingVault vault;
    address lender = makeAddr("lender");
    address borrower = makeAddr("borrower");
    address keeper = makeAddr("keeper");

    // 2%/yr borrow rate, 50% max LTV, 90% liq LTV, 5% bonus
    uint256 constant RATE = uint256(0.02e18) / 365 days;

    function setUp() public {
        usd = new MockUSD();
        yv = new MockYieldVault(usd);
        vault = new SuwappuAmortizingVault(address(yv), RATE, 0.5e18, 0.9e18, 0.05e18);

        usd.mint(lender, 1_000_000e18);
        usd.mint(borrower, 1_000_000e18);
        vm.startPrank(lender);
        usd.approve(address(vault), type(uint256).max);
        vault.supply(500_000e18);
        vm.stopPrank();

        vm.startPrank(borrower);
        usd.approve(address(yv), type(uint256).max);
        yv.deposit(100_000e18, borrower);
        yv.approve(address(vault), type(uint256).max);
        vm.stopPrank();
    }

    function _addYield(uint256 amount) internal {
        // simulate collateral vault earning yield: donate underlying
        usd.mint(address(yv), amount);
    }

    function testOpenPositionRespectsLtv() public {
        vm.startPrank(borrower);
        vm.expectRevert(SuwappuAmortizingVault.LtvExceeded.selector);
        vault.openPosition(100_000e18, 60_000e18);
        uint256 id = vault.openPosition(100_000e18, 50_000e18);
        vm.stopPrank();
        assertEq(vault.debtOf(id), 50_000e18);
        assertEq(usd.balanceOf(borrower), 950_000e18);
    }

    function testAmortizePaysDownDebtFromYield() public {
        vm.prank(borrower);
        uint256 id = vault.openPosition(100_000e18, 40_000e18);
        _addYield(10_000e18); // ~10% yield on the vault
        uint256 pending = vault.pendingYield(id);
        assertGt(pending, 0);
        vm.prank(keeper);
        uint256 applied = vault.amortize(id);
        assertGt(applied, 0);
        assertLt(vault.debtOf(id), 40_000e18);
    }

    function testSelfRepaysToZeroAndUnlocks() public {
        vm.prank(borrower);
        uint256 id = vault.openPosition(100_000e18, 10_000e18);
        _addYield(50_000e18);
        vm.prank(keeper);
        vault.amortize(id);
        assertEq(vault.debtOf(id), 0);
        (, uint256 shares,,) = vault.positions(id);
        vm.prank(borrower);
        vault.withdrawCollateral(id, shares);
        (, uint256 after_,,) = vault.positions(id);
        assertEq(after_, 0);
    }

    function testInterestAccrues() public {
        vm.prank(borrower);
        uint256 id = vault.openPosition(100_000e18, 40_000e18);
        vm.warp(block.timestamp + 365 days);
        assertApproxEqRel(vault.debtOf(id), 40_800e18, 0.01e18); // +2%
    }

    function testLenderEarnsInterest() public {
        vm.prank(borrower);
        uint256 id = vault.openPosition(100_000e18, 50_000e18);
        vm.warp(block.timestamp + 365 days);
        vm.startPrank(borrower);
        usd.approve(address(vault), type(uint256).max);
        vault.repay(id, vault.debtOf(id));
        vm.stopPrank();
        uint256 shares = vault.lendShares(lender);
        vm.prank(lender);
        uint256 got = vault.withdraw(shares);
        assertGt(got, 500_000e18); // principal + ~2% on the borrowed 50k
    }

    function testWithdrawCollateralBlockedAboveLtv() public {
        vm.startPrank(borrower);
        uint256 id = vault.openPosition(100_000e18, 50_000e18);
        vm.expectRevert(SuwappuAmortizingVault.LtvExceeded.selector);
        vault.withdrawCollateral(id, 50_000e18);
        vm.stopPrank();
    }

    function testLiquidationOnlyWhenUndercollateralized() public {
        vm.prank(borrower);
        uint256 id = vault.openPosition(100_000e18, 50_000e18);
        usd.mint(keeper, 100_000e18);
        vm.startPrank(keeper);
        usd.approve(address(vault), type(uint256).max);
        vm.expectRevert(SuwappuAmortizingVault.NotLiquidatable.selector);
        vault.liquidate(id);
        vm.stopPrank();

        // crash the share price: pull most of the vault's assets
        vm.prank(address(yv));
        usd.transfer(address(0xdead), 45_000e18);

        vm.prank(keeper);
        vault.liquidate(id);
        assertEq(vault.debtOf(id), 0);
        assertGt(yv.balanceOf(keeper), 0);
    }
}

// ---------------------------------------------------------------------------
// SuwappuMutualCredit
// ---------------------------------------------------------------------------
contract MutualCreditTest is Test {
    MockUSD usd;
    SuwappuMutualCredit mc;
    address alice = makeAddr("alice");
    address bob = makeAddr("bob");
    address carol = makeAddr("carol");

    function setUp() public {
        usd = new MockUSD();
        mc = new SuwappuMutualCredit();
    }

    function _open(address x, address y, uint256 limX, uint256 limY) internal {
        vm.prank(x);
        mc.proposeLine(y, address(usd), limX, 0, 7 days);
        vm.prank(y);
        mc.acceptLine(x, address(usd), limY);
    }

    function testHandshakeAndPay() public {
        _open(alice, bob, 1000e18, 500e18);
        vm.prank(alice);
        mc.pay(bob, address(usd), 300e18); // alice now owes bob 300
        assertEq(mc.owedBy(alice, bob, address(usd)), 300e18);
        assertEq(mc.owedBy(bob, alice, address(usd)), 0);
    }

    function testPayRespectsCounterpartyLimit() public {
        _open(alice, bob, 1000e18, 500e18);
        vm.prank(alice);
        vm.expectRevert(SuwappuMutualCredit.LimitExceeded.selector);
        mc.pay(bob, address(usd), 501e18); // bob only extended 500 to alice
    }

    function testPayNetsBilaterally() public {
        _open(alice, bob, 1000e18, 500e18);
        vm.prank(alice);
        mc.pay(bob, address(usd), 300e18);
        vm.prank(bob);
        mc.pay(alice, address(usd), 400e18);
        assertEq(mc.owedBy(alice, bob, address(usd)), 0);
        assertEq(mc.owedBy(bob, alice, address(usd)), 100e18);
    }

    function testCycleNetting() public {
        _open(alice, bob, 1000e18, 1000e18);
        _open(bob, carol, 1000e18, 1000e18);
        _open(carol, alice, 1000e18, 1000e18);
        vm.prank(alice);
        mc.pay(bob, address(usd), 300e18); // A owes B 300
        vm.prank(bob);
        mc.pay(carol, address(usd), 200e18); // B owes C 200
        vm.prank(carol);
        mc.pay(alice, address(usd), 250e18); // C owes A 250

        address[] memory cycle = new address[](3);
        cycle[0] = alice;
        cycle[1] = bob;
        cycle[2] = carol;
        mc.netCycle(address(usd), cycle); // min = 200

        assertEq(mc.owedBy(alice, bob, address(usd)), 100e18);
        assertEq(mc.owedBy(bob, carol, address(usd)), 0);
        assertEq(mc.owedBy(carol, alice, address(usd)), 50e18);
    }

    function testCycleNettingRejectsBrokenCycle() public {
        _open(alice, bob, 1000e18, 1000e18);
        _open(bob, carol, 1000e18, 1000e18);
        _open(carol, alice, 1000e18, 1000e18);
        vm.prank(alice);
        mc.pay(bob, address(usd), 300e18);
        address[] memory cycle = new address[](3);
        cycle[0] = alice;
        cycle[1] = bob;
        cycle[2] = carol;
        vm.expectRevert(SuwappuMutualCredit.BadCycle.selector);
        mc.netCycle(address(usd), cycle);
    }

    function testSettleWithRealTokens() public {
        _open(alice, bob, 1000e18, 500e18);
        vm.prank(alice);
        mc.pay(bob, address(usd), 300e18);
        usd.mint(alice, 300e18);
        vm.startPrank(alice);
        usd.approve(address(mc), type(uint256).max);
        mc.settle(bob, address(usd), 300e18);
        vm.stopPrank();
        assertEq(mc.owedBy(alice, bob, address(usd)), 0);
        assertEq(usd.balanceOf(bob), 300e18);
    }

    function testDefaultAfterGrace() public {
        _open(alice, bob, 1000e18, 500e18);
        vm.prank(alice);
        mc.pay(bob, address(usd), 300e18);
        vm.prank(bob);
        mc.demandSettlement(alice, address(usd));
        vm.prank(bob);
        vm.expectRevert(SuwappuMutualCredit.GraceNotElapsed.selector);
        mc.markDefault(alice, address(usd));
        vm.warp(block.timestamp + 7 days + 1);
        vm.prank(bob);
        mc.markDefault(alice, address(usd));
        assertEq(mc.defaults(alice), 1);
    }

    function testInterestAccruesTowardCreditor() public {
        vm.prank(alice);
        mc.proposeLine(bob, address(usd), 1000e18, uint256(0.1e18) / 365 days, 7 days);
        vm.prank(bob);
        mc.acceptLine(alice, address(usd), 1000e18);
        vm.prank(alice);
        mc.pay(bob, address(usd), 100e18);
        vm.warp(block.timestamp + 365 days);
        // ~10% APR simple interest
        assertApproxEqRel(mc.owedBy(alice, bob, address(usd)), 110e18, 0.01e18);
    }

    function testCloseRequiresZeroBalance() public {
        _open(alice, bob, 1000e18, 500e18);
        vm.prank(alice);
        mc.pay(bob, address(usd), 1e18);
        vm.prank(alice);
        vm.expectRevert(SuwappuMutualCredit.NothingOwed.selector);
        mc.closeLine(bob, address(usd));
    }
}
