// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {IAqua} from "@1inch/aqua/interfaces/IAqua.sol";
import {WorldIdGatedXYCSwap} from "./WorldIdGatedXYCSwap.sol";

interface IERC20Approve {
    function approve(address spender, uint256 amount) external returns (bool);
}

/// @notice Minimal taker for the ETHGlobal Tokyo 2026 demo swap — must itself be
/// recorded as World ID-verified on WorldIdGatedXYCSwap for its swaps to succeed.
contract SimpleTaker {
    IAqua public immutable AQUA;

    constructor(IAqua aqua_) {
        AQUA = aqua_;
    }

    function approveToken(address token) external {
        IERC20Approve(token).approve(address(AQUA), type(uint256).max);
    }

    function swap(
        WorldIdGatedXYCSwap app,
        WorldIdGatedXYCSwap.Strategy calldata strategy,
        bool zeroForOne,
        uint256 amountIn
    ) external returns (uint256) {
        return app.swapExactIn(strategy, zeroForOne, amountIn, 0, msg.sender, "");
    }

    function xycSwapCallback(
        address tokenIn,
        address,
        uint256 amountIn,
        uint256,
        address maker,
        address app,
        bytes32 strategyHash,
        bytes calldata
    ) external {
        AQUA.push(maker, app, strategyHash, tokenIn, amountIn);
    }
}
