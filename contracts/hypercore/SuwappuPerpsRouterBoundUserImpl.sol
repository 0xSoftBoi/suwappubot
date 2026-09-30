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
 * @title SuwappuPerpsRouterBoundUserImpl — per-user-clone leveraged perp trading
 *
 * Logic contract for SuwappuPerpsRouterFactory: one EIP-1167-with-immutable-args
 * clone per user, same isolation model as SuwappuCoreRouterBoundUserImpl.sol
 * (see that file and PROPOSAL_PER_USER_ROUTER_ISOLATION_2026-09-01.md) — but
 * for perps, isolation matters MORE than it did for spot: a HyperCore perp
 * margin account is a single pooled cross-margin balance backing every open
 * position, and a liquidation on one position can eat margin backing an
 * unrelated position on the same account. Sharing one address across
 * strangers wouldn't just misattribute a balance delta, it would let one
 * user's blowup liquidate another user's position.
 *
 * SHAPE, vs. the spot router: HyperCore perp margin is ONE pooled account
 * across every perp market (cross-margin by default), not a per-pair
 * balance — so unlike the spot router (one instance per base/quote pair),
 * this contract is deployed ONCE and trades ANY perp `asset` id passed to
 * openPosition/closePosition. Only the margin asset (USDC) and the perp dex
 * (perpDexIndex — the default Hyperliquid perps venue; HIP-3 builder-
 * deployed dexs are a separate, deprioritized "cross-DEX router" — see
 * docs/research/hyperliquid-router-opportunities-2026-09.md) are fixed at
 * deploy time.
 *
 * Two independent state machines, not one Swap-style struct:
 *  - Margin funding/withdrawal (depositMargin -> confirmMargin;
 *    initiateWithdraw -> bridgeWithdrawToEvm -> claimWithdraw) needs the
 *    SAME async-bridge-then-verify treatment the spot router uses, because
 *    it's the only place this contract does its own balance-delta
 *    accounting (marginOp's snapshots). One lock (marginOp.status) covers
 *    BOTH directions, since only one can be in flight at a time.
 *  - openPosition/closePosition are direct, single-call HyperCore actions.
 *    No lock, no snapshot: position state isn't something we track or
 *    attribute — it's read straight from L1Read.position(address(this), ..),
 *    always correct and unambiguous, because delegatecall keeps
 *    `address(this)` == this one exclusive clone. Nothing to serialize.
 *
 * Access control mirrors the lesson from SuwappuCoreRouterBoundUserImpl's
 * initiate() fix: anything that commits FRESH caller-chosen terms against
 * the bound user's standing resources (depositMargin's transferFrom amount;
 * openPosition's direction/size/price, which is a leveraged bet, not a spot
 * conversion) requires msg.sender == user() || msg.sender == factory().
 * Anything that can only REDUCE risk or that always pays the fixed user()
 * regardless of caller (closePosition, confirmMargin, the withdraw leg)
 * stays permissionless, same reasoning as execute/settle/claim there.
 *
 * SCOPE (v1, deliberately not built yet — see PERPS_ROUTER header notes in
 * commit history, not re-litigated per-line here):
 *  - No leverage/margin-mode (isolated vs cross) setting from this
 *    contract. HyperCore's CoreWriter action ids 14 and 16 are unallocated
 *    in CoreWriterLib.sol — almost certainly leverage/margin-mode actions,
 *    but their exact schema is unverified against a primary source. Trades
 *    at whatever leverage/mode the account already has. Do not guess-wrap
 *    an unverified raw action id into a money-path contract.
 *  - No retry()/forceRelease() liveness functions for a stuck margin
 *    bridge. Lower severity than the spot router's equivalent gap: a stuck
 *    marginOp only blocks FUTURE margin ops, never position trading
 *    (openPosition/closePosition don't touch marginOp at all).
 *  - No fee mechanism (APPROVE_BUILDER_FEE) wired in yet.
 */
contract SuwappuPerpsRouterBoundUserImpl is ImmutableBoundUser {
    IERC20 public immutable usdc;
    uint64 public immutable usdcCoreToken;
    uint8 public immutable usdcExtraEvmDecimals; // evm decimals - core wei decimals
    uint32 public immutable perpDexIndex; // for L1Read.accountMarginSummary

    enum MarginOpStatus {
        None,
        AwaitingBridgeIn, // deposit: EVM->Core spot send issued, waiting to land
        AwaitingBridgeOut, // withdraw: perp->spot usdClassTransfer issued, waiting to land
        AwaitingClaim // withdraw: Core->EVM spotSend issued, waiting to land
    }

    struct MarginOp {
        MarginOpStatus status;
        uint64 coreAmount; // notional being moved, Core wei
        uint64 spotSnapshot; // Core spot free balance snapshot before this leg landed
        uint256 evmSnapshot; // EVM balance snapshot, withdraw's final leg only
    }

    MarginOp public marginOp;
    uint128 public nextOrderNonce; // cloid, for off-chain order correlation only

    error Locked();
    error BadStatus();
    error NotLanded();
    error ZeroAmount();
    error NotAuthorized();
    error NotDivisible();

    event MarginDeposited(address indexed user, uint256 evmAmount);
    event MarginConfirmed(address indexed user, uint256 evmAmount);
    event MarginWithdrawalStarted(address indexed user, uint256 evmAmount);
    event MarginWithdrawn(address indexed user, uint256 evmAmount);
    event PositionOrderPlaced(uint32 indexed perp, bool isBuy, uint64 sz, bool reduceOnly);

    constructor(IERC20 usdc_, uint64 usdcCoreToken_, uint8 usdcExtraEvmDecimals_, uint32 perpDexIndex_) {
        usdc = usdc_;
        usdcCoreToken = usdcCoreToken_;
        usdcExtraEvmDecimals = usdcExtraEvmDecimals_;
        perpDexIndex = perpDexIndex_;
    }

    // ── views ───────────────────────────────────────────────────────────────

    function systemAddress(uint64 token) public pure returns (address) {
        return address(uint160(0x2000000000000000000000000000000000000000) | uint160(token));
    }

    function position(uint16 perp) external view returns (L1Read.Position memory) {
        return L1Read.position(address(this), perp);
    }

    function marginSummary() external view returns (L1Read.AccountMarginSummary memory) {
        return L1Read.accountMarginSummary(perpDexIndex, address(this));
    }

    function _free(uint64 token) internal view returns (uint64) {
        L1Read.SpotBalance memory b = L1Read.spotBalance(address(this), token);
        return b.total > b.hold ? b.total - b.hold : 0;
    }

    function _evmToCore(uint256 evmAmount) internal view returns (uint64) {
        uint256 scale = 10 ** usdcExtraEvmDecimals;
        if (evmAmount % scale != 0) revert NotDivisible();
        uint256 core = evmAmount / scale;
        require(core <= type(uint64).max, "overflow");
        return uint64(core);
    }

    function _coreToEvm(uint64 coreAmount) internal view returns (uint256) {
        return uint256(coreAmount) * 10 ** usdcExtraEvmDecimals;
    }

    // ── margin: deposit (EVM -> Core spot -> perp margin) ──────────────────

    /// Pull `evmAmount` USDC from the bound user and bridge it to Core spot.
    /// Gated like initiate() on the spot router: this commits a caller-
    /// chosen amount from the user's standing approval, so only the user
    /// themselves or the factory (once, at deploy — see
    /// SuwappuPerpsRouterFactory.deployAndDepositMargin) may call it.
    function depositMargin(uint256 evmAmount) external {
        if (marginOp.status != MarginOpStatus.None) revert Locked();
        if (evmAmount == 0) revert ZeroAmount();
        address boundUser = user();
        if (msg.sender != boundUser && msg.sender != factory()) revert NotAuthorized();

        uint64 coreAmount = _evmToCore(evmAmount);
        marginOp = MarginOp({
            status: MarginOpStatus.AwaitingBridgeIn,
            coreAmount: coreAmount,
            spotSnapshot: _free(usdcCoreToken),
            evmSnapshot: 0
        });

        require(usdc.transferFrom(boundUser, address(this), evmAmount), "pull");
        usdc.transfer(systemAddress(usdcCoreToken), evmAmount);
        emit MarginDeposited(boundUser, evmAmount);
    }

    /// Once the bridged deposit lands on Core spot, move it into perp
    /// margin. Permissionless: the amount and destination were already
    /// fixed by depositMargin, nothing left here for a caller to choose.
    function confirmMargin() external {
        MarginOp storage op = marginOp;
        if (op.status != MarginOpStatus.AwaitingBridgeIn) revert BadStatus();
        if (_free(usdcCoreToken) < op.spotSnapshot + op.coreAmount) revert NotLanded();

        uint64 coreAmount = op.coreAmount;
        delete marginOp;
        CoreWriterLib.usdClassTransfer(coreAmount, true);
        emit MarginConfirmed(user(), _coreToEvm(coreAmount));
    }

    // ── margin: withdraw (perp margin -> Core spot -> EVM) ──────────────────

    /// Start moving `evmAmount` USDC of margin back out to the bound user.
    /// Permissionless: withdrawal always pays user(), never the caller —
    /// same reasoning as claim() on the spot router.
    function initiateWithdraw(uint256 evmAmount) external {
        if (marginOp.status != MarginOpStatus.None) revert Locked();
        if (evmAmount == 0) revert ZeroAmount();

        uint64 coreAmount = _evmToCore(evmAmount);
        marginOp = MarginOp({
            status: MarginOpStatus.AwaitingBridgeOut,
            coreAmount: coreAmount,
            spotSnapshot: _free(usdcCoreToken),
            evmSnapshot: 0
        });
        CoreWriterLib.usdClassTransfer(coreAmount, false);
        emit MarginWithdrawalStarted(user(), evmAmount);
    }

    /// Once the perp->spot move lands, bridge it on to EVM.
    function bridgeWithdrawToEvm() external {
        MarginOp storage op = marginOp;
        if (op.status != MarginOpStatus.AwaitingBridgeOut) revert BadStatus();
        if (_free(usdcCoreToken) < op.spotSnapshot + op.coreAmount) revert NotLanded();

        op.evmSnapshot = usdc.balanceOf(address(this));
        op.status = MarginOpStatus.AwaitingClaim;
        CoreWriterLib.spotSend(systemAddress(usdcCoreToken), usdcCoreToken, op.coreAmount);
    }

    /// Once the EVM bridge-back lands, pay the bound user.
    function claimWithdraw() external {
        MarginOp storage op = marginOp;
        if (op.status != MarginOpStatus.AwaitingClaim) revert BadStatus();
        uint256 evmAmount = _coreToEvm(op.coreAmount);
        if (usdc.balanceOf(address(this)) < op.evmSnapshot + evmAmount) revert NotLanded();

        address boundUser = user();
        delete marginOp;
        require(usdc.transfer(boundUser, evmAmount), "pay");
        emit MarginWithdrawn(boundUser, evmAmount);
    }

    // ── positions ────────────────────────────────────────────────────────────

    /// Open or increase a position on `perp`. Gated like initiate(): this
    /// is a leveraged bet at caller-chosen direction/size/price against the
    /// bound user's margin — the exact same "standing resource, caller
    /// picks how it's spent" shape that made spot's initiate() dangerous
    /// unrestricted, except worse here (leverage amplifies loss).
    function openPosition(uint32 perp, bool isBuy, uint64 limitPx, uint64 sz) external {
        address boundUser = user();
        if (msg.sender != boundUser && msg.sender != factory()) revert NotAuthorized();
        if (sz == 0 || limitPx == 0) revert ZeroAmount();

        CoreWriterLib.limitOrder(
            perp, isBuy, limitPx, sz, false, CoreWriterLib.TIF_IOC, nextOrderNonce++
        );
        emit PositionOrderPlaced(perp, isBuy, sz, false);
    }

    /// Reduce or close a position on `perp`. Permissionless: reduceOnly
    /// means this can only ever shrink exposure, never open new exposure or
    /// redirect funds — anyone (e.g. a keeper protecting the user from
    /// liquidation) may trigger it, same reasoning as execute/settle/claim
    /// on the spot router. Side is read from the live position, not
    /// caller-supplied, so it can never be pointed the wrong way.
    function closePosition(uint32 perp, uint64 limitPx, uint64 sz) external {
        if (sz == 0 || limitPx == 0) revert ZeroAmount();
        L1Read.Position memory pos = L1Read.position(address(this), uint16(perp));
        bool isBuy = pos.szi < 0; // closing a short = buy back; closing a long = sell

        CoreWriterLib.limitOrder(
            perp, isBuy, limitPx, sz, true, CoreWriterLib.TIF_IOC, nextOrderNonce++
        );
        emit PositionOrderPlaced(perp, isBuy, sz, true);
    }
}
