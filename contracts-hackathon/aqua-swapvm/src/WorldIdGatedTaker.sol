// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {Aqua} from "@1inch/aqua/src/Aqua.sol";
import {ITakerCallbacks} from "@1inch/swap-vm/contracts/interfaces/ITakerCallbacks.sol";
import {SwapVM, ISwapVM} from "@1inch/swap-vm/contracts/SwapVM.sol";

/// @notice ETHGlobal Tokyo 2026 "Agent Swap Passport" — a SwapVM taker contract. Its own
/// address is the identity checked by the WhitelistCoequal opcode in the maker's
/// program (see script/DeployAndDemo.s.sol), which is itself populated from the same
/// off-chain World ID verification api-ts performs (api-ts/src/lib/worldId.ts,
/// `/v1/agent/link/code`) — the third protocol integration reusing the same passport,
/// alongside the Uniswap v4 hook and the plain Aqua position built earlier in this
/// submission.
contract WorldIdGatedTaker is ITakerCallbacks {
    Aqua public immutable AQUA;
    SwapVM public immutable SWAPVM;
    address public immutable owner;

    modifier onlyOwner() {
        require(msg.sender == owner, "not owner");
        _;
    }

    modifier onlySwapVM() {
        require(msg.sender == address(SWAPVM), "not SwapVM");
        _;
    }

    constructor(Aqua aqua, SwapVM swapVM, address owner_) {
        AQUA = aqua;
        SWAPVM = swapVM;
        owner = owner_;
    }

    function swap(ISwapVM.Order calldata order, uint256 amount, bytes calldata takerTraitsAndData)
        external
        onlyOwner
        returns (uint256 amountIn, uint256 amountOut)
    {
        (amountIn, amountOut,) = SWAPVM.swap(order, amount, takerTraitsAndData);
    }

    function preTransferInCallback(
        address maker,
        address,
        address tokenIn,
        address,
        uint256 amountIn,
        uint256,
        bytes32 orderHash,
        bytes calldata
    ) external onlySwapVM {
        ERC20(tokenIn).approve(address(AQUA), amountIn);
        AQUA.push(maker, address(SWAPVM), orderHash, tokenIn, amountIn);
    }

    function preTransferOutCallback(address, address, address, address, uint256, uint256, bytes32, bytes calldata)
        external
        view
        onlySwapVM
    {}
}
