// SPDX-License-Identifier: MIT
pragma solidity 0.8.27;

import "forge-std/Test.sol";
import { SuwappuCoreRouterFactory } from "../hypercore/SuwappuCoreRouterFactory.sol";
import { ImmutableArgsOwned } from "../hypercore/ImmutableArgsOwned.sol";

/// Minimal stand-in for the eventual SuwappuCoreRouterLogic: just enough to
/// prove the owner-from-bytecode access control actually gates a call.
contract MockRouterLogic is ImmutableArgsOwned {
    uint256 public hits;

    function poke() external onlyOwner {
        hits += 1;
    }
}

contract RouterFactoryTest is Test {
    SuwappuCoreRouterFactory factory;
    address logic;

    address alice = address(0xA11CE);
    address bob = address(0xB0B);

    function setUp() public {
        logic = address(new MockRouterLogic());
        factory = new SuwappuCoreRouterFactory(logic);
    }

    function test_constructor_rejectsZeroAndEoaLogic() public {
        vm.expectRevert(SuwappuCoreRouterFactory.ZeroAddress.selector);
        new SuwappuCoreRouterFactory(address(0));

        vm.expectRevert(SuwappuCoreRouterFactory.BadLogic.selector);
        new SuwappuCoreRouterFactory(address(0xdead)); // EOA-like address, no code
    }

    function test_routerFor_isDeterministic_andMatchesActualDeploy() public {
        address predicted = factory.routerFor(alice);
        assertEq(predicted.code.length, 0, "should be counterfactual before deploy");

        address deployed = factory.deployRouter(alice);
        assertEq(deployed, predicted, "deployed address must match prediction");
        assertGt(deployed.code.length, 0);
    }

    function test_differentUsers_getDifferentRouters() public {
        address a = factory.deployRouter(alice);
        address b = factory.deployRouter(bob);
        assertTrue(a != b);
    }

    function test_deployRouter_isIdempotent_noDuplicateEvent() public {
        address first = factory.deployRouter(alice);

        vm.recordLogs();
        address second = factory.deployRouter(alice);
        Vm.Log[] memory logs = vm.getRecordedLogs();

        assertEq(first, second);
        assertEq(logs.length, 0, "re-deploying an existing user's router must not re-emit");
    }

    function test_deployRouter_rejectsZeroUser() public {
        vm.expectRevert(SuwappuCoreRouterFactory.ZeroAddress.selector);
        factory.deployRouter(address(0));
    }

    function test_clone_ownerIsBakedInUser_notFactoryOrDeployer() public {
        address someoneElse = address(0xC0FFEE);
        vm.prank(someoneElse); // whoever calls deployRouter does NOT become owner
        address router = factory.deployRouter(alice);

        assertEq(MockRouterLogic(router).owner(), alice);
    }

    function test_onlyOwner_gatesTheClone_perUser() public {
        address aliceRouter = factory.deployRouter(alice);
        address bobRouter = factory.deployRouter(bob);

        vm.prank(bob);
        vm.expectRevert(ImmutableArgsOwned.NotOwner.selector);
        MockRouterLogic(aliceRouter).poke();

        vm.prank(alice);
        MockRouterLogic(aliceRouter).poke();
        assertEq(MockRouterLogic(aliceRouter).hits(), 1);

        // Bob's own clone is unaffected by Alice's, and Bob controls only his own.
        vm.prank(alice);
        vm.expectRevert(ImmutableArgsOwned.NotOwner.selector);
        MockRouterLogic(bobRouter).poke();

        vm.prank(bob);
        MockRouterLogic(bobRouter).poke();
        assertEq(MockRouterLogic(bobRouter).hits(), 1);
        assertEq(MockRouterLogic(aliceRouter).hits(), 1, "alice's clone state must not have moved");
    }

    function testFuzz_owner_alwaysMatchesDeployedUser(address user) public {
        vm.assume(user != address(0));
        address router = factory.deployRouter(user);
        assertEq(MockRouterLogic(router).owner(), user);
    }
}
