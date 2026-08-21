// SPDX-License-Identifier: MIT
pragma solidity 0.8.27;

/// @notice Minimal adapter boundary for Suwappu mixed-yield vaults.
/// @dev Strategies MUST denominate every value in the vault's underlying asset.
///      The vault is expected to be the only caller of deposit/withdraw.
interface ISuwappuYieldStrategy {
    function asset() external view returns (address);
    function vault() external view returns (address);
    function protocol() external view returns (string memory);
    function name() external view returns (string memory);

    /// @notice Mark-to-market value of this strategy in underlying asset units.
    /// @dev The vault does not trust upward jumps blindly; gains are rate-limited
    ///      during synchronization while losses are recognized immediately.
    function totalAssets() external view returns (uint256);

    /// @notice Amount that can be withdrawn synchronously right now.
    function liquidAssets() external view returns (uint256);

    /// @notice Allocate underlying assets already transferred by the vault.
    /// @param assets Amount of underlying sent to the strategy.
    /// @param data Strategy-specific calldata, e.g. protocol route parameters.
    /// @return deployed Underlying-denominated value actually deployed.
    function deposit(uint256 assets, bytes calldata data) external returns (uint256 deployed);

    /// @notice Return underlying assets to the vault.
    /// @param assets Requested underlying amount.
    /// @param minAssetsOut Minimum acceptable underlying returned.
    /// @param data Strategy-specific calldata.
    /// @return assetsOut Underlying amount returned to the vault.
    function withdraw(uint256 assets, uint256 minAssetsOut, bytes calldata data)
        external
        returns (uint256 assetsOut);

    /// @notice Emergency unwind path. Implementations MUST NOT depend on normal
    ///         allocation being enabled and MUST respect `minAssetsOut`.
    function emergencyExit(uint256 minAssetsOut, bytes calldata data)
        external
        returns (uint256 assetsOut);
}
