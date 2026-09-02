// SPDX-License-Identifier: MIT
pragma solidity 0.8.27;

import { LibClone } from "../lib/solady/src/utils/LibClone.sol";
import { SuwappuCoreRouterBoundUserImpl } from "./SuwappuCoreRouterBoundUserImpl.sol";

/**
 * @title SuwappuCoreRouterBoundUserFactory
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
 * one it routes funds for (see ImmutableBoundUser). Nothing here can deploy a
 * router "on behalf of" someone into a state where a different address ends
 * up receiving/paying for its swaps.
 *
 * Every clone's args also bake in this factory's OWN address
 * (`address(this)` at the moment `_args` is built) alongside the user's,
 * because `SuwappuCoreRouterBoundUserImpl.initiate()` checks
 * `msg.sender == user() || msg.sender == factory()` — see that function's
 * comment for why a standing token approval means initiate() can't stay
 * fully permissionless the way every other lifecycle function safely can.
 * deployAndInitiate() below is the ONLY place this contract ever calls
 * initiate() as itself, and it only does so for a clone it JUST deployed in
 * this same call (reverts RouterAlreadyDeployed otherwise) — so the
 * factory's msg.sender==factory() privilege on a given clone is spent
 * exactly once, at that clone's creation, never again.
 *
 * Scope note: the immutable args carry the routed user's address and this
 * factory's own address. Market config (baseErc20/quoteErc20/orderAsset/
 * decimals/treasury/feeBps) stays as regular Solidity `immutable`s on
 * SuwappuCoreRouterBoundUserImpl itself — correct there, since it's
 * identical for every clone of one market; only per-clone data needed the
 * immutable-args trick.
 */
contract SuwappuCoreRouterBoundUserFactory {
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

    /// @dev One clone per user: salt is derived purely from `user`, so the
    /// address is deterministic and every deploy attempt for the same user
    /// resolves to the same clone — see routerFor().
    function _salt(address user) internal pure returns (bytes32) {
        return bytes32(uint256(uint160(user)));
    }

    /// Bakes this factory's own address in alongside `user` — see the header
    /// for why SuwappuCoreRouterBoundUserImpl.initiate() needs it.
    function _args(address user) internal view returns (bytes memory) {
        return abi.encodePacked(user, address(this));
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
        router = _deploy(user);
    }

    /// Deploy `user`'s router and immediately initiate a swap on it,
    /// atomically — for a first-time user whose router doesn't exist yet.
    /// Works because `routerFor(user)` is counterfactually deterministic:
    /// `user` can approve that predicted address for `tokenIn` before it has
    /// any code, exactly as with any counterfactual smart-wallet deploy.
    ///
    /// Reverts RouterAlreadyDeployed if `user` already has a router — this
    /// function's authority to call initiate() AS the factory (see
    /// ImmutableBoundUser / SuwappuCoreRouterBoundUserImpl.initiate()) only
    /// makes sense for a brand new clone that couldn't have called
    /// initiate() itself yet; once a router exists, only its own user may
    /// initiate() on it directly. Without this revert, this function would
    /// be a standing way for ANY caller to force swaps against an existing
    /// router's approved allowance forever — exactly the vulnerability this
    /// permission split exists to close.
    ///
    /// initiate() reverting for any other reason (no allowance yet, e.g.)
    /// reverts this whole call, including the deploy — CREATE2 means a
    /// retry later lands on the same address.
    function deployAndInitiate(
        address user,
        bool baseForQuote,
        uint256 evmAmountIn,
        uint64 limitPx,
        uint64 minCoreOut
    ) external returns (address router, uint128 id) {
        if (user == address(0)) revert ZeroAddress();
        bool alreadyDeployed;
        (alreadyDeployed, router) = _deployReporting(user);
        if (alreadyDeployed) revert RouterAlreadyDeployed();
        id = SuwappuCoreRouterBoundUserImpl(router).initiate(
            baseForQuote, evmAmountIn, limitPx, minCoreOut
        );
    }

    function _deploy(address user) internal returns (address router) {
        (, router) = _deployReporting(user);
    }

    function _deployReporting(address user) internal returns (bool alreadyDeployed, address router) {
        (alreadyDeployed, router) = LibClone.createDeterministicClone(logic, _args(user), _salt(user));
        if (!alreadyDeployed) emit RouterDeployed(user, router);
    }
}
