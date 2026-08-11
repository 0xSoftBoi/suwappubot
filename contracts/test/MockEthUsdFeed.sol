// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @dev Test-only Chainlink aggregator. Mirrors the real ETH/USD feed on chain
///      4663 (0x78F3556b67E17Df817D51Ef5a990cDaF09E8d3A9, 8 decimals). Never deployed.
contract MockEthUsdFeed {
    int256 public answer;
    uint256 public updatedAt;
    uint8 public decimals = 8;

    constructor(int256 answer_) {
        answer = answer_;
        updatedAt = block.timestamp;
    }

    function set(int256 answer_, uint256 updatedAt_) external {
        answer = answer_;
        updatedAt = updatedAt_;
    }

    function setDecimals(uint8 d) external {
        decimals = d;
    }

    function latestRoundData()
        external
        view
        returns (uint80, int256, uint256, uint256, uint80)
    {
        return (1, answer, updatedAt, updatedAt, 1);
    }
}
