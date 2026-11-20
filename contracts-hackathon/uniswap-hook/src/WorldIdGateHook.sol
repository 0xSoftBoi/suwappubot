// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IHooks} from "v4-core/src/interfaces/IHooks.sol";
import {IPoolManager} from "v4-core/src/interfaces/IPoolManager.sol";
import {PoolKey} from "v4-core/src/types/PoolKey.sol";
import {BalanceDelta} from "v4-core/src/types/BalanceDelta.sol";
import {ModifyLiquidityParams, SwapParams} from "v4-core/src/types/PoolOperation.sol";
import {BeforeSwapDelta, BeforeSwapDeltaLibrary} from "v4-core/src/types/BeforeSwapDelta.sol";

/// @notice ETHGlobal Tokyo 2026 "Agent Swap Passport" — a minimal Uniswap v4 hook that
/// only allows a swap through `beforeSwap` if the swapper's address has been recorded as
/// World ID-verified. The allowlist is populated off-chain from the same World ID
/// verification api-ts already performs (see api-ts/src/lib/worldId.ts,
/// api-ts/src/routes/agent.ts `/v1/agent/link/code`) — this contract is the on-chain
/// enforcement point for that same passport, composing the World ID and Uniswap tracks
/// of this hackathon submission into one story.
///
/// Only `beforeSwap` is enabled (see the deployed address's flag bits, mined via
/// HookMiner) — every other IHooks callback is unused and reverts if ever invoked,
/// since PoolManager will never call them for an address without their flag bit set.
contract WorldIdGateHook is IHooks {
    error NotPoolManager();
    error SwapperNotVerified(address swapper);
    error HookNotImplemented();

    IPoolManager public immutable poolManager;
    address public immutable owner;
    mapping(address => bool) public isWorldIdVerified;

    event WorldIdVerifiedSet(address indexed account, bool verified);

    modifier onlyPoolManager() {
        if (msg.sender != address(poolManager)) revert NotPoolManager();
        _;
    }

    modifier onlyOwner() {
        require(msg.sender == owner, "not owner");
        _;
    }

    constructor(IPoolManager _poolManager, address _owner) {
        poolManager = _poolManager;
        owner = _owner;
    }

    /// @notice Owner-only allowlist setter, populated from api-ts's World ID verification
    /// results (agents.metadata.worldId, see docs/plans/ethglobal-tokyo2026-agent-passport.md
    /// Phase 1). A production version would read an on-chain attestation registry instead
    /// of a manually-set mapping; this is the minimal hackathon-scope enforcement point.
    function setWorldIdVerified(address account, bool verified) external onlyOwner {
        isWorldIdVerified[account] = verified;
        emit WorldIdVerifiedSet(account, verified);
    }

    /// @dev `sender` here is the immediate caller into PoolManager (almost always a
    /// router contract, e.g. PoolSwapTest/UniversalRouter), not the actual swapper's
    /// EOA. Real-world compliance hooks can't rely on `sender` for this reason — the
    /// actual swapper address must be passed through `hookData` by the router/frontend
    /// and checked here instead. This is the realistic pattern, not a shortcut.
    function beforeSwap(address, PoolKey calldata, SwapParams calldata, bytes calldata hookData)
        external
        view
        onlyPoolManager
        returns (bytes4, BeforeSwapDelta, uint24)
    {
        address swapper = abi.decode(hookData, (address));
        if (!isWorldIdVerified[swapper]) revert SwapperNotVerified(swapper);
        return (IHooks.beforeSwap.selector, BeforeSwapDeltaLibrary.ZERO_DELTA, 0);
    }

    // ---- Unused IHooks callbacks: this hook's deployed address only sets the
    // BEFORE_SWAP flag bit, so PoolManager never invokes any of these. They exist only
    // to satisfy the IHooks interface. ----

    function beforeInitialize(address, PoolKey calldata, uint160) external pure returns (bytes4) {
        revert HookNotImplemented();
    }

    function afterInitialize(address, PoolKey calldata, uint160, int24) external pure returns (bytes4) {
        revert HookNotImplemented();
    }

    function beforeAddLiquidity(address, PoolKey calldata, ModifyLiquidityParams calldata, bytes calldata)
        external
        pure
        returns (bytes4)
    {
        revert HookNotImplemented();
    }

    function afterAddLiquidity(
        address,
        PoolKey calldata,
        ModifyLiquidityParams calldata,
        BalanceDelta,
        BalanceDelta,
        bytes calldata
    ) external pure returns (bytes4, BalanceDelta) {
        revert HookNotImplemented();
    }

    function beforeRemoveLiquidity(address, PoolKey calldata, ModifyLiquidityParams calldata, bytes calldata)
        external
        pure
        returns (bytes4)
    {
        revert HookNotImplemented();
    }

    function afterRemoveLiquidity(
        address,
        PoolKey calldata,
        ModifyLiquidityParams calldata,
        BalanceDelta,
        BalanceDelta,
        bytes calldata
    ) external pure returns (bytes4, BalanceDelta) {
        revert HookNotImplemented();
    }

    function afterSwap(address, PoolKey calldata, SwapParams calldata, BalanceDelta, bytes calldata)
        external
        pure
        returns (bytes4, int128)
    {
        revert HookNotImplemented();
    }

    function beforeDonate(address, PoolKey calldata, uint256, uint256, bytes calldata)
        external
        pure
        returns (bytes4)
    {
        revert HookNotImplemented();
    }

    function afterDonate(address, PoolKey calldata, uint256, uint256, bytes calldata)
        external
        pure
        returns (bytes4)
    {
        revert HookNotImplemented();
    }
}
