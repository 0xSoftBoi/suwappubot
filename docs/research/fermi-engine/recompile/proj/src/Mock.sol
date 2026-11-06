// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.20;

/// Test-only registry mock placed over 0xDa7A... on an anvil fork. Price lives in slot 0.
contract MockRegistry {
    uint256 public price;
    uint256 public mode; // 0 => one value, 1 => empty array

    function getState(uint256, uint32, uint32) external view returns (uint32, uint256[] memory v) {
        if (mode == 1) return (uint32(block.timestamp), v);
        v = new uint256[](1);
        v[0] = price;
        return (uint32(block.timestamp), v);
    }
}
