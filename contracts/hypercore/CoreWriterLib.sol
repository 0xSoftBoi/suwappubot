// SPDX-License-Identifier: MIT
pragma solidity 0.8.27;

/**
 * @title CoreWriterLib — HyperCore write actions from HyperEVM
 *
 * Encodes and sends raw actions to the CoreWriter system contract
 * (0x3333...3333). Wire format: [version=1][3-byte big-endian action id]
 * [abi.encode(fields)].
 *
 * HyperCore semantics callers MUST design around:
 *  - Actions are asynchronous: they execute on HyperCore a few seconds after
 *    the EVM tx (order + vault actions are deliberately delayed). Effects are
 *    NEVER visible to precompile reads in the same transaction, and a
 *    rejected action does NOT revert the EVM tx. Native flows are therefore
 *    two-phase: act, then verify via L1Read in a later block.
 *  - Prices/sizes for orders are wire-encoded as 10^8 * human value.
 *  - ~25k gas burned per sendRawAction (~47k typical total).
 */
library CoreWriterLib {
    address constant CORE_WRITER = 0x3333333333333333333333333333333333333333;

    uint24 constant ACTION_LIMIT_ORDER = 1;
    uint24 constant ACTION_VAULT_TRANSFER = 2;
    uint24 constant ACTION_TOKEN_DELEGATE = 3;
    uint24 constant ACTION_STAKING_DEPOSIT = 4;
    uint24 constant ACTION_STAKING_WITHDRAW = 5;
    uint24 constant ACTION_SPOT_SEND = 6;
    uint24 constant ACTION_USD_CLASS_TRANSFER = 7;
    uint24 constant ACTION_FINALIZE_EVM_CONTRACT = 8;
    uint24 constant ACTION_ADD_API_WALLET = 9;
    uint24 constant ACTION_CANCEL_BY_OID = 10;
    uint24 constant ACTION_CANCEL_BY_CLOID = 11;
    uint24 constant ACTION_APPROVE_BUILDER_FEE = 12;
    uint24 constant ACTION_SEND_ASSET = 13;
    uint24 constant ACTION_BORROW_LEND = 15;
    uint24 constant ACTION_OUTCOME = 17;

    uint8 constant TIF_ALO = 1;
    uint8 constant TIF_GTC = 2;
    uint8 constant TIF_IOC = 3;

    // source/destination dex value meaning "spot" for sendAsset
    uint32 constant DEX_SPOT = type(uint32).max;

    function sendRawAction(uint24 actionId, bytes memory payload) internal {
        ICoreWriter(CORE_WRITER).sendRawAction(
            abi.encodePacked(uint8(1), actionId, payload)
        );
    }

    function limitOrder(
        uint32 asset,
        bool isBuy,
        uint64 limitPx,
        uint64 sz,
        bool reduceOnly,
        uint8 encodedTif,
        uint128 cloid
    ) internal {
        sendRawAction(
            ACTION_LIMIT_ORDER,
            abi.encode(asset, isBuy, limitPx, sz, reduceOnly, encodedTif, cloid)
        );
    }

    function vaultTransfer(address vault, bool isDeposit, uint64 usd) internal {
        sendRawAction(ACTION_VAULT_TRANSFER, abi.encode(vault, isDeposit, usd));
    }

    function tokenDelegate(address validator, uint64 weiAmount, bool isUndelegate) internal {
        sendRawAction(ACTION_TOKEN_DELEGATE, abi.encode(validator, weiAmount, isUndelegate));
    }

    function stakingDeposit(uint64 weiAmount) internal {
        sendRawAction(ACTION_STAKING_DEPOSIT, abi.encode(weiAmount));
    }

    function stakingWithdraw(uint64 weiAmount) internal {
        sendRawAction(ACTION_STAKING_WITHDRAW, abi.encode(weiAmount));
    }

    function spotSend(address destination, uint64 token, uint64 weiAmount) internal {
        sendRawAction(ACTION_SPOT_SEND, abi.encode(destination, token, weiAmount));
    }

    function usdClassTransfer(uint64 ntl, bool toPerp) internal {
        sendRawAction(ACTION_USD_CLASS_TRANSFER, abi.encode(ntl, toPerp));
    }

    function cancelByOid(uint32 asset, uint64 oid) internal {
        sendRawAction(ACTION_CANCEL_BY_OID, abi.encode(asset, oid));
    }

    function cancelByCloid(uint32 asset, uint128 cloid) internal {
        sendRawAction(ACTION_CANCEL_BY_CLOID, abi.encode(asset, cloid));
    }

    function approveBuilderFee(uint64 maxFeeRateDecibps, address builder) internal {
        sendRawAction(ACTION_APPROVE_BUILDER_FEE, abi.encode(maxFeeRateDecibps, builder));
    }

    function sendAsset(
        address destination,
        address subAccount,
        uint32 sourceDex,
        uint32 destinationDex,
        uint64 token,
        uint64 weiAmount
    ) internal {
        sendRawAction(
            ACTION_SEND_ASSET,
            abi.encode(destination, subAccount, sourceDex, destinationDex, token, weiAmount)
        );
    }

    /// @param op 0=Supply, 1=Withdraw; weiAmount 0 = maximal
    function borrowLend(uint8 op, uint64 token, uint64 weiAmount) internal {
        sendRawAction(ACTION_BORROW_LEND, abi.encode(op, token, weiAmount));
    }

    /// @param op 0=SplitOutcome, 1=MergeOutcome, 2=MergeQuestion, 3=NegateOutcome
    function outcomeOperation(uint8 op, uint32 question, uint32 outcome, uint64 weiAmount)
        internal
    {
        sendRawAction(ACTION_OUTCOME, abi.encode(op, question, outcome, weiAmount));
    }
}

interface ICoreWriter {
    function sendRawAction(bytes calldata data) external;
}
