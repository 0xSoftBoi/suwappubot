// SPDX-License-Identifier: UNLICENSED
pragma solidity >=0.8.25;

interface IFermiEngine {
    struct PairInfo {
        address baseAsset;
        address quoteAsset;
        bool isActive;
    }

    function traderVault() external view returns (address payable);

    function isActive(address baseAsset, address quoteAsset) external view returns (bool);

    function getPairs() external view returns (PairInfo[] memory);

    function swap(
        address tokenIn,
        address tokenOut,
        int256 amountSpecified,
        address sender
    ) external returns (uint256 amountIn, uint256 amountOut);

    function quote(
        address tokenIn,
        address tokenOut,
        int256 amountSpecified,
        address sender
    ) external view returns (uint256 amountIn, uint256 amountOut);
}
