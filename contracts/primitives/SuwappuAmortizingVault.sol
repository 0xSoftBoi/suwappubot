// SPDX-License-Identifier: MIT
pragma solidity 0.8.27;

/*//////////////////////////////////////////////////////////////////////////
                SuwappuAmortizingVault — Self-Repaying Collateralized Position

    An immutable, dependency-free lending vault where deposited yield-bearing
    collateral automatically pays down the position's own debt.

    - Collateral: shares of one immutable ERC-4626 vault (any yield source wrapped
      as 4626 — permissionlessly chosen at deployment).
    - Debt: the 4626's underlying asset, supplied by lenders into this contract.
      Debt and collateral share a denomination, so LTV comes from convertToAssets
      with no separate price feed (it does inherit the 4626's share-price surface).
    - amortize() is permissionless: any keeper crystallizes the yield the
      collateral earned (value above cost basis) and applies it to the debt.
    - At zero debt the position unlocks. Liquidation only if undercollateralized
      before self-repayment finishes; bad debt is written off against lenders.

    No owner, no upgrade path, no governance, no imports. Interest is *simple*
    (linear in time) via a time-only index, so accrual is independent of poke
    frequency. Lendable cash is tracked internally so donations cannot inflate
    share price; a virtual offset hardens the first-depositor case.
//////////////////////////////////////////////////////////////////////////*/

interface IVaultToken {
    function transfer(address to, uint256 amount) external returns (bool);
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
    function balanceOf(address account) external view returns (uint256);
}

interface IVault4626 {
    function asset() external view returns (address);
    function convertToAssets(uint256 shares) external view returns (uint256);
    function convertToShares(uint256 assets) external view returns (uint256);
    function maxWithdraw(address owner) external view returns (uint256);
    function withdraw(uint256 assets, address receiver, address owner) external returns (uint256);
}

contract SuwappuAmortizingVault {
    /*////////////////////////////////////////////////////////////
                          REENTRANCY GUARD (inlined)
    ////////////////////////////////////////////////////////////*/
    uint256 private _lock = 1;

    modifier nonReentrant() {
        require(_lock == 1, "REENTRANT");
        _lock = 2;
        _;
        _lock = 1;
    }

    /*////////////////////////////////////////////////////////////
                                  STATE
    ////////////////////////////////////////////////////////////*/
    uint256 private constant WAD = 1e18;
    uint256 private constant VIRTUAL = 1e6; // virtual shares/assets offset

    IVault4626 public immutable collateralVault;
    IVaultToken public immutable asset;
    uint256 public immutable borrowRate; // per-second simple rate, WAD
    uint256 public immutable maxLtv; // WAD
    uint256 public immutable liqLtv; // WAD
    uint256 public immutable liqBonus; // WAD
    uint256 public immutable startTime;

    struct Position {
        address owner;
        uint256 shares;
        uint256 baselineAssets; // collateral cost basis (yield = value above this)
        uint256 debtScaled; // debt / index
    }

    uint256 public nextPositionId;
    mapping(uint256 => Position) public positions;

    uint256 public totalLendShares;
    mapping(address => uint256) public lendShares;
    uint256 public totalDebtScaled;
    uint256 public totalCash; // internally tracked idle lendable assets

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
    error TransferFailed();

    constructor(
        address collateralVault_,
        uint256 borrowRate_,
        uint256 maxLtv_,
        uint256 liqLtv_,
        uint256 liqBonus_
    ) {
        if (collateralVault_ == address(0)) revert BadParams();
        if (maxLtv_ == 0 || maxLtv_ >= liqLtv_ || liqLtv_ >= WAD) revert BadParams();
        if (borrowRate_ > 1e12 || liqBonus_ > 0.5e18) revert BadParams();
        collateralVault = IVault4626(collateralVault_);
        asset = IVaultToken(IVault4626(collateralVault_).asset());
        borrowRate = borrowRate_;
        maxLtv = maxLtv_;
        liqLtv = liqLtv_;
        liqBonus = liqBonus_;
        startTime = block.timestamp;
    }

    /*////////////////////////////////////////////////////////////
                                 LENDERS
    ////////////////////////////////////////////////////////////*/

    function supply(uint256 assets_) external nonReentrant returns (uint256 shares) {
        if (assets_ == 0) revert ZeroAmount();
        uint256 pool = poolAssets();
        shares = _mulDiv(assets_, totalLendShares + VIRTUAL, pool + VIRTUAL);
        if (shares == 0) revert ZeroShares();
        totalLendShares += shares;
        lendShares[msg.sender] += shares;
        totalCash += assets_;
        _safeTransferFromAsset(msg.sender, address(this), assets_);
        emit Supplied(msg.sender, assets_, shares);
    }

    function withdraw(uint256 shares) external nonReentrant returns (uint256 assets_) {
        if (shares == 0 || shares > lendShares[msg.sender]) revert ZeroAmount();
        assets_ = _mulDiv(shares, poolAssets() + VIRTUAL, totalLendShares + VIRTUAL);
        if (assets_ > totalCash) revert InsufficientCash();
        lendShares[msg.sender] -= shares;
        totalLendShares -= shares;
        totalCash -= assets_;
        _safeTransferAsset(msg.sender, assets_);
        emit Withdrawn(msg.sender, assets_, shares);
    }

    function cash() public view returns (uint256) {
        return totalCash;
    }

    function poolAssets() public view returns (uint256) {
        return totalCash + totalDebtAssets();
    }

    function totalDebtAssets() public view returns (uint256) {
        return _mulDiv(totalDebtScaled, _index(), WAD);
    }

    /*////////////////////////////////////////////////////////////
                                POSITIONS
    ////////////////////////////////////////////////////////////*/

    function openPosition(uint256 shares, uint256 borrowAssets)
        external
        nonReentrant
        returns (uint256 id)
    {
        if (shares == 0) revert ZeroAmount();
        uint256 value = collateralVault.convertToAssets(shares);
        if (borrowAssets * WAD > value * maxLtv) revert LtvExceeded();
        if (borrowAssets > totalCash) revert InsufficientCash();

        uint256 scaled = _mulDiv(borrowAssets, WAD, _index());
        id = nextPositionId++;
        positions[id] =
            Position({owner: msg.sender, shares: shares, baselineAssets: value, debtScaled: scaled});
        totalDebtScaled += scaled;
        totalCash -= borrowAssets;

        _safeTransferFromShares(msg.sender, address(this), shares);
        if (borrowAssets > 0) _safeTransferAsset(msg.sender, borrowAssets);
        emit PositionOpened(id, msg.sender, shares, borrowAssets);
    }

    function addCollateral(uint256 id, uint256 shares) external nonReentrant {
        if (shares == 0) revert ZeroAmount();
        Position storage p = positions[id];
        if (p.owner == address(0)) revert NotOwner();
        p.shares += shares;
        p.baselineAssets += collateralVault.convertToAssets(shares);
        _safeTransferFromShares(msg.sender, address(this), shares);
        emit CollateralAdded(id, shares);
    }

    function amortize(uint256 id) public nonReentrant returns (uint256 applied) {
        applied = _amortize(id);
    }

    function repay(uint256 id, uint256 assets_) external nonReentrant {
        if (assets_ == 0) revert ZeroAmount();
        Position storage p = positions[id];
        uint256 d = debtOf(id);
        if (d == 0) revert ZeroAmount();
        if (assets_ > d) assets_ = d;
        _reduceDebt(p, assets_);
        totalCash += assets_;
        _safeTransferFromAsset(msg.sender, address(this), assets_);
        emit Repaid(id, assets_);
    }

    function withdrawCollateral(uint256 id, uint256 shares) external nonReentrant {
        Position storage p = positions[id];
        if (p.owner != msg.sender) revert NotOwner();
        if (shares == 0 || shares > p.shares) revert ZeroAmount();
        _amortize(id);
        uint256 d = debtOf(id);
        uint256 remaining = p.shares - shares;
        uint256 remainingValue = collateralVault.convertToAssets(remaining);
        if (d > 0 && d * WAD > remainingValue * maxLtv) revert LtvExceeded();
        p.baselineAssets = p.shares == 0 ? 0 : _mulDiv(p.baselineAssets, remaining, p.shares);
        p.shares = remaining;
        _safeTransferShares(msg.sender, shares);
        emit CollateralWithdrawn(id, shares);
    }

    /// @notice Liquidate an undercollateralized position: repay up to `repayAssets`,
    ///         seize collateral worth repay*(1+liqBonus). Yield is amortized first.
    ///         Shortfall (collateral gone, debt remaining) is written off against lenders.
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
        p.baselineAssets = p.shares == 0 ? 0 : _mulDiv(p.baselineAssets, remaining, p.shares);
        p.shares = remaining;

        if (p.shares == 0 && p.debtScaled > 0) {
            uint256 writeoff = debtOf(id);
            uint256 scaled = p.debtScaled;
            totalDebtScaled -= scaled > totalDebtScaled ? totalDebtScaled : scaled;
            p.debtScaled = 0;
            emit BadDebtWrittenOff(id, writeoff);
        }

        _safeTransferFromAsset(msg.sender, address(this), repayAmt);
        _safeTransferShares(msg.sender, seizeShares);
        emit Liquidated(id, msg.sender, repayAmt, seizeShares);
    }

    /*////////////////////////////////////////////////////////////
                                  VIEWS
    ////////////////////////////////////////////////////////////*/

    function debtOf(uint256 id) public view returns (uint256) {
        return _mulDiv(positions[id].debtScaled, _index(), WAD);
    }

    function pendingYield(uint256 id) public view returns (uint256) {
        Position storage p = positions[id];
        uint256 cur = collateralVault.convertToAssets(p.shares);
        return cur > p.baselineAssets ? cur - p.baselineAssets : 0;
    }

    /*////////////////////////////////////////////////////////////
                                INTERNALS
    ////////////////////////////////////////////////////////////*/

    function _amortize(uint256 id) internal returns (uint256 applied) {
        Position storage p = positions[id];
        uint256 d = debtOf(id);
        if (d == 0 || p.shares == 0) return 0;
        uint256 cur = collateralVault.convertToAssets(p.shares);
        if (cur <= p.baselineAssets) return 0;
        uint256 surplus = cur - p.baselineAssets;
        applied = surplus > d ? d : surplus;
        uint256 maxOut = collateralVault.maxWithdraw(address(this));
        if (applied > maxOut) applied = maxOut;
        if (applied == 0) return 0;
        uint256 burned = collateralVault.withdraw(applied, address(this), address(this));
        p.shares -= burned;
        _reduceDebt(p, applied);
        totalCash += applied;
        emit Amortized(id, applied, debtOf(id));
    }

    function _reduceDebt(Position storage p, uint256 assets_) internal {
        uint256 scaled = _mulDivUp(assets_, WAD, _index());
        if (scaled > p.debtScaled) scaled = p.debtScaled;
        p.debtScaled -= scaled;
        totalDebtScaled -= scaled > totalDebtScaled ? totalDebtScaled : scaled;
    }

    /// @dev Linear (simple-interest) index, a pure function of elapsed time.
    function _index() internal view returns (uint256) {
        return WAD + borrowRate * (block.timestamp - startTime);
    }

    /*////////////////////////////////////////////////////////////
                        SAFE ERC-20 (inlined, no lib)
    ////////////////////////////////////////////////////////////*/
    function _safeTransferAsset(address to, uint256 amount) private {
        _safeCall(address(asset), abi.encodeWithSelector(IVaultToken.transfer.selector, to, amount));
    }

    function _safeTransferFromAsset(address from, address to, uint256 amount) private {
        _safeCall(address(asset), abi.encodeWithSelector(IVaultToken.transferFrom.selector, from, to, amount));
    }

    function _safeTransferShares(address to, uint256 amount) private {
        _safeCall(address(collateralVault), abi.encodeWithSelector(IVaultToken.transfer.selector, to, amount));
    }

    function _safeTransferFromShares(address from, address to, uint256 amount) private {
        _safeCall(
            address(collateralVault),
            abi.encodeWithSelector(IVaultToken.transferFrom.selector, from, to, amount)
        );
    }

    function _safeCall(address token, bytes memory payload) private {
        (bool ok, bytes memory data) = token.call(payload);
        if (!ok || (data.length != 0 && !abi.decode(data, (bool)))) revert TransferFailed();
    }

    /*////////////////////////////////////////////////////////////
                                   MATH
    ////////////////////////////////////////////////////////////*/

    function _mulDivUp(uint256 x, uint256 y, uint256 d) internal pure returns (uint256 z) {
        z = _mulDiv(x, y, d);
        if (mulmod(x, y, d) != 0) z += 1;
    }

    /// @dev 512-bit multiply-then-divide (Remco Bloemen, MIT).
    function _mulDiv(uint256 x, uint256 y, uint256 denominator) internal pure returns (uint256 result) {
        unchecked {
            uint256 prod0;
            uint256 prod1;
            assembly {
                let mm := mulmod(x, y, not(0))
                prod0 := mul(x, y)
                prod1 := sub(sub(mm, prod0), lt(mm, prod0))
            }
            if (prod1 == 0) {
                require(denominator > 0, "DIV_ZERO");
                return prod0 / denominator;
            }
            require(denominator > prod1, "MULDIV_OVERFLOW");
            uint256 remainder;
            assembly {
                remainder := mulmod(x, y, denominator)
                prod1 := sub(prod1, gt(remainder, prod0))
                prod0 := sub(prod0, remainder)
            }
            uint256 twos = denominator & (~denominator + 1);
            assembly {
                denominator := div(denominator, twos)
                prod0 := div(prod0, twos)
                twos := add(div(sub(0, twos), twos), 1)
            }
            prod0 |= prod1 * twos;
            uint256 inverse = (3 * denominator) ^ 2;
            inverse *= 2 - denominator * inverse;
            inverse *= 2 - denominator * inverse;
            inverse *= 2 - denominator * inverse;
            inverse *= 2 - denominator * inverse;
            inverse *= 2 - denominator * inverse;
            inverse *= 2 - denominator * inverse;
            result = prod0 * inverse;
        }
    }
}
