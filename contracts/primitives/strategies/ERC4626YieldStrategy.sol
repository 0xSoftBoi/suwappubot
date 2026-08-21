// SPDX-License-Identifier: MIT
pragma solidity 0.8.27;

import {ISuwappuYieldStrategy} from "../interfaces/ISuwappuYieldStrategy.sol";

interface IERC4626Asset {
    function balanceOf(address account) external view returns (uint256);
    function approve(address spender, uint256 amount) external returns (bool);
}

interface IERC4626Target {
    function asset() external view returns (address);
    function deposit(uint256 assets, address receiver) external returns (uint256 shares);
    function withdraw(uint256 assets, address receiver, address owner) external returns (uint256 shares);
    function redeem(uint256 shares, address receiver, address owner) external returns (uint256 assets);
    function balanceOf(address account) external view returns (uint256 shares);
    function convertToAssets(uint256 shares) external view returns (uint256 assets);
    function maxWithdraw(address owner) external view returns (uint256 assets);
}

/// @title ERC4626YieldStrategy
/// @notice Generic adapter for audited ERC-4626 vaults, including Morpho Vault-style strategies.
/// @dev Governance must still risk-classify and cap each concrete target vault independently.
contract ERC4626YieldStrategy is ISuwappuYieldStrategy {
    IERC4626Asset public immutable underlying;
    IERC4626Target public immutable target;
    address public immutable override vault;
    string public override name;
    string public override protocol;

    error Unauthorized();
    error BadParams();
    error ApprovalFailed();
    error SlippageExceeded();
    error AccountingMismatch();

    modifier onlyVault() {
        if (msg.sender != vault) revert Unauthorized();
        _;
    }

    constructor(address asset_, address vault_, address target_, string memory protocol_, string memory name_) {
        if (asset_ == address(0) || vault_ == address(0) || target_ == address(0)) revert BadParams();
        if (IERC4626Target(target_).asset() != asset_) revert BadParams();
        underlying = IERC4626Asset(asset_);
        vault = vault_;
        target = IERC4626Target(target_);
        protocol = protocol_;
        name = name_;
    }

    function asset() external view override returns (address) {
        return address(underlying);
    }

    function totalAssets() public view override returns (uint256) {
        return target.convertToAssets(target.balanceOf(address(this)));
    }

    function liquidAssets() external view override returns (uint256) {
        uint256 claim = totalAssets();
        uint256 maxNow = target.maxWithdraw(address(this));
        return claim < maxNow ? claim : maxNow;
    }

    function deposit(uint256 assets, bytes calldata) external override onlyVault returns (uint256 deployed) {
        if (assets == 0 || underlying.balanceOf(address(this)) < assets) revert AccountingMismatch();
        uint256 beforeShares = target.balanceOf(address(this));
        _forceApprove(address(target), assets);
        target.deposit(assets, address(this));
        _forceApprove(address(target), 0);
        uint256 afterShares = target.balanceOf(address(this));
        if (afterShares < beforeShares) revert AccountingMismatch();
        uint256 newValue = target.convertToAssets(afterShares - beforeShares);
        deployed = newValue < assets ? newValue : assets;
    }

    function withdraw(uint256 assets, uint256 minAssetsOut, bytes calldata)
        external
        override
        onlyVault
        returns (uint256 assetsOut)
    {
        uint256 beforeBal = underlying.balanceOf(vault);
        target.withdraw(assets, vault, address(this));
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
        uint256 shares = target.balanceOf(address(this));
        uint256 beforeBal = underlying.balanceOf(vault);
        if (shares != 0) target.redeem(shares, vault, address(this));
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
