// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @dev Test-only stand-in for a Robinhood Chain licensed Stock Token. Mirrors
///      the two hooks the real ones expose — verified live on chain 4663:
///      NVDA/AAPL/TSLA/GME all return uiMultiplier() == 1e18 and
///      oraclePaused() == false. Never deployed.
contract MockStockToken {
    uint256 public uiMultiplier = 1e18;
    bool public oraclePaused;

    /// @notice Apply a corporate action, e.g. split(10) for a 10:1 split.
    function split(uint256 ratio) external {
        uiMultiplier = uiMultiplier * ratio;
    }

    function setMultiplier(uint256 m) external {
        uiMultiplier = m;
    }

    function setPaused(bool p) external {
        oraclePaused = p;
    }
}
