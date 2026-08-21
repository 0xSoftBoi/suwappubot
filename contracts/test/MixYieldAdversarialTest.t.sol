// SPDX-License-Identifier: MIT
pragma solidity 0.8.27;

import "forge-std/Test.sol";
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "../primitives/SuwappuMixYieldVault.sol";
import "../primitives/interfaces/ISuwappuYieldStrategy.sol";

contract AdversarialAsset is ERC20 {
    constructor() ERC20("Adversarial USD", "aUSD") {}
    function mint(address to, uint256 amount) external { _mint(to, amount); }
    function burn(address from, uint256 amount) external { _burn(from, amount); }
}

contract AdversarialStrategy is ISuwappuYieldStrategy {
    AdversarialAsset public immutable token;
    address public immutable override vault;
    string public override protocol = "adversarial";
    string public override name = "Adversarial Strategy";

    bool public revertDeposit;
    bool public revertWithdraw;
    bool public reenterOnDeposit;
    uint256 public fakeReport;
    uint256 public fakeLiquidity;
    bool public useFakeReport;
    bool public useFakeLiquidity;

    modifier onlyVault() {
        require(msg.sender == vault, "vault");
        _;
    }

    constructor(address asset_, address vault_) {
        token = AdversarialAsset(asset_);
        vault = vault_;
    }

    function asset() external view override returns (address) { return address(token); }
    function totalAssets() public view override returns (uint256) {
        return useFakeReport ? fakeReport : token.balanceOf(address(this));
    }
    function liquidAssets() external view override returns (uint256) {
        return useFakeLiquidity ? fakeLiquidity : token.balanceOf(address(this));
    }

    function setRevertDeposit(bool value) external { revertDeposit = value; }
    function setRevertWithdraw(bool value) external { revertWithdraw = value; }
    function setReenterOnDeposit(bool value) external { reenterOnDeposit = value; }
    function setFakeReport(uint256 value, bool enabled) external { fakeReport = value; useFakeReport = enabled; }
    function setFakeLiquidity(uint256 value, bool enabled) external { fakeLiquidity = value; useFakeLiquidity = enabled; }
    function realizeLoss(uint256 amount) external { token.burn(address(this), amount); }

    function deposit(uint256 assets, bytes calldata) external override onlyVault returns (uint256) {
        if (revertDeposit) revert("deposit-frozen");
        if (reenterOnDeposit) SuwappuMixYieldVault(vault).syncAll();
        return assets;
    }

    function withdraw(uint256 assets, uint256 minAssetsOut, bytes calldata)
        external
        override
        onlyVault
        returns (uint256 assetsOut)
    {
        if (revertWithdraw) revert("withdraw-frozen");
        uint256 bal = token.balanceOf(address(this));
        assetsOut = assets < bal ? assets : bal;
        require(assetsOut >= minAssetsOut, "slippage");
        if (assetsOut != 0) token.transfer(vault, assetsOut);
    }

    function emergencyExit(uint256 minAssetsOut, bytes calldata)
        external
        override
        onlyVault
        returns (uint256 assetsOut)
    {
        if (revertWithdraw) revert("withdraw-frozen");
        assetsOut = token.balanceOf(address(this));
        require(assetsOut >= minAssetsOut, "slippage");
        if (assetsOut != 0) token.transfer(vault, assetsOut);
    }
}

contract MixYieldAdversarialTest is Test {
    AdversarialAsset asset;
    SuwappuMixYieldVault vault;
    AdversarialStrategy strategy;

    address owner = address(0xA11CE);
    address allocator = address(0xA110C);
    address alice = address(0xB0B);

    function setUp() public {
        asset = new AdversarialAsset();
        vault = new SuwappuMixYieldVault(
            address(asset), "Suwappu Mix USD", "mixUSD", owner, allocator, 1 hours, 1_000
        );
        strategy = new AdversarialStrategy(address(asset), address(vault));
        asset.mint(alice, 10_000e18);
        vm.prank(alice);
        asset.approve(address(vault), type(uint256).max);

        vm.prank(owner);
        vault.submitStrategyConfig(
            address(strategy), true, SuwappuMixYieldVault.RiskClass.Conservative, 10_000
        );
        vm.warp(block.timestamp + 1 hours);
        vault.executeStrategyConfig(address(strategy));
    }

    function _deposit(uint256 amount) internal {
        vm.prank(alice);
        vault.deposit(amount, alice);
    }

    function _allocate(uint256 amount) internal {
        vm.prank(allocator);
        vault.allocate(address(strategy), amount, "");
    }

    function test_RevertingDepositIsAtomic() public {
        _deposit(1_000e18);
        strategy.setRevertDeposit(true);
        vm.prank(allocator);
        vm.expectRevert(bytes("deposit-frozen"));
        vault.allocate(address(strategy), 500e18, "");

        assertEq(vault.idleAssets(), 1_000e18);
        assertEq(asset.balanceOf(address(strategy)), 0);
        (, , , , , uint256 accounted) = vault.strategyConfig(address(strategy));
        assertEq(accounted, 0);
    }

    function test_ReentrantAdapterCannotEnterVault() public {
        _deposit(1_000e18);
        strategy.setReenterOnDeposit(true);
        vm.prank(allocator);
        vm.expectRevert();
        vault.allocate(address(strategy), 500e18, "");
        assertEq(vault.idleAssets(), 1_000e18);
        assertEq(asset.balanceOf(address(strategy)), 0);
    }

    function test_MaxUintNavLieIsRateLimited() public {
        _deposit(1_000e18);
        _allocate(500e18);
        strategy.setFakeReport(type(uint256).max, true);

        vault.syncStrategy(address(strategy));
        assertEq(vault.totalAssets(), 1_000e18);

        vm.warp(block.timestamp + 1 days);
        vault.syncStrategy(address(strategy));
        assertEq(vault.totalAssets(), 1_050e18);
    }

    function test_FakeLiquidityCannotStealSharesOnFailedWithdrawal() public {
        _deposit(1_000e18);
        _allocate(900e18);
        strategy.setFakeLiquidity(900e18, true);
        strategy.setRevertWithdraw(true);

        uint256 sharesBefore = vault.balanceOf(alice);
        uint256 assetsBefore = asset.balanceOf(alice);
        assertEq(vault.maxWithdraw(alice), 1_000e18);

        vm.prank(alice);
        vm.expectRevert(bytes("withdraw-frozen"));
        vault.withdraw(500e18, alice, alice);

        assertEq(vault.balanceOf(alice), sharesBefore);
        assertEq(asset.balanceOf(alice), assetsBefore);
        assertEq(vault.totalAssets(), 1_000e18);
    }

    function test_KilledFrozenStrategyDoesNotBlockIdleWithdrawal() public {
        _deposit(1_000e18);
        _allocate(800e18);
        strategy.setRevertWithdraw(true);
        vm.prank(owner);
        vault.killStrategy(address(strategy));

        vm.prank(alice);
        vault.withdraw(200e18, alice, alice);
        assertEq(vault.totalAssets(), 800e18);

        vm.prank(owner);
        vm.expectRevert(bytes("withdraw-frozen"));
        vault.emergencyExit(address(strategy), 0, "");
        assertEq(vault.totalAssets(), 800e18);
    }

    function test_RealLossOverridesPriorFakeGainImmediately() public {
        _deposit(1_000e18);
        _allocate(500e18);
        strategy.setFakeReport(1_000e18, true);
        vm.warp(block.timestamp + 1 days);
        vault.syncStrategy(address(strategy));
        assertEq(vault.totalAssets(), 1_050e18);

        strategy.setFakeReport(0, false);
        strategy.realizeLoss(200e18);
        vault.syncStrategy(address(strategy));
        assertEq(vault.totalAssets(), 800e18);
    }
}
