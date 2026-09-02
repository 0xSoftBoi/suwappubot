// SPDX-License-Identifier: MIT
pragma solidity 0.8.27;

import { Test, Vm } from "forge-std/Test.sol";
import { L1Read } from "../hypercore/L1Read.sol";
import { CoreWriterLib } from "../hypercore/CoreWriterLib.sol";
import { SuwappuCoreRouterBoundUserImpl, IERC20 } from "../hypercore/SuwappuCoreRouterBoundUserImpl.sol";
import { SuwappuCoreRouterBoundUserFactory } from "../hypercore/SuwappuCoreRouterBoundUserFactory.sol";

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

/// Proves the per-clone fund-direction gating: no matter who CALLS the
/// clone's lifecycle functions, tokens only ever move for the user this
/// clone was deployed for — never the caller, never anyone else's clone.
contract SuwappuCoreRouterBoundUserImplTest is Test {
    TestToken base;
    TestToken quote;
    SuwappuCoreRouterBoundUserImpl logic;
    SuwappuCoreRouterBoundUserFactory factory;
    SuwappuCoreRouterBoundUserImpl aliceRouter; // alice's clone, typed for calls

    address treasury = address(0x7EA);
    address alice = address(0xA11CE);
    address bob = address(0xB0B); // an unrelated keeper — never approved, never paid
    address keeper = address(0xCAFE); // triggers txs on alice's behalf, benefits from none

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

        logic = new SuwappuCoreRouterBoundUserImpl(
            base, quote, BASE_TOKEN, QUOTE_TOKEN, ORDER_ASSET, 8, 8, 10, 0, 2, treasury, 30
        );
        factory = new SuwappuCoreRouterBoundUserFactory(address(logic));

        address routerAddr = factory.deployRouter(alice);
        aliceRouter = SuwappuCoreRouterBoundUserImpl(routerAddr);

        base.mint(alice, 100e18);
        quote.mint(alice, 1_000e8);
        // alice approves her OWN clone, not the shared logic contract and not
        // any keeper — this is the only allowance that exists anywhere.
        vm.startPrank(alice);
        base.approve(routerAddr, type(uint256).max);
        quote.approve(routerAddr, type(uint256).max);
        vm.stopPrank();

        _mockSpot(routerAddr, QUOTE_TOKEN, 0, 0);
        _mockSpot(routerAddr, BASE_TOKEN, 0, 0);
    }

    // ── mock plumbing (spot balance keyed on the CLONE's address — that's
    // what address(this) resolves to inside the delegatecall) ──────────────

    function _mockL1Block(uint64 n) internal {
        vm.mockCall(L1Read.L1_BLOCK_NUMBER, bytes(""), abi.encode(n));
    }

    function _mockSpot(address router, uint64 token, uint64 total, uint64 hold) internal {
        vm.mockCall(
            L1Read.SPOT_BALANCE,
            abi.encode(router, token),
            abi.encode(L1Read.SpotBalance({ total: total, hold: hold, entryNtl: 0 }))
        );
    }

    function _afterDelay() internal {
        vm.roll(block.number + 1);
        _mockL1Block(L1_START + aliceRouter.SETTLE_DELAY_L1());
    }

    /// Deposit lands on Core, then execute places the IOC. Ported from
    /// SuwappuCoreRouterMultiUserTest.t.sol — same lifecycle mechanics, just
    /// against alice's clone instead of a directly-deployed router.
    function _fundAndExecute(uint128 id, uint64 inToken, uint64 coreIn) internal {
        _mockSpot(address(aliceRouter), inToken, coreIn, 0);
        aliceRouter.execute(id);
    }

    function _status(uint128 id) internal view returns (SuwappuCoreRouterBoundUserImpl.Status) {
        return aliceRouter.getSwap(id).status;
    }

    function _owed(uint128 id) internal view returns (uint64, uint64) {
        SuwappuCoreRouterBoundUserImpl.Swap memory s = aliceRouter.getSwap(id);
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

    function _settledSell() internal returns (uint128 id) {
        vm.prank(alice);
        id = aliceRouter.initiate(true, 2e18, PX, 49e8);
        _fundAndExecute(id, BASE_TOKEN, 2e8);
        _afterDelay();
        _mockSpot(address(aliceRouter), BASE_TOKEN, 0, 0);
        _mockSpot(address(aliceRouter), QUOTE_TOKEN, 50e8, 0);
        aliceRouter.settle(id);
    }

    // ── ported from SuwappuCoreRouterMultiUserTest.t.sol (single-clone
    // lifecycle mechanics — identical logic to SuwappuCoreRouterMultiUser.sol,
    // run against alice's clone) ──

    // ── funded-then-execute ordering ────────────────────────────────────────

    function test_execute_revertsUntilDepositObserved() public {
        vm.prank(alice);
        uint128 id = aliceRouter.initiate(true, 2e18, PX, 49e8);
        assertEq(uint8(_status(id)), uint8(SuwappuCoreRouterBoundUserImpl.Status.Funding));

        // deposit not on Core yet: the order must never be placed
        vm.expectRevert(SuwappuCoreRouterBoundUserImpl.NotLanded.selector);
        aliceRouter.execute(id);

        _fundAndExecute(id, BASE_TOKEN, 2e8);
        assertEq(uint8(_status(id)), uint8(SuwappuCoreRouterBoundUserImpl.Status.Pending));

        // and never twice
        vm.expectRevert(SuwappuCoreRouterBoundUserImpl.BadStatus.selector);
        aliceRouter.execute(id);
    }

    function test_settle_blockedInFundingAndBeforeDelay() public {
        vm.prank(alice);
        uint128 id = aliceRouter.initiate(true, 2e18, PX, 49e8);
        vm.expectRevert(SuwappuCoreRouterBoundUserImpl.BadStatus.selector);
        aliceRouter.settle(id); // still Funding

        _fundAndExecute(id, BASE_TOKEN, 2e8);
        vm.roll(block.number + 1);
        _mockL1Block(L1_START + 5); // < SETTLE_DELAY_L1 past execute
        vm.expectRevert(SuwappuCoreRouterBoundUserImpl.TooEarly.selector);
        aliceRouter.settle(id);
    }

    // ── sell path ───────────────────────────────────────────────────────────

    function test_sell_fullFill_happyPath() public {
        vm.prank(alice);
        uint128 id = aliceRouter.initiate(true, 2e18, PX, 49e8);
        assertEq(base.balanceOf(aliceRouter.systemAddress(BASE_TOKEN)), 2e18);
        _fundAndExecute(id, BASE_TOKEN, 2e8);
        assertEq(_lastOrderSz(), 2_0000_0000);

        _afterDelay();
        _mockSpot(address(aliceRouter), BASE_TOKEN, 0, 0); // base consumed
        _mockSpot(address(aliceRouter), QUOTE_TOKEN, 50e8, 0); // +50e8 quote
        aliceRouter.settle(id);

        (uint64 outOwed, uint64 inOwed) = _owed(id);
        assertEq(outOwed, 50e8 - 15_000_000); // 30bps fee
        assertEq(inOwed, 0);

        vm.expectRevert(SuwappuCoreRouterBoundUserImpl.BridgeNotLanded.selector);
        aliceRouter.claim(id);

        quote.mint(address(aliceRouter), 50e8 - 15_000_000);
        aliceRouter.claim(id);
        assertEq(quote.balanceOf(alice), 1_000e8 + 50e8 - 15_000_000);
        assertEq(aliceRouter.inFlight(), 0);
    }

    function test_sell_liveOrder_blocksSettle_thenResolves() public {
        vm.prank(alice);
        uint128 id = aliceRouter.initiate(true, 2e18, PX, 49e8);
        _fundAndExecute(id, BASE_TOKEN, 2e8);

        _afterDelay();
        // in-token still held = IOC not yet executed on Core: must not reconcile
        _mockSpot(address(aliceRouter), BASE_TOKEN, 2e8, 1_5000_0000);
        vm.expectRevert(SuwappuCoreRouterBoundUserImpl.TooEarly.selector);
        aliceRouter.settle(id);

        // order resolves (hold clears), full fill
        _mockSpot(address(aliceRouter), BASE_TOKEN, 0, 0);
        _mockSpot(address(aliceRouter), QUOTE_TOKEN, 50e8, 0);
        aliceRouter.settle(id);
        (uint64 outOwed,) = _owed(id);
        assertEq(outOwed, 50e8 - 15_000_000);
    }

    function test_staleSettle_afterForceRelease_isRejected() public {
        // NEW-2 regression: force-release reconciles the Pending swap UNDER the
        // lock (sound), moving it to Bridging; it can then never re-settle
        // against a later swap's balances.
        vm.prank(alice);
        uint128 id = aliceRouter.initiate(true, 2e18, PX, 49e8);
        _fundAndExecute(id, BASE_TOKEN, 2e8);

        // order resolved: base consumed, proceeds on Core
        _mockSpot(address(aliceRouter), BASE_TOKEN, 0, 0);
        _mockSpot(address(aliceRouter), QUOTE_TOKEN, 50e8, 0);
        _mockL1Block(L1_START + aliceRouter.RELEASE_DELAY_L1());
        aliceRouter.forceRelease(id);
        // reconciled under the lock, not abandoned; lock retained until claim
        assertEq(uint8(_status(id)), uint8(SuwappuCoreRouterBoundUserImpl.Status.Bridging));
        (uint64 outOwed,) = _owed(id);
        assertEq(outOwed, 50e8 - 15_000_000);
        assertEq(aliceRouter.inFlight(), id);

        // cannot re-settle against a successor's balances (status != Pending)
        vm.roll(block.number + 1);
        vm.expectRevert(SuwappuCoreRouterBoundUserImpl.BadStatus.selector);
        aliceRouter.settle(id);

        // claim pays the user and frees the lock only after credits land
        quote.mint(address(aliceRouter), 50e8 - 15_000_000);
        aliceRouter.claim(id);
        assertEq(quote.balanceOf(alice), 1_000e8 + 50e8 - 15_000_000);
        assertEq(aliceRouter.inFlight(), 0);
    }

    function test_forceRelease_funding_reconcilesUnderLock_refundsDeposit() public {
        // NEW-5 fix: a Funding swap whose deposit landed is recovered by
        // forceRelease itself (reconciled under the lock), not abandoned.
        vm.prank(alice);
        uint128 id = aliceRouter.initiate(true, 2e18, PX, 49e8);
        _mockSpot(address(aliceRouter), BASE_TOKEN, 2e8, 0); // deposit landed but execute never ran

        _mockL1Block(L1_START + aliceRouter.RELEASE_DELAY_L1());
        aliceRouter.forceRelease(id);

        // no order was placed => out-leg forced 0, full in-token refund, no fee
        (uint64 outOwed, uint64 inOwed) = _owed(id);
        assertEq(outOwed, 0);
        assertEq(inOwed, 2e8);
        assertEq(uint8(_status(id)), uint8(SuwappuCoreRouterBoundUserImpl.Status.Bridging));
        // lock is RETAINED until claim confirms the bridge credit (mirrors
        // settle) so the async refund cannot race a next swap's snapshot
        assertEq(aliceRouter.inFlight(), id);

        base.mint(address(aliceRouter), 2e18);
        aliceRouter.claim(id);
        assertEq(base.balanceOf(alice), 100e18); // made whole
        assertEq(aliceRouter.inFlight(), 0); // freed by claim
    }

    function test_forceRelease_recovered_retainsLockUntilClaim() public {
        // Round-4 fix: a recovering forceRelease must NOT free the lock in the
        // same tx as its async bridge-back, or the next swap under-credits.
        vm.prank(alice);
        uint128 id = aliceRouter.initiate(true, 2e18, PX, 49e8);
        _fundAndExecute(id, BASE_TOKEN, 2e8);
        _mockSpot(address(aliceRouter), BASE_TOKEN, 0, 0);
        _mockSpot(address(aliceRouter), QUOTE_TOKEN, 50e8, 0);
        _mockL1Block(L1_START + aliceRouter.RELEASE_DELAY_L1());
        aliceRouter.forceRelease(id);

        // next swap cannot snapshot Core while A's debit is still crossing
        vm.prank(alice);
        vm.expectRevert(SuwappuCoreRouterBoundUserImpl.Locked.selector);
        aliceRouter.initiate(true, 1e18, PX, 20e8);

        // once A's credit lands and A claims, the lock frees for B
        quote.mint(address(aliceRouter), 50e8 - 15_000_000);
        aliceRouter.claim(id);
        _mockSpot(address(aliceRouter), BASE_TOKEN, 0, 0);
        _mockL1Block(L1_START);
        vm.prank(alice);
        aliceRouter.initiate(true, 1e18, PX, 20e8); // now succeeds
    }

    function test_forceRelease_funding_neverLanded_abortsAndFreesLock() public {
        // Deposit never credited on Core (HyperCore-custody limbo): nothing to
        // reconcile, so terminalize to Aborted and free the lock for others.
        vm.prank(alice);
        uint128 id = aliceRouter.initiate(true, 2e18, PX, 49e8);
        // BASE_TOKEN stays 0 (deposit never landed)
        _mockL1Block(L1_START + aliceRouter.RELEASE_DELAY_L1());
        aliceRouter.forceRelease(id);
        assertEq(uint8(_status(id)), uint8(SuwappuCoreRouterBoundUserImpl.Status.Aborted));
        assertEq(aliceRouter.inFlight(), 0);

        // lock is free; a fresh swap proceeds normally
        vm.prank(alice);
        aliceRouter.initiate(true, 1e18, PX, 20e8);
        assertEq(aliceRouter.inFlight(), 2);
    }

    function test_retry_cannotStarveForceRelease() public {
        // NEW-4 regression: repeated retry() must not push forceRelease out.
        uint128 id = _settledSell();
        uint64 base_ = L1_START + aliceRouter.SETTLE_DELAY_L1();

        // spam retry every RETRY_DELAY_L1
        for (uint64 k = 1; k <= 3; k++) {
            _mockL1Block(base_ + k * aliceRouter.RETRY_DELAY_L1());
            aliceRouter.retry(id);
        }
        // forceRelease keyed off settledL1Block, unaffected by retries
        _mockL1Block(base_ + aliceRouter.RELEASE_DELAY_L1());
        aliceRouter.forceRelease(id);
        assertEq(aliceRouter.inFlight(), 0);
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
        uint128 id = aliceRouter.initiate(true, 2e18, PX, minOut);
        _fundAndExecute(id, BASE_TOKEN, coreIn);

        _afterDelay();
        // hold=0 => order resolved; unconsumed base returned, proceeds received
        _mockSpot(address(aliceRouter), BASE_TOKEN, coreIn - filledBase, 0);
        _mockSpot(address(aliceRouter), QUOTE_TOKEN, quoteRecv, 0);
        aliceRouter.settle(id);

        (uint64 outOwed, uint64 inOwed) = _owed(id);
        // fee is unconditional on proceeds (minCoreOut is NOT a fee gate)
        uint64 fee = uint64((uint256(quoteRecv) * 30) / 10_000);
        // conservation: every received quote and every unconsumed base is owed
        assertEq(outOwed + fee, quoteRecv);
        assertEq(inOwed, coreIn - filledBase);

        quote.mint(address(aliceRouter), outOwed);
        base.mint(address(aliceRouter), uint256(inOwed) * 1e10);
        aliceRouter.claim(id);
        assertEq(quote.balanceOf(alice), 1_000e8 + outOwed);
        assertEq(base.balanceOf(alice), 98e18 + uint256(inOwed) * 1e10);
        assertEq(aliceRouter.inFlight(), 0);
    }

    // ── buy path (input-driven sizing) ──────────────────────────────────────

    function test_buy_sizedFromInput_notMinOut() public {
        // 100e8 quote at px 25 => 4 base => sz wire 4e8, regardless of minCoreOut
        vm.prank(alice);
        uint128 id = aliceRouter.initiate(false, 100e8, PX, 3_9000_0000);
        _fundAndExecute(id, QUOTE_TOKEN, 100e8);
        assertEq(_lastOrderSz(), 4_0000_0000);

        _afterDelay();
        _mockSpot(address(aliceRouter), QUOTE_TOKEN, 0, 0);
        _mockSpot(address(aliceRouter), BASE_TOKEN, 3_9800_0000, 0); // fill minus taker fee in base
        aliceRouter.settle(id);
        (uint64 outOwed,) = _owed(id);
        assertEq(outOwed, 3_9800_0000 - (uint256(3_9800_0000) * 30) / 10_000);
    }

    function test_buy_lotRounding() public {
        // szDecimals=2 => lot 1e6. 100.5 quote at px 33: 3.0454..e8 -> 3.04e8
        vm.prank(alice);
        uint128 id = aliceRouter.initiate(false, 100_5000_0000, 33_0000_0000, 1);
        _fundAndExecute(id, QUOTE_TOKEN, 100_5000_0000);
        assertEq(_lastOrderSz() % 1e6, 0);
        assertEq(_lastOrderSz(), 3_0400_0000);
    }

    // ── liveness ────────────────────────────────────────────────────────────

    function test_retry_reissuesBridge() public {
        uint128 id = _settledSell();
        uint256 sends = CoreWriterSink(CoreWriterLib.CORE_WRITER).count();
        vm.expectRevert(SuwappuCoreRouterBoundUserImpl.TooEarly.selector);
        aliceRouter.retry(id);

        _mockL1Block(L1_START + aliceRouter.SETTLE_DELAY_L1() + aliceRouter.RETRY_DELAY_L1());
        aliceRouter.retry(id);
        assertGt(CoreWriterSink(CoreWriterLib.CORE_WRITER).count(), sends);
    }

    function test_forceRelease_fromFunding_andBridging() public {
        // stuck in Funding (deposit never lands)
        vm.prank(alice);
        uint128 id = aliceRouter.initiate(true, 2e18, PX, 49e8);
        vm.expectRevert(SuwappuCoreRouterBoundUserImpl.TooEarly.selector);
        aliceRouter.forceRelease(id);
        _mockL1Block(L1_START + aliceRouter.RELEASE_DELAY_L1());
        aliceRouter.forceRelease(id);
        assertEq(aliceRouter.inFlight(), 0);

        // stuck in Bridging: lock frees, claim survives
        _mockL1Block(L1_START);
        uint128 id2 = _settledSell();
        _mockL1Block(L1_START + aliceRouter.SETTLE_DELAY_L1() + aliceRouter.RELEASE_DELAY_L1());
        aliceRouter.forceRelease(id2);
        assertEq(aliceRouter.inFlight(), 0);
        quote.mint(address(aliceRouter), 50e8 - 15_000_000);
        aliceRouter.claim(id2);
        assertEq(uint8(_status(id2)), uint8(SuwappuCoreRouterBoundUserImpl.Status.Done));
    }

    function test_claim_gatedOnPerSwapSnapshot_notAggregateBalance() public {
        quote.mint(address(aliceRouter), 1_000e8); // pre-existing balance must not count
        uint128 id = _settledSell();
        vm.expectRevert(SuwappuCoreRouterBoundUserImpl.BridgeNotLanded.selector);
        aliceRouter.claim(id);
        quote.mint(address(aliceRouter), 50e8 - 15_000_000);
        aliceRouter.claim(id);
    }

    // ── guards ──────────────────────────────────────────────────────────────

    function test_lock_and_inputGuards() public {
        vm.prank(alice);
        aliceRouter.initiate(true, 1e18, PX, 20e8);
        vm.prank(alice);
        vm.expectRevert(SuwappuCoreRouterBoundUserImpl.Locked.selector);
        aliceRouter.initiate(true, 1e18, PX, 20e8);
    }

    function test_rejects_nonDivisible_and_badTreasury() public {
        vm.prank(alice);
        vm.expectRevert(SuwappuCoreRouterBoundUserImpl.NotDivisible.selector);
        aliceRouter.initiate(true, 1e18 + 1, PX, 20e8);

        vm.mockCall(L1Read.CORE_USER_EXISTS, abi.encode(address(0xDEAD)), abi.encode(false));
        vm.expectRevert(SuwappuCoreRouterBoundUserImpl.BadTreasury.selector);
        new SuwappuCoreRouterBoundUserImpl(
            base, quote, BASE_TOKEN, QUOTE_TOKEN, ORDER_ASSET, 8, 8, 10, 0, 2, address(0xDEAD), 30
        );
    }

    function test_initiate_calledByKeeper_stillBoundToTheCloneUser() public {
        vm.prank(keeper); // NOT alice — a keeper is triggering this
        uint128 id = aliceRouter.initiate(true, 2e18, PX, 49e8);

        SuwappuCoreRouterBoundUserImpl.Swap memory s = aliceRouter.getSwap(id);
        assertEq(s.user, alice, "swap must be bound to the clone's user, not the caller");
        // funds pulled from alice, not from the keeper (keeper never approved anything)
        assertEq(base.balanceOf(alice), 100e18 - 2e18);
        assertEq(base.balanceOf(address(aliceRouter.systemAddress(BASE_TOKEN))), 2e18);
    }

    function test_initiate_ignoresCallerAsPayer_evenIfCallerIsAThirdParty() public {
        // bob has zero approval to alice's clone; if fund-direction ever fell
        // back to msg.sender this would revert on the allowance underflow.
        vm.prank(bob);
        aliceRouter.initiate(true, 2e18, PX, 49e8);
        assertEq(base.balanceOf(bob), 0, "bob must never be debited");
    }

    function test_fullLifecycle_anyCallerTriggers_onlyAlicePaysAndIsPaid() public {
        address routerAddr = address(aliceRouter);

        vm.prank(keeper);
        uint128 id = aliceRouter.initiate(true, 2e18, PX, 49e8);

        _mockSpot(routerAddr, BASE_TOKEN, 2e8, 0);
        vm.prank(keeper);
        aliceRouter.execute(id);

        _afterDelay();
        _mockSpot(routerAddr, BASE_TOKEN, 0, 0);
        _mockSpot(routerAddr, QUOTE_TOKEN, 50e8, 0);
        vm.prank(keeper);
        aliceRouter.settle(id);

        (uint64 owedOut,) = (aliceRouter.getSwap(id).owedOut, aliceRouter.getSwap(id).owedIn);
        assertEq(owedOut, 50e8 - 15_000_000); // 30bps fee

        quote.mint(routerAddr, owedOut);
        vm.prank(bob); // yet another unrelated caller — still pays alice
        aliceRouter.claim(id);

        assertEq(quote.balanceOf(alice), 1_000e8 + owedOut, "proceeds must land on alice");
        assertEq(quote.balanceOf(bob), 0, "the claiming caller must receive nothing");
        assertEq(quote.balanceOf(keeper), 0);
    }

    function test_twoUsersClones_areIndependent() public {
        address bobRouterAddr = factory.deployRouter(bob);
        SuwappuCoreRouterBoundUserImpl bobRouter = SuwappuCoreRouterBoundUserImpl(bobRouterAddr);

        base.mint(bob, 100e18);
        vm.prank(bob);
        base.approve(bobRouterAddr, type(uint256).max);
        _mockSpot(bobRouterAddr, QUOTE_TOKEN, 0, 0);
        _mockSpot(bobRouterAddr, BASE_TOKEN, 0, 0);

        vm.prank(alice);
        uint128 aliceId = aliceRouter.initiate(true, 2e18, PX, 49e8);
        vm.prank(bob);
        uint128 bobId = bobRouter.initiate(true, 3e18, PX, 74e8);

        assertEq(aliceRouter.getSwap(aliceId).user, alice);
        assertEq(bobRouter.getSwap(bobId).user, bob);
        assertEq(base.balanceOf(alice), 100e18 - 2e18);
        assertEq(base.balanceOf(bob), 100e18 - 3e18);
        // separate HyperCore accounts: separate inFlight locks
        assertEq(aliceRouter.inFlight(), aliceId);
        assertEq(bobRouter.inFlight(), bobId);
    }

    // ── atomic deploy + initiate ────────────────────────────────────────────

    function test_deployAndInitiate_deploysCounterfactualRouter_andSwapsAtomically() public {
        address carol = address(0xCA501);
        address predicted = factory.routerFor(carol);
        assertEq(predicted.code.length, 0, "carol's router must not exist yet");

        // carol approves her counterfactual address before it has any code —
        // the whole point of deterministic addressing.
        base.mint(carol, 100e18);
        vm.prank(carol);
        base.approve(predicted, type(uint256).max);
        _mockSpot(predicted, QUOTE_TOKEN, 0, 0);
        _mockSpot(predicted, BASE_TOKEN, 0, 0);

        // an unrelated keeper triggers the deploy+swap in one call; carol
        // never sends a transaction herself.
        vm.prank(keeper);
        (address router, uint128 id) = factory.deployAndInitiate(carol, true, 2e18, PX, 49e8);

        assertEq(router, predicted);
        assertGt(router.code.length, 0, "router must exist after this call");
        SuwappuCoreRouterBoundUserImpl carolRouter = SuwappuCoreRouterBoundUserImpl(router);
        assertEq(carolRouter.getSwap(id).user, carol);
        assertEq(base.balanceOf(carol), 100e18 - 2e18);
        assertEq(base.balanceOf(keeper), 0, "the triggering keeper must never be debited");
    }

    function test_deployAndInitiate_revertsAtomically_deployRollsBackWithIt() public {
        address carol = address(0xCA501);
        address predicted = factory.routerFor(carol);
        // carol never approves anything — initiate()'s transferFrom must revert.
        vm.expectRevert();
        factory.deployAndInitiate(carol, true, 2e18, PX, 49e8);

        // the whole tx reverted, so the CREATE2 deploy rolled back too.
        assertEq(predicted.code.length, 0, "a failed initiate must not leave a router behind");
    }

    function test_deployAndInitiate_reusesExistingRouter_noDuplicateDeployEvent() public {
        address routerAddr = address(aliceRouter);
        assertGt(routerAddr.code.length, 0, "alice's router already exists from setUp");

        vm.recordLogs();
        vm.prank(keeper);
        (address router, uint128 id) = factory.deployAndInitiate(alice, true, 2e18, PX, 49e8);
        Vm.Log[] memory logs = vm.getRecordedLogs();

        assertEq(router, routerAddr);
        for (uint256 i = 0; i < logs.length; i++) {
            assertTrue(
                logs[i].topics[0] != SuwappuCoreRouterBoundUserFactory.RouterDeployed.selector,
                "must not re-emit RouterDeployed for an existing router"
            );
        }
        assertEq(aliceRouter.getSwap(id).user, alice);
    }
}
