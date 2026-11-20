// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console} from "forge-std/Script.sol";
import {IPoolManager} from "v4-core/src/interfaces/IPoolManager.sol";
import {Hooks} from "v4-core/src/libraries/Hooks.sol";
import {HookMiner} from "v4-periphery/test/shared/HookMiner.sol";
import {WorldIdGateHook} from "../src/WorldIdGateHook.sol";

address constant CREATE2_DEPLOYER = 0x4e59b44847b379578588920cA78FbF26c0B4956C;
address constant SEPOLIA_POOL_MANAGER = 0xE03A1074c86CFeDd5C142C4F04F1a1536e203543;

contract Deploy is Script {
    function run() external {
        uint256 pk = vm.envUint("PRIVATE_KEY");
        address owner = vm.addr(pk);

        uint160 flags = uint160(Hooks.BEFORE_SWAP_FLAG);
        bytes memory constructorArgs = abi.encode(IPoolManager(SEPOLIA_POOL_MANAGER), owner);
        (address hookAddress, bytes32 salt) =
            HookMiner.find(CREATE2_DEPLOYER, flags, type(WorldIdGateHook).creationCode, constructorArgs);

        console.log("mined hook address:", hookAddress);
        console.log("salt:", vm.toString(salt));

        vm.startBroadcast(pk);
        WorldIdGateHook hook = new WorldIdGateHook{salt: salt}(IPoolManager(SEPOLIA_POOL_MANAGER), owner);
        require(address(hook) == hookAddress, "deployed address mismatch");
        vm.stopBroadcast();

        console.log("deployed hook at:", address(hook));
    }
}
