// SPDX-License-Identifier: MIT
pragma solidity 0.8.27;

import { Test } from "forge-std/Test.sol";
import { L1Read } from "../hypercore/L1Read.sol";
import { CoreWriterLib } from "../hypercore/CoreWriterLib.sol";
import { SuwappuCoreRouterMultiUser, IERC20 } from "../hypercore/SuwappuCoreRouterMultiUser.sol";
import { TestToken, CoreWriterSink } from "./SuwappuCoreRouterMultiUserTest.t.sol";

/// Reproductions for findings in contracts/AUDIT_COREROUTER_2026-08-31.md.
/// These tests demonstrate CONFIRMED failures against the AS-DEPLOYED
/// SuwappuCoreRouterMultiUser.sol. No fix is applied here — see the audit doc's
/// before/after code blocks for the proposed (not-yet-applied) fix.
contract SuwappuCoreRouterMultiUserAuditTest is Test {
    TestToken base;
    TestToken quote;
    SuwappuCoreRouterMultiUser router;
    address treasury = address(0x7EA);
    address alice = address(0xA11CE); // swap B's user — never gets a landed credit
    address bob = address(0xB0B); // swap C's user — the victim

    uint64 constant BASE_TOKEN = 150;
    uint64 constant QUOTE_TOKEN = 0;
    uint32 constant ORDER_ASSET = 10_147;
    uint64 constant L1_START = 1000;
    uint64 constant PX = 25_0000_0000;

    function setUp() public {
        base = new TestToken();
        quote = new TestToken();
        CoreWriterSink sink = new CoreWriterSink();
        vm.etch(CoreWriterLib.CORE_WRITER, address(sink).code);

        _mockL1Block(L1_START);
        vm.mockCall(L1Read.CORE_USER_EXISTS, abi.encode(treasury), abi.encode(true));
        router = new SuwappuCoreRouterMultiUser(
            base, quote, BASE_TOKEN, QUOTE_TOKEN, ORDER_ASSET, 8, 8, 10, 0, 2, treasury, 30
        );

        base.mint(alice, 100e18);
        base.mint(bob, 100e18);
        quote.mint(alice, 1_000e8);
        quote.mint(bob, 1_000e8);
        vm.prank(alice);
        base.approve(address(router), type(uint256).max);
        vm.prank(bob);
        base.approve(address(router), type(uint256).max);

        _mockSpot(QUOTE_TOKEN, 0, 0);
        _mockSpot(BASE_TOKEN, 0, 0);
    }

    function _mockL1Block(uint64 n) internal {
        vm.mockCall(L1Read.L1_BLOCK_NUMBER, bytes(""), abi.encode(n));
    }

    function _mockSpot(uint64 token, uint64 total, uint64 hold) internal {
        vm.mockCall(
            L1Read.SPOT_BALANCE,
            abi.encode(address(router), token),
            abi.encode(L1Read.SpotBalance({ total: total, hold: hold, entryNtl: 0 }))
        );
    }

    function _owed(uint128 id) internal view returns (uint64, uint64) {
        SuwappuCoreRouterMultiUser.Swap memory s = router.getSwap(id);
        return (s.owedOut, s.owedIn);
    }

    /// AUDIT F1 (HIGH): forceRelease()'s Bridging branch frees `inFlight` but
    /// leaves the swap Bridging with owedOut/owedIn intact and claim()
    /// permanently callable. claim() — unlike retry() — has NO inFlight
    /// guard, so a swap whose own Core->EVM bridge-back never landed can
    /// still claim() successfully once a LATER, unrelated swap's bridge-back
    /// lands on the router's shared EVM balance. That later swap's user then
    /// finds their own credit already spent and cannot claim.
    ///
    /// Sequence:
    ///   1. B (alice) settles; its Core->EVM spotSend for owedOut is never
    ///      simulated as landing (silently rejected on real HyperCore).
    ///   2. A keeper calls forceRelease(B) past RELEASE_DELAY_L1 — this only
    ///      frees the global lock; B stays Bridging & claimable.
    ///   3. C (bob) runs the full, legitimate lifecycle and settles; its
    ///      fill lands on Core on top of B's still-unrelayed proceeds.
    ///   4. C's bridge-back actually lands on the router's EVM balance.
    ///   5. claim(B) succeeds anyway — paid entirely out of C's proceeds.
    ///   6. claim(C) now reverts: bob's own money is gone.
    function test_F1_staleBridgingClaim_stealsLaterSwapsCredit() public {
        // ── Swap B (alice) ───────────────────────────────────────────────
        vm.prank(alice);
        uint128 idB = router.initiate(true, 2e18, PX, 49e8);
        _mockSpot(BASE_TOKEN, 2e8, 0);
        router.execute(idB);

        vm.roll(block.number + 1);
        _mockL1Block(L1_START + router.SETTLE_DELAY_L1());
        _mockSpot(BASE_TOKEN, 0, 0); // base fully consumed by the fill
        _mockSpot(QUOTE_TOKEN, 50e8, 0); // 50e8 quote proceeds land on Core
        router.settle(idB);

        (uint64 owedOutB,) = _owed(idB);
        assertEq(owedOutB, 50e8 - 15_000_000);
        assertEq(uint8(router.getSwap(idB).status), uint8(SuwappuCoreRouterMultiUser.Status.Bridging));
        // B's Core->EVM spotSend was just requested; it never lands here —
        // nothing mints quote to the router on B's behalf.

        // ── Liveness escape hatch: B is stuck, a keeper releases the lock ──
        _mockL1Block(L1_START + router.SETTLE_DELAY_L1() + router.RELEASE_DELAY_L1());
        router.forceRelease(idB);
        assertEq(router.inFlight(), 0);
        assertEq(uint8(router.getSwap(idB).status), uint8(SuwappuCoreRouterMultiUser.Status.Bridging));

        // ── Swap C (bob), the victim: normal lifecycle. Its fill lands on
        // top of B's still-unrelayed 50e8 — the router's real Core balance
        // is 100e8 quote by the time C settles.
        vm.prank(bob);
        uint128 idC = router.initiate(true, 2e18, PX, 49e8);
        _mockSpot(BASE_TOKEN, 2e8, 0);
        router.execute(idC);

        vm.roll(block.number + 1);
        _mockL1Block(L1_START + 2 * router.SETTLE_DELAY_L1() + router.RELEASE_DELAY_L1());
        _mockSpot(BASE_TOKEN, 0, 0);
        _mockSpot(QUOTE_TOKEN, 100e8, 0); // B's stale 50e8 + C's new 50e8
        router.settle(idC);

        (uint64 owedOutC,) = _owed(idC);
        assertEq(owedOutC, 50e8 - 15_000_000);

        // ── C's bridge-back actually lands: the router's EVM quote balance
        // now holds exactly C's proceeds. Nothing of B's ever arrived.
        quote.mint(address(router), owedOutC);

        // THE BUG: B's own bridge-back NEVER landed, yet claim(idB) still
        // succeeds — paid entirely out of C's freshly-landed credit.
        router.claim(idB);
        assertEq(quote.balanceOf(alice), 1_000e8 + owedOutB);
        assertEq(quote.balanceOf(address(router)), 0);

        // C — the fully-settled, legitimate swap — can no longer claim: its
        // own credit was just consumed paying off a stale, released swap.
        vm.expectRevert(SuwappuCoreRouterMultiUser.BridgeNotLanded.selector);
        router.claim(idC);
        assertEq(quote.balanceOf(bob), 1_000e8); // bob is never made whole
    }
}
