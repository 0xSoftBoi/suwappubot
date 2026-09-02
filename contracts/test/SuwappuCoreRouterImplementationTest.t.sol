// SPDX-License-Identifier: MIT
pragma solidity 0.8.27;

import { Test, Vm } from "forge-std/Test.sol";
import { L1Read } from "../hypercore/L1Read.sol";
import { CoreWriterLib } from "../hypercore/CoreWriterLib.sol";
import { SuwappuCoreRouterImplementation, IERC20 } from "../hypercore/SuwappuCoreRouterImplementation.sol";
import { SuwappuCoreRouterFactory } from "../hypercore/SuwappuCoreRouterFactory.sol";

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
}

/// Proves the per-clone fund-direction gating: no matter who CALLS the
/// clone's lifecycle functions, tokens only ever move for the user this
/// clone was deployed for — never the caller, never anyone else's clone.
contract SuwappuCoreRouterImplementationTest is Test {
    TestToken base;
    TestToken quote;
    SuwappuCoreRouterImplementation logic;
    SuwappuCoreRouterFactory factory;
    SuwappuCoreRouterImplementation aliceRouter; // alice's clone, typed for calls

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

        logic = new SuwappuCoreRouterImplementation(
            base, quote, BASE_TOKEN, QUOTE_TOKEN, ORDER_ASSET, 8, 8, 10, 0, 2, treasury, 30
        );
        factory = new SuwappuCoreRouterFactory(address(logic));

        address routerAddr = factory.deployRouter(alice);
        aliceRouter = SuwappuCoreRouterImplementation(routerAddr);

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

    function test_initiate_calledByKeeper_stillBoundToTheCloneUser() public {
        vm.prank(keeper); // NOT alice — a keeper is triggering this
        uint128 id = aliceRouter.initiate(true, 2e18, PX, 49e8);

        SuwappuCoreRouterImplementation.Swap memory s = aliceRouter.getSwap(id);
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
        SuwappuCoreRouterImplementation bobRouter = SuwappuCoreRouterImplementation(bobRouterAddr);

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
        SuwappuCoreRouterImplementation carolRouter = SuwappuCoreRouterImplementation(router);
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
                logs[i].topics[0] != SuwappuCoreRouterFactory.RouterDeployed.selector,
                "must not re-emit RouterDeployed for an existing router"
            );
        }
        assertEq(aliceRouter.getSwap(id).user, alice);
    }
}
