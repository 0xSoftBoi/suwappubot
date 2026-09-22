// SPDX-License-Identifier: MIT
pragma solidity 0.8.27;

import { Test } from "forge-std/Test.sol";
import { L1Read } from "../hypercore/L1Read.sol";
import { CoreWriterLib } from "../hypercore/CoreWriterLib.sol";
import { SuwappuPerpsRouterBoundUserImpl, IERC20 } from "../hypercore/SuwappuPerpsRouterBoundUserImpl.sol";
import { SuwappuPerpsRouterFactory } from "../hypercore/SuwappuPerpsRouterFactory.sol";

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

contract SuwappuPerpsRouterBoundUserImplTest is Test {
    TestToken usdc;
    SuwappuPerpsRouterBoundUserImpl logic;
    SuwappuPerpsRouterFactory factory;
    SuwappuPerpsRouterBoundUserImpl aliceRouter;

    address alice = address(0xA11CE);
    address bob = address(0xB0B);
    address keeper = address(0xCAFE);

    uint64 constant USDC_CORE_TOKEN = 0;
    uint32 constant PERP_DEX = 0;
    uint64 constant L1_START = 1000;
    uint16 constant PERP = 5; // e.g. some perp index

    function setUp() public {
        usdc = new TestToken();
        CoreWriterSink sink = new CoreWriterSink();
        vm.etch(CoreWriterLib.CORE_WRITER, address(sink).code);
        _mockL1Block(L1_START);

        logic = new SuwappuPerpsRouterBoundUserImpl(usdc, USDC_CORE_TOKEN, 12, PERP_DEX);
        factory = new SuwappuPerpsRouterFactory(address(logic));

        address routerAddr = factory.deployRouter(alice);
        aliceRouter = SuwappuPerpsRouterBoundUserImpl(routerAddr);

        usdc.mint(alice, 1_000e18);
        vm.prank(alice);
        usdc.approve(routerAddr, type(uint256).max);

        _mockSpot(routerAddr, 0, 0);
        _mockPosition(routerAddr, PERP, 0);
    }

    // ── mock plumbing ───────────────────────────────────────────────────────

    function _mockL1Block(uint64 n) internal {
        vm.mockCall(L1Read.L1_BLOCK_NUMBER, bytes(""), abi.encode(n));
    }

    function _mockSpot(address router, uint64 total, uint64 hold) internal {
        vm.mockCall(
            L1Read.SPOT_BALANCE,
            abi.encode(router, USDC_CORE_TOKEN),
            abi.encode(L1Read.SpotBalance({ total: total, hold: hold, entryNtl: 0 }))
        );
    }

    function _mockPosition(address router, uint16 perp, int64 szi) internal {
        vm.mockCall(
            L1Read.POSITION,
            abi.encode(router, perp),
            abi.encode(
                L1Read.Position({
                    szi: szi,
                    entryNtl: 0,
                    isolatedRawUsd: 0,
                    leverage: 1,
                    isIsolated: false
                })
            )
        );
    }

    // ── margin: deposit ──────────────────────────────────────────────────────

    function test_depositMargin_pullsFromAlice_bridgesToSystemAddress() public {
        vm.prank(alice);
        aliceRouter.depositMargin(1e18);

        assertEq(usdc.balanceOf(alice), 1_000e18 - 1e18);
        assertEq(usdc.balanceOf(aliceRouter.systemAddress(USDC_CORE_TOKEN)), 1e18);
        assertEq(
            uint8(_marginOpStatus()), uint8(SuwappuPerpsRouterBoundUserImpl.MarginOpStatus.AwaitingBridgeIn)
        );
    }

    function test_depositMargin_rejectsThirdParty() public {
        vm.prank(bob);
        vm.expectRevert(SuwappuPerpsRouterBoundUserImpl.NotAuthorized.selector);
        aliceRouter.depositMargin(1e18);
    }

    function test_depositMargin_blockedWhileLocked() public {
        vm.prank(alice);
        aliceRouter.depositMargin(1e18);

        vm.prank(alice);
        vm.expectRevert(SuwappuPerpsRouterBoundUserImpl.Locked.selector);
        aliceRouter.depositMargin(1e18);
    }

    function test_confirmMargin_revertsBeforeLanded_thenSucceeds() public {
        vm.prank(alice);
        aliceRouter.depositMargin(1e18);

        vm.expectRevert(SuwappuPerpsRouterBoundUserImpl.NotLanded.selector);
        aliceRouter.confirmMargin();

        address routerAddr = address(aliceRouter);
        _mockSpot(routerAddr, 1e6, 0); // 1e18 evm / 10^12 extra = 1e6 core wei landed

        // permissionless: bob can confirm
        vm.prank(bob);
        aliceRouter.confirmMargin();

        assertEq(uint8(_marginOpStatus()), uint8(SuwappuPerpsRouterBoundUserImpl.MarginOpStatus.None));
    }

    // ── positions ────────────────────────────────────────────────────────────

    function test_openPosition_rejectsThirdParty() public {
        vm.prank(bob);
        vm.expectRevert(SuwappuPerpsRouterBoundUserImpl.NotAuthorized.selector);
        aliceRouter.openPosition(PERP, true, 100_0000_0000, 1e8);
    }

    function test_openPosition_allowsUser_placesLimitOrder() public {
        vm.prank(alice);
        aliceRouter.openPosition(PERP, true, 100_0000_0000, 1e8);

        assertEq(CoreWriterSink(CoreWriterLib.CORE_WRITER).count(), 1);
    }

    function test_closePosition_isPermissionless_inferSideFromLongPosition() public {
        address routerAddr = address(aliceRouter);
        _mockPosition(routerAddr, PERP, 1e8); // long -> close = sell

        vm.prank(bob); // anyone may close
        aliceRouter.closePosition(PERP, 100_0000_0000, 1e8);

        bytes memory action = CoreWriterSink(CoreWriterLib.CORE_WRITER).actions(0);
        bytes memory p = new bytes(action.length - 4);
        for (uint256 i = 0; i < p.length; i++) {
            p[i] = action[i + 4];
        }
        (, bool isBuy,,, bool reduceOnly,,) =
            abi.decode(p, (uint32, bool, uint64, uint64, bool, uint8, uint128));
        assertEq(isBuy, false, "closing a long must sell");
        assertTrue(reduceOnly);
    }

    function test_closePosition_inferSideFromShortPosition() public {
        address routerAddr = address(aliceRouter);
        _mockPosition(routerAddr, PERP, -1e8); // short -> close = buy

        aliceRouter.closePosition(PERP, 100_0000_0000, 1e8);

        bytes memory action = CoreWriterSink(CoreWriterLib.CORE_WRITER).actions(0);
        bytes memory p = new bytes(action.length - 4);
        for (uint256 i = 0; i < p.length; i++) {
            p[i] = action[i + 4];
        }
        (, bool isBuy,,,,,) = abi.decode(p, (uint32, bool, uint64, uint64, bool, uint8, uint128));
        assertEq(isBuy, true, "closing a short must buy");
    }

    // ── margin: withdraw ─────────────────────────────────────────────────────

    function test_fullWithdraw_permissionlessAtEveryStep_paysAlice() public {
        address routerAddr = address(aliceRouter);

        vm.prank(bob); // permissionless
        aliceRouter.initiateWithdraw(1e18);
        assertEq(
            uint8(_marginOpStatus()), uint8(SuwappuPerpsRouterBoundUserImpl.MarginOpStatus.AwaitingBridgeOut)
        );

        vm.expectRevert(SuwappuPerpsRouterBoundUserImpl.NotLanded.selector);
        aliceRouter.bridgeWithdrawToEvm();

        _mockSpot(routerAddr, 1e6, 0);
        vm.prank(keeper); // permissionless
        aliceRouter.bridgeWithdrawToEvm();
        assertEq(
            uint8(_marginOpStatus()), uint8(SuwappuPerpsRouterBoundUserImpl.MarginOpStatus.AwaitingClaim)
        );

        vm.expectRevert(SuwappuPerpsRouterBoundUserImpl.NotLanded.selector);
        aliceRouter.claimWithdraw();

        usdc.mint(routerAddr, 1e18);
        vm.prank(bob); // permissionless — still pays alice, not bob
        aliceRouter.claimWithdraw();

        assertEq(usdc.balanceOf(alice), 1_000e18 + 1e18);
        assertEq(usdc.balanceOf(bob), 0);
        assertEq(uint8(_marginOpStatus()), uint8(SuwappuPerpsRouterBoundUserImpl.MarginOpStatus.None));
    }

    function test_withdraw_blockedWhileDepositLocked() public {
        vm.prank(alice);
        aliceRouter.depositMargin(1e18);

        vm.expectRevert(SuwappuPerpsRouterBoundUserImpl.Locked.selector);
        aliceRouter.initiateWithdraw(1e18);
    }

    // ── factory: atomic deploy + deposit ────────────────────────────────────

    function test_deployAndDepositMargin_deploysAndFundsAtomically() public {
        address carol = address(0xCA501);
        address predicted = factory.routerFor(carol);
        usdc.mint(carol, 100e18);
        vm.prank(carol);
        usdc.approve(predicted, type(uint256).max);
        _mockSpot(predicted, 0, 0);

        vm.prank(keeper);
        address router = factory.deployAndDepositMargin(carol, 1e18);

        assertEq(router, predicted);
        assertEq(usdc.balanceOf(carol), 99e18);
    }

    function test_deployAndDepositMargin_revertsOnExistingRouter() public {
        vm.expectRevert(SuwappuPerpsRouterFactory.RouterAlreadyDeployed.selector);
        factory.deployAndDepositMargin(alice, 1e18);
    }

    // ── helpers ─────────────────────────────────────────────────────────────

    function _marginOpStatus() internal view returns (SuwappuPerpsRouterBoundUserImpl.MarginOpStatus) {
        (SuwappuPerpsRouterBoundUserImpl.MarginOpStatus status,,,) = aliceRouter.marginOp();
        return status;
    }
}
