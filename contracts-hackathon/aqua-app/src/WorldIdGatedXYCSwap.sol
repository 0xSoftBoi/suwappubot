// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {IAqua} from "@1inch/aqua/interfaces/IAqua.sol";
import {AquaApp} from "@1inch/aqua/AquaApp.sol";

interface IWorldIdGatedXYCSwapCallback {
    function xycSwapCallback(
        address tokenIn,
        address tokenOut,
        uint256 amountIn,
        uint256 amountOut,
        address maker,
        address app,
        bytes32 strategyHash,
        bytes calldata takerData
    ) external;
}

/// @notice ETHGlobal Tokyo 2026 "Agent Swap Passport" — a custom Aqua app implementing
/// a constant-product AMM position (based directly on Aqua's own XYCSwap example) that
/// only lets a *taker* execute a swap if their address has been recorded as World
/// ID-verified. The allowlist is populated off-chain from the same World ID
/// verification api-ts already performs (see api-ts/src/lib/worldId.ts,
/// api-ts/src/routes/agent.ts `/v1/agent/link/code`) — composing the World and 1inch
/// tracks of this hackathon submission into one identity-gated DeFi position, the same
/// pattern used for the Uniswap v4 hook in this same submission.
contract WorldIdGatedXYCSwap is AquaApp {
    using Math for uint256;

    error InsufficientOutputAmount(uint256 amountOut, uint256 amountOutMin);
    error ExcessiveInputAmount(uint256 amountIn, uint256 amountInMax);
    error TakerNotWorldIdVerified(address taker);

    struct Strategy {
        address maker;
        address token0;
        address token1;
        uint256 feeBps;
        bytes32 salt;
    }

    uint256 internal constant BPS_BASE = 10_000;

    address public immutable owner;
    mapping(address => bool) public isWorldIdVerified;

    event WorldIdVerifiedSet(address indexed account, bool verified);

    modifier onlyOwner() {
        require(msg.sender == owner, "not owner");
        _;
    }

    constructor(IAqua aqua_, address owner_) AquaApp(aqua_) {
        owner = owner_;
    }

    /// @notice Owner-only allowlist setter, populated from api-ts's World ID
    /// verification results (agents.metadata.worldId) — the on-chain enforcement point
    /// for the same passport built in Phase 1 of this submission.
    function setWorldIdVerified(address account, bool verified) external onlyOwner {
        isWorldIdVerified[account] = verified;
        emit WorldIdVerifiedSet(account, verified);
    }

    function quoteExactIn(Strategy calldata strategy, bool zeroForOne, uint256 amountIn)
        external
        view
        returns (uint256 amountOut)
    {
        bytes32 strategyHash = keccak256(abi.encode(strategy));
        (,, uint256 balanceIn, uint256 balanceOut) = _getInAndOut(strategy, strategyHash, zeroForOne);
        amountOut = _quoteExactIn(strategy, balanceIn, balanceOut, amountIn);
    }

    /// @notice Executes a swap with exact input amount — only for World ID-verified takers.
    function swapExactIn(
        Strategy calldata strategy,
        bool zeroForOne,
        uint256 amountIn,
        uint256 amountOutMin,
        address to,
        bytes calldata takerData
    ) external nonReentrantStrategy(strategy.maker, keccak256(abi.encode(strategy))) returns (uint256 amountOut) {
        if (!isWorldIdVerified[msg.sender]) revert TakerNotWorldIdVerified(msg.sender);

        bytes32 strategyHash = keccak256(abi.encode(strategy));
        (address tokenIn, address tokenOut, uint256 balanceIn, uint256 balanceOut) =
            _getInAndOut(strategy, strategyHash, zeroForOne);
        amountOut = _quoteExactIn(strategy, balanceIn, balanceOut, amountIn);
        require(amountOut >= amountOutMin, InsufficientOutputAmount(amountOut, amountOutMin));

        AQUA.pull(strategy.maker, strategyHash, tokenOut, amountOut, to);
        IWorldIdGatedXYCSwapCallback(msg.sender).xycSwapCallback(
            tokenIn, tokenOut, amountIn, amountOut, strategy.maker, address(this), strategyHash, takerData
        );
        _safeCheckAquaPush(strategy.maker, strategyHash, tokenIn, balanceIn + amountIn);
    }

    function _quoteExactIn(Strategy calldata strategy, uint256 balanceIn, uint256 balanceOut, uint256 amountIn)
        internal
        pure
        returns (uint256 amountOut)
    {
        uint256 amountInWithFee = (amountIn * (BPS_BASE - strategy.feeBps)) / BPS_BASE;
        amountOut = (amountInWithFee * balanceOut) / (balanceIn + amountInWithFee);
    }

    function _getInAndOut(Strategy calldata strategy, bytes32 strategyHash, bool zeroForOne)
        private
        view
        returns (address tokenIn, address tokenOut, uint256 balanceIn, uint256 balanceOut)
    {
        tokenIn = zeroForOne ? strategy.token0 : strategy.token1;
        tokenOut = zeroForOne ? strategy.token1 : strategy.token0;
        (balanceIn, balanceOut) = AQUA.safeBalances(strategy.maker, address(this), strategyHash, tokenIn, tokenOut);
    }
}
