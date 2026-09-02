// SPDX-License-Identifier: MIT
pragma solidity 0.8.27;

import { L1Read } from "./L1Read.sol";
import { CoreWriterLib } from "./CoreWriterLib.sol";
import { ImmutableBoundUser } from "./ImmutableBoundUser.sol";

interface IERC20 {
    function transfer(address to, uint256 amount) external returns (bool);
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
    function balanceOf(address who) external view returns (uint256);
}

/**
 * @title SuwappuCoreRouterBoundUserImpl — per-user-clone native spot swaps
 *
 * Logic contract for SuwappuCoreRouterBoundUserFactory: one EIP-1167-with-immutable-args
 * clone per user `delegatecall`s into a single deployed instance of this
 * contract per market (see PROPOSAL_PER_USER_ROUTER_ISOLATION_2026-09-01.md).
 * Market config (this file's constructor immutables) is correctly shared by
 * every clone — it's the same for every user of one market. The ONE thing
 * that must differ per clone is WHICH user it moves funds for, and that
 * can't be a Solidity `immutable` here (those bake into this shared LOGIC
 * contract's own bytecode, identical for every clone) — it's read via
 * ImmutableBoundUser.user(), which decodes the address baked into the
 * CALLING clone's own bytecode at deploy time (delegatecall keeps
 * `address(this)` == the clone, not this logic contract).
 *
 * IMPORTANT — this is fund-direction gating, not caller access control.
 * Every function stays exactly as permissionless as the original
 * SuwappuCoreRouter (any caller may drive the lifecycle — keepers, the user
 * themselves, doesn't matter). What changes is that `initiate()` no longer
 * takes `msg.sender` as the swap's beneficiary/payer — it always uses
 * `user()`, the address fixed into THIS clone at deploy time. So
 * regardless of who calls initiate()/execute()/settle()/claim()/retry() on
 * this clone, tokens only ever leave from and land on that one fixed
 * address. There is no caller access control anywhere in this file on
 * purpose — ImmutableBoundUser makes no ownership claim, it's routing data.
 *
 * Everything below this point is otherwise IDENTICAL in spirit to
 * SuwappuCoreRouter.sol — see that file's header for the full four-step
 * lifecycle (initiate/execute/settle/claim), liveness (retry/forceRelease),
 * and concurrency (inFlight lock) documentation, and
 * AUDIT_COREROUTER_2026-08-31.md for F1-F11. Isolation removes the
 * CROSS-USER dimension of F1/F2/F3 structurally (no other user's swap can
 * ever share this clone's balance to misattribute against) — the same-user
 * residual within one clone (documented in that audit as surviving
 * isolation) is unchanged by this file and not addressed here.
 */
contract SuwappuCoreRouterBoundUserImpl is ImmutableBoundUser {
    // ── immutable market config ─────────────────────────────────────────────
    IERC20 public immutable baseErc20;
    IERC20 public immutable quoteErc20;
    uint64 public immutable baseToken; // Core token index
    uint64 public immutable quoteToken;
    uint32 public immutable orderAsset; // spot order asset id (10000 + pair index)
    uint8 public immutable baseWeiDecimals;
    uint8 public immutable quoteWeiDecimals;
    uint8 public immutable baseExtraEvmDecimals; // evm decimals - core wei decimals
    uint8 public immutable quoteExtraEvmDecimals;
    uint8 public immutable szDecimals; // base asset lot precision
    address public immutable treasury;
    uint16 public immutable feeBps;

    uint16 public constant MAX_FEE_BPS = 100; // 1% hard cap, forever

    // L1 (HyperCore) block delays. Core blocks are sub-second; CoreWriter
    // actions land "a few seconds" after the EVM tx. These are deliberately
    // generous — a late settle costs seconds, an early one costs funds.
    uint64 public constant SETTLE_DELAY_L1 = 100;
    uint64 public constant RETRY_DELAY_L1 = 2_000;
    uint64 public constant RELEASE_DELAY_L1 = 100_000;

    enum Status {
        None,
        Funding, // deposit bridging to Core, awaiting execute
        Pending, // order placed, awaiting settle
        Bridging, // reconciled on Core, awaiting EVM credits
        Done,
        Aborted // lock force-released from Funding/Pending; see forceRelease
    }

    // Result of _reconcile: order still live (in-token held), nothing landed
    // yet, or reconciled to Bridging. Returned rather than reverted so a single
    // in-token balance read serves both settle() and forceRelease().
    enum Recon {
        Held,
        Nothing,
        Reconciled
    }

    // Field order is packed by WRITE STEP so each lifecycle step touches the
    // fewest fresh storage slots — grouping fields written together keeps later
    // writes on already-non-zero (cheaper) slots. Six 32-byte slots total. Do
    // NOT reorder without re-checking both the packing AND which step writes
    // each slot (see per-slot notes).
    struct Swap {
        // slot 0 — status lives with initiate fields so every status flip
        // (execute/settle/claim) hits an already-non-zero slot.
        address user; // 20 bytes — always this clone's user(), never msg.sender
        bool baseForQuote; // true: sell base for quote (1)
        Status status; // (1)
        uint64 coreIn; // in-token deposited, Core wei (8) => 30/32
        // slot 1 — initiate-only, never rewritten after initiate.
        uint64 minCoreOut; // acceptance bound for fee-charging, Core wei
        uint64 inSnapshot; // free Core balance of in-token at initiate
        uint64 initiatedL1Block;
        uint64 initiatedEvmBlock;
        // slot 2 — execute rewrites outSnapshot and writes executedL1Block;
        // initiate already made this slot non-zero (outSnapshot + limitPx), so
        // execute's writes stay cheap.
        uint64 outSnapshot; // free Core balance of out-token, re-snapped at execute
        uint64 executedL1Block;
        uint64 limitPx; // stored at initiate, used at execute
        // slot 3 — all written together at settle (one 0->non-zero slot).
        uint64 owedOut; // proceeds after fee, Core wei
        uint64 owedIn; // unconsumed in-token refund, Core wei
        uint64 settledL1Block;
        uint64 retriedL1Block;
        // slots 4-5: full-width EVM balance snapshots, for claim gating
        uint256 evmOutSnapshot;
        uint256 evmInSnapshot;
    }

    // No `= 1` initializer here on purpose: state variable initializers only
    // run in a constructor, and clones never run one — every clone's storage
    // starts zeroed regardless of what this declaration says. nextSwapId
    // relies only on that zero default (see the pre-increment at initiate()).
    uint128 public nextSwapId;
    uint128 public inFlight; // 0 = free; else the active swap id
    mapping(uint128 => Swap) internal swaps;

    function getSwap(uint128 id) external view returns (Swap memory) {
        return swaps[id];
    }

    event SwapInitiated(
        uint128 indexed id, address indexed user, bool baseForQuote, uint64 coreIn, uint64 minCoreOut
    );
    event SwapExecuted(uint128 indexed id, uint64 sz);
    event SwapSettled(uint128 indexed id, uint64 outDelta, uint64 owedIn, uint64 fee, bool filled);
    event SwapClaimed(uint128 indexed id, address indexed user, uint256 evmOut, uint256 evmIn);
    event BridgeRetried(uint128 indexed id);
    event LockReleased(uint128 indexed id);

    error Locked();
    error BadStatus();
    error TooEarly();
    error NotLanded();
    error NotDivisible();
    error FeeTooHigh();
    error BridgeNotLanded();
    error ZeroAmount();
    error BadTreasury();
    error SzTooSmall();

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
        uint8 szDecimals_,
        address treasury_,
        uint16 feeBps_
    ) {
        if (feeBps_ > MAX_FEE_BPS) revert FeeTooHigh();
        // Fee spotSends to a Core-uninitialized address are silently rejected
        // forever, so refuse to deploy against one.
        if (treasury_ == address(0) || !L1Read.coreUserExists(treasury_)) revert BadTreasury();
        require(szDecimals_ <= 8, "szDecimals");
        require(baseToken_ != quoteToken_ && baseErc20_ != quoteErc20_, "same token");
        baseErc20 = baseErc20_;
        quoteErc20 = quoteErc20_;
        baseToken = baseToken_;
        quoteToken = quoteToken_;
        orderAsset = orderAsset_;
        baseWeiDecimals = baseWeiDecimals_;
        quoteWeiDecimals = quoteWeiDecimals_;
        baseExtraEvmDecimals = baseExtraEvmDecimals_;
        quoteExtraEvmDecimals = quoteExtraEvmDecimals_;
        szDecimals = szDecimals_;
        treasury = treasury_;
        feeBps = feeBps_;
    }

    // ── helpers ─────────────────────────────────────────────────────────────

    /// Core system address for a token: first byte 0x20, token index big-endian.
    function systemAddress(uint64 token) public pure returns (address) {
        return address(uint160(0x2000000000000000000000000000000000000000) | uint160(token));
    }

    /// spotSend can only move free balance; total includes held margin.
    function _free(uint64 token) internal view returns (uint64) {
        L1Read.SpotBalance memory b = L1Read.spotBalance(address(this), token);
        return b.total > b.hold ? b.total - b.hold : 0;
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

    /// Order size wire format: 10^8 * human base size, rounded DOWN to the
    /// market lot (multiples of 10^(8 - szDecimals)); reverts if it rounds to 0.
    /// Sizing is ALWAYS input-driven: sells size from the base deposited; buys
    /// size from quote deposited / limit price. minCoreOut is only ever an
    /// acceptance check. Truncation residue stays in the in-token and comes
    /// back through the owedIn reconciliation at settle.
    function _orderSz(bool baseForQuote, uint64 coreIn, uint64 limitPx)
        internal
        view
        returns (uint64)
    {
        uint256 sz;
        if (baseForQuote) {
            sz = (uint256(coreIn) * 1e8) / (10 ** baseWeiDecimals);
        } else {
            // human_base = (coreIn / 10^qwd) / (limitPx / 1e8); wire = 1e8 * human
            sz = (uint256(coreIn) * 1e16) / (10 ** quoteWeiDecimals) / limitPx;
        }
        uint256 lot = 10 ** (8 - szDecimals);
        sz -= sz % lot;
        if (sz == 0 || sz > type(uint64).max) revert SzTooSmall();
        return uint64(sz);
    }

    // ── lifecycle ───────────────────────────────────────────────────────────

    function initiate(bool baseForQuote, uint256 evmAmountIn, uint64 limitPx, uint64 minCoreOut)
        external
        returns (uint128 id)
    {
        if (inFlight != 0) revert Locked();
        if (evmAmountIn == 0 || minCoreOut == 0 || limitPx == 0) revert ZeroAmount();

        address boundUser = user();

        (IERC20 tokenIn, uint64 coreTokenIn, uint8 extraIn) = baseForQuote
            ? (baseErc20, baseToken, baseExtraEvmDecimals)
            : (quoteErc20, quoteToken, quoteExtraEvmDecimals);
        uint64 coreTokenOut = baseForQuote ? quoteToken : baseToken;

        uint64 coreIn = _evmToCore(evmAmountIn, extraIn);
        _orderSz(baseForQuote, coreIn, limitPx); // reject unfillable sizes up front

        // Pre-increment: first id must be 1, never 0 — 0 collides with
        // inFlight's "free" sentinel (see nextSwapId's declaration above).
        id = ++nextSwapId;
        inFlight = id;

        // Snapshots BEFORE any bridging lands (async ⇒ same-tx reads are pre-deposit).
        swaps[id] = Swap({
            user: boundUser,
            baseForQuote: baseForQuote,
            coreIn: coreIn,
            minCoreOut: minCoreOut,
            outSnapshot: _free(coreTokenOut),
            inSnapshot: _free(coreTokenIn),
            owedOut: 0,
            owedIn: 0,
            evmOutSnapshot: 0,
            evmInSnapshot: 0,
            limitPx: limitPx,
            initiatedL1Block: L1Read.l1BlockNumber(),
            initiatedEvmBlock: uint64(block.number),
            executedL1Block: 0,
            settledL1Block: 0,
            retriedL1Block: 0,
            status: Status.Funding
        });

        // EVM -> Core: transfer to the token's system address credits this
        // contract's Core spot balance once HyperCore processes the block.
        // Pulled from boundUser regardless of who called initiate() — whoever
        // triggers the tx, funds only ever move for the user this clone is
        // fixed to (requires boundUser's own ERC-20 approval to this clone).
        require(tokenIn.transferFrom(boundUser, address(this), evmAmountIn), "pull");
        require(tokenIn.transfer(systemAddress(coreTokenIn), evmAmountIn), "bridge");
        emit SwapInitiated(id, boundUser, baseForQuote, coreIn, minCoreOut);
    }

    /// Place the IOC once the deposit is observable on Core. Anyone may call.
    /// Ordering is proven, not assumed: the order only exists after the funds do.
    function execute(uint128 id) external {
        Swap storage s = swaps[id];
        if (s.status != Status.Funding) revert BadStatus();
        (uint64 coreTokenOut, uint64 coreTokenIn) =
            s.baseForQuote ? (quoteToken, baseToken) : (baseToken, quoteToken);
        if (_free(coreTokenIn) < s.inSnapshot + s.coreIn) revert NotLanded();

        // Tighten the out-token delta window to [execute, settle].
        s.outSnapshot = _free(coreTokenOut);
        s.executedL1Block = L1Read.l1BlockNumber();
        s.status = Status.Pending;

        uint64 sz = _orderSz(s.baseForQuote, s.coreIn, s.limitPx);
        CoreWriterLib.limitOrder(
            orderAsset, !s.baseForQuote, s.limitPx, sz, false, CoreWriterLib.TIF_IOC, uint128(id)
        );
        emit SwapExecuted(id, sz);
    }

    /// Reconcile both legs after the deposit + IOC have resolved on HyperCore.
    /// Only the lock holder may settle, so the balance delta is purely this
    /// swap's — no other swap could have moved the router's Core balances.
    function settle(uint128 id) external {
        Swap storage s = swaps[id];
        if (s.status != Status.Pending) revert BadStatus();
        if (inFlight != id) revert BadStatus(); // released swaps cannot settle
        uint64 l1 = L1Read.l1BlockNumber();
        if (block.number <= s.initiatedEvmBlock || l1 < s.executedL1Block + SETTLE_DELAY_L1) {
            revert TooEarly();
        }
        // orderPlaced=true: a Pending swap always executed its IOC.
        Recon r = _reconcile(id, s, true, l1);
        if (r == Recon.Held) revert TooEarly(); // order live, retry later
        if (r == Recon.Nothing) revert NotLanded(); // stay Pending, retry
    }

    /// Shared reconciliation for settle() and forceRelease(). MUST be called
    /// only while inFlight == id so the free-balance delta is attributable to
    /// this swap alone. Reads the in-token spot balance exactly once and reports
    /// via Recon (Held / Nothing / Reconciled) so callers, not this function,
    /// choose whether to revert or terminalize; `l1` is passed in so the caller's
    /// existing l1BlockNumber read is reused.
    ///
    /// @param orderPlaced false for a Funding swap that never placed an order —
    /// it can have no legitimate proceeds, so the out-leg is forced to 0 and it
    /// can only ever refund its own coreIn-capped input. This is what makes a
    /// lock-free out-leg unnecessary and closes the rescue() misattribution.
    function _reconcile(uint128 id, Swap storage s, bool orderPlaced, uint64 l1)
        internal
        returns (Recon)
    {
        (uint64 coreTokenOut, uint64 coreTokenIn) =
            s.baseForQuote ? (quoteToken, baseToken) : (baseToken, quoteToken);

        uint64 outDelta;
        uint64 inRemainder;
        // Scoped so the balance structs leave the stack before the writes below
        // (keeps this within the stack limit without project-wide via-IR).
        {
            L1Read.SpotBalance memory inBal = L1Read.spotBalance(address(this), coreTokenIn);
            if (inBal.hold > 0) return Recon.Held; // order still live
            if (inBal.total > s.inSnapshot) {
                unchecked {
                    inRemainder = inBal.total - s.inSnapshot;
                }
                if (inRemainder > s.coreIn) inRemainder = s.coreIn;
            }
        }
        {
            uint64 outFree = _free(coreTokenOut);
            if (orderPlaced && outFree > s.outSnapshot) {
                unchecked {
                    outDelta = outFree - s.outSnapshot;
                }
            }
        }
        if (outDelta == 0 && inRemainder == 0) return Recon.Nothing;

        uint64 fee = uint64((uint256(outDelta) * feeBps) / 10_000);
        s.owedOut = outDelta - fee; // fee <= outDelta by construction
        s.owedIn = inRemainder;
        s.evmOutSnapshot = _erc20For(coreTokenOut).balanceOf(address(this));
        s.evmInSnapshot = _erc20For(coreTokenIn).balanceOf(address(this));
        s.settledL1Block = l1;
        s.status = Status.Bridging;

        if (fee > 0) CoreWriterLib.spotSend(treasury, coreTokenOut, fee);
        _bridgeBack(coreTokenOut, s.owedOut);
        _bridgeBack(coreTokenIn, inRemainder);
        emit SwapSettled(id, outDelta, inRemainder, fee, outDelta >= s.minCoreOut);
        return Recon.Reconciled;
    }

    /// Pay the user both legs once THIS swap's bridge credits landed on EVM,
    /// measured against the settle-time snapshots (aggregate balance is not
    /// proof — see header).
    function claim(uint128 id) external {
        Swap storage s = swaps[id];
        if (s.status != Status.Bridging) revert BadStatus();
        if (s.owedOut == 0 && s.owedIn == 0) revert ZeroAmount();

        (uint64 coreTokenOut, uint64 coreTokenIn) =
            s.baseForQuote ? (quoteToken, baseToken) : (baseToken, quoteToken);
        (uint8 extraOut, uint8 extraIn) = s.baseForQuote
            ? (quoteExtraEvmDecimals, baseExtraEvmDecimals)
            : (baseExtraEvmDecimals, quoteExtraEvmDecimals);

        uint256 evmOut = _coreToEvm(s.owedOut, extraOut);
        uint256 evmIn = _coreToEvm(s.owedIn, extraIn);
        IERC20 tokenOut = _erc20For(coreTokenOut);
        IERC20 tokenIn = _erc20For(coreTokenIn);

        if (tokenOut.balanceOf(address(this)) < s.evmOutSnapshot + evmOut) revert BridgeNotLanded();
        if (tokenIn.balanceOf(address(this)) < s.evmInSnapshot + evmIn) revert BridgeNotLanded();

        s.status = Status.Done;
        if (inFlight == id) inFlight = 0;
        if (evmOut > 0) require(tokenOut.transfer(s.user, evmOut), "pay out");
        if (evmIn > 0) require(tokenIn.transfer(s.user, evmIn), "pay in");
        emit SwapClaimed(id, s.user, evmOut, evmIn);
    }

    /// Re-issue bridge sends for a swap whose spotSend was silently rejected
    /// (e.g. balance momentarily held). Only while no OTHER swap is in flight,
    /// so it can never perturb a live delta window.
    function retry(uint128 id) external {
        Swap storage s = swaps[id];
        if (s.status != Status.Bridging) revert BadStatus();
        if (inFlight != 0 && inFlight != id) revert Locked();
        uint64 l1 = L1Read.l1BlockNumber();
        uint64 lastTry = s.retriedL1Block == 0 ? s.settledL1Block : s.retriedL1Block;
        if (l1 < lastTry + RETRY_DELAY_L1) revert TooEarly();

        (uint64 coreTokenOut, uint64 coreTokenIn) =
            s.baseForQuote ? (quoteToken, baseToken) : (baseToken, quoteToken);
        s.retriedL1Block = l1;
        _bridgeBack(coreTokenOut, _min64(s.owedOut, _free(coreTokenOut)));
        _bridgeBack(coreTokenIn, _min64(s.owedIn, _free(coreTokenIn)));
        emit BridgeRetried(id);
    }

    /// Free the serialization lock from a swap stuck long past every async
    /// horizon, so one wedged swap can never brick the router. Because this runs
    /// while the lock is still held, it reconciles the stuck swap HERE — where
    /// the balance delta is sound — instead of abandoning its funds. A Bridging
    /// swap is already reconciled and just needs the lock freed.
    function forceRelease(uint128 id) external {
        Swap storage s = swaps[id];
        if (inFlight != id) revert BadStatus();
        Status st = s.status;
        uint64 l1 = L1Read.l1BlockNumber();

        if (st == Status.Bridging) {
            if (l1 < s.settledL1Block + RELEASE_DELAY_L1) revert TooEarly();
            inFlight = 0;
            emit LockReleased(id);
            return;
        }
        if (st != Status.Funding && st != Status.Pending) revert BadStatus();
        uint64 since = st == Status.Funding ? s.initiatedL1Block : s.executedL1Block;
        if (l1 < since + RELEASE_DELAY_L1) revert TooEarly();

        // Reconcile under the lock. A Funding swap placed no order, so its
        // out-leg is forced to 0 and it refunds only its coreIn-capped input; a
        // Pending swap recovers both legs. Reconciliation moves it to Bridging
        // (claim()/retry() take over). If nothing is recoverable — never
        // credited, or an order still held (Recon.Held/Nothing) — the funds are
        // in HyperCore's custody and unrecoverable by the contract; terminalize
        // to Aborted so a later call can never reconcile against a successor's
        // balances (NEW-2). _reconcile does the single in-token read itself.
        if (_reconcile(id, s, st == Status.Pending, l1) == Recon.Reconciled) {
            // Reconciled to Bridging: async Core->EVM bridge-backs are now in
            // flight. KEEP the lock (exactly as settle does) so no next swap can
            // snapshot Core while our debit is still crossing and get
            // under-credited. claim() frees the lock once it verifies the
            // credits landed; if a send was rejected, retry() (allowed while
            // inFlight==id) re-sends, then the Bridging branch above frees it.
            return;
        }
        // Nothing recoverable: either the deposit was never credited (funds sit
        // at the token system address in HyperCore's hands, unrecoverable by any
        // contract), or an order is still held 100k+ L1 blocks past execute — a
        // HyperCore-level failure. In the latter the held balance is the
        // contract's own and would free if the order ever resolved; we accept
        // abandoning it to keep the router live rather than let one wedged order
        // brick every future swap. Terminalize so no later call reconciles
        // against a successor's balances.
        s.status = Status.Aborted;
        inFlight = 0;
        emit LockReleased(id);
    }

    // ── internals ───────────────────────────────────────────────────────────

    function _erc20For(uint64 coreToken) internal view returns (IERC20) {
        return coreToken == baseToken ? baseErc20 : quoteErc20;
    }

    /// Core -> EVM: spotSend to the token's own system address; the system tx
    /// later credits this contract's EVM ERC-20 balance.
    function _bridgeBack(uint64 coreToken, uint64 amount) internal {
        if (amount > 0) CoreWriterLib.spotSend(systemAddress(coreToken), coreToken, amount);
    }

    function _min64(uint64 a, uint64 b) internal pure returns (uint64) {
        return a < b ? a : b;
    }
}
