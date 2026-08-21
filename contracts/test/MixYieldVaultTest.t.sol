// SPDX-License-Identifier: MIT
pragma solidity 0.8.27;

import "forge-std/Test.sol";
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "../primitives/SuwappuMixYieldVault.sol";
import "../primitives/interfaces/ISuwappuYieldStrategy.sol";

contract MixAssetMock is ERC20 {
    constructor() ERC20("Mock USD", "mUSD") {}
    function mint(address to, uint256 amount) external { _mint(to, amount); }
    function burn(address from, uint256 amount) external { _burn(from, amount); }
}

contract MixStrategyMock is ISuwappuYieldStrategy {
    MixAssetMock public immutable token;
    address public immutable override vault;
    string public override protocol = "mock";
    string public override name;
    uint256 public liquidityCap = type(uint256).max;
    uint16 public withdrawalHaircutBps;

    modifier onlyVault() {
        require(msg.sender == vault, "vault");
        _;
    }

    constructor(address asset_, address vault_, string memory name_) {
        token = MixAssetMock(asset_);
        vault = vault_;
        name = name_;
    }

    function asset() external view override returns (address) { return address(token); }
    function totalAssets() public view override returns (uint256) { return token.balanceOf(address(this)); }
    function liquidAssets() external view override returns (uint256) {
        uint256 bal = token.balanceOf(address(this));
        return bal < liquidityCap ? bal : liquidityCap;
    }

    function setLiquidityCap(uint256 cap) external { liquidityCap = cap; }
    function setWithdrawalHaircut(uint16 bps) external { require(bps <= 5_000); withdrawalHaircutBps = bps; }
    function mintYield(uint256 amount) external { token.mint(address(this), amount); }
    function realizeLoss(uint256 amount) external { token.burn(address(this), amount); }

    function deposit(uint256 assets, bytes calldata) external onlyVault returns (uint256 deployed) {
        return assets;
    }

    function withdraw(uint256 assets, uint256 minAssetsOut, bytes calldata)
        external
        onlyVault
        returns (uint256 assetsOut)
    {
        uint256 cap = token.balanceOf(address(this));
        if (cap > liquidityCap) cap = liquidityCap;
        assetsOut = assets < cap ? assets : cap;
        assetsOut = assetsOut * (10_000 - withdrawalHaircutBps) / 10_000;
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

contract MixYieldVaultTest is Test {
    MixAssetMock asset;
    SuwappuMixYieldVault vault;
    MixStrategyMock conservative;
    MixStrategyMock moderateA;
    MixStrategyMock moderateB;
    MixStrategyMock aggressive;

    address owner = address(0xA11CE);
    address allocator = address(0xA110C);
    address alice = address(0xB0B);

    function setUp() public {
        asset = new MixAssetMock();
        vault = new SuwappuMixYieldVault(
            address(asset), "Suwappu Mix USD", "mixUSD", owner, allocator, 1 hours, 1_000
        );
        conservative = new MixStrategyMock(address(asset), address(vault), "Conservative");
        moderateA = new MixStrategyMock(address(asset), address(vault), "Moderate A");
        moderateB = new MixStrategyMock(address(asset), address(vault), "Moderate B");
        aggressive = new MixStrategyMock(address(asset), address(vault), "Aggressive");

        asset.mint(alice, 10_000e18);
        vm.prank(alice);
        asset.approve(address(vault), type(uint256).max);

        _configure(address(conservative), SuwappuMixYieldVault.RiskClass.Conservative, 10_000);
        _configure(address(moderateA), SuwappuMixYieldVault.RiskClass.Moderate, 2_500);
        _configure(address(moderateB), SuwappuMixYieldVault.RiskClass.Moderate, 2_500);
        _configure(address(aggressive), SuwappuMixYieldVault.RiskClass.Aggressive, 1_000);
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

    function test_ERC4626IdleRoundTrip() public {
        _deposit(1_000e18);
        assertEq(vault.balanceOf(alice), 1_000e18);
        assertEq(vault.totalAssets(), 1_000e18);

        vm.prank(alice);
        uint256 assetsOut = vault.redeem(250e18, alice, alice);
        assertEq(assetsOut, 250e18);
        assertEq(vault.totalAssets(), 750e18);
    }

    function test_ModerateIndividualAndAggregateCaps() public {
        _deposit(1_000e18);
        vm.startPrank(allocator);
        vault.allocate(address(moderateA), 250e18, "");
        vault.allocate(address(moderateB), 150e18, "");
        assertEq(vault.tierAllocationBps(SuwappuMixYieldVault.RiskClass.Moderate), 4_000);
        assertTrue(vault.riskCapsHealthy());

        vm.expectRevert(SuwappuMixYieldVault.RiskCapExceeded.selector);
        vault.allocate(address(moderateB), 1e18, "");
        vm.stopPrank();
    }

    function test_AggressiveTierCappedAtTenPercent() public {
        _deposit(1_000e18);
        vm.startPrank(allocator);
        vault.allocate(address(aggressive), 100e18, "");
        assertEq(vault.tierAllocationBps(SuwappuMixYieldVault.RiskClass.Aggressive), 1_000);
        vm.expectRevert(SuwappuMixYieldVault.RiskCapExceeded.selector);
        vault.allocate(address(aggressive), 1e18, "");
        vm.stopPrank();
    }

    function test_LossRecognizedImmediately() public {
        _deposit(1_000e18);
        vm.prank(allocator);
        vault.allocate(address(conservative), 500e18, "");
        conservative.realizeLoss(100e18);
        vault.syncStrategy(address(conservative));
        assertEq(vault.totalAssets(), 900e18);
        assertEq(vault.convertToAssets(vault.balanceOf(alice)), 900e18);
    }

    function test_ReportedGainCannotSpikeSharePrice() public {
        _deposit(1_000e18);
        vm.prank(allocator);
        vault.allocate(address(conservative), 500e18, "");

        conservative.mintYield(500e18); // strategy claims +100% instantly
        vault.syncStrategy(address(conservative));
        assertEq(vault.totalAssets(), 1_000e18); // zero elapsed => no gain admitted

        vm.warp(block.timestamp + 1 days);
        vault.syncStrategy(address(conservative));
        assertEq(vault.totalAssets(), 1_050e18); // 10%/day cap on the 500 accounted
    }

    function test_MaxWithdrawReportsOnlyImmediateLiquidity() public {
        _deposit(1_000e18);
        vm.prank(allocator);
        vault.allocate(address(conservative), 800e18, "");
        conservative.setLiquidityCap(100e18);
        assertEq(vault.liquidAssets(), 300e18);
        assertEq(vault.maxWithdraw(alice), 300e18);

        vm.prank(alice);
        vault.withdraw(300e18, alice, alice);
        assertEq(vault.totalAssets(), 700e18);
    }

    function test_KillStopsAllocationButAllowsDeallocation() public {
        _deposit(1_000e18);
        vm.prank(allocator);
        vault.allocate(address(conservative), 500e18, "");

        vm.prank(owner);
        vault.killStrategy(address(conservative));

        vm.prank(allocator);
        vm.expectRevert(SuwappuMixYieldVault.StrategyKilledError.selector);
        vault.allocate(address(conservative), 1e18, "");

        vm.prank(allocator);
        uint256 out = vault.deallocate(address(conservative), 100e18, 100e18, "");
        assertEq(out, 100e18);
    }

    function test_DeallocationUsesMeasuredOutputAndSlippageFloor() public {
        _deposit(1_000e18);
        vm.prank(allocator);
        vault.allocate(address(conservative), 500e18, "");
        conservative.setWithdrawalHaircut(500); // 5%

        vm.prank(allocator);
        vm.expectRevert();
        vault.deallocate(address(conservative), 100e18, 100e18, "");

        vm.prank(allocator);
        uint256 out = vault.deallocate(address(conservative), 100e18, 95e18, "");
        assertEq(out, 95e18);
        assertEq(vault.idleAssets(), 595e18);
        assertEq(vault.totalAssets(), 995e18); // 5 asset loss recognized
    }

    function test_StrategyOnboardingIsTimelocked() public {
        MixStrategyMock fresh = new MixStrategyMock(address(asset), address(vault), "Fresh");
        vm.prank(owner);
        vault.submitStrategyConfig(
            address(fresh), true, SuwappuMixYieldVault.RiskClass.Conservative, 10_000
        );
        vm.expectRevert(SuwappuMixYieldVault.TimelockNotReady.selector);
        vault.executeStrategyConfig(address(fresh));
        vm.warp(block.timestamp + 1 hours);
        vault.executeStrategyConfig(address(fresh));
        (bool enabled,,,,) = vault.strategyConfig(address(fresh));
        assertTrue(enabled);
    }

    function test_EmergencyExitCanRealizePreviouslyUnaccountedGain() public {
        _deposit(1_000e18);
        vm.prank(allocator);
        vault.allocate(address(conservative), 500e18, "");
        conservative.mintYield(100e18);

        vm.prank(owner);
        vault.killStrategy(address(conservative));
        vm.prank(owner);
        uint256 out = vault.emergencyExit(address(conservative), 590e18, "");
        assertEq(out, 600e18);
        assertEq(vault.totalAssets(), 1_100e18); // gain is now real underlying in the vault
    }
}
