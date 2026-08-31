// SPDX-License-Identifier: MIT
pragma solidity 0.8.27;

import { L1Read } from "./L1Read.sol";
import { CoreWriterLib } from "./CoreWriterLib.sol";

interface IERC20 {
    function transfer(address to, uint256 amount) external returns (bool);
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
    function balanceOf(address who) external view returns (uint256);
}

/**
 * @title SuwappuCoreRouter — native spot swaps against the HyperCore orderbook
 *
 * One router instance per spot market (base/quote), parameters immutable forever,
 * no owner/pause/upgrade (same ethos as primitives/). Executes swaps by trading
 * on HyperCore itself — no AMM, no aggregator, no external oracle: the book IS
 * the price. Fee accrues to an immutable treasury.
 *
 * HyperCore actions are ASYNC (see CoreWriterLib header), so a swap is a
 * three-step lifecycle driven by anyone (user or keeper):
 *
 *  1. initiate()  — pull tokenIn, bridge EVM->Core (ERC-20 transfer to the
 *                   token's system address credits THIS contract on Core),
 *                   place an IOC limit order (cloid = swap id), snapshot the
 *                   router's Core balances.
 *  2. settle()    — in a later EVM block: measure the Core balance delta of the
 *                   out-token vs. the reserved snapshot. Filled enough → take
 *                   fee, spotSend proceeds Core->EVM. Not filled → spotSend the
 *                   in-token back. Either way funds head to this contract's EVM
 *                   balance via the system bridge.
 *  3. claim()     — once the bridge credit landed on EVM, pay the user.
 *
 * Concurrency: exactly ONE in-flight swap at a time (global lock). Balance-delta
 * attribution is only sound when nothing else moves this contract's Core
 * balances mid-flight; serialization enforces that. Throughput scales by
 * deploying more router instances per market. Donations to the router's Core
 * account can only over-credit the in-flight swap, never under-pay it.
 */
contract SuwappuCoreRouter {
    using L1Read for *;

    // ── immutable market config ─────────────────────────────────────────────
    IERC20 public immutable baseErc20;
    IERC20 public immutable quoteErc20;
    uint64 public immutable baseToken; // Core token index
    uint64 public immutable quoteToken;
    uint32 public immutable orderAsset; // spot order asset id (10000 + pair index)
    uint8 public immutable baseWeiDecimals; // Core wei decimals
    uint8 public immutable quoteWeiDecimals;
    uint8 public immutable baseExtraEvmDecimals; // evm decimals - core wei decimals
    uint8 public immutable quoteExtraEvmDecimals;
    address public immutable treasury;
    uint16 public immutable feeBps; // taken from proceeds on success

    uint16 public constant MAX_FEE_BPS = 100; // 1% hard cap, forever

    // ── swap lifecycle ──────────────────────────────────────────────────────
    enum Status {
        None,
        Pending, // order placed, awaiting settle
        Bridging, // settled on Core, awaiting EVM credit
        Refunding, // unfilled, in-tokens heading back to EVM
        Done
    }

    struct Swap {
        address user;
        bool baseForQuote; // true: sell base for quote
        uint64 coreIn; // in-token amount, Core wei
        uint64 minCoreOut; // slippage bound, Core wei of out-token
        uint64 outSnapshot; // router's Core balance of out-token at initiate
        uint64 coreOwed; // out after fee (or refund amount), Core wei
        uint64 initiatedL1Block;
        uint64 initiatedEvmBlock;
        Status status;
    }

    uint128 public nextSwapId = 1;
    uint128 public inFlight; // 0 = free; else the active swap id
    mapping(uint128 => Swap) public swaps;

    event SwapInitiated(
        uint128 indexed id, address indexed user, bool baseForQuote, uint64 coreIn, uint64 minCoreOut
    );
    event SwapSettled(uint128 indexed id, uint64 coreOut, uint64 fee, bool filled);
    event SwapClaimed(uint128 indexed id, address indexed user, uint256 evmAmount);

    error Locked();
    error BadStatus();
    error TooEarly();
    error NotDivisible();
    error FeeTooHigh();
    error BridgeNotLanded();
    error ZeroAmount();

    constructor(
        IERC20 baseErc20_,
        IERC20 quoteErc20_,
        uint64 baseToken_,
        uint64 quoteToken_,
        uint32 orderAsset_,
        uint8 baseWeiDecimals_,
        uint8 quoteWeiDecimals_,
        uint8 baseExtraEvmDecimals_,
        uint8 quoteExtraEvmDecimals_,
        address treasury_,
        uint16 feeBps_
    ) {
        if (feeBps_ > MAX_FEE_BPS) revert FeeTooHigh();
        baseErc20 = baseErc20_;
        quoteErc20 = quoteErc20_;
        baseToken = baseToken_;
        quoteToken = quoteToken_;
        orderAsset = orderAsset_;
        baseWeiDecimals = baseWeiDecimals_;
        quoteWeiDecimals = quoteWeiDecimals_;
        baseExtraEvmDecimals = baseExtraEvmDecimals_;
        quoteExtraEvmDecimals = quoteExtraEvmDecimals_;
        treasury = treasury_;
        feeBps = feeBps_;
    }

    // ── helpers ─────────────────────────────────────────────────────────────

    /// Core system address for a token: first byte 0x20, token index big-endian.
    function systemAddress(uint64 token) public pure returns (address) {
        return address(uint160(0x2000000000000000000000000000000000000000) | uint160(token));
    }

    function _evmToCore(uint256 evmAmount, uint8 extra) internal pure returns (uint64) {
        uint256 scale = 10 ** extra;
        if (evmAmount % scale != 0) revert NotDivisible();
        uint256 core = evmAmount / scale;
        require(core <= type(uint64).max, "overflow");
        return uint64(core);
    }

    function _coreToEvm(uint64 coreAmount, uint8 extra) internal pure returns (uint256) {
        return uint256(coreAmount) * 10 ** extra;
    }

    /// Order size wire format: 10^8 * human size; human = coreWei / 10^weiDecimals.
    function _coreToSz(uint64 coreAmount, uint8 weiDecimals) internal pure returns (uint64) {
        uint256 sz = (uint256(coreAmount) * 1e8) / (10 ** weiDecimals);
        require(sz > 0 && sz <= type(uint64).max, "sz range");
        return uint64(sz);
    }

    // ── lifecycle ───────────────────────────────────────────────────────────

    /// @param baseForQuote sell base into quote (an ask); else buy base with quote
    /// @param evmAmountIn  in-token amount in EVM decimals (must divide cleanly)
    /// @param limitPx      order limit price, wire format (10^8 * human)
    /// @param minCoreOut   minimum acceptable proceeds in Core wei of the out-token
    function initiate(bool baseForQuote, uint256 evmAmountIn, uint64 limitPx, uint64 minCoreOut)
        external
        returns (uint128 id)
    {
        if (inFlight != 0) revert Locked();
        if (evmAmountIn == 0 || minCoreOut == 0) revert ZeroAmount();

        (IERC20 tokenIn, uint64 coreTokenIn, uint8 extraIn) = baseForQuote
            ? (baseErc20, baseToken, baseExtraEvmDecimals)
            : (quoteErc20, quoteToken, quoteExtraEvmDecimals);
        (uint64 coreTokenOut,) = baseForQuote ? (quoteToken, 0) : (baseToken, 0);

        uint64 coreIn = _evmToCore(evmAmountIn, extraIn);

        id = nextSwapId++;
        inFlight = id;

        // EVM -> Core: transferring the linked ERC-20 to its system address
        // credits THIS contract's Core spot balance.
        require(tokenIn.transferFrom(msg.sender, address(this), evmAmountIn), "pull");
        require(tokenIn.transfer(systemAddress(coreTokenIn), evmAmountIn), "bridge");

        // IOC on the book; sz is denominated in BASE for both directions.
        uint64 sz = baseForQuote
            ? _coreToSz(coreIn, baseWeiDecimals)
            : _coreToSz(minCoreOut, baseWeiDecimals);
        CoreWriterLib.limitOrder(
            orderAsset, !baseForQuote, limitPx, sz, false, CoreWriterLib.TIF_IOC, uint128(id)
        );

        swaps[id] = Swap({
            user: msg.sender,
            baseForQuote: baseForQuote,
            coreIn: coreIn,
            minCoreOut: minCoreOut,
            outSnapshot: L1Read.spotBalance(address(this), coreTokenOut).total,
            coreOwed: 0,
            initiatedL1Block: L1Read.l1BlockNumber(),
            initiatedEvmBlock: uint64(block.number),
            status: Status.Pending
        });
        emit SwapInitiated(id, msg.sender, baseForQuote, coreIn, minCoreOut);
    }

    /// Settle after the IOC has executed on HyperCore (a few seconds). Anyone
    /// may call; outcome is determined purely by on-chain Core state.
    function settle(uint128 id) external {
        Swap storage s = swaps[id];
        if (s.status != Status.Pending) revert BadStatus();
        // Actions land seconds later; require both clocks to have advanced.
        if (block.number <= s.initiatedEvmBlock || L1Read.l1BlockNumber() <= s.initiatedL1Block) {
            revert TooEarly();
        }

        (uint64 coreTokenOut, uint64 coreTokenIn) =
            s.baseForQuote ? (quoteToken, baseToken) : (baseToken, quoteToken);

        uint64 outBal = L1Read.spotBalance(address(this), coreTokenOut).total;
        uint64 delta = outBal > s.outSnapshot ? outBal - s.outSnapshot : 0;

        if (delta >= s.minCoreOut) {
            uint64 fee = uint64((uint256(delta) * feeBps) / 10_000);
            s.coreOwed = delta - fee;
            s.status = Status.Bridging;
            if (fee > 0) CoreWriterLib.spotSend(treasury, coreTokenOut, fee);
            // Core -> EVM: send proceeds to the out-token's system address;
            // the system tx credits this contract's EVM ERC-20 balance.
            CoreWriterLib.spotSend(systemAddress(coreTokenOut), coreTokenOut, s.coreOwed);
            emit SwapSettled(id, delta, fee, true);
        } else {
            // Unfilled (or partial below bound): cancel any resting remainder
            // and route everything we still hold back to EVM for refund.
            CoreWriterLib.cancelByCloid(orderAsset, uint128(id));
            uint64 inBal = L1Read.spotBalance(address(this), coreTokenIn).total;
            uint64 refund = inBal < s.coreIn ? inBal : s.coreIn;
            s.coreOwed = refund;
            s.status = Status.Refunding;
            CoreWriterLib.spotSend(systemAddress(coreTokenIn), coreTokenIn, refund);
            emit SwapSettled(id, delta, 0, false);
        }
    }

    /// Pay the user once the Core->EVM bridge credit has landed.
    function claim(uint128 id) external {
        Swap storage s = swaps[id];
        bool refunding = s.status == Status.Refunding;
        if (s.status != Status.Bridging && !refunding) revert BadStatus();

        (IERC20 tokenOut, uint8 extraOut) = refunding
            ? (s.baseForQuote ? (baseErc20, baseExtraEvmDecimals) : (quoteErc20, quoteExtraEvmDecimals))
            : (s.baseForQuote ? (quoteErc20, quoteExtraEvmDecimals) : (baseErc20, baseExtraEvmDecimals));

        uint256 evmAmount = _coreToEvm(s.coreOwed, extraOut);
        if (tokenOut.balanceOf(address(this)) < evmAmount) revert BridgeNotLanded();

        s.status = Status.Done;
        inFlight = 0;
        require(tokenOut.transfer(s.user, evmAmount), "pay");
        emit SwapClaimed(id, s.user, evmAmount);
    }
}
