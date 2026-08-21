// SPDX-License-Identifier: MIT
pragma solidity 0.8.27;

/// @notice Research-only execution baseline used to measure generic route overhead.
/// @dev Not production code. The benchmark deliberately favors readability and explicit
///      postconditions over specialization so later optimizations have a stable baseline.
contract BaselineExecutor {
    error CallFailed(uint256 index, bytes returndata);
    error MinBalanceNotMet(address token, uint256 observed, uint256 minimum);

    struct Call {
        address target;
        uint256 value;
        bytes data;
    }

    struct BalanceCheck {
        address token;
        uint256 minimum;
    }

    function execute(Call[] calldata calls, BalanceCheck calldata check)
        external
        payable
        returns (uint256 finalBalance)
    {
        uint256 length = calls.length;
        for (uint256 i; i < length; ++i) {
            Call calldata item = calls[i];
            (bool ok, bytes memory returndata) = item.target.call{value: item.value}(item.data);
            if (!ok) revert CallFailed(i, returndata);
        }

        finalBalance = IERC20Balance(check.token).balanceOf(address(this));
        if (finalBalance < check.minimum) {
            revert MinBalanceNotMet(check.token, finalBalance, check.minimum);
        }
    }

    receive() external payable {}
}

interface IERC20Balance {
    function balanceOf(address account) external view returns (uint256);
}
