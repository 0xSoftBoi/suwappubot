// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/interfaces/IERC4626.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/**
 * @title SuwappuAmortizingVault — Self-Repaying Collateralized Position
 * @notice An immutable lending vault where deposited yield-bearing collateral
 *         automatically pays down the position's own debt.
 *
 *         - Collateral: shares of one immutable ERC-4626 vault (any yield source
 *           wrapped as 4626 — permissionlessly chosen at deployment).
 *         - Debt: the 4626's *underlying* asset, supplied by lenders into this
 *           contract. Because debt and collateral are denominated in the same
 *           asset, LTV is computed from `convertToAssets` — **no oracle**.
 *         - `amortize()` is permissionless: any keeper can crystallize the yield
 *           the collateral has earned (asset value above the recorded baseline),
 *           redeem exactly that much, and apply it to the position's debt.
 *         - Once debt hits zero the position unlocks and collateral is freely
 *           withdrawable. Liquidation only occurs if the position becomes
 *           undercollateralized before self-repayment finishes.
 *
 *         No owner, no upgrade path, no governance. All rates and ratios are
 *         immutable, fixed forever at deployment.
 */
contract SuwappuAmortizingVault is ReentrancyGuard {
    using SafeERC20 for IERC20;

    uint256 private constant WAD = 1e18;

    /// @notice The yield-bearing collateral vault.
    IERC4626 public immutable collateralVault;
    /// @notice The debt asset — the collateral vault's underlying.
    IERC20 public immutable asset;
    /// @notice Per-second borrow interest rate, WAD (simple, applied on accrual).
    uint256 public immutable borrowRate;
    /// @notice Maximum debt/collateral-value at borrow time, WAD (e.g. 0.5e18).
    uint256 public immutable maxLtv;
    /// @notice Debt/collateral-value above which liquidation opens, WAD (e.g. 0.9e18).
    uint256 public immutable liqLtv;
    /// @notice Liquidator bonus on seized collateral, WAD (e.g. 0.05e18).
    uint256 public immutable liqBonus;

    struct Position {
        address owner;
        uint256 shares;          // 4626 shares held as collateral
        uint256 baselineAssets;  // asset value already accounted for (yield watermark)
        uint256 debtScaled;      // debt / borrowIndex at last touch
    }

    uint256 public nextPositionId;
    mapping(uint256 => Position) public positions;

    // Lender-side pooled accounting.
    uint256 public totalLendShares;
    mapping(address => uint256) public lendShares;
    uint256 public totalDebtAssets; // aggregate outstanding debt incl. accrued interest
    uint256 public borrowIndex = WAD;
    uint256 public lastAccrue;

    event Supplied(address indexed lender, uint256 assets, uint256 shares);
    event Withdrawn(address indexed lender, uint256 assets, uint256 shares);
    event PositionOpened(uint256 indexed id, address indexed owner, uint256 shares, uint256 debt);
    event Amortized(uint256 indexed id, uint256 yieldApplied, uint256 remainingDebt);
    event Repaid(uint256 indexed id, uint256 assets);
    event CollateralWithdrawn(uint256 indexed id, uint256 shares);
    event Liquidated(uint256 indexed id, address indexed liquidator, uint256 debtRepaid, uint256 sharesSeized);

    error BadParams();
    error NotOwner();
    error ZeroAmount();
    error LtvExceeded();
    error InsufficientCash();
    error NotLiquidatable();
    error DebtOutstanding();

    constructor(
        address collateralVault_,
        uint256 borrowRate_,
        uint256 maxLtv_,
        uint256 liqLtv_,
        uint256 liqBonus_
    ) {
        if (collateralVault_ == address(0)) revert BadParams();
        if (maxLtv_ == 0 || maxLtv_ >= liqLtv_ || liqLtv_ >= WAD) revert BadParams();
        collateralVault = IERC4626(collateralVault_);
        asset = IERC20(collateralVault.asset());
        borrowRate = borrowRate_;
        maxLtv = maxLtv_;
        liqLtv = liqLtv_;
        liqBonus = liqBonus_;
        lastAccrue = block.timestamp;
    }

    // ---------------------------------------------------------------- lenders

    function supply(uint256 assets_) external nonReentrant returns (uint256 shares) {
        if (assets_ == 0) revert ZeroAmount();
        _accrue();
        uint256 pool = poolAssets();
        shares = (totalLendShares == 0 || pool == 0)
            ? assets_
            : (assets_ * totalLendShares) / pool;
        totalLendShares += shares;
        lendShares[msg.sender] += shares;
        asset.safeTransferFrom(msg.sender, address(this), assets_);
        emit Supplied(msg.sender, assets_, shares);
    }

    function withdraw(uint256 shares) external nonReentrant returns (uint256 assets_) {
        if (shares == 0 || shares > lendShares[msg.sender]) revert ZeroAmount();
        _accrue();
        assets_ = (shares * poolAssets()) / totalLendShares;
        if (assets_ > cash()) revert InsufficientCash();
        lendShares[msg.sender] -= shares;
        totalLendShares -= shares;
        asset.safeTransfer(msg.sender, assets_);
        emit Withdrawn(msg.sender, assets_, shares);
    }

    /// @notice Idle lendable assets on hand.
    function cash() public view returns (uint256) {
        return asset.balanceOf(address(this));
    }

    /// @notice Total lender claim: idle cash + outstanding debt owed back.
    function poolAssets() public view returns (uint256) {
        return cash() + totalDebtAssets;
    }

    // -------------------------------------------------------------- positions

    /// @notice Deposit 4626 shares as collateral and borrow the underlying asset.
    function openPosition(uint256 shares, uint256 borrowAssets)
        external
        nonReentrant
        returns (uint256 id)
    {
        if (shares == 0) revert ZeroAmount();
        _accrue();
        uint256 value = collateralVault.convertToAssets(shares);
        if (borrowAssets * WAD > value * maxLtv) revert LtvExceeded();
        if (borrowAssets > cash()) revert InsufficientCash();

        id = nextPositionId++;
        positions[id] = Position({
            owner: msg.sender,
            shares: shares,
            baselineAssets: value,
            debtScaled: (borrowAssets * WAD) / borrowIndex
        });
        totalDebtAssets += borrowAssets;

        IERC20(address(collateralVault)).safeTransferFrom(msg.sender, address(this), shares);
        if (borrowAssets > 0) asset.safeTransfer(msg.sender, borrowAssets);
        emit PositionOpened(id, msg.sender, shares, borrowAssets);
    }

    /// @notice Permissionless: apply the collateral's earned yield to its own debt.
    function amortize(uint256 id) public nonReentrant returns (uint256 applied) {
        _accrue();
        applied = _amortize(id);
    }

    /// @notice Manually repay debt with external assets.
    function repay(uint256 id, uint256 assets_) external nonReentrant {
        if (assets_ == 0) revert ZeroAmount();
        _accrue();
        Position storage p = positions[id];
        uint256 d = debtOf(id);
        if (assets_ > d) assets_ = d;
        asset.safeTransferFrom(msg.sender, address(this), assets_);
        _reduceDebt(p, assets_);
        emit Repaid(id, assets_);
    }

    /// @notice Withdraw collateral shares. Free once debt is zero; otherwise the
    ///         remaining collateral must keep the position within maxLtv.
    function withdrawCollateral(uint256 id, uint256 shares) external nonReentrant {
        _accrue();
        Position storage p = positions[id];
        if (p.owner != msg.sender) revert NotOwner();
        if (shares == 0 || shares > p.shares) revert ZeroAmount();
        _amortize(id);
        uint256 d = debtOf(id);
        uint256 remainingValue = collateralVault.convertToAssets(p.shares - shares);
        if (d > 0 && d * WAD > remainingValue * maxLtv) revert LtvExceeded();
        p.shares -= shares;
        p.baselineAssets = collateralVault.convertToAssets(p.shares);
        IERC20(address(collateralVault)).safeTransfer(msg.sender, shares);
        emit CollateralWithdrawn(id, shares);
    }

    /// @notice Liquidate an undercollateralized position: repay its full debt,
    ///         seize collateral worth debt * (1 + liqBonus). Amortization is
    ///         applied first, so positions are never liquidated on stale yield.
    function liquidate(uint256 id) external nonReentrant {
        _accrue();
        _amortize(id);
        Position storage p = positions[id];
        uint256 d = debtOf(id);
        uint256 value = collateralVault.convertToAssets(p.shares);
        if (d == 0 || d * WAD <= value * liqLtv) revert NotLiquidatable();

        asset.safeTransferFrom(msg.sender, address(this), d);
        uint256 seizeValue = d + (d * liqBonus) / WAD;
        uint256 seizeShares = collateralVault.convertToShares(seizeValue);
        if (seizeShares > p.shares) seizeShares = p.shares;
        _reduceDebt(p, d);
        p.shares -= seizeShares;
        p.baselineAssets = collateralVault.convertToAssets(p.shares);
        IERC20(address(collateralVault)).safeTransfer(msg.sender, seizeShares);
        emit Liquidated(id, msg.sender, d, seizeShares);
    }

    // ------------------------------------------------------------------ views

    /// @notice Current debt of a position including accrued interest.
    function debtOf(uint256 id) public view returns (uint256) {
        return (positions[id].debtScaled * _currentIndex()) / WAD;
    }

    /// @notice Yield earned by the collateral since the last amortization.
    function pendingYield(uint256 id) public view returns (uint256) {
        Position storage p = positions[id];
        uint256 cur = collateralVault.convertToAssets(p.shares);
        return cur > p.baselineAssets ? cur - p.baselineAssets : 0;
    }

    // -------------------------------------------------------------- internals

    function _amortize(uint256 id) internal returns (uint256 applied) {
        Position storage p = positions[id];
        uint256 d = (p.debtScaled * borrowIndex) / WAD;
        if (d == 0 || p.shares == 0) return 0;
        uint256 cur = collateralVault.convertToAssets(p.shares);
        if (cur <= p.baselineAssets) return 0;
        uint256 surplus = cur - p.baselineAssets;
        applied = surplus > d ? d : surplus;
        uint256 burned = collateralVault.withdraw(applied, address(this), address(this));
        p.shares -= burned;
        _reduceDebt(p, applied);
        p.baselineAssets = collateralVault.convertToAssets(p.shares);
        emit Amortized(id, applied, debtOf(id));
    }

    function _reduceDebt(Position storage p, uint256 assets_) internal {
        // Round scaled reduction up so a full-debt repayment always zeroes the position.
        uint256 scaled = (assets_ * WAD + borrowIndex - 1) / borrowIndex;
        if (scaled > p.debtScaled) scaled = p.debtScaled;
        p.debtScaled -= scaled;
        totalDebtAssets = totalDebtAssets > assets_ ? totalDebtAssets - assets_ : 0;
    }

    function _currentIndex() internal view returns (uint256) {
        uint256 dt = block.timestamp - lastAccrue;
        return borrowIndex + (borrowIndex * borrowRate * dt) / WAD;
    }

    function _accrue() internal {
        uint256 dt = block.timestamp - lastAccrue;
        if (dt == 0) return;
        uint256 interest = (totalDebtAssets * borrowRate * dt) / WAD;
        totalDebtAssets += interest;
        borrowIndex += (borrowIndex * borrowRate * dt) / WAD;
        lastAccrue = block.timestamp;
    }
}
