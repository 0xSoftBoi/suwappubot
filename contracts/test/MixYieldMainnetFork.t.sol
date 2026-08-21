// SPDX-License-Identifier: MIT
pragma solidity 0.8.27;

import "forge-std/Test.sol";
import "../primitives/SuwappuMixYieldVault.sol";
import "../primitives/strategies/AaveV3YieldStrategy.sol";
import "../primitives/strategies/ERC4626YieldStrategy.sol";

interface IERC20Fork {
    function approve(address spender, uint256 amount) external returns (bool);
    function balanceOf(address account) external view returns (uint256);
    function decimals() external view returns (uint8);
}

/// @notice Ethereum live-head integration tests against deployed protocols.
/// @dev These are intentionally run against current mainnet state in CI. A historical archive RPC can
///      additionally pin replay blocks later; protocol fixture assertions make migrations fail loudly.
contract MixYieldMainnetForkTest is Test {
    address constant USDC = 0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48;
    address constant AAVE_V3_POOL = 0x87870Bca3F3fD6335C3F4ce8392D69350B4fA4E2;
    address constant AAVE_V3_AUSDC = 0x98C23E9d8f34FEFb1B7BD6a91B7FF122F4e16F5c;
    address constant MORPHO_USDC_VAULT = 0xBEEF01735c132Ada46AA9aA4c54623cAA92A64CB;

    address owner = address(0xA11CE);
    address allocator = address(0xA110C);
    address alice = address(0xB0B);

    function _newVault() internal returns (SuwappuMixYieldVault vault) {
        vault = new SuwappuMixYieldVault(
            USDC, "Suwappu Mix USDC", "mixUSDC", owner, allocator, 1 hours, 1_000
        );
    }

    function _configure(
        SuwappuMixYieldVault vault,
        address strategy,
        SuwappuMixYieldVault.RiskClass risk,
        uint16 cap
    ) internal {
        vm.prank(owner);
        vault.submitStrategyConfig(strategy, true, risk, cap);
        vm.warp(block.timestamp + 1 hours);
        vault.executeStrategyConfig(strategy);
    }

    function _fundAndDeposit(SuwappuMixYieldVault vault, uint256 amount) internal {
        deal(USDC, alice, amount, true);
        vm.startPrank(alice);
        IERC20Fork(USDC).approve(address(vault), type(uint256).max);
        vault.deposit(amount, alice);
        vm.stopPrank();
    }

    function testFork_AaveV3SupplyWithdrawRoundTrip() public {
        assertEq(block.chainid, 1, "ethereum fork required");
        assertEq(IERC20Fork(USDC).decimals(), 6);

        SuwappuMixYieldVault vault = _newVault();
        AaveV3YieldStrategy strategy = new AaveV3YieldStrategy(
            USDC, address(vault), AAVE_V3_POOL, AAVE_V3_AUSDC, "Aave V3 USDC"
        );
        _configure(vault, address(strategy), SuwappuMixYieldVault.RiskClass.Conservative, 10_000);
        _fundAndDeposit(vault, 1_000_000e6);

        vm.prank(allocator);
        vault.allocate(address(strategy), 600_000e6, "");

        assertApproxEqAbs(strategy.totalAssets(), 600_000e6, 1, "aUSDC supply rounding");
        assertGt(strategy.liquidAssets(), 0, "Aave reserve should expose cash");
        assertApproxEqAbs(vault.totalAssets(), 1_000_000e6, 1, "Aave rounding must hit NAV");

        uint256 aliceBefore = IERC20Fork(USDC).balanceOf(alice);
        vm.prank(allocator);
        uint256 out = vault.deallocate(address(strategy), 100_000e6, 99_999e6, "");
        assertGe(out, 99_999e6);
        assertEq(IERC20Fork(USDC).balanceOf(alice), aliceBefore);
        assertApproxEqAbs(vault.totalAssets(), 1_000_000e6, 3, "round-trip NAV");

        vm.prank(alice);
        vault.withdraw(500_000e6, alice, alice);
        assertEq(IERC20Fork(USDC).balanceOf(alice), aliceBefore + 500_000e6);
    }

    function testFork_MorphoERC4626DepositWithdrawRoundTrip() public {
        assertEq(block.chainid, 1, "ethereum fork required");
        assertEq(IERC4626Target(MORPHO_USDC_VAULT).asset(), USDC, "Morpho fixture asset changed");

        SuwappuMixYieldVault vault = _newVault();
        ERC4626YieldStrategy strategy = new ERC4626YieldStrategy(
            USDC, address(vault), MORPHO_USDC_VAULT, "morpho-v1", "Morpho USDC"
        );
        _configure(vault, address(strategy), SuwappuMixYieldVault.RiskClass.Moderate, 2_500);
        _fundAndDeposit(vault, 1_000_000e6);

        vm.prank(allocator);
        vault.allocate(address(strategy), 250_000e6, "");

        assertGt(strategy.totalAssets(), 249_999e6, "Morpho shares should represent deposit");
        assertLe(strategy.totalAssets(), 250_001e6, "unexpected deposit value drift");
        assertLe(strategy.liquidAssets(), strategy.totalAssets());
        assertTrue(vault.riskCapsHealthy());

        uint256 liquid = strategy.liquidAssets();
        assertGt(liquid, 1e6, "Morpho fixture unexpectedly frozen");
        uint256 ask = liquid > 50_000e6 ? 50_000e6 : liquid / 2;

        vm.prank(allocator);
        uint256 out = vault.deallocate(address(strategy), ask, ask - 2, "");
        assertGe(out, ask - 2);
        assertTrue(vault.riskCapsHealthy());
    }

    function testFork_ProtocolLiquidityBoundsPortfolioWithdrawals() public {
        SuwappuMixYieldVault vault = _newVault();
        ERC4626YieldStrategy strategy = new ERC4626YieldStrategy(
            USDC, address(vault), MORPHO_USDC_VAULT, "morpho-v1", "Morpho USDC"
        );
        _configure(vault, address(strategy), SuwappuMixYieldVault.RiskClass.Moderate, 2_500);
        _fundAndDeposit(vault, 1_000_000e6);

        vm.prank(allocator);
        vault.allocate(address(strategy), 250_000e6, "");

        uint256 expected = 750_000e6 + strategy.liquidAssets();
        if (expected > vault.totalAssets()) expected = vault.totalAssets();
        assertEq(vault.maxWithdraw(alice), expected, "portfolio must honor protocol liquidity");
    }
}
