// SPDX-License-Identifier: MIT
pragma solidity 0.8.27;

import {ISuwappuYieldStrategy} from "../interfaces/ISuwappuYieldStrategy.sol";

interface IAaveAsset {
    function balanceOf(address account) external view returns (uint256);
    function approve(address spender, uint256 amount) external returns (bool);
}

interface IAaveAToken {
    function balanceOf(address account) external view returns (uint256);
    function UNDERLYING_ASSET_ADDRESS() external view returns (address);
}

interface IAaveV3Pool {
    function supply(address asset, uint256 amount, address onBehalfOf, uint16 referralCode) external;
    function withdraw(address asset, uint256 amount, address to) external returns (uint256);
}

/// @title AaveV3YieldStrategy
/// @notice Narrow Aave V3 supply adapter for Suwappu mixed-yield vaults.
/// @dev No borrow, flash-loan, collateral toggling, arbitrary call, or reward-swap surface exists here.
contract AaveV3YieldStrategy is ISuwappuYieldStrategy {
    IAaveAsset public immutable underlying;
    IAaveAToken public immutable aToken;
    IAaveV3Pool public immutable pool;
    address public immutable override vault;
    string public override name;
    string public constant override protocol = "aave-v3";

    error Unauthorized();
    error BadParams();
    error ApprovalFailed();
    error SlippageExceeded();
    error AccountingMismatch();

    modifier onlyVault() {
        if (msg.sender != vault) revert Unauthorized();
        _;
    }

    constructor(address asset_, address vault_, address pool_, address aToken_, string memory name_) {
        if (asset_ == address(0) || vault_ == address(0) || pool_ == address(0) || aToken_ == address(0)) {
            revert BadParams();
        }
        if (IAaveAToken(aToken_).UNDERLYING_ASSET_ADDRESS() != asset_) revert BadParams();
        underlying = IAaveAsset(asset_);
        vault = vault_;
        pool = IAaveV3Pool(pool_);
        aToken = IAaveAToken(aToken_);
        name = name_;
    }

    function asset() external view override returns (address) {
        return address(underlying);
    }

    /// @notice Aave aToken balances are underlying-denominated and accrue supply interest.
    function totalAssets() public view override returns (uint256) {
        return aToken.balanceOf(address(this));
    }

    /// @notice Conservative synchronous liquidity bound.
    /// @dev Aave reserve cash is held at the aToken address. We cap the strategy claim by that cash
    ///      so ERC-4626 maxWithdraw does not assume the entire supplied position can always exit at once.
    function liquidAssets() external view override returns (uint256) {
        uint256 claim = totalAssets();
        uint256 reserveCash = underlying.balanceOf(address(aToken));
        return claim < reserveCash ? claim : reserveCash;
    }

    function deposit(uint256 assets, bytes calldata) external override onlyVault returns (uint256 deployed) {
        if (assets == 0 || underlying.balanceOf(address(this)) < assets) revert AccountingMismatch();
        uint256 beforeClaim = totalAssets();
        _forceApprove(address(pool), assets);
        pool.supply(address(underlying), assets, address(this), 0);
        _forceApprove(address(pool), 0);
        uint256 afterClaim = totalAssets();
        if (afterClaim < beforeClaim) revert AccountingMismatch();
        deployed = afterClaim - beforeClaim;
        if (deployed > assets) deployed = assets;
    }

    function withdraw(uint256 assets, uint256 minAssetsOut, bytes calldata)
        external
        override
        onlyVault
        returns (uint256 assetsOut)
    {
        uint256 beforeBal = underlying.balanceOf(vault);
        pool.withdraw(address(underlying), assets, vault);
        uint256 afterBal = underlying.balanceOf(vault);
        if (afterBal < beforeBal) revert AccountingMismatch();
        assetsOut = afterBal - beforeBal;
        if (assetsOut < minAssetsOut) revert SlippageExceeded();
    }

    function emergencyExit(uint256 minAssetsOut, bytes calldata)
        external
        override
        onlyVault
        returns (uint256 assetsOut)
    {
        uint256 beforeBal = underlying.balanceOf(vault);
        pool.withdraw(address(underlying), type(uint256).max, vault);
        uint256 afterBal = underlying.balanceOf(vault);
        if (afterBal < beforeBal) revert AccountingMismatch();
        assetsOut = afterBal - beforeBal;
        if (assetsOut < minAssetsOut) revert SlippageExceeded();
    }

    function _forceApprove(address spender, uint256 amount) internal {
        if (!underlying.approve(spender, 0)) revert ApprovalFailed();
        if (amount != 0 && !underlying.approve(spender, amount)) revert ApprovalFailed();
    }
}
