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
    // Market: base=UFOO (core wei 8, evm 18 => extra 10), quote=USDQ (core wei 8, evm 8 => extra 0)
    TestToken base;
    TestToken quote;
    SuwappuCoreRouter router;
    address treasury = address(0x7EA);
    address alice = address(0xA11CE);

    uint64 constant BASE_TOKEN = 150;
    uint64 constant QUOTE_TOKEN = 0;
    uint32 constant ORDER_ASSET = 10_147;

    function setUp() public {
        base = new TestToken();
        quote = new TestToken();
        CoreWriterSink sink = new CoreWriterSink();
        vm.etch(CoreWriterLib.CORE_WRITER, address(sink).code);

        router = new SuwappuCoreRouter(
            base, quote, BASE_TOKEN, QUOTE_TOKEN, ORDER_ASSET, 8, 8, 10, 0, treasury, 30
        );

        base.mint(alice, 100e18);
        vm.prank(alice);
        base.approve(address(router), type(uint256).max);

        _mockCoreState(0, 0, 1000);
    }

    function _mockCoreState(uint64 quoteBal, uint64 baseBal, uint64 l1Block) internal {
        vm.mockCall(
            L1Read.SPOT_BALANCE,
            abi.encode(address(router), QUOTE_TOKEN),
            abi.encode(L1Read.SpotBalance({ total: quoteBal, hold: 0, entryNtl: 0 }))
        );
        vm.mockCall(
            L1Read.SPOT_BALANCE,
            abi.encode(address(router), BASE_TOKEN),
            abi.encode(L1Read.SpotBalance({ total: baseBal, hold: 0, entryNtl: 0 }))
        );
        vm.mockCall(L1Read.L1_BLOCK_NUMBER, bytes(""), abi.encode(l1Block));
    }

    function _sink() internal view returns (CoreWriterSink) {
        return CoreWriterSink(CoreWriterLib.CORE_WRITER);
    }

    function test_systemAddress() public view {
        assertEq(
            router.systemAddress(200), address(0x20000000000000000000000000000000000000C8)
        );
    }

    function test_happyPath_sellBaseForQuote() public {
        // Alice sells 2 UFOO (2e18 evm = 2e8 core wei) for >= 49e8 quote wei
        vm.prank(alice);
        uint128 id = router.initiate(true, 2e18, 25_0000_0000, 49e8);

        // in-tokens bridged to base system address
        assertEq(base.balanceOf(router.systemAddress(BASE_TOKEN)), 2e18);
        // order action recorded: version 1, action 1, sz = 2e8 corewei -> 2e8/1e8*1e8 = 2e8
        bytes memory order = _sink().actions(0);
        assertEq(uint8(order[0]), 1);

        // too early: same evm block
        vm.expectRevert(SuwappuCoreRouter.TooEarly.selector);
        router.settle(id);

        // fill lands on Core: +50e8 quote
        vm.roll(block.number + 1);
        _mockCoreState(50e8, 0, 1001);
        router.settle(id);

        // fee = 30bps of 50e8 = 0.15e8; owed = 49.85e8
        (,,,,, uint64 owed,,, SuwappuCoreRouter.Status st) = router.swaps(id);
        assertEq(owed, 50e8 - 15_000_000);
        assertEq(uint8(st), 2); // Bridging

        // bridge hasn't landed on EVM yet
        vm.expectRevert(SuwappuCoreRouter.BridgeNotLanded.selector);
        router.claim(id);

        // system tx credits router's EVM quote balance (quote extra=0 => 1:1)
        quote.mint(address(router), 50e8 - 15_000_000);
        router.claim(id);
        assertEq(quote.balanceOf(alice), 50e8 - 15_000_000);
        assertEq(router.inFlight(), 0);
    }

    function test_refundPath_whenUnfilled() public {
        vm.prank(alice);
        uint128 id = router.initiate(true, 2e18, 25_0000_0000, 49e8);

        vm.roll(block.number + 1);
        // no fill: quote still 0, base bounced back to our core account
        _mockCoreState(0, 2e8, 1001);
        router.settle(id);

        (,,,,, uint64 owed,,, SuwappuCoreRouter.Status st) = router.swaps(id);
        assertEq(owed, 2e8);
        assertEq(uint8(st), 3); // Refunding

        base.mint(address(router), 2e18); // bridge-back lands (extra=10: 2e8 core -> 2e18 evm)
        router.claim(id);
        assertEq(base.balanceOf(alice), 100e18); // made whole
    }

    function test_serialization_lock() public {
        vm.prank(alice);
        router.initiate(true, 1e18, 25_0000_0000, 20e8);
        vm.prank(alice);
        vm.expectRevert(SuwappuCoreRouter.Locked.selector);
        router.initiate(true, 1e18, 25_0000_0000, 20e8);
    }

    function test_rejects_nonDivisible_evmAmount() public {
        vm.prank(alice);
        vm.expectRevert(SuwappuCoreRouter.NotDivisible.selector);
        router.initiate(true, 1e18 + 1, 25_0000_0000, 20e8);
    }

    function test_feeCap_enforced() public {
        vm.expectRevert(SuwappuCoreRouter.FeeTooHigh.selector);
        new SuwappuCoreRouter(
            base, quote, BASE_TOKEN, QUOTE_TOKEN, ORDER_ASSET, 8, 8, 10, 0, treasury, 101
        );
    }
}
