// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/interfaces/IERC4626.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/utils/math/Math.sol";

/**
 * @title SuwappuAmortizingVault — Self-Repaying Collateralized Position
 * @notice An immutable lending vault where deposited yield-bearing collateral
 *         automatically pays down the position's own debt.
 *
 *         - Collateral: shares of one immutable ERC-4626 vault (any yield source
 *           wrapped as 4626 — permissionlessly chosen at deployment).
 *         - Debt: the 4626's *underlying* asset, supplied by lenders into this
 *           contract. Because debt and collateral are denominated in the same
 *           asset, LTV is computed from `convertToAssets`. There is no external
 *           price feed — but note the 4626 share price *is* the price input, so
 *           this inherits that vault's share-price-manipulation surface.
 *         - `amortize()` is permissionless: any keeper can crystallize the yield
 *           the collateral has earned (asset value above the recorded cost basis),
 *           redeem exactly that much, and apply it to the position's debt.
 *         - Once debt hits zero the position unlocks and collateral is freely
 *           withdrawable. Liquidation only occurs if the position becomes
 *           undercollateralized before self-repayment finishes.
 *
 *         No owner, no upgrade path, no governance. All rates and ratios are
 *         immutable, fixed forever at deployment.
 *
 * @dev Interest is *simple* (linear in time) via an index that is a pure function
 *      of elapsed time, so accrual is independent of how often anyone pokes the
 *      contract. Lendable cash is tracked internally (`totalCash`) rather than
 *      read from `balanceOf`, so donations cannot inflate share price. Bad debt
 *      is written off against lenders when collateral is exhausted below debt.
 */
contract SuwappuAmortizingVault is ReentrancyGuard {
    using SafeERC20 for IERC20;

    uint256 private constant WAD = 1e18;
    /// @dev Virtual shares/assets offset hardening the empty-pool first-depositor case.
    uint256 private constant VIRTUAL = 1e6;

    /// @notice The yield-bearing collateral vault.
    IERC4626 public immutable collateralVault;
    /// @notice The debt asset — the collateral vault's underlying.
    IERC20 public immutable asset;
    /// @notice Per-second simple borrow interest rate, WAD.
    uint256 public immutable borrowRate;
    /// @notice Maximum debt/collateral-value at borrow time, WAD (e.g. 0.5e18).
    uint256 public immutable maxLtv;
    /// @notice Debt/collateral-value above which liquidation opens, WAD (e.g. 0.9e18).
    uint256 public immutable liqLtv;
    /// @notice Liquidator bonus on seized collateral, WAD (e.g. 0.05e18).
    uint256 public immutable liqBonus;
    /// @notice t=0 of the interest schedule.
    uint256 public immutable startTime;

    struct Position {
        address owner;
        uint256 shares;          // 4626 shares held as collateral
        uint256 baselineAssets;  // collateral cost basis (yield = value above this)
        uint256 debtScaled;      // debt / index, fixed until principal changes
    }

    uint256 public nextPositionId;
    mapping(uint256 => Position) public positions;

    // Lender-side pooled accounting.
    uint256 public totalLendShares;
    mapping(address => uint256) public lendShares;
    uint256 public totalDebtScaled; // aggregate debt / index
    uint256 public totalCash;       // internally tracked idle lendable assets

    event Supplied(address indexed lender, uint256 assets, uint256 shares);
    event Withdrawn(address indexed lender, uint256 assets, uint256 shares);
    event PositionOpened(uint256 indexed id, address indexed owner, uint256 shares, uint256 debt);
    event CollateralAdded(uint256 indexed id, uint256 shares);
    event Amortized(uint256 indexed id, uint256 yieldApplied, uint256 remainingDebt);
    event Repaid(uint256 indexed id, uint256 assets);
    event CollateralWithdrawn(uint256 indexed id, uint256 shares);
    event Liquidated(uint256 indexed id, address indexed liquidator, uint256 debtRepaid, uint256 sharesSeized);
    event BadDebtWrittenOff(uint256 indexed id, uint256 assets);

    error BadParams();
    error NotOwner();
    error ZeroAmount();
    error ZeroShares();
    error LtvExceeded();
    error InsufficientCash();
    error NotLiquidatable();

    constructor(
        address collateralVault_,
        uint256 borrowRate_,
        uint256 maxLtv_,
        uint256 liqLtv_,
        uint256 liqBonus_
    ) {
        if (collateralVault_ == address(0)) revert BadParams();
        if (maxLtv_ == 0 || maxLtv_ >= liqLtv_ || liqLtv_ >= WAD) revert BadParams();
        // Bound borrowRate so index = WAD + rate*dt cannot overflow for any
        // realistic timestamp, and cap the liquidation bonus at a sane level.
        if (borrowRate_ > 1e12 || liqBonus_ > 0.5e18) revert BadParams();
        collateralVault = IERC4626(collateralVault_);
        asset = IERC20(collateralVault.asset());
        borrowRate = borrowRate_;
        maxLtv = maxLtv_;
        liqLtv = liqLtv_;
        liqBonus = liqBonus_;
        startTime = block.timestamp;
    }

    // ---------------------------------------------------------------- lenders

    function supply(uint256 assets_) external nonReentrant returns (uint256 shares) {
        if (assets_ == 0) revert ZeroAmount();
        uint256 pool = poolAssets();
        shares = Math.mulDiv(assets_, totalLendShares + VIRTUAL, pool + VIRTUAL);
        if (shares == 0) revert ZeroShares();
        totalLendShares += shares;
        lendShares[msg.sender] += shares;
        totalCash += assets_;
        asset.safeTransferFrom(msg.sender, address(this), assets_);
        emit Supplied(msg.sender, assets_, shares);
    }

    function withdraw(uint256 shares) external nonReentrant returns (uint256 assets_) {
        if (shares == 0 || shares > lendShares[msg.sender]) revert ZeroAmount();
        assets_ = Math.mulDiv(shares, poolAssets() + VIRTUAL, totalLendShares + VIRTUAL);
        if (assets_ > totalCash) revert InsufficientCash();
        lendShares[msg.sender] -= shares;
        totalLendShares -= shares;
        totalCash -= assets_;
        asset.safeTransfer(msg.sender, assets_);
        emit Withdrawn(msg.sender, assets_, shares);
    }

    /// @notice Idle lendable assets on hand (internally tracked, donation-proof).
    function cash() public view returns (uint256) {
        return totalCash;
    }

    /// @notice Total lender claim: idle cash + outstanding debt owed back.
    function poolAssets() public view returns (uint256) {
        return totalCash + totalDebtAssets();
    }

    /// @notice Aggregate outstanding debt including accrued interest.
    function totalDebtAssets() public view returns (uint256) {
        return Math.mulDiv(totalDebtScaled, _index(), WAD);
    }

    // -------------------------------------------------------------- positions

    /// @notice Deposit 4626 shares as collateral and borrow the underlying asset.
    function openPosition(uint256 shares, uint256 borrowAssets)
        external
        nonReentrant
        returns (uint256 id)
    {
        if (shares == 0) revert ZeroAmount();
        uint256 value = collateralVault.convertToAssets(shares);
        if (borrowAssets * WAD > value * maxLtv) revert LtvExceeded();
        if (borrowAssets > totalCash) revert InsufficientCash();

        uint256 scaled = _toScaled(borrowAssets, false);
        id = nextPositionId++;
        positions[id] = Position({
            owner: msg.sender,
            shares: shares,
            baselineAssets: value,
            debtScaled: scaled
        });
        totalDebtScaled += scaled;
        totalCash -= borrowAssets;

        IERC20(address(collateralVault)).safeTransferFrom(msg.sender, address(this), shares);
        if (borrowAssets > 0) asset.safeTransfer(msg.sender, borrowAssets);
        emit PositionOpened(id, msg.sender, shares, borrowAssets);
    }

    /// @notice Add collateral to an existing position (improve its health).
    function addCollateral(uint256 id, uint256 shares) external nonReentrant {
        if (shares == 0) revert ZeroAmount();
        Position storage p = positions[id];
        if (p.owner == address(0)) revert NotOwner();
        p.shares += shares;
        p.baselineAssets += collateralVault.convertToAssets(shares);
        IERC20(address(collateralVault)).safeTransferFrom(msg.sender, address(this), shares);
        emit CollateralAdded(id, shares);
    }

    /// @notice Permissionless: apply the collateral's earned yield to its own debt.
    function amortize(uint256 id) public nonReentrant returns (uint256 applied) {
        applied = _amortize(id);
    }

    /// @notice Manually repay debt with external assets.
    function repay(uint256 id, uint256 assets_) external nonReentrant {
        if (assets_ == 0) revert ZeroAmount();
        Position storage p = positions[id];
        uint256 d = debtOf(id);
        if (d == 0) revert ZeroAmount();
        if (assets_ > d) assets_ = d;
        _reduceDebt(p, assets_);
        totalCash += assets_;
        asset.safeTransferFrom(msg.sender, address(this), assets_);
        emit Repaid(id, assets_);
    }

    /// @notice Withdraw collateral shares. Free once debt is zero; otherwise the
    ///         remaining collateral must keep the position within maxLtv.
    function withdrawCollateral(uint256 id, uint256 shares) external nonReentrant {
        Position storage p = positions[id];
        if (p.owner != msg.sender) revert NotOwner();
        if (shares == 0 || shares > p.shares) revert ZeroAmount();
        _amortize(id);
        uint256 d = debtOf(id);
        uint256 remaining = p.shares - shares;
        uint256 remainingValue = collateralVault.convertToAssets(remaining);
        if (d > 0 && d * WAD > remainingValue * maxLtv) revert LtvExceeded();
        // Reduce cost basis proportionally to principal removed (no ratchet).
        p.baselineAssets = p.shares == 0 ? 0 : Math.mulDiv(p.baselineAssets, remaining, p.shares);
        p.shares = remaining;
        IERC20(address(collateralVault)).safeTransfer(msg.sender, shares);
        emit CollateralWithdrawn(id, shares);
    }

    /// @notice Liquidate an undercollateralized position: repay up to `repayAssets`
    ///         of its debt, seize collateral worth repay * (1 + liqBonus). Yield is
    ///         amortized first, so positions are never liquidated on stale yield.
    ///         If collateral is exhausted with debt remaining, the shortfall is
    ///         written off against the lender pool.
    function liquidate(uint256 id, uint256 repayAssets) external nonReentrant {
        _amortize(id);
        Position storage p = positions[id];
        uint256 d = debtOf(id);
        uint256 value = collateralVault.convertToAssets(p.shares);
        if (d == 0 || d * WAD <= value * liqLtv) revert NotLiquidatable();

        uint256 repayAmt = repayAssets > d ? d : repayAssets;
        if (repayAmt == 0) revert ZeroAmount();
        uint256 seizeValue = repayAmt + (repayAmt * liqBonus) / WAD;
        uint256 seizeShares = collateralVault.convertToShares(seizeValue);
        if (seizeShares > p.shares) seizeShares = p.shares;

        _reduceDebt(p, repayAmt);
        totalCash += repayAmt;
        uint256 remaining = p.shares - seizeShares;
        p.baselineAssets = p.shares == 0 ? 0 : Math.mulDiv(p.baselineAssets, remaining, p.shares);
        p.shares = remaining;

        // Bad-debt writeoff: collateral gone but debt remains → socialize the loss.
        if (p.shares == 0 && p.debtScaled > 0) {
            uint256 writeoff = debtOf(id);
            uint256 scaled = p.debtScaled;
            totalDebtScaled -= scaled > totalDebtScaled ? totalDebtScaled : scaled;
            p.debtScaled = 0;
            emit BadDebtWrittenOff(id, writeoff);
        }

        asset.safeTransferFrom(msg.sender, address(this), repayAmt);
        IERC20(address(collateralVault)).safeTransfer(msg.sender, seizeShares);
        emit Liquidated(id, msg.sender, repayAmt, seizeShares);
    }

    // ------------------------------------------------------------------ views

    /// @notice Current debt of a position including accrued interest.
    function debtOf(uint256 id) public view returns (uint256) {
        return Math.mulDiv(positions[id].debtScaled, _index(), WAD);
    }

    /// @notice Yield earned by the collateral above its cost basis.
    function pendingYield(uint256 id) public view returns (uint256) {
        Position storage p = positions[id];
        uint256 cur = collateralVault.convertToAssets(p.shares);
        return cur > p.baselineAssets ? cur - p.baselineAssets : 0;
    }

    // -------------------------------------------------------------- internals

    function _amortize(uint256 id) internal returns (uint256 applied) {
        Position storage p = positions[id];
        uint256 d = debtOf(id);
        if (d == 0 || p.shares == 0) return 0;
        uint256 cur = collateralVault.convertToAssets(p.shares);
        if (cur <= p.baselineAssets) return 0;
        uint256 surplus = cur - p.baselineAssets;
        applied = surplus > d ? d : surplus;
        // Never ask the 4626 for more than it can currently service, or the whole
        // call (including any liquidation that ran amortize first) would revert.
        uint256 maxOut = collateralVault.maxWithdraw(address(this));
        if (applied > maxOut) applied = maxOut;
        if (applied == 0) return 0;
        uint256 burned = collateralVault.withdraw(applied, address(this), address(this));
        p.shares -= burned;
        _reduceDebt(p, applied);
        totalCash += applied;
        // Basis unchanged: we harvested pure yield (value above basis).
        emit Amortized(id, applied, debtOf(id));
    }

    function _reduceDebt(Position storage p, uint256 assets_) internal {
        // Round the scaled reduction up so a full-debt repayment always zeroes out.
        uint256 scaled = _toScaled(assets_, true);
        if (scaled > p.debtScaled) scaled = p.debtScaled;
        p.debtScaled -= scaled;
        totalDebtScaled -= scaled > totalDebtScaled ? totalDebtScaled : scaled;
    }

    /// @dev assets → scaled debt units at the current index; `roundUp` for reductions.
    function _toScaled(uint256 assets_, bool roundUp) internal view returns (uint256) {
        uint256 idx = _index();
        return roundUp ? Math.mulDiv(assets_, WAD, idx, Math.Rounding.Ceil) : Math.mulDiv(assets_, WAD, idx);
    }

    /// @dev Linear (simple-interest) index, a pure function of elapsed time.
    function _index() internal view returns (uint256) {
        return WAD + borrowRate * (block.timestamp - startTime);
    }
}
