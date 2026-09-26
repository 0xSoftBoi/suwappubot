// SPDX-License-Identifier: MIT
pragma solidity 0.8.27;

import "forge-std/Test.sol";
import "forge-std/console2.sol";
import "../primitives/SuwappuTimeCurve.sol";
import "../primitives/SuwappuAmortizingVault.sol";
import "../primitives/SuwappuMutualCredit.sol";

/*//////////////////////////////////////////////////////////////////////////
    Foundry stateful invariant suite for the three immutable primitives.

    Pattern: one Handler contract per primitive that exposes bounded,
    try/catch-wrapped entry points to the fuzzer, plus one Test contract per
    primitive that registers the handler via targetContract/targetSelector
    and asserts the money invariants either as `invariant_*` view functions
    (checked after every fuzzed call sequence) or as inline assertions inside
    the handler itself (for "this single operation must preserve X" claims,
    e.g. netCycle conservation, which need a before/after snapshot bracketing
    one specific call rather than a global point-in-time check).
//////////////////////////////////////////////////////////////////////////*/

/// @dev Minimal inlined ERC20 so this file has no external OZ dependency beyond
///      the ERC4626 mock below (kept separate from the primitives under test).
abstract contract ERC20Like {
    string public name;
    string public symbol;
    uint8 public constant decimals = 18;
    uint256 public totalSupply;
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;

    constructor(string memory n, string memory s) {
        name = n;
        symbol = s;
    }

    function approve(address spender, uint256 amount) external returns (bool) {
        allowance[msg.sender][spender] = amount;
        return true;
    }

    function transfer(address to, uint256 amount) external returns (bool) {
        _transfer(msg.sender, to, amount);
        return true;
    }

    function transferFrom(address from, address to, uint256 amount) external returns (bool) {
        uint256 allowed = allowance[from][msg.sender];
        if (allowed != type(uint256).max) {
            require(allowed >= amount, "ALLOWANCE");
            allowance[from][msg.sender] = allowed - amount;
        }
        _transfer(from, to, amount);
        return true;
    }

    function _transfer(address from, address to, uint256 amount) internal {
        require(balanceOf[from] >= amount, "BALANCE");
        unchecked {
            balanceOf[from] -= amount;
            balanceOf[to] += amount;
        }
    }

    function _mint(address to, uint256 amount) internal {
        totalSupply += amount;
        balanceOf[to] += amount;
    }

    function _burn(address from, uint256 amount) internal {
        require(balanceOf[from] >= amount, "BALANCE");
        balanceOf[from] -= amount;
        totalSupply -= amount;
    }
}

contract MockUSD is ERC20Like {
    constructor() ERC20Like("Mock USD", "mUSD") {}

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }
}

/// @dev Minimal ERC4626-style yield vault mock (1:1 share/asset at deploy,
///      share price rises when `asset` is minted directly to this contract —
///      mirrors PrimitivesTest.t.sol's MockYieldVault pattern).
contract MockYieldVault is ERC20Like {
    MockUSD public immutable asset;

    constructor(MockUSD asset_) ERC20Like("Yield mUSD", "ymUSD") {
        asset = asset_;
    }

    function totalAssets() public view returns (uint256) {
        return asset.balanceOf(address(this));
    }

    function convertToShares(uint256 assets) public view returns (uint256) {
        uint256 supply = totalSupply;
        return supply == 0 ? assets : (assets * supply) / totalAssets();
    }

    function convertToAssets(uint256 shares) public view returns (uint256) {
        uint256 supply = totalSupply;
        return supply == 0 ? shares : (shares * totalAssets()) / supply;
    }

    function maxWithdraw(address owner) public view returns (uint256) {
        return convertToAssets(balanceOf[owner]);
    }

    function deposit(uint256 assets, address receiver) external returns (uint256 shares) {
        shares = convertToShares(assets);
        require(asset.transferFrom(msg.sender, address(this), assets), "XFER");
        _mint(receiver, shares);
    }

    function withdraw(uint256 assets, address receiver, address owner) external returns (uint256 shares) {
        shares = convertToShares(assets);
        if (shares == 0 && assets > 0) shares = 1;
        _burn(owner, shares);
        require(asset.transfer(receiver, assets), "XFER");
    }
}

/*//////////////////////////////////////////////////////////////////////////
                        SuwappuTimeCurve — Handler + Invariants
//////////////////////////////////////////////////////////////////////////*/

contract TimeCurveHandler is Test {
    SuwappuTimeCurve public curve;
    MockUSD public usd;
    address[] public actors;

    bool public insufficientReserveHappened;
    uint256 public buyCalls;
    uint256 public sellCalls;
    uint256 public warpCalls;

    constructor(SuwappuTimeCurve _curve, MockUSD _usd, string memory salt) {
        curve = _curve;
        usd = _usd;
        for (uint256 i = 0; i < 3; i++) {
            address a = makeAddr(string(abi.encodePacked(salt, "-actor-", vm.toString(i))));
            actors.push(a);
            vm.prank(a);
            usd.approve(address(curve), type(uint256).max);
        }
    }

    function _actor(uint256 seed) internal view returns (address) {
        return actors[seed % actors.length];
    }

    function buy(uint256 actorSeed, uint256 amountSeed) external {
        address actor = _actor(actorSeed);
        uint256 amount = bound(amountSeed, 1e12, 200_000e18);
        uint256 cost;
        try curve.quoteBuy(amount) returns (uint256 c) {
            cost = c;
        } catch {
            return;
        }
        if (cost == 0) return; // dust: contract itself rejects free mints
        usd.mint(actor, cost);
        uint256 balBefore = curve.reserveBalance();
        vm.prank(actor);
        try curve.buy(amount, type(uint256).max, type(uint256).max) returns (uint256) {
            buyCalls++;
            // NO FREE MINT: every successful buy must strictly grow the reserve.
            assertGt(curve.reserveBalance(), balBefore, "buy minted without growing reserve");
        } catch {}
    }

    function sell(uint256 actorSeed, uint256 amountSeed) external {
        address actor = _actor(actorSeed);
        uint256 bal = curve.balanceOf(actor);
        if (bal == 0) return;
        uint256 amount = bound(amountSeed, 1, bal);
        vm.prank(actor);
        try curve.sell(amount, 0, type(uint256).max) returns (uint256) {
            sellCalls++;
        } catch (bytes memory reason) {
            if (_isSelector(reason, SuwappuTimeCurve.InsufficientReserve.selector)) {
                insufficientReserveHappened = true;
            }
        }
    }

    function warp(uint256 jump) external {
        uint256 dt = bound(jump, 0, 15 days);
        vm.warp(block.timestamp + dt);
        warpCalls++;
    }

    function _isSelector(bytes memory reason, bytes4 sel) internal pure returns (bool) {
        if (reason.length < 4) return false;
        bytes4 got;
        assembly {
            got := mload(add(reason, 32))
        }
        return got == sel;
    }
}

abstract contract TimeCurveInvariantBase is Test {
    MockUSD usd;
    SuwappuTimeCurve curve;
    TimeCurveHandler handler;
    uint256 lastSunk;

    function _setUpCurve(int256 rate, uint256 sinkRate, string memory salt) internal {
        usd = new MockUSD();
        curve = new SuwappuTimeCurve(
            "Curve", "CRV", address(usd), 0.01e18, 0.001e18, rate, sinkRate
        );
        handler = new TimeCurveHandler(curve, usd, salt);

        targetContract(address(handler));
        bytes4[] memory selectors = new bytes4[](3);
        selectors[0] = TimeCurveHandler.buy.selector;
        selectors[1] = TimeCurveHandler.sell.selector;
        selectors[2] = TimeCurveHandler.warp.selector;
        targetSelector(FuzzSelector({addr: address(handler), selectors: selectors}));
    }

    /// INVARIANT (solvency): a full unwind of the entire supply must never cost
    /// more than the reserve actually holds — and must not revert.
    function invariant_fullUnwindNeverExceedsReserve() public view {
        uint256 supply = curve.totalSupply();
        if (supply == 0) return;
        assertLe(curve.quoteSell(supply), curve.reserveBalance());
    }

    /// INVARIANT: for rate <= 0, sequential random buys/sells never hit
    /// InsufficientReserve on a legitimate (balance-bounded) sell.
    function invariant_neverInsufficientReserve() public view {
        assertFalse(handler.insufficientReserveHappened(), "InsufficientReserve on rate<=0 curve");
    }

    /// INVARIANT: totalSunk is monotonically non-decreasing.
    function invariant_totalSunkMonotonic() public {
        uint256 cur = curve.totalSunk();
        assertGe(cur, lastSunk, "totalSunk decreased");
        lastSunk = cur;
    }
}

/// forge-config: default.invariant.runs = 256
/// forge-config: default.invariant.depth = 64
contract TimeCurveFlatInvariantTest is TimeCurveInvariantBase {
    function setUp() public {
        // flat schedule: rate = 0, 1% sink
        _setUpCurve(0, 0.01e18, "flat");
    }
}

/// forge-config: default.invariant.runs = 256
/// forge-config: default.invariant.depth = 64
contract TimeCurveDecayInvariantTest is TimeCurveInvariantBase {
    // 5%/yr decay, 1% sink — matches PrimitivesTest.t.sol's DECAY constant.
    int256 constant DECAY = -int256(0.05e18) / int256(365 days);

    function setUp() public {
        _setUpCurve(DECAY, 0.01e18, "decay");
    }
}

/*//////////////////////////////////////////////////////////////////////////
                    SuwappuAmortizingVault — Handler + Invariants
//////////////////////////////////////////////////////////////////////////*/

contract VaultHandler is Test {
    SuwappuAmortizingVault public vault;
    MockUSD public usd;
    MockYieldVault public yv;
    address[] public actors;

    constructor(SuwappuAmortizingVault _vault, MockUSD _usd, MockYieldVault _yv) {
        vault = _vault;
        usd = _usd;
        yv = _yv;
        for (uint256 i = 0; i < 4; i++) {
            address a = makeAddr(string(abi.encodePacked("vault-actor-", vm.toString(i))));
            actors.push(a);
            usd.mint(a, 50_000_000e18);
            vm.startPrank(a);
            usd.approve(address(vault), type(uint256).max);
            usd.approve(address(yv), type(uint256).max);
            yv.approve(address(vault), type(uint256).max);
            vm.stopPrank();
        }
        // seed the lending pool so borrowing is possible from the very first call
        vm.prank(actors[0]);
        vault.supply(10_000_000e18);
    }

    function actorsLength() external view returns (uint256) {
        return actors.length;
    }

    function _actor(uint256 seed) internal view returns (address) {
        return actors[seed % actors.length];
    }

    function supply(uint256 actorSeed, uint256 amtSeed) external {
        address a = _actor(actorSeed);
        uint256 amt = bound(amtSeed, 1e18, 5_000_000e18);
        if (usd.balanceOf(a) < amt) usd.mint(a, amt);
        vm.prank(a);
        try vault.supply(amt) {} catch {}
    }

    function withdraw(uint256 actorSeed, uint256 sharesSeed) external {
        address a = _actor(actorSeed);
        uint256 bal = vault.lendShares(a);
        if (bal == 0) return;
        uint256 shares = bound(sharesSeed, 1, bal);
        vm.prank(a);
        try vault.withdraw(shares) {} catch {}
    }

    function openPosition(uint256 actorSeed, uint256 depositSeed, uint256 ltvSeed) external {
        address a = _actor(actorSeed);
        uint256 deposit_ = bound(depositSeed, 1000e18, 500_000e18);
        if (usd.balanceOf(a) < deposit_) usd.mint(a, deposit_);
        vm.startPrank(a);
        uint256 shares = yv.deposit(deposit_, a);
        uint256 value = yv.convertToAssets(shares);
        uint256 ltvBps = bound(ltvSeed, 0, 4900); // mostly stay under the 50% maxLtv
        uint256 borrowAssets = (value * ltvBps) / 10_000;
        try vault.openPosition(shares, borrowAssets, type(uint256).max) {} catch {}
        vm.stopPrank();
    }

    function addCollateral(uint256 actorSeed, uint256 posIdSeed, uint256 depositSeed) external {
        uint256 n = vault.nextPositionId();
        if (n == 0) return;
        uint256 id = posIdSeed % n;
        address a = _actor(actorSeed);
        uint256 deposit_ = bound(depositSeed, 1e18, 100_000e18);
        if (usd.balanceOf(a) < deposit_) usd.mint(a, deposit_);
        vm.startPrank(a);
        uint256 shares = yv.deposit(deposit_, a);
        try vault.addCollateral(id, shares) {} catch {}
        vm.stopPrank();
    }

    function repay(uint256 actorSeed, uint256 posIdSeed, uint256 amtSeed) external {
        uint256 n = vault.nextPositionId();
        if (n == 0) return;
        uint256 id = posIdSeed % n;
        uint256 debt = vault.debtOf(id);
        if (debt == 0) return;
        uint256 amt = bound(amtSeed, 1, debt);
        address a = _actor(actorSeed);
        if (usd.balanceOf(a) < amt) usd.mint(a, amt);
        vm.prank(a);
        try vault.repay(id, amt) {} catch {}
    }

    function amortize(uint256 posIdSeed) external {
        uint256 n = vault.nextPositionId();
        if (n == 0) return;
        uint256 id = posIdSeed % n;
        try vault.amortize(id) {} catch {}
    }

    function withdrawCollateral(uint256 posIdSeed, uint256 sharesSeed) external {
        uint256 n = vault.nextPositionId();
        if (n == 0) return;
        uint256 id = posIdSeed % n;
        (address owner, uint256 shares,,) = vault.positions(id);
        if (owner == address(0) || shares == 0) return;
        uint256 want = bound(sharesSeed, 1, shares);
        vm.prank(owner);
        try vault.withdrawCollateral(id, want, type(uint256).max) {} catch {}
    }

    function liquidate(uint256 actorSeed, uint256 posIdSeed, uint256 repaySeed) external {
        uint256 n = vault.nextPositionId();
        if (n == 0) return;
        uint256 id = posIdSeed % n;
        uint256 debt = vault.debtOf(id);
        if (debt == 0) return;
        uint256 repay_ = bound(repaySeed, 1, debt);
        address a = _actor(actorSeed);
        if (usd.balanceOf(a) < repay_) usd.mint(a, repay_);
        vm.prank(a);
        try vault.liquidate(id, repay_, type(uint256).max) {} catch {}
    }

    function addYield(uint256 amtSeed) external {
        uint256 amt = bound(amtSeed, 0, 200_000e18);
        if (amt == 0) return;
        usd.mint(address(yv), amt);
    }

    /// @dev simulates a collateral value crash (needed to actually trigger
    ///      liquidations) by draining part of the yield vault's own balance —
    ///      never through the handler donating to the vault under test.
    function crashValue(uint256 amtSeed) external {
        uint256 bal = usd.balanceOf(address(yv));
        if (bal == 0) return;
        uint256 amt = bound(amtSeed, 0, bal / 2);
        if (amt == 0) return;
        vm.prank(address(yv));
        usd.transfer(address(0xdead), amt);
    }

    function warp(uint256 jump) external {
        uint256 dt = bound(jump, 0, 20 days);
        vm.warp(block.timestamp + dt);
    }
}

/// forge-config: default.invariant.runs = 256
/// forge-config: default.invariant.depth = 64
contract AmortizingVaultInvariantTest is Test {
    MockUSD usd;
    MockYieldVault yv;
    SuwappuAmortizingVault vault;
    VaultHandler handler;

    uint256 constant RATE = uint256(0.02e18) / 365 days;
    uint256 constant VIRTUAL = 1e6; // mirrors the vault's internal virtual offset

    function setUp() public {
        usd = new MockUSD();
        yv = new MockYieldVault(usd);
        vault = new SuwappuAmortizingVault(address(yv), RATE, 0.5e18, 0.9e18, 0.05e18);
        handler = new VaultHandler(vault, usd, yv);

        targetContract(address(handler));
        bytes4[] memory selectors = new bytes4[](11);
        selectors[0] = VaultHandler.supply.selector;
        selectors[1] = VaultHandler.withdraw.selector;
        selectors[2] = VaultHandler.openPosition.selector;
        selectors[3] = VaultHandler.addCollateral.selector;
        selectors[4] = VaultHandler.repay.selector;
        selectors[5] = VaultHandler.amortize.selector;
        selectors[6] = VaultHandler.withdrawCollateral.selector;
        selectors[7] = VaultHandler.liquidate.selector;
        selectors[8] = VaultHandler.addYield.selector;
        selectors[9] = VaultHandler.crashValue.selector;
        selectors[10] = VaultHandler.warp.selector;
        targetSelector(FuzzSelector({addr: address(handler), selectors: selectors}));
    }

    /// INVARIANT: sum of per-position debtScaled == totalDebtScaled.
    function invariant_debtAccounting() public view {
        uint256 n = vault.nextPositionId();
        uint256 sum;
        for (uint256 i = 0; i < n; i++) {
            (,,, uint256 debtScaled) = vault.positions(i);
            sum += debtScaled;
        }
        assertEq(sum, vault.totalDebtScaled(), "sum(debtScaled) != totalDebtScaled");
    }

    /// INVARIANT: poolAssets() == totalCash + totalDebtAssets(), and totalCash
    /// tracks the vault's real token balance (no phantom cash from donations).
    function invariant_poolAssetsAccounting() public view {
        assertEq(vault.poolAssets(), vault.cash() + vault.totalDebtAssets(), "poolAssets mismatch");
        assertEq(vault.cash(), usd.balanceOf(address(vault)), "totalCash != real balance");
    }

    /// INVARIANT: no position has shares==0 while still carrying debt — bad
    /// debt must always be written off (never left as phantom debtScaled).
    function invariant_noZeroSharesWithDebt() public view {
        uint256 n = vault.nextPositionId();
        for (uint256 i = 0; i < n; i++) {
            (,, , uint256 debtScaled) = vault.positions(i);
            (, uint256 shares,,) = vault.positions(i);
            if (shares == 0) {
                assertEq(debtScaled, 0, "bad debt not written off");
            }
        }
    }

    /// INVARIANT: aggregate lender withdrawable value never exceeds poolAssets,
    /// up to a bounded virtual-offset rounding slack.
    ///
    /// Each lender's conversion is floor(shares_i * (pool+V) / (totalShares+V)).
    /// Summed over all shares this is <= totalShares*(pool+V)/(totalShares+V),
    /// which exceeds `pool` by V*(totalShares-pool)/(totalShares+V) < V only when
    /// the pool has taken losses (totalShares > pool). The excess is < VIRTUAL wei
    /// and is in the *over-claim* direction — it is neutralized because an actual
    /// withdraw() is gated by `assets_ <= totalCash` and totalCash == real balance
    /// (invariant_poolAssetsAccounting), so no lender can ever pull more than the
    /// vault holds. This asserts the mathematically-proven bound.
    function invariant_lendersWithdrawableWithinPool() public view {
        uint256 pool = vault.poolAssets();
        uint256 totalShares = vault.totalLendShares();
        uint256 sumAssets;
        uint256 sumShares;
        uint256 n = handler.actorsLength();
        for (uint256 i = 0; i < n; i++) {
            address a = handler.actors(i);
            uint256 shares = vault.lendShares(a);
            sumShares += shares;
            if (shares == 0) continue;
            uint256 got = (shares * (pool + VIRTUAL)) / (totalShares + VIRTUAL);
            sumAssets += got;
            console2.log("actor", i, shares);
            console2.log("  got", got);
        }
        console2.log("pool", pool);
        console2.log("totalShares", totalShares);
        console2.log("sumShares", sumShares);
        console2.log("sumAssets", sumAssets);
        assertLe(sumAssets, pool + VIRTUAL, "aggregate lender withdrawable exceeds poolAssets + rounding slack");
    }
}

/*//////////////////////////////////////////////////////////////////////////
                    SuwappuMutualCredit — Handler + Invariants
//////////////////////////////////////////////////////////////////////////*/

contract MutualCreditHandler is Test {
    SuwappuMutualCredit public mc;
    MockUSD public usd;
    address[] public cycle; // fixed 3-node cycle: e.g. alice -> bob -> carol -> alice

    constructor(SuwappuMutualCredit _mc, MockUSD _usd, address[] memory _cycle) {
        mc = _mc;
        usd = _usd;
        for (uint256 i = 0; i < _cycle.length; i++) {
            cycle.push(_cycle[i]);
            usd.mint(_cycle[i], 10_000_000e18);
            vm.prank(_cycle[i]);
            usd.approve(address(mc), type(uint256).max);
        }
    }

    /// @notice Random bilateral payment along one of the cycle's edges, in
    ///         either direction (dirSeed picks payer/payee order).
    function pay(uint256 fromSeed, uint256 dirSeed, uint256 amountSeed) external {
        uint256 n = cycle.length;
        uint256 i = fromSeed % n;
        address a = cycle[i];
        address b = cycle[(i + 1) % n];
        (address from, address to) = dirSeed % 2 == 0 ? (a, b) : (b, a);
        uint256 amount = bound(amountSeed, 1, 500e18);
        vm.prank(from);
        try mc.pay(to, address(usd), amount) {} catch {}
    }

    /// @notice Net the fixed cycle and assert every node's net position
    ///         (owed-to-it minus owed-by-it, summed over its two cycle lines)
    ///         is exactly unchanged — netting only moves debt around the loop.
    function netCycle() external {
        uint256 n = cycle.length;
        address[] memory c = new address[](n);
        for (uint256 i = 0; i < n; i++) {
            c[i] = cycle[i];
        }

        int256[] memory preNet = new int256[](n);
        for (uint256 i = 0; i < n; i++) {
            preNet[i] = _netPosition(i);
        }

        try mc.netCycle(address(usd), c) {
            for (uint256 i = 0; i < n; i++) {
                assertEq(_netPosition(i), preNet[i], "netCycle changed a node's net position");
            }
        } catch {}
    }

    function settle(uint256 fromSeed, uint256 amountSeed) external {
        uint256 n = cycle.length;
        uint256 i = fromSeed % n;
        address from = cycle[i];
        address to = cycle[(i + 1) % n];
        uint256 owed = mc.owedBy(from, to, address(usd));
        if (owed == 0) return;
        uint256 amount = bound(amountSeed, 1, owed);
        if (usd.balanceOf(from) < amount) usd.mint(from, amount);
        vm.prank(from);
        try mc.settle(to, address(usd), amount) {} catch {}
    }

    /// @dev Net position of cycle node i = sum over its two cycle-adjacent
    ///      lines of (amount owed TO it) - (amount it owes).
    function _netPosition(uint256 i) internal view returns (int256) {
        uint256 n = cycle.length;
        address self = cycle[i];
        address prev = cycle[(i + n - 1) % n];
        address next = cycle[(i + 1) % n];
        int256 net = 0;
        net += int256(mc.owedBy(prev, self, address(usd))) - int256(mc.owedBy(self, prev, address(usd)));
        net += int256(mc.owedBy(next, self, address(usd))) - int256(mc.owedBy(self, next, address(usd)));
        return net;
    }
}

/// forge-config: default.invariant.runs = 256
/// forge-config: default.invariant.depth = 64
contract MutualCreditInvariantTest is Test {
    MockUSD usd;
    SuwappuMutualCredit mc;
    MutualCreditHandler handler;
    address alice = makeAddr("mc-alice");
    address bob = makeAddr("mc-bob");
    address carol = makeAddr("mc-carol");

    function setUp() public {
        usd = new MockUSD();
        mc = new SuwappuMutualCredit();
        _open(alice, bob, 5_000e18, 5_000e18);
        _open(bob, carol, 5_000e18, 5_000e18);
        _open(carol, alice, 5_000e18, 5_000e18);

        address[] memory cyc = new address[](3);
        cyc[0] = alice;
        cyc[1] = bob;
        cyc[2] = carol;
        handler = new MutualCreditHandler(mc, usd, cyc);

        targetContract(address(handler));
        bytes4[] memory selectors = new bytes4[](3);
        selectors[0] = MutualCreditHandler.pay.selector;
        selectors[1] = MutualCreditHandler.netCycle.selector;
        selectors[2] = MutualCreditHandler.settle.selector;
        targetSelector(FuzzSelector({addr: address(handler), selectors: selectors}));
    }

    function _open(address x, address y, uint256 limX, uint256 limY) internal {
        vm.prank(x);
        mc.proposeLine(y, address(usd), limX, 0, 7 days);
        vm.prank(y);
        mc.acceptLine(x, address(usd), limY);
    }

    /// INVARIANT: no line's outstanding balance ever exceeds the limit the
    /// counterparty agreed to extend, after any pay()/netCycle()/settle().
    function invariant_balancesWithinAgreedLimits() public view {
        _checkLine(alice, bob);
        _checkLine(bob, carol);
        _checkLine(carol, alice);
    }

    function _checkLine(address x, address y) internal view {
        bytes32 key = mc.lineKey(x, y, address(usd));
        (uint256 limitA, uint256 limitB, int256 balance,,,,,,,) = mc.lines(key);
        if (balance > 0) {
            assertLe(uint256(balance), limitA, "balance exceeds limitA");
        } else if (balance < 0) {
            assertLe(uint256(-balance), limitB, "balance exceeds limitB");
        }
    }
}
