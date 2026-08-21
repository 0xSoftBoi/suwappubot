// SPDX-License-Identifier: MIT
pragma solidity 0.8.27;

import "forge-std/Test.sol";
import "forge-std/StdInvariant.sol";
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "../primitives/SuwappuMixYieldVault.sol";
import "../primitives/interfaces/ISuwappuYieldStrategy.sol";

contract InvariantAsset is ERC20 {
    constructor() ERC20("Invariant USD", "iUSD") {}

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }
}

contract InvariantStrategy is ISuwappuYieldStrategy {
    InvariantAsset public immutable token;
    address public immutable override vault;
    string public override protocol = "invariant";
    string public override name = "Invariant Conservative";

    modifier onlyVault() {
        require(msg.sender == vault, "vault");
        _;
    }

    constructor(address asset_, address vault_) {
        token = InvariantAsset(asset_);
        vault = vault_;
    }

    function asset() external view override returns (address) {
        return address(token);
    }

    function totalAssets() external view override returns (uint256) {
        return token.balanceOf(address(this));
    }

    function liquidAssets() external view override returns (uint256) {
        return token.balanceOf(address(this));
    }

    function deposit(uint256 assets, bytes calldata) external onlyVault returns (uint256) {
        return assets;
    }

    function withdraw(uint256 assets, uint256 minAssetsOut, bytes calldata)
        external
        onlyVault
        returns (uint256 assetsOut)
    {
        uint256 balance = token.balanceOf(address(this));
        assetsOut = assets < balance ? assets : balance;
        require(assetsOut >= minAssetsOut, "slippage");
        token.transfer(vault, assetsOut);
    }

    function emergencyExit(uint256 minAssetsOut, bytes calldata)
        external
        onlyVault
        returns (uint256 assetsOut)
    {
        assetsOut = token.balanceOf(address(this));
        require(assetsOut >= minAssetsOut, "slippage");
        token.transfer(vault, assetsOut);
    }
}

contract MixYieldHandler is Test {
    InvariantAsset public immutable assetToken;
    SuwappuMixYieldVault public immutable mixVault;
    InvariantStrategy public immutable strategy;
    address public immutable allocator;
    address public immutable actor;

    constructor(
        InvariantAsset asset_,
        SuwappuMixYieldVault vault_,
        InvariantStrategy strategy_,
        address allocator_,
        address actor_
    ) {
        assetToken = asset_;
        mixVault = vault_;
        strategy = strategy_;
        allocator = allocator_;
        actor = actor_;
    }

    function deposit(uint96 raw) external {
        uint256 assets = bound(uint256(raw), 1, 1_000_000e18);
        assetToken.mint(actor, assets);
        vm.startPrank(actor);
        assetToken.approve(address(mixVault), type(uint256).max);
        mixVault.deposit(assets, actor);
        vm.stopPrank();
    }

    function allocate(uint96 raw) external {
        uint256 idle = mixVault.idleAssets();
        if (idle == 0) return;
        uint256 assets = bound(uint256(raw), 1, idle);
        vm.prank(allocator);
        mixVault.allocate(address(strategy), assets, "");
    }

    function deallocate(uint96 raw) external {
        (,,,,, uint256 accountedAssets) = mixVault.strategyConfig(address(strategy));
        if (accountedAssets == 0) return;
        uint256 assets = bound(uint256(raw), 1, accountedAssets);
        vm.prank(allocator);
        mixVault.deallocate(address(strategy), assets, 0, "");
    }

    function redeem(uint96 raw) external {
        uint256 shares = mixVault.balanceOf(actor);
        if (shares == 0) return;
        uint256 maxShares = mixVault.maxRedeem(actor);
        if (maxShares == 0) return;
        uint256 amount = bound(uint256(raw), 1, maxShares < shares ? maxShares : shares);
        vm.prank(actor);
        mixVault.redeem(amount, actor, actor);
    }
}

contract MixYieldVaultInvariant is StdInvariant, Test {
    InvariantAsset assetToken;
    SuwappuMixYieldVault mixVault;
    InvariantStrategy strategy;
    MixYieldHandler handler;

    address owner = address(0xA11CE);
    address allocator = address(0xA110C);
    address actor = address(0xB0B);

    function setUp() public {
        assetToken = new InvariantAsset();
        mixVault = new SuwappuMixYieldVault(
            address(assetToken), "Invariant Mix", "imix", owner, allocator, 1 hours, 1_000
        );
        strategy = new InvariantStrategy(address(assetToken), address(mixVault));

        vm.prank(owner);
        mixVault.submitStrategyConfig(
            address(strategy), true, SuwappuMixYieldVault.RiskClass.Conservative, 10_000
        );
        vm.warp(block.timestamp + 1 hours);
        mixVault.executeStrategyConfig(address(strategy));

        handler = new MixYieldHandler(assetToken, mixVault, strategy, allocator, actor);
        targetContract(address(handler));
    }

    function invariant_accountingIdentityHolds() public view {
        assertEq(mixVault.totalAssets(), mixVault.idleAssets() + mixVault.accountedStrategyAssets());
    }

    function invariant_idleAssetsArePhysicallyBacked() public view {
        assertGe(assetToken.balanceOf(address(mixVault)), mixVault.idleAssets());
    }

    function invariant_strategyAccountingMatchesAggregate() public view {
        (,,,,, uint256 accountedAssets) = mixVault.strategyConfig(address(strategy));
        assertEq(accountedAssets, mixVault.accountedStrategyAssets());
    }

    function invariant_withdrawLimitNeverExceedsLiquidAssets() public view {
        assertLe(mixVault.maxWithdraw(actor), mixVault.liquidAssets());
    }

    function invariant_conservativePortfolioRemainsWithinCaps() public view {
        assertTrue(mixVault.riskCapsHealthy());
    }
}
