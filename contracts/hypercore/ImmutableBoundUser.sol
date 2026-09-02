// SPDX-License-Identifier: MIT
pragma solidity 0.8.27;

import { LibClone } from "../lib/solady/src/utils/LibClone.sol";

/**
 * @title ImmutableBoundUser
 *
 * Mixin for a logic contract meant to be `delegatecall`-run by one EIP-1167
 * clone per user (see SuwappuCoreRouterBoundUserFactory.sol). Two addresses
 * are baked into EACH CLONE'S OWN bytecode at CREATE2 time
 * (`LibClone.cloneDeterministic`/`createDeterministicClone`) — not a storage
 * slot, not a constructor, not an initializer — laid out back to back:
 * bytes [0,20) the user this clone routes funds for, bytes [20,40) the
 * factory that deployed it. There is nothing here to front-run: both are
 * fixed the instant the clone is deployed, and contract code cannot change
 * afterward.
 *
 * This file itself makes no policy claim — it's a data reader, not an
 * authorization decision. `user()` is mostly used as pure routing data (the
 * transferFrom source and swap beneficiary, never a `msg.sender` check) by
 * SuwappuCoreRouterBoundUserImpl — except in `initiate()`, which uses BOTH
 * `user()` and `factory()` together as the one place in this stack that
 * actually gates on `msg.sender` (see that function's own comment for why:
 * a standing token approval means initiate() can't stay fully permissionless
 * the way execute/settle/claim/retry/forceRelease safely can).
 *
 * Every clone runs the SAME logic bytecode via `delegatecall`, but
 * `address(this)` under `delegatecall` resolves to the CALLING clone's own
 * address, not the logic contract's. So `LibClone.argsOnClone(address(this))`
 * reads THIS specific clone's own trailing bytes — one shared logic
 * contract, a distinct fixed (user, factory) pair per clone.
 */
abstract contract ImmutableBoundUser {
    /// @dev Subclasses that bake MORE immutable args after these two
    /// addresses (e.g. market config, in a future version) must read them
    /// starting at offset USER_ARGS_LEN + FACTORY_ARGS_LEN, not 0.
    uint256 internal constant USER_ARGS_LEN = 20;
    uint256 internal constant FACTORY_ARGS_LEN = 20;

    /// The user this specific clone routes funds for, read from its own
    /// bytecode.
    function user() public view returns (address user_) {
        bytes memory raw = LibClone.argsOnClone(address(this), 0, USER_ARGS_LEN);
        assembly {
            user_ := shr(96, mload(add(raw, 0x20)))
        }
    }

    /// The factory that deployed this specific clone, read from its own
    /// bytecode.
    function factory() public view returns (address factory_) {
        bytes memory raw =
            LibClone.argsOnClone(address(this), USER_ARGS_LEN, USER_ARGS_LEN + FACTORY_ARGS_LEN);
        assembly {
            factory_ := shr(96, mload(add(raw, 0x20)))
        }
    }
}
