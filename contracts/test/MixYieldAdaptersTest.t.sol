// SPDX-License-Identifier: MIT
pragma solidity 0.8.27;

import "forge-std/Test.sol";
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "../primitives/SuwappuMixYieldVault.sol";
import "../primitives/strategies/AaveV3YieldStrategy.sol";
import "../primitives/strategies/ERC4626YieldStrategy.sol";

contract AdapterAssetMock is ERC20 {
    constructor() ERC20("Mock USD", "mUSD") {}
    function mint(address to, uint256 amount) external { _mint(to, amount); }
}

contract MockAToken is ERC20 {
    address public immutable UNDERLYING_ASSET_ADDRESS;
    address public pool;

    constructor(address asset_) ERC20("Aave Mock USD", "amUSD") {
        UNDERLYING_ASSET_ADDRESS = asset_;
    }

    function setPool(address pool_) external {
        require(pool == address(0));
        pool = pool_;
    }

    function mintTo(address to, uint256 amount) external {
        require(msg.sender == pool);
        _mint(to, amount);
    }

    function burnFrom(address from, uint256 amount) external {
        require(msg.sender == pool);
        _burn(from, amount);
    }

    function sendUnderlying(address to, uint256 amount) external {
        require(msg.sender == pool);
        ERC20(UNDERLYING_ASSET_ADDRESS).transfer(to, amount);
    }
}

contract MockAavePool {
    AdapterAssetMock public immutable assetToken;
    MockAToken public immutable receipt;

    constructor(address asset_, address aToken_) {
        assetToken = AdapterAssetMock(asset_);
        receipt = MockAToken(aToken_);
    }

    function supply(address asset, uint256 amount, address onBehalfOf, uint16) external {
        require(asset == address(assetToken));
        assetToken.transferFrom(msg.sender, address(receipt), amount);
        receipt.mintTo(onBehalfOf, amount);
    }

    function withdraw(address asset, uint256 amount, address to) external returns (uint256 out) {
        require(asset == address(assetToken));
        uint256 claim = receipt.balanceOf(msg.sender);
        out = amount == type(uint256).max ? claim : amount;
        require(out <= claim);
        require(out <= assetToken.balanceOf(address(receipt)), "reserve-liquidity");
        receipt.burnFrom(msg.sender, out);
        receipt.sendUnderlying(to, out);
    }

    function drainReserve(address to, uint256 amount) external {
        receipt.sendUnderlying(to, amount);
    }
}

contract MockERC4626Target is ERC20 {
    AdapterAssetMock public immutable underlying;
    uint256 public liquidityCap = type(uint256).max;

    constructor(address asset_) ERC20("Morpho Mock Vault", "mmUSD") {
        underlying = AdapterAssetMock(asset_);
    }

    function asset() external view returns (address) { return address(underlying); }
    function convertToAssets(uint256 shares) external pure returns (uint256) { return shares; }

    function maxWithdraw(address owner) external view returns (uint256) {
        uint256 claim = balanceOf(owner);
        uint256 cash = underlying.balanceOf(address(this));
        uint256 cap = liquidityCap < cash ? liquidityCap : cash;
        return claim < cap ? claim : cap;
    }

    function setLiquidityCap(uint256 cap) external { liquidityCap = cap; }

    function deposit(uint256 assets, address receiver) external returns (uint256 shares) {
        underlying.transferFrom(msg.sender, address(this), assets);
        _mint(receiver, assets);
        return assets;
    }

    function withdraw(uint256 assets, address receiver, address owner) external returns (uint256 shares) {
        uint256 maxNow = this.maxWithdraw(owner);
        require(assets <= maxNow, "illiquid");
        if (msg.sender != owner) _spendAllowance(owner, msg.sender, assets);
        _burn(owner, assets);
        underlying.transfer(receiver, assets);
        return assets;
    }

    function redeem(uint256 shares, address receiver, address owner) external returns (uint256 assets) {
        uint256 maxNow = this.maxWithdraw(owner);
        require(shares <= maxNow, "illiquid");
        if (msg.sender != owner) _spendAllowance(owner, msg.sender, shares);
        _burn(owner, shares);
        underlying.transfer(receiver, shares);
        return shares;
    }
}

contract MixYieldAdaptersTest is Test {
    AdapterAssetMock asset;
    SuwappuMixYieldVault vault;
    address owner = address(0xA11CE);
    address allocator = address(0xA110C);
    address alice = address(0xB0B);

    function setUp() public {
        asset = new AdapterAssetMock();
        vault = new SuwappuMixYieldVault(
            address(asset), "Suwappu Mix USD", "mixUSD", owner, allocator, 1 hours, 1_000
        );
        asset.mint(alice, 10_000e18);
        vm.prank(alice);
        asset.approve(address(vault), type(uint256).max);
    }

    function _configure(address strategy, SuwappuMixYieldVault.RiskClass risk, uint16 cap) internal {
        vm.prank(owner);
        vault.submitStrategyConfig(strategy, true, risk, cap);
        vm.warp(block.timestamp + 1 hours);
        vault.executeStrategyConfig(strategy);
    }

    function _deposit(uint256 amount) internal {
        vm.prank(alice);
        vault.deposit(amount, alice);
    }

    function test_AaveAdapterTracksReserveLiquidityAndWithdraws() public {
        MockAToken aToken = new MockAToken(address(asset));
        MockAavePool pool = new MockAavePool(address(asset), address(aToken));
        aToken.setPool(address(pool));
        AaveV3YieldStrategy strategy = new AaveV3YieldStrategy(
            address(asset), address(vault), address(pool), address(aToken), "Aave v3 mUSD"
        );
        _configure(address(strategy), SuwappuMixYieldVault.RiskClass.Conservative, 10_000);
        _deposit(1_000e18);

        vm.prank(allocator);
        vault.allocate(address(strategy), 600e18, "");
        assertEq(strategy.totalAssets(), 600e18);
        assertEq(strategy.liquidAssets(), 600e18);

        pool.drainReserve(address(0xD1), 500e18);
        assertEq(strategy.totalAssets(), 600e18);
        assertEq(strategy.liquidAssets(), 100e18);
        assertEq(vault.maxWithdraw(alice), 500e18); // 400 idle + 100 synchronously liquid

        vm.prank(alice);
        vault.withdraw(500e18, alice, alice);
        assertEq(vault.totalAssets(), 500e18);
        assertEq(asset.balanceOf(alice), 9_500e18);
    }

    function test_ERC4626AdapterHonorsTargetMaxWithdraw() public {
        MockERC4626Target target = new MockERC4626Target(address(asset));
        ERC4626YieldStrategy strategy = new ERC4626YieldStrategy(
            address(asset), address(vault), address(target), "morpho-vault", "Morpho mUSD"
        );
        _configure(address(strategy), SuwappuMixYieldVault.RiskClass.Moderate, 2_500);
        _deposit(1_000e18);

        vm.prank(allocator);
        vault.allocate(address(strategy), 250e18, "");
        target.setLiquidityCap(50e18);

        assertEq(strategy.totalAssets(), 250e18);
        assertEq(strategy.liquidAssets(), 50e18);
        assertEq(vault.maxWithdraw(alice), 800e18); // 750 idle + 50 target liquidity

        vm.prank(alice);
        vault.withdraw(800e18, alice, alice);
        assertEq(vault.totalAssets(), 200e18);
    }

    function test_AdaptersRejectDirectExternalWithdrawals() public {
        MockERC4626Target target = new MockERC4626Target(address(asset));
        ERC4626YieldStrategy strategy = new ERC4626YieldStrategy(
            address(asset), address(vault), address(target), "morpho-vault", "Morpho mUSD"
        );
        vm.expectRevert(ERC4626YieldStrategy.Unauthorized.selector);
        strategy.withdraw(1, 0, "");
    }
}
