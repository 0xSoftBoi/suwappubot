// SPDX-License-Identifier: MIT
pragma solidity 0.8.27;

import {ISuwappuYieldStrategy} from "../interfaces/ISuwappuYieldStrategy.sol";

interface IAaveAsset {
    function balanceOf(address account) external view returns (uint256);
    function approve(address spender, uint256 amount) external returns (bool);
    function transfer(address to, uint256 amount) external returns (bool);
}

interface IAaveAToken {
    function balanceOf(address account) external view returns (uint256);
    function UNDERLYING_ASSET_ADDRESS() external view returns (address);
}

interface IAaveV3Pool {
    function supply(address asset, uint256 amount, address onBehalfOf, uint16 referralCode) external;
    function withdraw(address asset, uint256 amount, address to) external returns (uint256);
}

contract AaveV3YieldStrategy is ISuwappuYieldStrategy {
    uint256 internal constant MAX_SUPPLY_ROUNDING_LOSS = 1;

    IAaveAsset public immutable underlying;
    IAaveAToken public immutable aToken;
    IAaveV3Pool public immutable pool;
    address public immutable override vault;
    string public override name;
    string public constant override protocol = "aave-v3";

    error Unauthorized();
    error BadParams();
    error ApprovalFailed();
    error TransferFailed();
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

    function totalAssets() public view override returns (uint256) {
        return underlying.balanceOf(address(this)) + aToken.balanceOf(address(this));
    }

    function liquidAssets() external view override returns (uint256) {
        uint256 idle = underlying.balanceOf(address(this));
        uint256 claim = aToken.balanceOf(address(this));
        uint256 reserveCash = underlying.balanceOf(address(aToken));
        return idle + (claim < reserveCash ? claim : reserveCash);
    }

    function deposit(uint256 assets, bytes calldata) external override onlyVault returns (uint256 deployed) {
        if (assets == 0 || underlying.balanceOf(address(this)) < assets) revert AccountingMismatch();
        uint256 beforeAssets = totalAssets();
        _forceApprove(address(pool), assets);
        pool.supply(address(underlying), assets, address(this), 0);
        _forceApprove(address(pool), 0);
        uint256 afterAssets = totalAssets();

        // Aave's scaled-balance conversion can round a supply down by one unit of the
        // underlying token. Treat exactly that protocol rounding as realized loss and
        // let the parent vault's immediate-loss sync account for it. Anything larger
        // is unexpected and remains a hard failure.
        if (afterAssets < beforeAssets) {
            uint256 loss = beforeAssets - afterAssets;
            if (loss > MAX_SUPPLY_ROUNDING_LOSS) revert AccountingMismatch();
            deployed = assets - loss;
        } else {
            deployed = assets;
        }
    }

    function withdraw(uint256 assets, uint256 minAssetsOut, bytes calldata)
        external
        override
        onlyVault
        returns (uint256 assetsOut)
    {
        uint256 beforeBal = underlying.balanceOf(vault);
        uint256 idle = underlying.balanceOf(address(this));
        uint256 fromIdle = idle < assets ? idle : assets;
        if (fromIdle != 0 && !underlying.transfer(vault, fromIdle)) revert TransferFailed();
        uint256 remaining = assets - fromIdle;
        if (remaining != 0) pool.withdraw(address(underlying), remaining, vault);
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
        uint256 idle = underlying.balanceOf(address(this));
        if (idle != 0 && !underlying.transfer(vault, idle)) revert TransferFailed();
        if (aToken.balanceOf(address(this)) != 0) {
            pool.withdraw(address(underlying), type(uint256).max, vault);
        }
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
