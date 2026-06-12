// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "./IUpgradeModuleRegistry.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

/**
 * @title UpgradeModuleRegistry
 * @notice Registry for tracking upgrade module versions and their history
 * @dev This contract serves as a version registry
 */
contract UpgradeModuleRegistry is IUpgradeModuleRegistry, Ownable {
    VersionData[] private _versions;

    constructor(address initialOwner) Ownable(initialOwner) {}

    function latestVersion() external view override returns (uint256) {
        if (_versions.length == 0) {
            return 0;
        }
        return _versions.length - 1;
    }

    /**
     * @notice Add a new version to the registry
     * @param moduleAddress Address of the upgrade module for this version
     * @param infoUrl URL pointing to IPFS or other storage containing detailed version information
     * @return versionIndex The index of the newly added version
     */
    function addVersion(address moduleAddress, string calldata infoUrl)
        external
        override
        onlyOwner
        returns (uint256 versionIndex)
    {
        require(_isContract(moduleAddress), "Module address is not a contract");

        VersionData memory newVersion =
            VersionData({timestamp: block.timestamp, moduleAddress: moduleAddress, infoUrl: infoUrl});

        _versions.push(newVersion);
        versionIndex = _versions.length - 1;

        emit VersionAdded(versionIndex, moduleAddress);
        return versionIndex;
    }

    function getVersionInfo(uint256 versionIndex) external view override returns (VersionData memory) {
        require(versionIndex < _versions.length, "Version not found");
        return _versions[versionIndex];
    }

    function getVersionCount() external view override returns (uint256) {
        return _versions.length;
    }

    function getLatestModuleAddress() external view returns (address) {
        if (_versions.length == 0) {
            return address(0);
        }
        return _versions[_versions.length - 1].moduleAddress;
    }

    function _isContract(address addr) internal view returns (bool) {
        uint256 size;
        assembly {
            size := extcodesize(addr)
        }
        return size > 0;
    }
}
