// SPDX-License-Identifier: MIT
pragma solidity ^0.8.13;

import "forge-std/Script.sol";
import "@source/factory/ElytroFactory.sol";
import "@source/Elytro.sol";
import "@source/abstract/DefaultCallbackHandler.sol";
import {ElytroDefaultValidator} from "@source/validator/ElytroDefaultValidator.sol";
import {EntryPoint} from "@account-abstraction/contracts/core/EntryPoint.sol";
import {ElytroInfoRecorder} from "@source/tools/ElytroInfoRecorder.sol";
import "./DeployHelper.sol";

contract WalletDeployer is Script, DeployHelper {
    function run() public {
        vm.startBroadcast(privateKey);
        Network network = getNetwork();
        string memory networkName = NetWorkLib.getNetworkName();
        console.log("deploy elytro contract on ", networkName);
        if (network == Network.Anvil) {
            deploySingletonFactory();
            deployLocalEntryPoint();
        }
        deploy();
    }

    function deploy() private {
        address elytroDefaultValidator = deploy(
            "ElytroDefaultValidator",
            bytes.concat(type(ElytroDefaultValidator).creationCode, abi.encode(ENTRYPOINT_ADDRESS))
        );
        writeAddressToEnv("ELYTRO_DEFAULT_VALIDATOR", elytroDefaultValidator);
        address elytroInstance = deploy(
            "ElytroInstance",
            bytes.concat(type(Elytro).creationCode, abi.encode(ENTRYPOINT_ADDRESS, elytroDefaultValidator))
        );
        address elytroFactoryOwner = vm.envAddress("ELYTRO_FACTORY_OWNER");
        address elytroFactoryAddress = deploy(
            "ElytroFactory",
            bytes.concat(
                type(ElytroFactory).creationCode, abi.encode(elytroInstance, ENTRYPOINT_ADDRESS, elytroFactoryOwner)
            )
        );
        writeAddressToEnv("ELYTRO_FACTORY_ADDRESS", elytroFactoryAddress);

        deploy("DefaultCallbackHandler", type(DefaultCallbackHandler).creationCode);

        // Deploy ElytroInfoRecorder
        address elytroInfoRecorder = deploy("ElytroInfoRecorder", type(ElytroInfoRecorder).creationCode);
        writeAddressToEnv("ELYTRO_INFO_RECORDER", elytroInfoRecorder);
    }

    function deployLocalEntryPoint() private {
        ENTRYPOINT_ADDRESS = deploy("EntryPoint", type(EntryPoint).creationCode);
    }
}
