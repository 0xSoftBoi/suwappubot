// SPDX-License-Identifier: MIT
pragma solidity 0.8.27;

import { LibClone } from "../lib/solady/src/utils/LibClone.sol";

/**
 * @title SuwappuCoreRouterFactory
 *
 * Deploys one EIP-1167-with-immutable-args clone per user against a single
 * shared logic contract, so each user gets their own HyperCore account (own
 * contract address) without redeploying the swap logic per user. See
 * contracts/PROPOSAL_PER_USER_ROUTER_ISOLATION_2026-09-01.md for why this
 * closes F1/F2/F3's shared root cause instead of patching each way it goes
 * wrong.
 *
 * Fund-direction gating lives in the clone's OWN bytecode, not storage: the
 * CREATE2 salt and the immutable args are both derived from `user`, so a
 * clone can only ever be produced with that user's address baked in as the
 * one it routes funds for (see ImmutableUser). Nothing here can deploy a
 * router "on behalf of" someone into a state where a different address ends
 * up receiving/paying for its swaps. This is not caller access control —
 * see SuwappuCoreRouterImplementation.sol for why every clone stays fully
 * permissionless.
 *
 * Scope note: today the immutable args carry ONLY the routed user's address.
 * Market config (baseErc20/quoteErc20/orderAsset/decimals/treasury/feeBps)
 * is deliberately not baked in yet — that's for SuwappuCoreRouterLogic's own
 * port (separate follow-up), which will decide whether config also belongs
 * in each clone's args (cheaper at steady-state, per the proposal) or stays
 * factory-read.
 */
contract SuwappuCoreRouterFactory {
    /// The shared logic contract every clone `delegatecall`s into.
    address public immutable logic;

    event RouterDeployed(address indexed user, address indexed router);

    error ZeroAddress();
    error BadLogic();

    constructor(address logic_) {
        if (logic_ == address(0)) revert ZeroAddress();
        if (logic_.code.length == 0) revert BadLogic();
        logic = logic_;
    }

    /// @dev One clone per user: salt is derived purely from `user`, so the
    /// address is deterministic and every deploy attempt for the same user
    /// resolves to the same clone — see routerFor().
    function _salt(address user) internal pure returns (bytes32) {
        return bytes32(uint256(uint160(user)));
    }

    function _args(address user) internal pure returns (bytes memory) {
        return abi.encodePacked(user);
    }

    /// Predict a user's router address before it's deployed (counterfactual
    /// — safe to approve tokens to this address ahead of the user's first
    /// swap, the same pattern smart-wallet factories use).
    function routerFor(address user) public view returns (address) {
        return LibClone.predictDeterministicAddress(logic, _args(user), _salt(user), address(this));
    }

    /// Deploy `user`'s router if it doesn't already exist; idempotent and
    /// permissionless — anyone may trigger deployment for anyone, but doing
    /// so can never change who ends up controlling the resulting clone, so
    /// there's nothing to grief. Returns the (possibly newly deployed) router.
    function deployRouter(address user) external returns (address router) {
        if (user == address(0)) revert ZeroAddress();
        bool alreadyDeployed;
        (alreadyDeployed, router) = LibClone.createDeterministicClone(logic, _args(user), _salt(user));
        if (!alreadyDeployed) emit RouterDeployed(user, router);
    }
}
