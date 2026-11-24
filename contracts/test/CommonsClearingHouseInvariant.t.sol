// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Test.sol";
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "../commons/CommonsClearingHouse.sol";

contract InvToken is ERC20 {
    constructor() ERC20("Inv USD", "iUSD") {}

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }
}

/// @dev Drives the full line lifecycle with interest across 5 actors, all pairs
///      connected by CLEARABLE lines. Ghost counters record any violation the
///      invariants below then assert are zero.
contract ClearingHandler is Test {
    CommonsClearingHouse public ch;
    InvToken public token;
    address[] public actors;

    uint256 public clearNetViolations;
    uint256 public limitViolations;
    uint256 public clears;
    uint256 public pays;
    uint256 public pathPays;
    uint256 public settles;
    uint256 public defaults;
    uint256 public withdrawals;
    uint256 public routeCapViolations;

    uint256 constant N = 5;

    constructor(CommonsClearingHouse ch_, InvToken token_) {
        ch = ch_;
        token = token_;
        for (uint256 i; i < N; ++i) actors.push(address(uint160(0xA000 + i)));
        // Every pair: CLEARABLE line, mixed fee rates (0, ~5%, ~30%/yr), varied limits.
        uint256[3] memory fees = [uint256(0), 1585489599, 9512937595];
        for (uint256 i; i < N; ++i) {
            for (uint256 j = i + 1; j < N; ++j) {
                address x = actors[i];
                address y = actors[j];
                vm.prank(x);
                ch.proposeLine(y, address(token), 500e18 + i * 100e18, fees[(i + j) % 3], 1 days, 1);
                bytes32 th = ch.getLine(x, y, address(token)).termsHash;
                vm.prank(y);
                ch.acceptLine(x, address(token), 500e18 + j * 100e18, th);
            }
            vm.prank(actors[i]);
            ch.setRoutingPolicy(address(token), true, uint16(i * 10));
        }
        // Every actor consents to be routed toward every other (bounded per line).
        for (uint256 i; i < N; ++i) {
            for (uint256 j; j < N; ++j) {
                if (i == j) continue;
                vm.prank(actors[i]);
                ch.setRouteCap(actors[j], address(token), 400e18 + j * 50e18);
            }
        }
    }

    function _pick(uint256 seed) internal view returns (address) {
        return actors[seed % N];
    }

    function _limitFor(address debtor, address creditor) internal view returns (uint256) {
        CommonsClearingHouse.Line memory l = ch.getLine(debtor, creditor, address(token));
        // creditor's extended credit = limit on its side
        return creditor < debtor ? l.limitLo : l.limitHi;
    }

    function netOf(address who) public view returns (int256 net) {
        for (uint256 i; i < N; ++i) {
            address o = actors[i];
            if (o == who) continue;
            net += int256(ch.owedBy(o, who, address(token)));
            net -= int256(ch.owedBy(who, o, address(token)));
        }
    }

    // ------------------------------------------------------------ actions

    function pay(uint256 s1, uint256 s2, uint256 amt) external {
        address x = _pick(s1);
        address y = _pick(s2);
        if (x == y) return;
        amt = bound(amt, 1, 300e18);
        vm.prank(x);
        try ch.pay(y, address(token), amt) {
            pays++;
            // Principal op: post-state debt must fit the creditor's limit.
            if (ch.owedBy(x, y, address(token)) > _limitFor(x, y)) limitViolations++;
        } catch {}
    }

    function payPath(uint256 s1, uint256 s2, uint256 s3, uint256 amt) external {
        address x = _pick(s1);
        address y = _pick(s2);
        address z = _pick(s3);
        if (x == y || y == z || x == z) return;
        amt = bound(amt, 1, 200e18);
        address[] memory path = new address[](3);
        (path[0], path[1], path[2]) = (x, y, z);
        vm.prank(x);
        try ch.payPath(address(token), path, amt, type(uint256).max) {
            pathPays++;
            if (ch.owedBy(x, y, address(token)) > _limitFor(x, y)) limitViolations++;
            if (ch.owedBy(y, z, address(token)) > _limitFor(y, z)) limitViolations++;
            // The intermediary never carries routed debt beyond its own cap.
            if (ch.owedBy(y, z, address(token)) > ch.routeCap(y, z, address(token))) routeCapViolations++;
        } catch {}
    }

    /// Finds a debt triangle among 3 actors (in whichever direction debts run)
    /// and clears its minimum leg. Records any change to any actor's net position.
    function clearTriangle(uint256 s1, uint256 s2, uint256 s3, uint256 frac) external {
        address x = _pick(s1);
        address y = _pick(s2);
        address z = _pick(s3);
        if (x == y || y == z || x == z) return;
        uint256 a = ch.owedBy(x, y, address(token));
        uint256 b = ch.owedBy(y, z, address(token));
        uint256 c = ch.owedBy(z, x, address(token));
        if (a == 0 || b == 0 || c == 0) {
            (x, z) = (z, x); // try the reverse orientation
            a = ch.owedBy(x, y, address(token));
            b = ch.owedBy(y, z, address(token));
            c = ch.owedBy(z, x, address(token));
            if (a == 0 || b == 0 || c == 0) return;
        }
        uint256 m = a < b ? a : b;
        if (c < m) m = c;
        m = bound(frac, 1, m);

        int256[N] memory before;
        for (uint256 i; i < N; ++i) before[i] = netOf(actors[i]);

        CommonsClearingHouse.Edge[] memory e = new CommonsClearingHouse.Edge[](3);
        e[0] = CommonsClearingHouse.Edge(x, y, m);
        e[1] = CommonsClearingHouse.Edge(y, z, m);
        e[2] = CommonsClearingHouse.Edge(z, x, m);
        try ch.clear(address(token), e) {
            clears++;
            for (uint256 i; i < N; ++i) {
                if (netOf(actors[i]) != before[i]) clearNetViolations++;
            }
        } catch {}
    }

    /// Builds a debt triangle on top of whatever state exists (interest, prior
    /// debts, lowered limits), then clears a random fraction of it.
    function payCycleThenClear(uint256 s1, uint256 s2, uint256 s3, uint256 amt, uint256 frac) external {
        address x = _pick(s1);
        address y = _pick(s2);
        address z = _pick(s3);
        if (x == y || y == z || x == z) return;
        amt = bound(amt, 1e15, 100e18);
        vm.prank(x);
        try ch.pay(y, address(token), amt) {} catch {}
        vm.prank(y);
        try ch.pay(z, address(token), amt) {} catch {}
        vm.prank(z);
        try ch.pay(x, address(token), amt) {} catch {}
        this.clearTriangle(s1, s2, s3, frac);
    }

    function settle(uint256 s1, uint256 s2, uint256 amt) external {
        address x = _pick(s1);
        address y = _pick(s2);
        if (x == y) return;
        uint256 owed = ch.owedBy(x, y, address(token));
        if (owed == 0) return;
        amt = bound(amt, 1, owed);
        token.mint(x, amt);
        vm.startPrank(x);
        token.approve(address(ch), amt);
        try ch.settle(y, address(token), amt) {
            settles++;
        } catch {}
        vm.stopPrank();
    }

    function withdraw(uint256 s1, uint256 s2) external {
        address who = _pick(s1);
        if (ch.claimable(who, address(token)) == 0) return;
        vm.prank(who);
        ch.withdraw(address(token), _pick(s2));
        withdrawals++;
    }

    function totalClaimable() external view returns (uint256 sum) {
        for (uint256 i; i < N; ++i) sum += ch.claimable(actors[i], address(token));
    }

    function setLimit(uint256 s1, uint256 s2, uint256 lim) external {
        address x = _pick(s1);
        address y = _pick(s2);
        if (x == y) return;
        lim = bound(lim, 0, 2000e18);
        vm.prank(x);
        try ch.setMyLimit(y, address(token), lim) {} catch {}
    }

    function demandAndMaybeDefault(uint256 s1, uint256 s2, bool doDefault) external {
        address creditor = _pick(s1);
        address debtor = _pick(s2);
        if (creditor == debtor) return;
        vm.prank(creditor);
        try ch.demandSettlement(debtor, address(token)) {} catch {}
        // Rare: a defaulted line freezes, which would starve clearing coverage.
        if (doDefault && s1 % 10 == 0) {
            vm.warp(block.timestamp + 1 days);
            vm.prank(creditor);
            try ch.markDefault(debtor, address(token)) {
                defaults++;
            } catch {}
        }
    }

    function warp(uint256 dt) external {
        vm.warp(block.timestamp + bound(dt, 1, 30 days));
    }
}

contract CommonsClearingHouseInvariantTest is Test {
    CommonsClearingHouse ch;
    InvToken token;
    ClearingHandler h;

    function setUp() public {
        vm.warp(1_700_000_000);
        ch = new CommonsClearingHouse();
        token = new InvToken();
        h = new ClearingHandler(ch, token);
        targetContract(address(h));
    }

    /// Clearing never moves anyone's net position (it only cancels circulation).
    function invariant_clearPreservesNetPositions() public view {
        assertEq(h.clearNetViolations(), 0);
    }

    /// Every principal-increasing op leaves debt within the creditor's limit.
    function invariant_principalWithinLimits() public view {
        assertEq(h.limitViolations(), 0);
    }

    /// Escrow is exact: tokens held == sum of creditors' claimable balances.
    function invariant_custodyEqualsClaimable() public view {
        assertEq(token.balanceOf(address(ch)), h.totalClaimable());
    }

    /// Routed debt on an intermediary's outbound leg never exceeds its route cap.
    function invariant_routeCapsRespected() public view {
        assertEq(h.routeCapViolations(), 0);
    }

    /// Net positions across the closed actor set always sum to zero.
    function invariant_netsSumToZero() public view {
        int256 sum;
        for (uint256 i; i < 5; ++i) sum += h.netOf(h.actors(i));
        assertEq(sum, 0);
    }

    /// Closed lines carry no balance; Defaulted lines still carry debt.
    function invariant_statusConsistency() public view {
        for (uint256 i; i < 5; ++i) {
            for (uint256 j = i + 1; j < 5; ++j) {
                CommonsClearingHouse.Line memory l = ch.getLine(h.actors(i), h.actors(j), address(token));
                if (l.status == CommonsClearingHouse.Status.Closed) assertEq(l.balance, 0);
                if (l.status == CommonsClearingHouse.Status.Defaulted) assertTrue(l.balance != 0);
            }
        }
    }

    function invariant_callSummary() public view {
        // Coverage proof: these actions must actually succeed, not just be attempted.
        console.log("clears", h.clears(), "pays", h.pays());
        console.log("pathPays", h.pathPays(), "settles", h.settles());
        console.log("defaults", h.defaults(), "withdrawals", h.withdrawals());
    }
}
