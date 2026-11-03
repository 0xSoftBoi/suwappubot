// SPDX-License-Identifier: MIT
pragma solidity 0.8.27;

import { LibClone } from "../lib/solady/src/utils/LibClone.sol";
import { SuwappuPerpsRouterBoundUserImpl } from "./SuwappuPerpsRouterBoundUserImpl.sol";

/**
 * @title SuwappuPerpsRouterFactory
 *
 * Deploys one EIP-1167-with-immutable-args perps-router clone per user
 * against a single shared logic contract, same pattern as
 * SuwappuCoreRouterBoundUserFactory.sol — see that file's header for the
 * full isolation/fund-direction-gating rationale, identical here. Kept as
 * its own separate factory rather than generalizing the spot factory,
 * because the two logic contracts have different ABIs (initiate() vs
 * depositMargin()) — see SuwappuPerpsRouterBoundUserImpl.sol's header for
 * why a perps router is shaped differently from the spot router (one
 * instance trades ANY perp, not one pair).
 */
contract SuwappuPerpsRouterFactory {
    /// The shared logic contract every clone `delegatecall`s into.
    address public immutable logic;

    event RouterDeployed(address indexed user, address indexed router);

    error ZeroAddress();
    error BadLogic();
    error RouterAlreadyDeployed();

    constructor(address logic_) {
        if (logic_ == address(0)) revert ZeroAddress();
        if (logic_.code.length == 0) revert BadLogic();
        logic = logic_;
    }

    function _salt(address user) internal pure returns (bytes32) {
        return bytes32(uint256(uint160(user)));
    }

    function _args(address user) internal view returns (bytes memory) {
        return abi.encodePacked(user, address(this));
    }

    /// Predict a user's router address before it's deployed (counterfactual
    /// — safe to approve USDC to this address ahead of the user's first
    /// deposit).
    function routerFor(address user) public view returns (address) {
        return LibClone.predictDeterministicAddress(logic, _args(user), _salt(user), address(this));
    }

    /// Deploy `user`'s router if it doesn't already exist; idempotent and
    /// permissionless — see SuwappuCoreRouterBoundUserFactory.deployRouter.
    function deployRouter(address user) external returns (address router) {
        if (user == address(0)) revert ZeroAddress();
        router = _deploy(user);
    }

    /// Deploy `user`'s router and immediately deposit margin, atomically —
    /// for a first-time user whose router doesn't exist yet. Reverts
    /// RouterAlreadyDeployed if `user` already has a router — same "spent
    /// exactly once, at creation" reasoning as
    /// SuwappuCoreRouterBoundUserFactory.deployAndInitiate; see that
    /// function's comment for why the alternative (idempotent reuse) would
    /// be a standing bypass of depositMargin's access control.
    function deployAndDepositMargin(address user, uint256 evmAmount)
        external
        returns (address router)
    {
        if (user == address(0)) revert ZeroAddress();
        bool alreadyDeployed;
        (alreadyDeployed, router) = _deployReporting(user);
        if (alreadyDeployed) revert RouterAlreadyDeployed();
        SuwappuPerpsRouterBoundUserImpl(router).depositMargin(evmAmount);
    }

    function _deploy(address user) internal returns (address router) {
        (, router) = _deployReporting(user);
    }

    function _deployReporting(address user) internal returns (bool alreadyDeployed, address router) {
        (alreadyDeployed, router) = LibClone.createDeterministicClone(logic, _args(user), _salt(user));
        if (!alreadyDeployed) emit RouterDeployed(user, router);
    }
}
