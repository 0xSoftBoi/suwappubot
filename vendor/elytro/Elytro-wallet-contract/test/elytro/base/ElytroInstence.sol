// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "./ElytroLogicInstence.sol";
import {EntryPoint} from "@account-abstraction/contracts/core/EntryPoint.sol";
import {ElytroDefaultValidator} from "@source/validator/ElytroDefaultValidator.sol";
import "@source/factory/ElytroFactory.sol";
import "@source/libraries/TypeConversion.sol";
import "@source/interfaces/IElytro.sol";
import "forge-std/Test.sol";

contract ElytroInstence is Test {
    using TypeConversion for address;

    ElytroLogicInstence public elytroLogicInstence;
    ElytroFactory public elytroFactory;
    EntryPoint public entryPoint;
    IElytro public elytro;
    ElytroDefaultValidator public defaultValidator;

    constructor(
        address defaultCallbackHandler,
        bytes32[] memory owners,
        bytes[] memory modules,
        bytes[] memory hooks,
        bytes32 salt
    ) {
        entryPoint = new EntryPoint();
        defaultValidator = new ElytroDefaultValidator(address(entryPoint));
        elytroLogicInstence = new ElytroLogicInstence(address(entryPoint), address(defaultValidator));

        elytroFactory =
            new ElytroFactory(address(elytroLogicInstence.elytroLogic()), address(entryPoint), address(this));

        // elytroLogicInstence.initialize(owners, defaultCallbackHandler, modules, hooks);
        bytes memory initializer = abi.encodeWithSignature(
            "initialize(bytes32[],address,bytes[],bytes[])", owners, defaultCallbackHandler, modules, hooks
        );
        address walletAddress1 = elytroFactory.getWalletAddress(initializer, salt);

        // Impersonate the senderCreator address to pass the security check
        address senderCreator = address(entryPoint.senderCreator());
        vm.prank(senderCreator);
        address walletAddress2 = elytroFactory.createWallet(initializer, salt);

        require(walletAddress1 == walletAddress2, "walletAddress1 != walletAddress2");
        require(walletAddress2.code.length > 0, "wallet code is empty");
        // walletAddress1 as Elytro
        elytro = IElytro(walletAddress1);
    }
}
