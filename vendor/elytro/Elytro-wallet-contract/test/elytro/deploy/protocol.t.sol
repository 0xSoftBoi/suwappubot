// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "forge-std/Test.sol";
import {EntryPoint} from "@account-abstraction/contracts/core/EntryPoint.sol";
import {IElytro} from "@source/interfaces/IElytro.sol";
import "@source/validator/ElytroDefaultValidator.sol";
import {ElytroFactory} from "@source/factory/ElytroFactory.sol";
import "@source/abstract/DefaultCallbackHandler.sol";
import "@source/libraries/TypeConversion.sol";
import {ElytroLogicInstence} from "../base/ElytroLogicInstence.sol";
import {UserOpHelper} from "../../helper/UserOpHelper.t.sol";
import {Bundler} from "../../helper/Bundler.t.sol";
import {UserOperationHelper} from "@elytro-wallet-core/test/dev/userOperationHelper.sol";

contract DeployProtocolTest is Test, UserOpHelper {
    using TypeConversion for address;

    ElytroDefaultValidator public elytroDefaultValidator;
    ElytroLogicInstence public elytroLogicInstence;
    ElytroFactory public elytroFactory;
    Bundler public bundler;

    function setUp() public {
        entryPoint = new EntryPoint();
        elytroDefaultValidator = new ElytroDefaultValidator(address(entryPoint));
        elytroLogicInstence = new ElytroLogicInstence(address(entryPoint), address(elytroDefaultValidator));
        address logic = address(elytroLogicInstence.elytroLogic());

        elytroFactory = new ElytroFactory(logic, address(entryPoint), address(this));
        require(elytroFactory._WALLETIMPL() == logic, "logic address not match");

        bundler = new Bundler();
    }

    function test_Deploy() public {
        address sender;
        uint256 nonce;
        bytes memory initCode;
        bytes memory callData;
        uint256 callGasLimit = 10000000;
        uint256 verificationGasLimit;
        uint256 preVerificationGas;
        uint256 maxFeePerGas;
        uint256 maxPriorityFeePerGas;
        bytes memory paymasterAndData;

        (address walletOwner, uint256 walletOwnerPrivateKey) = makeAddrAndKey("walletOwner");
        {
            nonce = 0;

            bytes[] memory modules = new bytes[](0);
            bytes[] memory hooks = new bytes[](0);

            bytes32 salt = bytes32(0);

            DefaultCallbackHandler defaultCallbackHandler = new DefaultCallbackHandler();
            bytes32[] memory owners = new bytes32[](1);
            owners[0] = walletOwner.toBytes32();
            bytes memory initializer = abi.encodeWithSignature(
                "initialize(bytes32[],address,bytes[],bytes[])", owners, defaultCallbackHandler, modules, hooks
            );
            sender = elytroFactory.getWalletAddress(initializer, salt);

            /*
            function createWallet(bytes memory _initializer, bytes32 _salt)
            */
            bytes memory elytroFactoryCall = abi.encodeWithSignature("createWallet(bytes,bytes32)", initializer, salt);
            initCode = abi.encodePacked(address(elytroFactory), elytroFactoryCall);

            verificationGasLimit = 2000000;
            preVerificationGas = 200000;
            maxFeePerGas = 10 gwei;
            maxPriorityFeePerGas = 10 gwei;
        }

        PackedUserOperation memory userOperation = UserOperationHelper.newUserOp(
            sender,
            nonce,
            initCode,
            callData,
            callGasLimit,
            verificationGasLimit,
            preVerificationGas,
            maxFeePerGas,
            maxPriorityFeePerGas,
            paymasterAndData
        );

        bytes32 userOpHash = entryPoint.getUserOpHash(userOperation);
        (userOpHash);
        userOperation.signature = signUserOp(userOperation, walletOwnerPrivateKey, address(elytroDefaultValidator));
        vm.expectRevert();
        bundler.post(entryPoint, userOperation);
        assertEq(sender.code.length, 0, "A1:sender.code.length != 0");

        vm.deal(userOperation.sender, 10 ether);
        bundler.post(entryPoint, userOperation);
        assertEq(sender.code.length > 0, true, "A2:sender.code.length == 0");
        IElytro elytro = IElytro(sender);
        assertEq(elytro.isOwner(walletOwner.toBytes32()), true);
        assertEq(elytro.isOwner(address(0x1111).toBytes32()), false);
    }
}
