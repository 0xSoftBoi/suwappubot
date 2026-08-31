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
    //         quote=USDQ (core wei 8, evm 8 => extra 0)
    TestToken base;
    TestToken quote;
    SuwappuCoreRouter router;
    address treasury = address(0x7EA);
    address alice = address(0xA11CE);

    uint64 constant BASE_TOKEN = 150;
    uint64 constant QUOTE_TOKEN = 0;
    uint32 constant ORDER_ASSET = 10_147;
    uint64 constant L1_START = 1000;

    function setUp() public {
        base = new TestToken();
        quote = new TestToken();
        CoreWriterSink sink = new CoreWriterSink();
        vm.etch(CoreWriterLib.CORE_WRITER, address(sink).code);

        _mockL1Block(L1_START);
        vm.mockCall(
            L1Read.CORE_USER_EXISTS, abi.encode(treasury), abi.encode(true)
        );
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

    // ── sell path ───────────────────────────────────────────────────────────

    function test_sell_fullFill_happyPath() public {
        vm.prank(alice);
        uint128 id = router.initiate(true, 2e18, 25_0000_0000, 49e8);
        assertEq(base.balanceOf(router.systemAddress(BASE_TOKEN)), 2e18);

        // settle blocked before the L1 delay
        vm.roll(block.number + 1);
        _mockL1Block(L1_START + 5);
        vm.expectRevert(SuwappuCoreRouter.TooEarly.selector);
        router.settle(id);

        _afterDelay();
        _mockSpot(QUOTE_TOKEN, 50e8, 0); // full fill: +50e8 quote, base consumed
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

    function test_sell_settleBeforeDepositLanded_staysPending() public {
        vm.prank(alice);
        uint128 id = router.initiate(true, 2e18, 25_0000_0000, 49e8);

        _afterDelay();
        // nothing landed on Core yet: both deltas zero -> must NOT terminalize
        vm.expectRevert(SuwappuCoreRouter.NotLanded.selector);
        router.settle(id);
        assertEq(uint8(_status(id)), uint8(SuwappuCoreRouter.Status.Pending));

        // deposit + fill land later; settle then succeeds
        _mockSpot(QUOTE_TOKEN, 50e8, 0);
        router.settle(id);
        assertEq(uint8(_status(id)), uint8(SuwappuCoreRouter.Status.Bridging));
    }

    function test_sell_partialFill_belowMin_refundsBothLegs_noFee() public {
        vm.prank(alice);
        uint128 id = router.initiate(true, 2e18, 25_0000_0000, 49e8);

        _afterDelay();
        // half filled: +25e8 quote received, 1e8 base still ours (free)
        _mockSpot(QUOTE_TOKEN, 25e8, 0);
        _mockSpot(BASE_TOKEN, 1e8, 0);
        router.settle(id);

        (uint64 outOwed, uint64 inOwed) = _owed(id);
        assertEq(outOwed, 25e8); // partial proceeds returned in full, NO fee
        assertEq(inOwed, 1e8); // unsold base refunded

        quote.mint(address(router), 25e8);
        base.mint(address(router), 1e18); // 1e8 core * 10^10
        router.claim(id);
        assertEq(quote.balanceOf(alice), 1_000e8 + 25e8);
        assertEq(base.balanceOf(alice), 99e18); // 2 sold, 1 back
    }

    function test_sell_partialFill_aboveMin_feeOnlyOnProceeds_refundsRemainder() public {
        vm.prank(alice);
        uint128 id = router.initiate(true, 2e18, 25_0000_0000, 20e8);

        _afterDelay();
        _mockSpot(QUOTE_TOKEN, 25e8, 0);
        _mockSpot(BASE_TOKEN, 1e8, 0);
        router.settle(id);

        (uint64 outOwed, uint64 inOwed) = _owed(id);
        assertEq(outOwed, 25e8 - 7_500_000); // fee charged: filled >= min
        assertEq(inOwed, 1e8); // remainder still refunded
    }

    function test_sell_heldBalance_excludedFromRefund() public {
        vm.prank(alice);
        uint128 id = router.initiate(true, 2e18, 25_0000_0000, 49e8);

        _afterDelay();
        // 2e8 base back on our Core account but 1.5e8 of it held
        _mockSpot(BASE_TOKEN, 2e8, 1_5000_0000);
        router.settle(id);
        (, uint64 inOwed) = _owed(id);
        assertEq(inOwed, 5000_0000); // only free balance is sendable
    }

    // ── buy path (input-driven sizing) ──────────────────────────────────────

    function test_buy_sizedFromInput_notMinOut() public {
        // Alice buys base with 100e8 quote at limit px 25 (wire 25e8).
        // human quote = 100, human base = 4, sz wire = 4e8.
        vm.prank(alice);
        uint128 id = router.initiate(false, 100e8, 25_0000_0000, 3_9000_0000);

        bytes memory order = CoreWriterSink(CoreWriterLib.CORE_WRITER).actions(0);
        bytes memory expected = abi.encodePacked(
            uint8(1),
            uint24(1),
            abi.encode(
                ORDER_ASSET,
                true, // buying base
                uint64(25_0000_0000),
                uint64(4_0000_0000), // sized from input, NOT from minCoreOut
                false,
                uint8(3),
                uint128(id)
            )
        );
        assertEq(order, expected);

        _afterDelay();
        // fill lands minus taker fee in received (base) token
        _mockSpot(BASE_TOKEN, 3_9800_0000, 0);
        router.settle(id);
        (uint64 outOwed,) = _owed(id);
        // acceptance uses minCoreOut as a post-fee bound: 3.98 >= 3.9 -> fee charged
        assertEq(outOwed, 3_9800_0000 - (uint256(3_9800_0000) * 30) / 10_000);
    }

    function test_buy_lotRounding() public {
        // szDecimals=2 => lot = 1e6. 100.5e8 quote at px 33 => sz 3.045454..e8
        // rounds down to 3.04e8 (multiple of 1e6... 3_0454_5454 -> 3_0400_0000).
        vm.prank(alice);
        router.initiate(false, 100_5000_0000, 33_0000_0000, 1);
        bytes memory order = CoreWriterSink(CoreWriterLib.CORE_WRITER).actions(0);
        (,,, uint64 sz,,,) =
            abi.decode(_payload(order), (uint32, bool, uint64, uint64, bool, uint8, uint128));
        assertEq(sz % 1e6, 0);
        assertEq(sz, 3_0400_0000);
    }

    // ── liveness ────────────────────────────────────────────────────────────

    function test_retry_reissuesBridge() public {
        vm.prank(alice);
        uint128 id = router.initiate(true, 2e18, 25_0000_0000, 49e8);
        _afterDelay();
        _mockSpot(QUOTE_TOKEN, 50e8, 0);
        router.settle(id);

        uint256 sends = CoreWriterSink(CoreWriterLib.CORE_WRITER).count();
        vm.expectRevert(SuwappuCoreRouter.TooEarly.selector);
        router.retry(id);

        _mockL1Block(L1_START + router.SETTLE_DELAY_L1() + router.RETRY_DELAY_L1());
        router.retry(id);
        assertGt(CoreWriterSink(CoreWriterLib.CORE_WRITER).count(), sends);
    }

    function test_forceRelease_unbricksLock_preservesClaim() public {
        vm.prank(alice);
        uint128 id = router.initiate(true, 2e18, 25_0000_0000, 49e8);
        _afterDelay();
        _mockSpot(QUOTE_TOKEN, 50e8, 0);
        router.settle(id);

        vm.expectRevert(SuwappuCoreRouter.TooEarly.selector);
        router.forceRelease(id);

        _mockL1Block(L1_START + router.SETTLE_DELAY_L1() + router.RELEASE_DELAY_L1());
        router.forceRelease(id);
        assertEq(router.inFlight(), 0);

        // lock free for others; original swap still claimable
        vm.prank(alice);
        router.initiate(true, 1e18, 25_0000_0000, 20e8);
        quote.mint(address(router), 50e8 - 15_000_000);
        router.claim(id);
        assertEq(uint8(_status(id)), uint8(SuwappuCoreRouter.Status.Done));
    }

    function test_claim_gatedOnPerSwapSnapshot_notAggregateBalance() public {
        // pre-existing EVM balance must not satisfy the claim gate
        quote.mint(address(router), 1_000e8);
        vm.prank(alice);
        uint128 id = router.initiate(true, 2e18, 25_0000_0000, 49e8);
        _afterDelay();
        _mockSpot(QUOTE_TOKEN, 50e8, 0);
        router.settle(id); // snapshot includes the 1_000e8

        vm.expectRevert(SuwappuCoreRouter.BridgeNotLanded.selector);
        router.claim(id);
        quote.mint(address(router), 50e8 - 15_000_000);
        router.claim(id);
    }

    // ── guards ──────────────────────────────────────────────────────────────

    function test_lock_and_inputGuards() public {
        vm.prank(alice);
        router.initiate(true, 1e18, 25_0000_0000, 20e8);
        vm.prank(alice);
        vm.expectRevert(SuwappuCoreRouter.Locked.selector);
        router.initiate(true, 1e18, 25_0000_0000, 20e8);
    }

    function test_rejects_nonDivisible_and_badTreasury() public {
        vm.prank(alice);
        vm.expectRevert(SuwappuCoreRouter.NotDivisible.selector);
        router.initiate(true, 1e18 + 1, 25_0000_0000, 20e8);

        vm.mockCall(L1Read.CORE_USER_EXISTS, abi.encode(address(0xDEAD)), abi.encode(false));
        vm.expectRevert(SuwappuCoreRouter.BadTreasury.selector);
        new SuwappuCoreRouter(
            base, quote, BASE_TOKEN, QUOTE_TOKEN, ORDER_ASSET, 8, 8, 10, 0, 2, address(0xDEAD), 30
        );
    }

    function _payload(bytes memory action) internal pure returns (bytes memory p) {
        p = new bytes(action.length - 4);
        for (uint256 i = 0; i < p.length; i++) {
            p[i] = action[i + 4];
        }
    }
}
