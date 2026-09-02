// SPDX-License-Identifier: MIT
pragma solidity 0.8.27;

import { LibClone } from "../lib/solady/src/utils/LibClone.sol";

/**
 * @title ImmutableBoundUser
 *
 * Mixin for a logic contract meant to be `delegatecall`-run by one EIP-1167
 * clone per user (see SuwappuCoreRouterFactory.sol). The user each clone
 * routes funds for is baked into the first 20 bytes of EACH CLONE'S OWN
 * bytecode at CREATE2 time (`LibClone.cloneDeterministic`/
 * `createDeterministicClone`) — not a storage slot, not a constructor, not
 * an initializer. There is nothing here to front-run: it's fixed the
 * instant the clone is deployed, and contract code cannot change afterward.
 *
 * This is NOT an access-control primitive — it makes no claim about who may
 * CALL anything. It only answers "which user does this clone route funds
 * for," which a caller (e.g. SuwappuCoreRouterImplementation) uses as the
 * transferFrom source and swap beneficiary, never as a `msg.sender` check.
 *
 * Every clone runs the SAME logic bytecode via `delegatecall`, but
 * `address(this)` under `delegatecall` resolves to the CALLING clone's own
 * address, not the logic contract's. So `LibClone.argsOnClone(address(this))`
 * reads THIS specific clone's own trailing bytes — one shared logic
 * contract, a distinct fixed user per clone.
 */
abstract contract ImmutableBoundUser {
    /// @dev Subclasses that bake MORE immutable args after the user address
    /// (e.g. market config, in a future version) must read them starting at
    /// offset USER_ARGS_LEN, not 0.
    uint256 internal constant USER_ARGS_LEN = 20;

    /// The user this specific clone routes funds for, read from its own
    /// bytecode.
    function user() public view returns (address user_) {
        bytes memory raw = LibClone.argsOnClone(address(this), 0, USER_ARGS_LEN);
        assembly {
            user_ := shr(96, mload(add(raw, 0x20)))
        }
    }
}
