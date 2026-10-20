// SPDX-License-Identifier: MIT
pragma solidity 0.8.27;

import "forge-std/Test.sol";
import { SuwappuCoreRouterBoundUserFactory } from "../hypercore/SuwappuCoreRouterBoundUserFactory.sol";
import { ImmutableBoundUser } from "../hypercore/ImmutableBoundUser.sol";

/// Minimal stand-in for the eventual SuwappuCoreRouterLogic: just enough to
/// prove ImmutableBoundUser's per-clone user() actually varies clone-by-clone,
/// and that a clone's own storage is independent of every other clone's.
/// poke() is deliberately permissionless — ImmutableBoundUser is fund-routing
/// data, not caller access control (see SuwappuCoreRouterBoundUserImpl.sol).
contract MockRouterLogic is ImmutableBoundUser {
    uint256 public hits;

    function poke() external {
        hits += 1;
    }
}

contract SuwappuCoreRouterBoundUserFactoryTest is Test {
    SuwappuCoreRouterBoundUserFactory factory;
    address logic;

    address alice = address(0xA11CE);
    address bob = address(0xB0B);

    function setUp() public {
        logic = address(new MockRouterLogic());
        factory = new SuwappuCoreRouterBoundUserFactory(logic);
    }

    function test_constructor_rejectsZeroAndEoaLogic() public {
        vm.expectRevert(SuwappuCoreRouterBoundUserFactory.ZeroAddress.selector);
        new SuwappuCoreRouterBoundUserFactory(address(0));

        vm.expectRevert(SuwappuCoreRouterBoundUserFactory.BadLogic.selector);
        new SuwappuCoreRouterBoundUserFactory(address(0xdead)); // EOA-like address, no code
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
        vm.expectRevert(SuwappuCoreRouterBoundUserFactory.ZeroAddress.selector);
        factory.deployRouter(address(0));
    }

    function test_clone_userIsBakedInTarget_notFactoryOrDeployer() public {
        address someoneElse = address(0xC0FFEE);
        vm.prank(someoneElse); // whoever calls deployRouter is irrelevant to user()
        address router = factory.deployRouter(alice);

        assertEq(MockRouterLogic(router).user(), alice);
    }

    function test_clonesAreIndependent_anyCallerPokesEither_stateNeverCrosses() public {
        address aliceRouter = factory.deployRouter(alice);
        address bobRouter = factory.deployRouter(bob);

        // No caller gating anywhere — bob can poke alice's clone and vice versa...
        vm.prank(bob);
        MockRouterLogic(aliceRouter).poke();
        vm.prank(alice);
        MockRouterLogic(bobRouter).poke();

        // ...but each clone's own storage (and baked-in user()) never crosses.
        assertEq(MockRouterLogic(aliceRouter).hits(), 1);
        assertEq(MockRouterLogic(bobRouter).hits(), 1);
        assertEq(MockRouterLogic(aliceRouter).user(), alice);
        assertEq(MockRouterLogic(bobRouter).user(), bob);
    }

    function testFuzz_user_alwaysMatchesDeployedTarget(address target) public {
        vm.assume(target != address(0));
        address router = factory.deployRouter(target);
        assertEq(MockRouterLogic(router).user(), target);
    }
}
