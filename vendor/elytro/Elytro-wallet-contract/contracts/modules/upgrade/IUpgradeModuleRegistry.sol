// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/**
 * @title IUpgradeModuleRegistry
 * @notice Interface for the upgrade module registry that tracks version history
 */
interface IUpgradeModuleRegistry {
    struct VersionData {
        uint256 timestamp;
        address moduleAddress;
        string infoUrl;
    }

    event VersionAdded(uint256 indexed versionIndex, address indexed moduleAddress);

    function latestVersion() external view returns (uint256);

    /**
     * @notice Add a new version to the registry
     * @param moduleAddress Address of the upgrade module for this version
     * @param infoUrl URL pointing to IPFS or other storage containing detailed version information
     * @return versionIndex The index of the newly added version
     */
    function addVersion(address moduleAddress, string calldata infoUrl) external returns (uint256 versionIndex);

    function getVersionInfo(uint256 versionIndex) external view returns (VersionData memory);

    function getVersionCount() external view returns (uint256);
}
