// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "forge-std/Test.sol";
import "@source/modules/upgrade/UpgradeModuleRegistry.sol";

contract MockModule {
    function hello() external pure returns (string memory) {
        return "hello world";
    }
}

contract UpgradeModuleRegistryTest is Test {
    UpgradeModuleRegistry public registry;
    address public owner;
    address public nonOwner;
    MockModule public mockModule1;
    MockModule public mockModule2;

    event VersionAdded(uint256 indexed versionIndex, address indexed moduleAddress);

    error OwnableUnauthorizedAccount(address account);

    function setUp() public {
        owner = makeAddr("owner");
        nonOwner = makeAddr("nonOwner");

        registry = new UpgradeModuleRegistry(owner);

        mockModule1 = new MockModule();
        mockModule2 = new MockModule();
    }

    function test_Constructor() public view {
        assertEq(registry.owner(), owner);
        assertEq(registry.getVersionCount(), 0);
        assertEq(registry.latestVersion(), 0);
        assertEq(registry.getLatestModuleAddress(), address(0));
    }

    function test_AddVersion() public {
        vm.startPrank(owner);

        string memory infoUrl = "ipfs://elytro-version-110";

        vm.expectEmit(true, true, false, true);
        emit VersionAdded(0, address(mockModule1));

        uint256 versionIndex = registry.addVersion(address(mockModule1), infoUrl);
        assertEq(versionIndex, 0);

        assertEq(registry.getVersionCount(), 1);
        assertEq(registry.latestVersion(), 0);
        assertEq(registry.getLatestModuleAddress(), address(mockModule1));

        IUpgradeModuleRegistry.VersionData memory versionData = registry.getVersionInfo(0);
        assertEq(versionData.moduleAddress, address(mockModule1));
        assertEq(versionData.infoUrl, infoUrl);
        assertEq(versionData.timestamp, block.timestamp);

        vm.stopPrank();
    }

    function test_AddMultipleVersions() public {
        vm.startPrank(owner);

        string memory infoUrl1 = "ipfs://elytro-version-110";
        uint256 versionIndex1 = registry.addVersion(address(mockModule1), infoUrl1);
        assertEq(versionIndex1, 0);

        string memory infoUrl2 = "ipfs://elytro-version-120";
        uint256 versionIndex2 = registry.addVersion(address(mockModule2), infoUrl2);
        assertEq(versionIndex2, 1);

        assertEq(registry.getVersionCount(), 2);
        assertEq(registry.latestVersion(), 1);
        assertEq(registry.getLatestModuleAddress(), address(mockModule2));

        IUpgradeModuleRegistry.VersionData memory versionData1 = registry.getVersionInfo(0);
        assertEq(versionData1.moduleAddress, address(mockModule1));
        assertEq(versionData1.infoUrl, infoUrl1);

        IUpgradeModuleRegistry.VersionData memory versionData2 = registry.getVersionInfo(1);
        assertEq(versionData2.moduleAddress, address(mockModule2));
        assertEq(versionData2.infoUrl, infoUrl2);

        vm.stopPrank();
    }

    function test_RevertWhen_NonOwnerAddsVersion() public {
        vm.startPrank(nonOwner);

        vm.expectRevert(abi.encodeWithSelector(OwnableUnauthorizedAccount.selector, nonOwner));
        registry.addVersion(address(mockModule1), "ipfs://elytro-version-110");

        vm.stopPrank();
    }

    function test_RevertWhen_AddVersionWithNonContractAddress() public {
        vm.startPrank(owner);

        address nonContractAddress = makeAddr("nonContract");

        vm.expectRevert();
        registry.addVersion(nonContractAddress, "ipfs://elytro-version-110");

        vm.stopPrank();
    }

    function test_RevertWhen_GetInvalidVersionInfo() public {
        vm.expectRevert("Version not found");
        registry.getVersionInfo(0);

        vm.prank(owner);
        registry.addVersion(address(mockModule1), "ipfs://elytro-version-110");

        registry.getVersionInfo(0);

        // Try to get info for non-existent version
        vm.expectRevert("Version not found");
        registry.getVersionInfo(1);
    }

    function test_TransferOwnership() public {
        assertEq(registry.owner(), owner);

        vm.prank(owner);
        registry.transferOwnership(nonOwner);

        assertEq(registry.owner(), nonOwner);

        // Old owner can no longer add versions
        vm.startPrank(owner);
        vm.expectRevert(abi.encodeWithSelector(OwnableUnauthorizedAccount.selector, owner));
        registry.addVersion(address(mockModule1), "ipfs://elytro-version-110");
        vm.stopPrank();

        // New owner can add versions
        vm.startPrank(nonOwner);
        registry.addVersion(address(mockModule1), "ipfs://elytro-version-110");
        vm.stopPrank();
    }

    function test_ZeroVersions() public view {
        assertEq(registry.getVersionCount(), 0);
        assertEq(registry.latestVersion(), 0);
        assertEq(registry.getLatestModuleAddress(), address(0));
    }

    function test_VersionTimestamps() public {
        vm.startPrank(owner);

        uint256 timestamp1 = 1700000000;
        vm.warp(timestamp1);
        registry.addVersion(address(mockModule1), "ipfs://elytro-version-110");

        uint256 timestamp2 = 1700086400; // 1 day later
        vm.warp(timestamp2);
        registry.addVersion(address(mockModule2), "ipfs://elytro-version-120");

        vm.stopPrank();

        IUpgradeModuleRegistry.VersionData memory version1 = registry.getVersionInfo(0);
        assertEq(version1.timestamp, timestamp1);

        IUpgradeModuleRegistry.VersionData memory version2 = registry.getVersionInfo(1);
        assertEq(version2.timestamp, timestamp2);

        // Verify we can use this to determine the chronological order
        assertTrue(version1.timestamp < version2.timestamp, "Version timestamps should reflect chronological order");
    }
}
