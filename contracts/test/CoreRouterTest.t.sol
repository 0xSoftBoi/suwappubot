// SPDX-License-Identifier: MIT
pragma solidity 0.8.27;

import { Test } from "forge-std/Test.sol";
import { L1Read } from "../hypercore/L1Read.sol";
import { CoreWriterLib } from "../hypercore/CoreWriterLib.sol";
import { SuwappuCoreRouter, IERC20 } from "../hypercore/SuwappuCoreRouter.sol";

contract TestToken is IERC20 {
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;

    function mint(address to, uint256 amt) external {
        balanceOf[to] += amt;
    }

    function approve(address spender, uint256 amt) external {
        allowance[msg.sender][spender] = amt;
    }

    function transfer(address to, uint256 amt) external returns (bool) {
        balanceOf[msg.sender] -= amt;
        balanceOf[to] += amt;
        return true;
    }

    function transferFrom(address from, address to, uint256 amt) external returns (bool) {
        allowance[from][msg.sender] -= amt;
        balanceOf[from] -= amt;
        balanceOf[to] += amt;
        return true;
    }
}

contract CoreWriterSink {
    bytes[] public actions;

    function sendRawAction(bytes calldata data) external {
        actions.push(data);
    }

    function count() external view returns (uint256) {
        return actions.length;
    }
}

contract CoreRouterTest is Test {
    // Market: base=UFOO (core wei 8, evm 18 => extra 10, szDecimals 2),
    //         quote=USDQ (core wei 8, evm 8 => extra 0). Limit px 25 (wire 25e8).
    TestToken base;
    TestToken quote;
    SuwappuCoreRouter router;
    address treasury = address(0x7EA);
    address alice = address(0xA11CE);

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
        router = new SuwappuCoreRouter(
            base, quote, BASE_TOKEN, QUOTE_TOKEN, ORDER_ASSET, 8, 8, 10, 0, 2, treasury, 30
        );

        base.mint(alice, 100e18);
        quote.mint(alice, 1_000e8);
        vm.startPrank(alice);
        base.approve(address(router), type(uint256).max);
        quote.approve(address(router), type(uint256).max);
        vm.stopPrank();

        _mockSpot(QUOTE_TOKEN, 0, 0);
        _mockSpot(BASE_TOKEN, 0, 0);
    }

    // ── mock plumbing ───────────────────────────────────────────────────────

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

    /// Deposit lands on Core, then execute places the IOC.
    function _fundAndExecute(uint128 id, uint64 inToken, uint64 coreIn) internal {
        _mockSpot(inToken, coreIn, 0);
        router.execute(id);
    }

    function _afterDelay() internal {
        vm.roll(block.number + 1);
        _mockL1Block(L1_START + router.SETTLE_DELAY_L1());
    }

    function _status(uint128 id) internal view returns (SuwappuCoreRouter.Status) {
        return router.getSwap(id).status;
    }

    function _owed(uint128 id) internal view returns (uint64, uint64) {
        SuwappuCoreRouter.Swap memory s = router.getSwap(id);
        return (s.owedOut, s.owedIn);
    }

    function _lastOrderSz() internal view returns (uint64 sz) {
        CoreWriterSink sink = CoreWriterSink(CoreWriterLib.CORE_WRITER);
        bytes memory action = sink.actions(sink.count() - 1);
        bytes memory p = new bytes(action.length - 4);
        for (uint256 i = 0; i < p.length; i++) {
            p[i] = action[i + 4];
        }
        (,,, sz,,,) = abi.decode(p, (uint32, bool, uint64, uint64, bool, uint8, uint128));
    }

    // ── funded-then-execute ordering ────────────────────────────────────────

    function test_execute_revertsUntilDepositObserved() public {
        vm.prank(alice);
        uint128 id = router.initiate(true, 2e18, PX, 49e8);
        assertEq(uint8(_status(id)), uint8(SuwappuCoreRouter.Status.Funding));

        // deposit not on Core yet: the order must never be placed
        vm.expectRevert(SuwappuCoreRouter.NotLanded.selector);
        router.execute(id);

        _fundAndExecute(id, BASE_TOKEN, 2e8);
        assertEq(uint8(_status(id)), uint8(SuwappuCoreRouter.Status.Pending));

        // and never twice
        vm.expectRevert(SuwappuCoreRouter.BadStatus.selector);
        router.execute(id);
    }

    function test_settle_blockedInFundingAndBeforeDelay() public {
        vm.prank(alice);
        uint128 id = router.initiate(true, 2e18, PX, 49e8);
        vm.expectRevert(SuwappuCoreRouter.BadStatus.selector);
        router.settle(id); // still Funding

        _fundAndExecute(id, BASE_TOKEN, 2e8);
        vm.roll(block.number + 1);
        _mockL1Block(L1_START + 5); // < SETTLE_DELAY_L1 past execute
        vm.expectRevert(SuwappuCoreRouter.TooEarly.selector);
        router.settle(id);
    }

    // ── sell path ───────────────────────────────────────────────────────────

    function test_sell_fullFill_happyPath() public {
        vm.prank(alice);
        uint128 id = router.initiate(true, 2e18, PX, 49e8);
        assertEq(base.balanceOf(router.systemAddress(BASE_TOKEN)), 2e18);
        _fundAndExecute(id, BASE_TOKEN, 2e8);
        assertEq(_lastOrderSz(), 2_0000_0000);

        _afterDelay();
        _mockSpot(BASE_TOKEN, 0, 0); // base consumed
        _mockSpot(QUOTE_TOKEN, 50e8, 0); // +50e8 quote
        router.settle(id);

        (uint64 outOwed, uint64 inOwed) = _owed(id);
        assertEq(outOwed, 50e8 - 15_000_000); // 30bps fee
        assertEq(inOwed, 0);

        vm.expectRevert(SuwappuCoreRouter.BridgeNotLanded.selector);
        router.claim(id);

        quote.mint(address(router), 50e8 - 15_000_000);
        router.claim(id);
        assertEq(quote.balanceOf(alice), 1_000e8 + 50e8 - 15_000_000);
        assertEq(router.inFlight(), 0);
    }

    function test_sell_liveOrder_blocksSettle_thenResolves() public {
        vm.prank(alice);
        uint128 id = router.initiate(true, 2e18, PX, 49e8);
        _fundAndExecute(id, BASE_TOKEN, 2e8);

        _afterDelay();
        // in-token still held = IOC not yet executed on Core: must not reconcile
        _mockSpot(BASE_TOKEN, 2e8, 1_5000_0000);
        vm.expectRevert(SuwappuCoreRouter.TooEarly.selector);
        router.settle(id);

        // order resolves (hold clears), full fill
        _mockSpot(BASE_TOKEN, 0, 0);
        _mockSpot(QUOTE_TOKEN, 50e8, 0);
        router.settle(id);
        (uint64 outOwed,) = _owed(id);
        assertEq(outOwed, 50e8 - 15_000_000);
    }

    function test_staleSettle_afterForceRelease_isRejected() public {
        // NEW-2 regression: force-release reconciles the Pending swap UNDER the
        // lock (sound), moving it to Bridging; it can then never re-settle
        // against a later swap's balances.
        vm.prank(alice);
        uint128 id = router.initiate(true, 2e18, PX, 49e8);
        _fundAndExecute(id, BASE_TOKEN, 2e8);

        // order resolved: base consumed, proceeds on Core
        _mockSpot(BASE_TOKEN, 0, 0);
        _mockSpot(QUOTE_TOKEN, 50e8, 0);
        _mockL1Block(L1_START + router.RELEASE_DELAY_L1());
        router.forceRelease(id);
        // reconciled under the lock, not abandoned
        assertEq(uint8(_status(id)), uint8(SuwappuCoreRouter.Status.Bridging));
        (uint64 outOwed,) = _owed(id);
        assertEq(outOwed, 50e8 - 15_000_000);
        assertEq(router.inFlight(), 0);

        // cannot re-settle against a successor's balances
        vm.roll(block.number + 1);
        vm.expectRevert(SuwappuCoreRouter.BadStatus.selector);
        router.settle(id);

        // and the user still gets paid via the normal claim path
        quote.mint(address(router), 50e8 - 15_000_000);
        router.claim(id);
        assertEq(quote.balanceOf(alice), 1_000e8 + 50e8 - 15_000_000);
    }

    function test_forceRelease_funding_reconcilesUnderLock_refundsDeposit() public {
        // NEW-5 fix: a Funding swap whose deposit landed is recovered by
        // forceRelease itself (reconciled under the lock), not abandoned.
        vm.prank(alice);
        uint128 id = router.initiate(true, 2e18, PX, 49e8);
        _mockSpot(BASE_TOKEN, 2e8, 0); // deposit landed but execute never ran

        _mockL1Block(L1_START + router.RELEASE_DELAY_L1());
        router.forceRelease(id);

        // no order was placed => out-leg forced 0, full in-token refund, no fee
        (uint64 outOwed, uint64 inOwed) = _owed(id);
        assertEq(outOwed, 0);
        assertEq(inOwed, 2e8);
        assertEq(uint8(_status(id)), uint8(SuwappuCoreRouter.Status.Bridging));
        assertEq(router.inFlight(), 0);

        base.mint(address(router), 2e18);
        router.claim(id);
        assertEq(base.balanceOf(alice), 100e18); // made whole
    }

    function test_forceRelease_funding_neverLanded_abortsAndFreesLock() public {
        // Deposit never credited on Core (HyperCore-custody limbo): nothing to
        // reconcile, so terminalize to Aborted and free the lock for others.
        vm.prank(alice);
        uint128 id = router.initiate(true, 2e18, PX, 49e8);
        // BASE_TOKEN stays 0 (deposit never landed)
        _mockL1Block(L1_START + router.RELEASE_DELAY_L1());
        router.forceRelease(id);
        assertEq(uint8(_status(id)), uint8(SuwappuCoreRouter.Status.Aborted));
        assertEq(router.inFlight(), 0);

        // lock is free; a fresh swap proceeds normally
        vm.prank(alice);
        router.initiate(true, 1e18, PX, 20e8);
        assertEq(router.inFlight(), 2);
    }

    function test_retry_cannotStarveForceRelease() public {
        // NEW-4 regression: repeated retry() must not push forceRelease out.
        uint128 id = _settledSell();
        uint64 base_ = L1_START + router.SETTLE_DELAY_L1();

        // spam retry every RETRY_DELAY_L1
        for (uint64 k = 1; k <= 3; k++) {
            _mockL1Block(base_ + k * router.RETRY_DELAY_L1());
            router.retry(id);
        }
        // forceRelease keyed off settledL1Block, unaffected by retries
        _mockL1Block(base_ + router.RELEASE_DELAY_L1());
        router.forceRelease(id);
        assertEq(router.inFlight(), 0);
    }

    /// Conservation across every fill fraction: nothing strands, fee only on
    /// acceptance, user is made exactly whole on both legs.
    function testFuzz_conservation_sellAnyFillFraction(uint16 fillBps) public {
        fillBps = uint16(bound(fillBps, 0, 10_000));
        uint64 coreIn = 2e8;
        uint64 filledBase = uint64((uint256(coreIn) * fillBps) / 10_000);
        uint64 quoteRecv = uint64((uint256(filledBase) * 25)); // px 25, equal wei decimals
        uint64 minOut = 30e8;

        vm.prank(alice);
        uint128 id = router.initiate(true, 2e18, PX, minOut);
        _fundAndExecute(id, BASE_TOKEN, coreIn);

        _afterDelay();
        // hold=0 => order resolved; unconsumed base returned, proceeds received
        _mockSpot(BASE_TOKEN, coreIn - filledBase, 0);
        _mockSpot(QUOTE_TOKEN, quoteRecv, 0);
        router.settle(id);

        (uint64 outOwed, uint64 inOwed) = _owed(id);
        // fee is unconditional on proceeds (minCoreOut is NOT a fee gate)
        uint64 fee = uint64((uint256(quoteRecv) * 30) / 10_000);
        // conservation: every received quote and every unconsumed base is owed
        assertEq(outOwed + fee, quoteRecv);
        assertEq(inOwed, coreIn - filledBase);

        quote.mint(address(router), outOwed);
        base.mint(address(router), uint256(inOwed) * 1e10);
        router.claim(id);
        assertEq(quote.balanceOf(alice), 1_000e8 + outOwed);
        assertEq(base.balanceOf(alice), 98e18 + uint256(inOwed) * 1e10);
        assertEq(router.inFlight(), 0);
    }

    // ── buy path (input-driven sizing) ──────────────────────────────────────

    function test_buy_sizedFromInput_notMinOut() public {
        // 100e8 quote at px 25 => 4 base => sz wire 4e8, regardless of minCoreOut
        vm.prank(alice);
        uint128 id = router.initiate(false, 100e8, PX, 3_9000_0000);
        _fundAndExecute(id, QUOTE_TOKEN, 100e8);
        assertEq(_lastOrderSz(), 4_0000_0000);

        _afterDelay();
        _mockSpot(QUOTE_TOKEN, 0, 0);
        _mockSpot(BASE_TOKEN, 3_9800_0000, 0); // fill minus taker fee in base
        router.settle(id);
        (uint64 outOwed,) = _owed(id);
        assertEq(outOwed, 3_9800_0000 - (uint256(3_9800_0000) * 30) / 10_000);
    }

    function test_buy_lotRounding() public {
        // szDecimals=2 => lot 1e6. 100.5 quote at px 33: 3.0454..e8 -> 3.04e8
        vm.prank(alice);
        uint128 id = router.initiate(false, 100_5000_0000, 33_0000_0000, 1);
        _fundAndExecute(id, QUOTE_TOKEN, 100_5000_0000);
        assertEq(_lastOrderSz() % 1e6, 0);
        assertEq(_lastOrderSz(), 3_0400_0000);
    }

    // ── liveness ────────────────────────────────────────────────────────────

    function test_retry_reissuesBridge() public {
        uint128 id = _settledSell();
        uint256 sends = CoreWriterSink(CoreWriterLib.CORE_WRITER).count();
        vm.expectRevert(SuwappuCoreRouter.TooEarly.selector);
        router.retry(id);

        _mockL1Block(L1_START + router.SETTLE_DELAY_L1() + router.RETRY_DELAY_L1());
        router.retry(id);
        assertGt(CoreWriterSink(CoreWriterLib.CORE_WRITER).count(), sends);
    }

    function test_forceRelease_fromFunding_andBridging() public {
        // stuck in Funding (deposit never lands)
        vm.prank(alice);
        uint128 id = router.initiate(true, 2e18, PX, 49e8);
        vm.expectRevert(SuwappuCoreRouter.TooEarly.selector);
        router.forceRelease(id);
        _mockL1Block(L1_START + router.RELEASE_DELAY_L1());
        router.forceRelease(id);
        assertEq(router.inFlight(), 0);

        // stuck in Bridging: lock frees, claim survives
        _mockL1Block(L1_START);
        uint128 id2 = _settledSell();
        _mockL1Block(L1_START + router.SETTLE_DELAY_L1() + router.RELEASE_DELAY_L1());
        router.forceRelease(id2);
        assertEq(router.inFlight(), 0);
        quote.mint(address(router), 50e8 - 15_000_000);
        router.claim(id2);
        assertEq(uint8(_status(id2)), uint8(SuwappuCoreRouter.Status.Done));
    }

    function test_claim_gatedOnPerSwapSnapshot_notAggregateBalance() public {
        quote.mint(address(router), 1_000e8); // pre-existing balance must not count
        uint128 id = _settledSell();
        vm.expectRevert(SuwappuCoreRouter.BridgeNotLanded.selector);
        router.claim(id);
        quote.mint(address(router), 50e8 - 15_000_000);
        router.claim(id);
    }

    // ── guards ──────────────────────────────────────────────────────────────

    function test_lock_and_inputGuards() public {
        vm.prank(alice);
        router.initiate(true, 1e18, PX, 20e8);
        vm.prank(alice);
        vm.expectRevert(SuwappuCoreRouter.Locked.selector);
        router.initiate(true, 1e18, PX, 20e8);
    }

    function test_rejects_nonDivisible_and_badTreasury() public {
        vm.prank(alice);
        vm.expectRevert(SuwappuCoreRouter.NotDivisible.selector);
        router.initiate(true, 1e18 + 1, PX, 20e8);

        vm.mockCall(L1Read.CORE_USER_EXISTS, abi.encode(address(0xDEAD)), abi.encode(false));
        vm.expectRevert(SuwappuCoreRouter.BadTreasury.selector);
        new SuwappuCoreRouter(
            base, quote, BASE_TOKEN, QUOTE_TOKEN, ORDER_ASSET, 8, 8, 10, 0, 2, address(0xDEAD), 30
        );
    }

    // ── helpers ─────────────────────────────────────────────────────────────

    function _settledSell() internal returns (uint128 id) {
        vm.prank(alice);
        id = router.initiate(true, 2e18, PX, 49e8);
        _fundAndExecute(id, BASE_TOKEN, 2e8);
        _afterDelay();
        _mockSpot(BASE_TOKEN, 0, 0);
        _mockSpot(QUOTE_TOKEN, 50e8, 0);
        router.settle(id);
    }
}
