// SPDX-License-Identifier: MIT
pragma solidity 0.8.27;

/**
 * @title L1Read — HyperCore read precompiles
 *
 * Static-call wrappers over the read precompiles at 0x...0800+. Values are
 * guaranteed to match HyperCore state at EVM block construction time.
 * Gas: 2000 + 65 * (input_len + output_len); an invalid input consumes all gas.
 *
 * Decimals (HyperCore wire format, NOT wad):
 *  - perp px: divide by 10^(6 - szDecimals) for the human price
 *  - spot px: divide by 10^(8 - base szDecimals)
 *  - spot balances are in the token's Core "wei" (10^weiDecimals per unit)
 */
library L1Read {
    address constant POSITION = 0x0000000000000000000000000000000000000800;
    address constant SPOT_BALANCE = 0x0000000000000000000000000000000000000801;
    address constant VAULT_EQUITY = 0x0000000000000000000000000000000000000802;
    address constant WITHDRAWABLE = 0x0000000000000000000000000000000000000803;
    address constant DELEGATIONS = 0x0000000000000000000000000000000000000804;
    address constant DELEGATOR_SUMMARY = 0x0000000000000000000000000000000000000805;
    address constant MARK_PX = 0x0000000000000000000000000000000000000806;
    address constant ORACLE_PX = 0x0000000000000000000000000000000000000807;
    address constant SPOT_PX = 0x0000000000000000000000000000000000000808;
    address constant L1_BLOCK_NUMBER = 0x0000000000000000000000000000000000000809;
    address constant PERP_ASSET_INFO = 0x000000000000000000000000000000000000080a;
    address constant SPOT_INFO = 0x000000000000000000000000000000000000080b;
    address constant TOKEN_INFO = 0x000000000000000000000000000000000000080C;
    address constant BBO = 0x000000000000000000000000000000000000080e;
    address constant ACCOUNT_MARGIN_SUMMARY = 0x000000000000000000000000000000000000080F;
    address constant CORE_USER_EXISTS = 0x0000000000000000000000000000000000000810;

    struct Position {
        int64 szi;
        uint64 entryNtl;
        int64 isolatedRawUsd;
        uint32 leverage;
        bool isIsolated;
    }

    struct SpotBalance {
        uint64 total;
        uint64 hold;
        uint64 entryNtl;
    }

    struct UserVaultEquity {
        uint64 equity;
        uint64 lockedUntilTimestamp;
    }

    struct Withdrawable {
        uint64 withdrawable;
    }

    struct Bbo {
        uint64 bid;
        uint64 ask;
    }

    struct AccountMarginSummary {
        int64 accountValue;
        uint64 marginUsed;
        uint64 ntlPos;
        int64 rawUsd;
    }

    error PrecompileCallFailed(address precompile);

    function _staticQuery(address precompile, bytes memory input)
        private
        view
        returns (bytes memory)
    {
        (bool ok, bytes memory out) = precompile.staticcall(input);
        if (!ok) revert PrecompileCallFailed(precompile);
        return out;
    }

    function position(address user, uint16 perp) internal view returns (Position memory) {
        return abi.decode(_staticQuery(POSITION, abi.encode(user, perp)), (Position));
    }

    function spotBalance(address user, uint64 token) internal view returns (SpotBalance memory) {
        return abi.decode(_staticQuery(SPOT_BALANCE, abi.encode(user, token)), (SpotBalance));
    }

    function userVaultEquity(address user, address vault)
        internal
        view
        returns (UserVaultEquity memory)
    {
        return
            abi.decode(_staticQuery(VAULT_EQUITY, abi.encode(user, vault)), (UserVaultEquity));
    }

    function withdrawable(address user) internal view returns (uint64) {
        return abi.decode(_staticQuery(WITHDRAWABLE, abi.encode(user)), (Withdrawable)).withdrawable;
    }

    function markPx(uint32 asset) internal view returns (uint64) {
        return abi.decode(_staticQuery(MARK_PX, abi.encode(asset)), (uint64));
    }

    function oraclePx(uint32 asset) internal view returns (uint64) {
        return abi.decode(_staticQuery(ORACLE_PX, abi.encode(asset)), (uint64));
    }

    function spotPx(uint32 spotIndex) internal view returns (uint64) {
        return abi.decode(_staticQuery(SPOT_PX, abi.encode(spotIndex)), (uint64));
    }

    function l1BlockNumber() internal view returns (uint64) {
        return abi.decode(_staticQuery(L1_BLOCK_NUMBER, ""), (uint64));
    }

    function bbo(uint32 asset) internal view returns (Bbo memory) {
        return abi.decode(_staticQuery(BBO, abi.encode(asset)), (Bbo));
    }

    function accountMarginSummary(uint32 perpDexIndex, address user)
        internal
        view
        returns (AccountMarginSummary memory)
    {
        return abi.decode(
            _staticQuery(ACCOUNT_MARGIN_SUMMARY, abi.encode(perpDexIndex, user)),
            (AccountMarginSummary)
        );
    }

    function coreUserExists(address user) internal view returns (bool) {
        return abi.decode(_staticQuery(CORE_USER_EXISTS, abi.encode(user)), (bool));
    }
}
