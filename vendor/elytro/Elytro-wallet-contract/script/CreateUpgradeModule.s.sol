// SPDX-License-Identifier: MIT
pragma solidity ^0.8.13;

import "forge-std/Script.sol";
import "@source/modules/upgrade/UpgradeModule.sol";
import "@source/modules/upgrade/UpgradeModuleRegistry.sol";
import {Solenv} from "@solenv/Solenv.sol";
import "./DeployHelper.sol";

/**
 * @title DeployUpgradeModules
 * @notice Script to deploy UpgradeModuleRegistry and UpgradeModule
 * @dev Deploys the registry first, then the module with a new implementation address, and registers the module in the registry
 */
contract DeployUpgradeModules is Script, DeployHelper {
    // Newly deployed contract addresses
    address public upgradeModuleRegistry;
    address public upgradeModule;

    // Configuration parameters
    address public registryOwner;
    address public newImplementation;
    string public versionInfoUrl;

    function run() public {
        Solenv.config(".env_backend");

        // Configuration for the registry and module
        registryOwner = vm.envOr("REGISTRY_OWNER", deployer);
        newImplementation = vm.envAddress("ElytroInstance");
        require(newImplementation != address(0), "New implementation address not provided");
        versionInfoUrl = vm.envOr(
            "VERSION_INFO_URL",
            string("https://ipfs.io/ipfs/bafkreihs2dikkxipfeaylwmdipl7ucc6xemk67flqmbhgqtmkjk5r7e6ye")
        );

        // Start deployment
        vm.startBroadcast(privateKey);

        string memory networkName = NetWorkLib.getNetworkName();
        console.log("Deploying UpgradeModule contracts on", networkName);

        // Deploy the upgrade module registry
        deployUpgradeModuleRegistry();

        // Deploy the upgrade module with the new implementation
        deployUpgradeModule();

        // Register the deployed module in the registry
        registerUpgradeModule();

        vm.stopBroadcast();
    }

    function deployUpgradeModuleRegistry() private {
        console.log("Deploying UpgradeModuleRegistry...");

        upgradeModuleRegistry = deploy(
            "UpgradeModuleRegistry",
            abi.encodePacked(type(UpgradeModuleRegistry).creationCode, abi.encode(registryOwner))
        );

        console.log("UpgradeModuleRegistry deployed at:", upgradeModuleRegistry);
    }

    function deployUpgradeModule() private {
        console.log("Deploying UpgradeModule with new implementation:", newImplementation);

        // Deploy the UpgradeModule with the new implementation address
        upgradeModule =
            deploy("UpgradeModule", abi.encodePacked(type(UpgradeModule).creationCode, abi.encode(newImplementation)));

        console.log("UpgradeModule deployed at:", upgradeModule);
    }

    function registerUpgradeModule() private {
        console.log("Registering UpgradeModule in the registry...");

        // Only register if deployer is the registry owner, otherwise it will need to be done later
        if (deployer == registryOwner) {
            UpgradeModuleRegistry registry = UpgradeModuleRegistry(upgradeModuleRegistry);
            uint256 versionIndex = registry.addVersion(upgradeModule, versionInfoUrl);

            console.log("UpgradeModule registered with version index:", versionIndex);
        } else {
            console.log("Registry owner is different from deployer, manual registration required");
        }
    }
}
