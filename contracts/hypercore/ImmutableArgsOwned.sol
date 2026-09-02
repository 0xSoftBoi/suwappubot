// SPDX-License-Identifier: MIT
pragma solidity 0.8.27;

import { LibClone } from "../lib/solady/src/utils/LibClone.sol";

/**
 * @title ImmutableArgsOwned
 *
 * Mixin for a logic contract meant to be `delegatecall`-run by one EIP-1167
 * clone per user (see RouterFactory.sol). The owning user's address is baked
 * into the first 20 bytes of EACH CLONE'S OWN bytecode at CREATE2 time
 * (`LibClone.cloneDeterministic`/`createDeterministicClone`) — not a storage
 * slot, not a constructor, not an initializer. There is nothing here to
 * front-run: the owner is fixed the instant the clone is deployed, and
 * contract code cannot change afterward.
 *
 * Every clone runs the SAME logic bytecode via `delegatecall`, but
 * `address(this)` under `delegatecall` resolves to the CALLING clone's own
 * address, not the logic contract's. So `LibClone.argsOnClone(address(this))`
 * reads THIS specific clone's own trailing bytes — one shared logic contract,
 * unforgeable per-clone ownership.
 */
abstract contract ImmutableArgsOwned {
    error NotOwner();

    /// @dev Subclasses that bake MORE immutable args after the owner address
    /// (e.g. market config, in a future version of the logic contract) must
    /// read them starting at offset OWNER_ARGS_LEN, not 0.
    uint256 internal constant OWNER_ARGS_LEN = 20;

    /// The user this specific clone belongs to, read from its own bytecode.
    function owner() public view returns (address owner_) {
        bytes memory raw = LibClone.argsOnClone(address(this), 0, OWNER_ARGS_LEN);
        assembly {
            owner_ := shr(96, mload(add(raw, 0x20)))
        }
    }

    modifier onlyOwner() {
        if (msg.sender != owner()) revert NotOwner();
        _;
    }
}
