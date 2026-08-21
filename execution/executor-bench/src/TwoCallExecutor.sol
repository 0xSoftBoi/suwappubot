// SPDX-License-Identifier: MIT
pragma solidity 0.8.27;

/// @notice Research-only specialized executor candidate for the dominant two-leg shape.
/// @dev It intentionally supports exactly two calls and one final ERC20 balance invariant.
contract TwoCallExecutor {
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
        _callTarget(target0, value0, data0);
        _callTarget(target1, value1, data1);
        finalBalance = _balanceOf(token);

        if (finalBalance < minimum) {
            revert MinBalanceNotMet(token, finalBalance, minimum);
        }
    }

    function _callTarget(address target, uint256 value, bytes calldata data) private {
        assembly ("memory-safe") {
            let ptr := mload(0x40)
            calldatacopy(ptr, data.offset, data.length)
            if iszero(call(gas(), target, value, ptr, data.length, 0, 0)) {
                revert(0, 0)
            }
        }
    }

    function _balanceOf(address token) private view returns (uint256 balance) {
        assembly ("memory-safe") {
            let ptr := mload(0x40)
            // IERC20.balanceOf(address(this)) selector = 0x70a08231.
            mstore(ptr, shl(224, 0x70a08231))
            mstore(add(ptr, 4), address())
            if iszero(staticcall(gas(), token, ptr, 36, ptr, 32)) {
                revert(0, 0)
            }
            if lt(returndatasize(), 32) {
                revert(0, 0)
            }
            balance := mload(ptr)
        }
    }

    receive() external payable {}
}
