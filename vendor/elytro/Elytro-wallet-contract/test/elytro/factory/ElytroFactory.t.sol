// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "forge-std/Test.sol";
import {EntryPoint} from "@account-abstraction/contracts/core/EntryPoint.sol";
import "@source/validator/ElytroDefaultValidator.sol";
import {ElytroFactory} from "@source/factory/ElytroFactory.sol";
import "@source/libraries/TypeConversion.sol";
import {ElytroLogicInstence} from "../base/ElytroLogicInstence.sol";
import {UserOpHelper} from "../../helper/UserOpHelper.t.sol";
import {UserOperationHelper} from "@elytro-wallet-core/test/dev/userOperationHelper.sol";
import "@source/abstract/DefaultCallbackHandler.sol";

contract ElytroFactoryTest is Test, UserOpHelper {
    using TypeConversion for address;

    ElytroDefaultValidator public elytroDefaultValidator;
    ElytroLogicInstence public elytroLogicInstence;
    ElytroFactory public elytroFactory;
    DefaultCallbackHandler public defaultCallbackHandler;

    function setUp() public {
        defaultCallbackHandler = new DefaultCallbackHandler();
        entryPoint = new EntryPoint();
        elytroDefaultValidator = new ElytroDefaultValidator(address(entryPoint));
        elytroLogicInstence = new ElytroLogicInstence(address(entryPoint), address(elytroDefaultValidator));
        address logic = address(elytroLogicInstence.elytroLogic());

        elytroFactory = new ElytroFactory(logic, address(entryPoint), address(this));
        require(elytroFactory._WALLETIMPL() == logic, "logic address not match");
    }

    function test_deployWallet() public {
        bytes[] memory modules;
        bytes[] memory hooks;
        bytes32[] memory owners = new bytes32[](1);
        owners[0] = address(this).toBytes32();
        bytes32 salt = bytes32(0);
        bytes memory initializer = abi.encodeWithSignature(
            "initialize(bytes32[],address,bytes[],bytes[])", owners, defaultCallbackHandler, modules, hooks
        );
        address walletAddress1 = elytroFactory.getWalletAddress(initializer, salt);
        address senderCreator = address(entryPoint.senderCreator());
        vm.prank(senderCreator);
        address walletAddress2 = elytroFactory.createWallet(initializer, salt);
        require(walletAddress1 == walletAddress2, "walletAddress1 != walletAddress2");
    }
    // test return the wallet account address even if it has already been created

    function test_alreadyDeployedWallet() public {
        bytes[] memory modules;
        bytes[] memory hooks;
        bytes32[] memory owners = new bytes32[](1);
        owners[0] = address(this).toBytes32();
        bytes32 salt = bytes32(0);
        bytes memory initializer = abi.encodeWithSignature(
            "initialize(bytes32[],address,bytes[],bytes[])", owners, defaultCallbackHandler, modules, hooks
        );
        address walletAddress1 = elytroFactory.getWalletAddress(initializer, salt);
        address senderCreator = address(entryPoint.senderCreator());
        vm.startPrank(senderCreator);
        address walletAddress2 = elytroFactory.createWallet(initializer, salt);
        require(walletAddress1 == walletAddress2, "walletAddress1 != walletAddress2");
        address walletAddress3 = elytroFactory.createWallet(initializer, salt);
        vm.stopPrank();
        require(walletAddress3 == walletAddress2, "walletAddress3 != walletAddress2");
    }
}
