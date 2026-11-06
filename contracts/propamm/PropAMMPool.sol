// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.27;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import {SafeCast} from "@openzeppelin/contracts/utils/math/SafeCast.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Ownable2Step, Ownable} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";

interface IPropOracle {
    function getPrice(uint256 feedId) external view returns (uint128 price, uint64 blockNumber, uint48 timestamp);
}

/// @notice Independent second price source (Chainlink/Pyth adapter), 1e18 quote-per-base.
interface IAnchorPrice {
    function anchorPrice() external view returns (uint256 price1e18, uint256 updatedAt);
}

interface IPropAMMSwapCallback {
    /// @dev Must transfer `amountIn` of `tokenIn` to the pool before returning.
    function propAMMSwapCallback(address tokenIn, uint256 amountIn, bytes calldata data) external;
}

/// @title PropAMMPool (skeleton)
/// @notice Single-pair, self-custodied proprietary AMM. Price = maker-pushed oracle price
///         x (1 + skew(inventory)) x (1 +/- edge(per-block flow)). No passive curve.
/// @dev Pricing model reproduced from the reverse-engineered FermiSwap engine
///      (docs/research/fermi-FINDINGS.md, behaviour-verified 210/210 + 120/120 on fork), PLUS the
///      protections FermiSwap lacks: in-pool freshness, optional second-source anchor, value
///      stop-loss, hard edge floor / skew cap that bound the hot strategist key, pause-only
///      guardian, and NO arbitrary-call admin. MONEY-PATH: must pass money-path-reviewer +
///      security-auditor + external audit before holding real inventory. See ./README.md.
///
///      Units: price = quote-whole per base-whole, 1e18-scaled. edge/skew = 1e18 per 1 bp.
///      Token amounts are raw units. Fee-on-transfer / rebasing tokens are NOT supported.
///
///      Stop-loss caveat: value is marked at the ORACLE price, so an ordinary market move of
///      `drawdownE6` on base-heavy inventory also blocks swaps until the peak decays. It is a
///      circuit breaker, not a PnL guard.
///
///      Trust: `swapper` (router) is trusted for recipient / payer / amountCheck enforcement.
contract PropAMMPool is Ownable2Step, ReentrancyGuard {
    using SafeERC20 for IERC20;
    using SafeCast for uint256;

    uint256 internal constant BPS = 10_000e18; // 100% in edge/skew units (1e18 == 1 bp)
    uint256 internal constant PRICE_SCALE = 1e18; // 1e18 (not 1e8) so low-priced bases keep precision

    // ------------------------------------------------------------------ immutables
    IERC20 public immutable base;
    IERC20 public immutable quote;
    uint256 internal immutable scaleBase; // 10**decimals(base)
    uint256 internal immutable scaleQuote;
    IPropOracle public immutable oracle;
    uint256 public immutable feedId;

    // ------------------------------------------------------------------ roles
    address public guardian; // can only pause
    address public strategist; // hot key: retunes edge/curves, bounded by owner-set clamps
    address public swapper; // only caller allowed to swap (e.g. PropAMM Router); 0 = nobody
    bool public paused;

    // ------------------------------------------------------------------ strategist-tunable
    struct Seg { int128 x0; int128 x1; int128 c2; int128 c3; int128 c4; int128 c5; }
    uint128 public baseEdge; // 1e18 == 1bp
    Seg[] private sizeCurve; // x = (cumFlow+qty)/lo (1e18), y = extra edge
    Seg[] private skewCurve; // x = normalised inventory imbalance (1e18), y = price skew

    // ------------------------------------------------------------------ owner-set risk params
    struct Risk {
        uint128 minEdge; // hard floor on total edge (strategist cannot undercut)
        uint128 maxSkew; // |skew| clamp
        uint128 lo; // size normaliser (quote raw units); != 0 enables the pool
        uint128 hi; // max single-swap quote-leg size (quote raw units); 0 = unlimited
        uint16 targetBps; // target base share of inventory value, in bps of 10_000
        uint32 maxAgeBlocks; // oracle freshness; 0 = must be pushed in THIS block
        uint32 drawdownE6; // stop-loss: max fall of inventory value vs decayed peak (1e6 = 100%)
        uint64 decayPerSecE18; // peak decays by this fraction/sec (1e18 = 100%/s)
        uint16 maxAnchorDevBps; // max |oracle/anchor - 1| (anchor is mandatory)
        uint32 maxAnchorAge; // max seconds since the anchor was updated
        uint128 maxInventoryBase; // 0 = no cap
        uint128 maxInventoryQuote;
    }
    Risk public risk;
    IAnchorPrice public anchor; // optional

    // ------------------------------------------------------------------ state
    struct Acc { uint64 blockNumber; uint192 cum; }
    mapping(bool => Acc) private acc; // key: taker sells base?
    uint128 public peakValue; // stop-loss high-watermark (quote raw units)
    uint64 public peakTs;

    // ------------------------------------------------------------------ events/errors
    event Swap(address indexed caller, address indexed recipient, address tokenIn, uint256 amountIn, uint256 amountOut, uint256 price1e8, uint256 edge, int256 skew);
    event Paused(bool paused);
    event RolesSet(address guardian, address strategist, address swapper);
    event RiskSet(Risk newRisk, address newAnchor);
    event CurvesSet(uint128 baseEdge, uint256 sizeSegs, uint256 skewSegs);
    event Withdrawn(address indexed token, address indexed to, uint256 amount);

    error NotAuthorized();
    error PoolPaused();
    error Disabled();
    error BadToken();
    error ZeroAmount();
    error OracleStale();
    error OracleZero();
    error AnchorDeviation();
    error TooLarge();
    error NeedsCurve();
    error CurveOutOfRange();
    error BadCurve();
    error EdgeOverflow();
    error InsufficientLiquidity();
    error InventoryCap();
    error Slippage();
    error NotPaid();
    error StopLoss();
    error CumOverflow();
    error BadParam();

    modifier onlyStrategist() {
        if (msg.sender != strategist && msg.sender != owner()) revert NotAuthorized();
        _;
    }

    constructor(
        address owner_,
        IERC20Metadata base_,
        IERC20Metadata quote_,
        IPropOracle oracle_,
        uint256 feedId_
    ) Ownable(owner_) {
        if (address(base_) == address(quote_) || address(base_) == address(0) || address(quote_) == address(0)) revert BadToken();
        base = base_;
        quote = quote_;
        scaleBase = 10 ** uint256(base_.decimals());
        scaleQuote = 10 ** uint256(quote_.decimals());
        oracle = oracle_;
        feedId = feedId_;
        // pool starts DISABLED (risk.lo == 0) and paused=false; owner must call setRisk.
    }

    // =================================================================== admin
    function setRoles(address guardian_, address strategist_, address swapper_) external onlyOwner {
        guardian = guardian_;
        strategist = strategist_;
        swapper = swapper_;
        emit RolesSet(guardian_, strategist_, swapper_);
    }

    /// @dev Owner SHOULD be a timelocked multisig. TODO: enforce propose/execute delay on-chain
    ///      for loosening changes (raise caps/hi, lower minEdge/drawdown, change anchor).
    function setRisk(Risk calldata r, IAnchorPrice anchor_) external onlyOwner {
        if (r.lo == 0 || r.hi == 0 || r.targetBps > 10_000) revert BadParam();
        if (r.drawdownE6 == 0 || r.drawdownE6 > 1e6) revert BadParam();
        // decay <= 1e-5/s (~86%/day) so the stop-loss peak cannot be decayed away
        if (r.decayPerSecE18 > 1e13) revert BadParam();
        // min edge must be positive and dominate skew: otherwise skew round-trips are extractable
        // (taker overshoots inventory across the skew sign flip, then trades back).
        if (r.minEdge == 0 || r.maxSkew > r.minEdge || uint256(r.minEdge) >= BPS) revert BadParam();
        if (r.maxAgeBlocks > 10) revert BadParam();
        // anchor (independent second source) is MANDATORY: the oracle pusher is a hot key
        if (address(anchor_) == address(0)) revert BadParam();
        if (r.maxAnchorDevBps == 0 || r.maxAnchorDevBps > 5000 || r.maxAnchorAge == 0) revert BadParam();
        risk = r;
        anchor = anchor_;
        emit RiskSet(r, address(anchor_));
    }

    function setPaused(bool p) external {
        // guardian may only pause; owner may also unpause
        if (p) {
            if (msg.sender != guardian && msg.sender != owner()) revert NotAuthorized();
        } else if (msg.sender != owner()) {
            revert NotAuthorized();
        }
        paused = p;
        emit Paused(p);
    }

    /// @notice Inventory out. Only the owner, only to an address the owner chooses. Re-bases the stop-loss.
    function withdraw(IERC20 token, address to, uint256 amount) external onlyOwner nonReentrant {
        token.safeTransfer(to, amount);
        peakValue = 0; // re-base watermark on next swap
        emit Withdrawn(address(token), to, amount);
    }
    // Deposits are plain ERC20 transfers to the pool.

    /// @notice Strategist retune (fast path, bounded by Risk.minEdge/maxSkew at pricing time).
    function setCurves(uint128 baseEdge_, Seg[] calldata size_, Seg[] calldata skew_) external onlyStrategist {
        if (uint256(baseEdge_) >= BPS) revert BadParam();
        _validate(size_);
        _validate(skew_);
        baseEdge = baseEdge_;
        delete sizeCurve;
        for (uint256 i; i < size_.length; ++i) sizeCurve.push(size_[i]);
        delete skewCurve;
        for (uint256 i; i < skew_.length; ++i) skewCurve.push(skew_[i]);
        emit CurvesSet(baseEdge_, size_.length, skew_.length);
    }

    function _validate(Seg[] calldata a) internal pure {
        if (a.length == 0 || a.length > 32) revert BadCurve();
        int256 prev = type(int256).min;
        for (uint256 i; i < a.length; ++i) {
            if (a[i].x1 <= a[i].x0 || a[i].x0 < prev) revert BadCurve();
            prev = a[i].x1;
        }
    }

    // =================================================================== swap
    /// @param tokenIn base or quote.
    /// @param amountSpecified >0 exact-in (tokenIn); <0 exact-out (tokenOut).
    /// @param amountCheck exact-in: min amountOut; exact-out: max amountIn.
    /// @param cbData empty => pay by allowance (transferFrom msg.sender) after payout;
    ///        non-empty => `propAMMSwapCallback` (pay-out first, then callback, then balance check).
    function swap(address tokenIn, int256 amountSpecified, uint256 amountCheck, address recipient, bytes calldata cbData)
        external
        nonReentrant
        returns (uint256 amountIn, uint256 amountOut)
    {
        if (msg.sender != swapper) revert NotAuthorized();
        if (paused) revert PoolPaused();
        if (recipient == address(0)) revert ZeroAmount();
        bool baseIn;
        uint256 p;
        {
            uint256 edge;
            int256 skew;
            (amountIn, amountOut, baseIn, p, edge, skew) = _price(tokenIn, amountSpecified);
            emit Swap(msg.sender, recipient, tokenIn, amountIn, amountOut, p, edge, skew);
        }

        if (amountSpecified > 0 ? amountOut < amountCheck : amountIn > amountCheck) revert Slippage();

        // flow accounting BEFORE interactions (cum counts the quote leg)
        _bumpAcc(baseIn, baseIn ? _toQuote(amountIn, p) : amountIn);

        uint256 vPre = _value(p); // stop-loss baseline = PRE-trade value (so the trade itself is checked)
        _settle(baseIn, tokenIn, recipient, amountIn, amountOut, cbData);
        _stopLoss(p, vPre);
    }

    function _settle(
        bool baseIn,
        address tokenIn,
        address recipient,
        uint256 amountIn,
        uint256 amountOut,
        bytes calldata cbData
    ) internal {
        IERC20 tIn = baseIn ? base : quote;
        IERC20 tOut = baseIn ? quote : base;
        uint256 balInBefore = tIn.balanceOf(address(this));
        tOut.safeTransfer(recipient, amountOut); // pay out first (Uniswap-v3 style)
        if (cbData.length == 0) {
            tIn.safeTransferFrom(msg.sender, address(this), amountIn);
        } else {
            IPropAMMSwapCallback(msg.sender).propAMMSwapCallback(tokenIn, amountIn, cbData);
        }
        uint256 balInAfter = tIn.balanceOf(address(this));
        if (balInAfter < balInBefore + amountIn) revert NotPaid();
        uint256 cap = baseIn ? risk.maxInventoryBase : risk.maxInventoryQuote;
        if (cap != 0 && balInAfter > cap) revert InventoryCap();
    }

    /// @notice Same math as `swap`, no state change. Reverts if the oracle was not pushed this block.
    function quoteSwap(address tokenIn, int256 amountSpecified)
        external
        view
        returns (uint256 amountIn, uint256 amountOut)
    {
        (amountIn, amountOut,,,,) = _price(tokenIn, amountSpecified);
    }

    // =================================================================== pricing
    function _price(address tokenIn, int256 amountSpecified)
        internal
        view
        returns (uint256 amountIn, uint256 amountOut, bool baseIn, uint256 p, uint256 edge, int256 skew)
    {
        Risk memory r = risk;
        if (r.lo == 0) revert Disabled();
        if (amountSpecified == 0) revert ZeroAmount();
        if (tokenIn == address(base)) baseIn = true;
        else if (tokenIn != address(quote)) revert BadToken();

        p = _oraclePrice(r);

        bool exactIn = amountSpecified > 0;
        uint256 amt = exactIn ? uint256(amountSpecified) : uint256(-amountSpecified);

        // size leg in quote raw units: exact-in => tokenIn leg; exact-out => tokenOut leg
        uint256 qty = exactIn ? (baseIn ? _toQuote(amt, p) : amt) : (baseIn ? amt : _toQuote(amt, p));
        if (r.hi != 0 && qty > r.hi) revert TooLarge();

        skew = _skew(r, p);
        edge = _edge(r, qty, baseIn);

        // execution price: seller-of-base gets lower, buyer-of-base pays higher.
        // Rounding ALWAYS favours the pool: when the taker pays quote (buys base) a higher p2 gives
        // them less base, so round p up; when the taker sells base a lower p2 gives less quote.
        Math.Rounding rnd = baseIn ? Math.Rounding.Floor : Math.Rounding.Ceil;
        uint256 p1 = Math.mulDiv(p, uint256(int256(BPS) + skew), BPS, rnd);
        uint256 p2 = Math.mulDiv(p1, baseIn ? BPS - edge : BPS + edge, BPS, rnd);
        if (p2 == 0) revert OracleZero();

        if (exactIn) {
            amountIn = amt;
            amountOut = baseIn
                ? Math.mulDiv(amt, p2 * scaleQuote, scaleBase * PRICE_SCALE) // round down
                : Math.mulDiv(amt, scaleBase * PRICE_SCALE, p2 * scaleQuote);
        } else {
            amountOut = amt;
            amountIn = baseIn
                ? Math.mulDiv(amt, scaleBase * PRICE_SCALE, p2 * scaleQuote, Math.Rounding.Ceil) // round up
                : Math.mulDiv(amt, p2 * scaleQuote, scaleBase * PRICE_SCALE, Math.Rounding.Ceil);
        }
        if (amountOut == 0) revert ZeroAmount();
        // Unlike FermiSwap (which silently clamps payout) we revert: clamping hides inventory exhaustion.
        if (amountOut > (baseIn ? quote : base).balanceOf(address(this))) revert InsufficientLiquidity();
    }

    function _oraclePrice(Risk memory r) internal view returns (uint256 p) {
        (uint128 price, uint64 bn,) = oracle.getPrice(feedId);
        if (price == 0) revert OracleZero();
        if (block.number - bn > r.maxAgeBlocks) revert OracleStale();
        p = price;
        (uint256 ap, uint256 at) = anchor.anchorPrice(); // anchor != 0 enforced in setRisk
        if (ap == 0 || at == 0 || at > block.timestamp || block.timestamp - at > r.maxAnchorAge) {
            revert AnchorDeviation();
        }
        uint256 d = p > ap ? p - ap : ap - p;
        if (d * 10_000 > ap * r.maxAnchorDevBps) revert AnchorDeviation();
    }

    /// @dev edge = max(minEdge, baseEdge + sizeCurve((cum + qty)/lo)), capped below 100%.
    function _edge(Risk memory r, uint256 qty, bool baseIn) internal view returns (uint256 e) {
        if (sizeCurve.length == 0) revert NeedsCurve();
        uint256 cum = _cum(baseIn);
        int256 x = int256(Math.mulDiv(cum + qty, 1e18, r.lo));
        int256 ev = int256(uint256(baseEdge)) + _interp(sizeCurve, x);
        e = ev < int256(uint256(r.minEdge)) ? r.minEdge : uint256(ev);
        if (e >= BPS) revert EdgeOverflow();
    }

    /// @dev skew from live inventory vs target share; clamped to +-maxSkew.
    function _skew(Risk memory r, uint256 p) internal view returns (int256 s) {
        if (skewCurve.length == 0) revert NeedsCurve();
        uint256 vBase = _toQuote(base.balanceOf(address(this)), p);
        uint256 total = vBase + quote.balanceOf(address(this));
        if (total == 0) return 0;
        int256 target = int256(Math.mulDiv(r.targetBps, total, 10_000));
        int256 imb = (int256(vBase) - target) * 1e18 / int256(total);
        s = _interp(skewCurve, imb);
        int256 m = int256(uint256(r.maxSkew));
        if (s > m) s = m; else if (s < -m) s = -m;
    }

    function _interp(Seg[] storage a, int256 v) internal view returns (int256) {
        uint256 lo; uint256 hi = a.length;
        while (lo < hi) {
            uint256 mid = (lo + hi) / 2;
            if (a[mid].x1 < v) lo = mid + 1; else hi = mid;
        }
        if (lo >= a.length) revert CurveOutOfRange();
        Seg memory g = a[lo];
        if (v < g.x0) revert CurveOutOfRange();
        int256 t = (v - g.x0) * 1e18 / (int256(g.x1) - int256(g.x0));
        int256 t2 = t * t / 1e18;
        int256 t3 = t * t2 / 1e18;
        return int256(g.c5) + t * g.c4 / 1e18 + t2 * g.c3 / 1e18 + t3 * g.c2 / 1e18;
    }

    function _toQuote(uint256 amountBase, uint256 p) internal view returns (uint256) {
        return Math.mulDiv(amountBase, p * scaleQuote, scaleBase * PRICE_SCALE);
    }

    // =================================================================== flow accounting
    function _cum(bool dir) internal view returns (uint256) {
        Acc storage x = acc[dir];
        return x.blockNumber == block.number ? x.cum : 0; // same-block window only
    }

    function _bumpAcc(bool dir, uint256 qty) internal {
        uint256 n = _cum(dir) + qty;
        if (n > type(uint192).max) revert CumOverflow();
        acc[dir] = Acc(uint64(block.number), uint192(n));
    }

    // =================================================================== stop-loss
    /// @dev Inventory value (quote units, marked at oracle price) vs decaying peak. Reverts the
    ///      offending swap, like Metric's OracleValueStopLossExtension.
    function _value(uint256 p) internal view returns (uint256) {
        return _toQuote(base.balanceOf(address(this)), p) + quote.balanceOf(address(this));
    }

    /// @param vPre pre-trade inventory value: folded into the peak BEFORE the post-trade check, so
    ///        the first swap after deployment / a withdraw (peak == 0) is still protected.
    function _stopLoss(uint256 p, uint256 vPre) internal {
        Risk memory r = risk;
        uint256 v = _value(p);
        uint256 peak = peakValue;
        if (peak != 0 && block.timestamp > peakTs) {
            uint256 dec = Math.mulDiv(peak, uint256(r.decayPerSecE18) * (block.timestamp - peakTs), 1e18);
            peak = dec >= peak ? 0 : peak - dec;
        }
        if (vPre > peak) peak = vPre;
        if (v >= peak) {
            peak = v;
        } else if (v * 1e6 < peak * (1e6 - r.drawdownE6)) {
            revert StopLoss();
        }
        peakValue = peak.toUint128();
        peakTs = block.timestamp.toUint64();
    }

    // =================================================================== views
    function curves() external view returns (Seg[] memory size_, Seg[] memory skew_) {
        size_ = sizeCurve;
        skew_ = skewCurve;
    }

    function cumulativeFlow(bool takerSellsBase) external view returns (uint256) {
        return _cum(takerSellsBase);
    }
}
