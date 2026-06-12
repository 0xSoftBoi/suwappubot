// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IHook, PackedUserOperation} from "@elytro-wallet-core/contracts/interface/IHook.sol";
import {IStandardExecutor, Execution} from "@elytro-wallet-core/contracts/interface/IStandardExecutor.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/**
 * @title DailyERC20SpendingLimitHook
 * @dev Hook for enforcing daily spending limits on ERC20 tokens and ETH.
 *
 * Supported operations:
 * - ETH transfers
 * - ERC20 transfer, transferFrom, approve, increaseAllowance
 *
 * Limitations: Token-specific functions (permit, transferWithAuthorization, etc.)
 * are not supported and may bypass limits.
 *
 * Recommendations:
 * - Keep the number of tracked tokens reasonable
 * - Remove unused token limits before uninstalling the hook
 * - Monitor gas costs as token count grows
 *
 * Note: Gas costs are relatively stable as token count increases due to
 * efficient array operations and storage management.
 */
contract DailyERC20SpendingLimitHook is IHook {
    uint256 public constant TIME_LOCK_DURATION = 1 days;
    uint256 private constant ONE_DAY = 1 days;
    address private constant ETH_TOKEN_ADDRESS = address(2);

    struct PendingLimit {
        uint256 newLimit;
        uint256 effectiveTime;
    }

    struct TokenLimit {
        uint256 dailyLimit;
        uint256 dailySpent;
        uint256 lastResetTime;
        PendingLimit pendingLimit;
    }

    struct SpendingLimit {
        bool initialized;
        mapping(address => TokenLimit) tokenLimits;
        address[] trackedTokens;
    }

    mapping(address => SpendingLimit) public walletSpendingLimits;

    event LimitChangeInitiated(address indexed wallet, address indexed token, uint256 newLimit, uint256 effectiveTime);
    event LimitChanged(address indexed wallet, address indexed token, uint256 newLimit);
    event LimitChangesCancelled(address indexed wallet, address indexed token);
    event TokenTracked(address indexed wallet, address indexed token);

    function supportsInterface(bytes4 interfaceId) external pure override returns (bool) {
        return interfaceId == type(IHook).interfaceId;
    }

    function Init(bytes calldata data) external override {
        SpendingLimit storage limit = walletSpendingLimits[msg.sender];
        require(!limit.initialized, "already initialized");
        limit.initialized = true;
        (address[] memory tokens, uint256[] memory limits) = abi.decode(data, (address[], uint256[]));
        require(tokens.length == limits.length, "Dailylimit: invalid data");
        for (uint256 i = 0; i < tokens.length; i++) {
            address _token = tokens[i];
            uint256 _limit = limits[i];
            require(_limit > 0, "Dailylimit: invalid limit");
            _setInitialLimit(_token, _limit);
        }
    }

    /**
     * @dev Deinitializes the hook and clears all token limits.
     *
     * Note: tracked tokens size should be kept reasonable to avoid high gas costs
     * during hook uninstallation.
     */
    function DeInit() external override {
        SpendingLimit storage limit = walletSpendingLimits[msg.sender];
        require(limit.initialized, "not initialized");

        // Clear all tracked token limits
        for (uint256 i = 0; i < limit.trackedTokens.length; i++) {
            delete limit.tokenLimits[limit.trackedTokens[i]];
        }

        // Clear the tracked tokens array
        delete limit.trackedTokens;

        delete walletSpendingLimits[msg.sender];
    }

    function preIsValidSignatureHook(bytes32 hash, bytes calldata hookSignature) external pure override {
        // Not used for spending limit
        (hash, hookSignature);
    }

    function preUserOpValidationHook(
        PackedUserOperation calldata userOp,
        bytes32 userOpHash,
        uint256 missingAccountFunds,
        bytes calldata hookSignature
    ) external override {
        (userOp, userOpHash, missingAccountFunds, hookSignature);
        bytes4 selector = bytes4(userOp.callData);

        require(walletSpendingLimits[msg.sender].initialized, "not initialized");

        if (IStandardExecutor.execute.selector == selector) {
            // function execute(address target, uint256 value, bytes calldata data)
            (address target, uint256 value, bytes memory data) =
                abi.decode(userOp.callData[4:], (address, uint256, bytes));
            (address decodeToken, uint256 spent) = _decodeSpent(target, value, data);
            _checkAndUpdateSpending(msg.sender, decodeToken, spent);
        } else if (IStandardExecutor.executeBatch.selector == selector) {
            // function executeBatch(Execution[] calldata executions)
            (Execution[] memory executions) = abi.decode(userOp.callData[4:], (Execution[]));
            for (uint256 i = 0; i < executions.length; i++) {
                (address target, uint256 value, bytes memory data) =
                    (executions[i].target, executions[i].value, executions[i].data);
                (address decodeToken, uint256 spent) = _decodeSpent(target, value, data);
                _checkAndUpdateSpending(msg.sender, decodeToken, spent);
            }
        }
    }

    /**
     * @dev Decodes spending operations from user operation data.
     *
     * Currently supported spending functions:
     * 1. ETH transfers (when value > 0)
     * 2. ERC20 transfer(address to, uint256 amount)
     * 3. ERC20 approve(address spender, uint256 amount)
     * 4. ERC20 increaseAllowance(address spender, uint256 addedValue)
     * 5. ERC20 transferFrom(address from, address to, uint256 amount)
     *
     * Note: Other token-specific functions (e.g., permit, transferWithAuthorization, etc.)
     * are not supported and may bypass spending limits.
     */
    function _decodeSpent(address target, uint256 value, bytes memory data)
        private
        view
        returns (address token, uint256 spent)
    {
        if (value > 0) {
            return (ETH_TOKEN_ADDRESS, value);
        }
        bytes4 selector;
        assembly {
            selector := and(mload(add(data, 32)), 0xffffffff00000000000000000000000000000000000000000000000000000000)
        }
        if (selector == IERC20.transfer.selector) {
            // 0xa9059cbb   address  uint256
            // ____4_____|____32___|___32__
            assembly {
                spent := mload(add(data, 68)) // 32 + 4 +32
            }
            token = target;
            return (token, spent);
        } else if (selector == IERC20.approve.selector) {
            // 0x095ea7b3   address  uint256
            // ____4_____|____32___|___32__
            assembly {
                spent := mload(add(data, 68)) // 32 + 4 +32
            }
            token = target;
            return (token, spent);
        } else if (selector == 0x39509351) {
            // increaseAllowance(address,uint256)
            // 0x39509351   address  uint256
            // ____4_____|____32___|___32__
            assembly {
                spent := mload(add(data, 68)) // 32 + 4 +32
            }
            token = target;
            return (token, spent);
        } else if (selector == IERC20.transferFrom.selector) {
            // 0x23b872dd   address  address  uint256
            // ____4_____|____32___|____32__|___32__
            address sender;
            assembly {
                sender := mload(add(data, 36)) // 32 + 4
            }
            if (sender == msg.sender) {
                assembly {
                    spent := mload(add(data, 100)) // 32 + 4 +32 + 32
                }
                token = target;
                return (token, spent);
            }
        }
        // no match
        return (address(0), 0);
    }

    function _checkAndUpdateSpending(address wallet, address token, uint256 spent) internal {
        // Skip if no spending to check
        if (spent == 0) {
            return;
        }

        SpendingLimit storage limit = walletSpendingLimits[wallet];
        TokenLimit storage tokenLimit = limit.tokenLimits[token];

        // Skip if no limit set for this token
        if (tokenLimit.dailyLimit == 0) {
            return;
        }
        uint256 currentDay = _getDay(block.timestamp);
        uint256 lastDay = _getDay(tokenLimit.lastResetTime);
        // Reset daily spent if we're in a new day
        if (currentDay > lastDay) {
            tokenLimit.dailySpent = 0;
            tokenLimit.lastResetTime = block.timestamp;
        }

        // Check if the new spending would exceed the daily limit
        require(tokenLimit.dailySpent + spent <= tokenLimit.dailyLimit, "Daily spending limit exceeded");

        // Update the spent amount
        tokenLimit.dailySpent += spent;
    }

    function _getDay(uint256 timeNow) private pure returns (uint256) {
        return timeNow / ONE_DAY;
    }

    function initiateSetLimit(address token, uint256 newLimit) external {
        require(newLimit > 0, "newLimit must be greater than 0");
        SpendingLimit storage limit = walletSpendingLimits[msg.sender];
        require(limit.initialized, "not initialized");

        TokenLimit storage tokenLimit = limit.tokenLimits[token];

        // If token has no existing limit, set it immediately
        if (tokenLimit.dailyLimit == 0) {
            tokenLimit.dailyLimit = newLimit;
            tokenLimit.lastResetTime = block.timestamp;
            tokenLimit.dailySpent = 0;
            _trackToken(limit, token);
            emit LimitChanged(msg.sender, token, newLimit);
        } else {
            // For existing limits, use time-lock
            tokenLimit.pendingLimit.newLimit = newLimit;
            tokenLimit.pendingLimit.effectiveTime = block.timestamp + TIME_LOCK_DURATION;
            emit LimitChangeInitiated(msg.sender, token, newLimit, tokenLimit.pendingLimit.effectiveTime);
        }
    }

    function applySetLimit(address token) external {
        SpendingLimit storage limit = walletSpendingLimits[msg.sender];
        require(limit.initialized, "not initialized");

        TokenLimit storage tokenLimit = limit.tokenLimits[token];
        require(tokenLimit.dailyLimit > 0, "Token limit not initialized");

        require(tokenLimit.pendingLimit.effectiveTime > 0, "No pending change");
        require(block.timestamp >= tokenLimit.pendingLimit.effectiveTime, "Time lock not expired");

        // Update the limit
        tokenLimit.dailyLimit = tokenLimit.pendingLimit.newLimit;
        tokenLimit.lastResetTime = block.timestamp;
        tokenLimit.dailySpent = 0;

        _trackToken(limit, token);

        // Clear pending change
        delete tokenLimit.pendingLimit;

        emit LimitChanged(msg.sender, token, tokenLimit.dailyLimit);
    }

    function cancelSetLimit(address token) external {
        SpendingLimit storage limit = walletSpendingLimits[msg.sender];
        require(limit.initialized, "not initialized");

        TokenLimit storage tokenLimit = limit.tokenLimits[token];
        require(tokenLimit.pendingLimit.effectiveTime > 0, "No pending change");

        delete tokenLimit.pendingLimit;

        emit LimitChangesCancelled(msg.sender, token);
    }

    function _setInitialLimit(address token, uint256 amount) internal {
        SpendingLimit storage limit = walletSpendingLimits[msg.sender];
        TokenLimit storage tokenLimit = limit.tokenLimits[token];

        tokenLimit.dailyLimit = amount;
        tokenLimit.lastResetTime = block.timestamp;
        tokenLimit.dailySpent = 0;

        _trackToken(limit, token);

        emit TokenTracked(msg.sender, token);
        emit LimitChanged(msg.sender, token, amount);
    }

    /**
     * @dev Tracks a token in the trackedTokens array for proper cleanup during DeInit.
     *
     * Performance impact:
     * - Adding new tokens becomes more expensive as trackedTokens array grows
     */
    function _trackToken(SpendingLimit storage limit, address token) private {
        bool found = false;
        for (uint256 i = 0; i < limit.trackedTokens.length; i++) {
            if (limit.trackedTokens[i] == token) {
                found = true;
                break;
            }
        }
        if (!found) {
            limit.trackedTokens.push(token);
        }
    }

    // View functions
    function getPendingLimit(address wallet, address token)
        external
        view
        returns (uint256 newLimit, uint256 effectiveTime)
    {
        SpendingLimit storage limit = walletSpendingLimits[wallet];
        require(limit.initialized, "not initialized");

        TokenLimit storage tokenLimit = limit.tokenLimits[token];
        return (tokenLimit.pendingLimit.newLimit, tokenLimit.pendingLimit.effectiveTime);
    }

    function getRemainingLimit(address wallet, address token) external view returns (uint256) {
        SpendingLimit storage limit = walletSpendingLimits[wallet];
        if (!limit.initialized) {
            // If not initialized, return max limit
            return type(uint256).max;
        }

        TokenLimit storage tokenLimit = limit.tokenLimits[token];
        if (tokenLimit.dailyLimit == 0) {
            // If no limit set, return max limit
            return type(uint256).max;
        }

        if (block.timestamp >= tokenLimit.lastResetTime + ONE_DAY) {
            return tokenLimit.dailyLimit;
        }

        return tokenLimit.dailyLimit - tokenLimit.dailySpent;
    }

    function getCurrentLimit(address wallet, address token) external view returns (uint256) {
        return walletSpendingLimits[wallet].tokenLimits[token].dailyLimit;
    }
}
