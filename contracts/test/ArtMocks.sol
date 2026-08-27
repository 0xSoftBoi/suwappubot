// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @notice Minimal oracle for exercising the on-chain renderer end to end.
contract MockPositionOracle {
    mapping(address => uint256) public price;
    mapping(address => uint96) public multiplier;

    function set(address token, uint256 p, uint96 m) external {
        price[token] = p;
        multiplier[token] = m;
    }

    function priceOf(address token) external view returns (uint256) {
        return price[token];
    }

    function multiplierOf(address token) external view returns (uint96) {
        return multiplier[token];
    }
}

/// @notice An ERC-20 that returns `symbol()` as a string, the common shape.
contract MockSymbolString {
    string public symbol;

    constructor(string memory s) {
        symbol = s;
    }
}

/// @notice An ERC-20 that returns `symbol()` as a bytes32, the older shape that
///         several long-lived tokens still use. `tickerSymbol` must decode both.
contract MockSymbolBytes32 {
    bytes32 private immutable _s;

    constructor(bytes32 s) {
        _s = s;
    }

    function symbol() external view returns (bytes32) {
        return _s;
    }
}

/// @notice A token with no `symbol()` at all — the render must degrade, not revert.
contract MockSymbolMissing {}
