// SPDX-License-Identifier: MIT
pragma solidity 0.8.27;

/// @notice Research-only specialized executor candidate for the dominant two-leg shape.
/// @dev It intentionally supports exactly two calls and one final ERC20 balance invariant.
contract TwoCallExecutor {
    error CallFailed(uint256 index);
    error BalanceReadFailed();
    error MinBalanceNotMet(address token, uint256 observed, uint256 minimum);

    function executeTwo(
        address target0,
        uint256 value0,
        bytes calldata data0,
        address target1,
        uint256 value1,
        bytes calldata data1,
        address token,
        uint256 minimum
    ) external payable returns (uint256 finalBalance) {
        assembly ("memory-safe") {
            let ptr := mload(0x40)

            calldatacopy(ptr, data0.offset, data0.length)
            if iszero(call(gas(), target0, value0, ptr, data0.length, 0, 0)) {
                mstore(ptr, shl(224, 0x8a7a4d2b))
                mstore(add(ptr, 4), 0)
                revert(ptr, 36)
            }

            calldatacopy(ptr, data1.offset, data1.length)
            if iszero(call(gas(), target1, value1, ptr, data1.length, 0, 0)) {
                mstore(ptr, shl(224, 0x8a7a4d2b))
                mstore(add(ptr, 4), 1)
                revert(ptr, 36)
            }

            // IERC20.balanceOf(address(this)) selector = 0x70a08231.
            mstore(ptr, shl(224, 0x70a08231))
            mstore(add(ptr, 4), address())
            if iszero(staticcall(gas(), token, ptr, 36, ptr, 32)) {
                mstore(ptr, shl(224, 0x6d3f0f34))
                revert(ptr, 4)
            }
            if lt(returndatasize(), 32) {
                mstore(ptr, shl(224, 0x6d3f0f34))
                revert(ptr, 4)
            }
            finalBalance := mload(ptr)
        }

        if (finalBalance < minimum) {
            revert MinBalanceNotMet(token, finalBalance, minimum);
        }
    }

    receive() external payable {}
}
