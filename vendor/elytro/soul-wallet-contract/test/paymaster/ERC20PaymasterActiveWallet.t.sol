// SPDX-License-Identifier: GPL-3.0
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "../soulwallet/base/SoulWalletInstence.sol";
import "@source/abstract/DefaultCallbackHandler.sol";
import "@source/paymaster/ERC20Paymaster.sol";
import "@source/dev/tokens/TokenERC20.sol";
import "@source/dev/TestOracle.sol";
import "@source/dev/HelloWorld.sol";
import "../helper/Bundler.t.sol";
import "../helper/UserOpHelper.t.sol";
import {MessageHashUtils} from "@openzeppelin/contracts/utils/cryptography/MessageHashUtils.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import "@source/libraries/TypeConversion.sol";
import {SoulWalletDefaultValidator} from "@source/validator/SoulWalletDefaultValidator.sol";
import {UserOperationHelper} from "@soulwallet-core/test/dev/userOperationHelper.sol";

contract ERC20PaymasterActiveWalletTest is Test, UserOpHelper {
    using ECDSA for bytes32;
    using MessageHashUtils for bytes32;
    using TypeConversion for address;

    SoulWalletLogicInstence public soulWalletLogicInstence;
    SoulWalletFactory public soulWalletFactory;
    ISoulWallet soulWallet;
    ERC20Paymaster paymaster;
    Bundler bundler;
    SoulWalletDefaultValidator defaultValidator;
    DefaultCallbackHandler defaultCallbackHandler;

    using TypeConversion for address;

    address ownerAddr;
    uint256 ownerKey;

    address paymasterOwner;
    address payable beneficiary;
    TokenERC20 token;
    TestOracle testOracle;
    TestOracle nativeAssetOracle;
    HelloWorld helloWorld;

    function setUp() public {
        vm.warp(1685300000);
        (ownerAddr, ownerKey) = makeAddrAndKey("owner1");
        paymasterOwner = makeAddr("paymasterOwner");
        beneficiary = payable(makeAddr("beneficiary"));

        token = new TokenERC20(6);
        testOracle = new TestOracle(166590000);
        nativeAssetOracle = new TestOracle(190355094900);
        helloWorld = new HelloWorld();
        bundler = new Bundler();

        entryPoint = new EntryPoint();
        defaultValidator = new SoulWalletDefaultValidator();
        soulWalletLogicInstence = new SoulWalletLogicInstence(address(entryPoint), address(defaultValidator));
        address logic = address(soulWalletLogicInstence.soulWalletLogic());
        soulWalletFactory = new SoulWalletFactory(logic, address(entryPoint), address(this));
        require(soulWalletFactory._WALLETIMPL() == logic, "logic address not match");

        paymaster = new ERC20Paymaster(entryPoint, paymasterOwner, address(soulWalletFactory));

        vm.deal(paymasterOwner, 10000e18);
        vm.startPrank(paymasterOwner);
        paymaster.setNativeAssetOracle(address(nativeAssetOracle));
        entryPoint.depositTo{value: 1000e18}(address(paymaster));
        paymaster.addStake{value: 1000e18}(1);
        address[] memory tokens = new address[](1);
        tokens[0] = address(token);
        address[] memory oracles = new address[](1);
        oracles[0] = address(testOracle);
        uint32[] memory priceMarkups = new uint32[](1);
        priceMarkups[0] = 1e6;
        paymaster.setToken(tokens, oracles, priceMarkups);
        paymaster.updatePrice(address(token));
        defaultCallbackHandler = new DefaultCallbackHandler();
        vm.stopPrank();
    }

    function test_ActiveWalletWithERC20Paymaster() public {
        vm.warp(1685300000);

        Execution[] memory executions = new Execution[](1);
        executions[0].target = address(token);
        executions[0].value = 0;
        executions[0].data = abi.encodeWithSignature("approve(address,uint256)", address(paymaster), 10000e6);
        bytes memory callData = abi.encodeWithSignature("executeBatch((address,uint256,bytes)[])", executions);
        bytes memory paymasterAndData = abi.encodePacked(
            abi.encodePacked(address(paymaster), uint128(400000), uint128(400000)),
            abi.encode(address(token), uint256(10000e6))
        );

        bytes32 salt = bytes32(uint256(12));
        bytes[] memory modules = new bytes[](0);
        bytes32[] memory owners = new bytes32[](1);
        owners[0] = ownerAddr.toBytes32();

        bytes[] memory hooks = new bytes[](0);

        bytes memory initializer = abi.encodeWithSignature(
            "initialize(bytes32[],address,bytes[],bytes[])", owners, defaultCallbackHandler, modules, hooks
        );

        address cacluatedAddress = soulWalletFactory.getWalletAddress(initializer, salt);
        // deal some token to the wallet
        deal(address(token), cacluatedAddress, 10000e18);

        PackedUserOperation[] memory ops = new PackedUserOperation[](1);

        bytes memory soulWalletFactoryCall = abi.encodeWithSignature("createWallet(bytes,bytes32)", initializer, salt);
        bytes memory initCode = abi.encodePacked(address(soulWalletFactory), soulWalletFactoryCall);

        PackedUserOperation memory userOperation = UserOperationHelper.newUserOp({
            sender: cacluatedAddress,
            nonce: 0,
            initCode: initCode,
            callData: callData,
            callGasLimit: 5000000,
            verificationGasLimit: 1000000,
            preVerificationGas: 500000,
            maxFeePerGas: 10000,
            maxPriorityFeePerGas: 10000,
            paymasterAndData: paymasterAndData
        });
        userOperation.signature = signUserOp(userOperation, ownerKey, address(defaultValidator));

        ops[0] = userOperation;
        entryPoint.handleOps(ops, payable(ownerAddr));
    }

    function testFail_ActiveWalletWithERC20PaymasterMoreOperation() public {
        vm.warp(1685300000);

        Execution[] memory executions = new Execution[](2);
        executions[0].target = address(token);
        executions[0].value = 0;
        executions[0].data = abi.encodeWithSignature("approve(address,uint256)", address(paymaster), 10000e6);
        executions[1].target = address(token);
        executions[1].value = 0;
        executions[1].data = abi.encodeWithSignature("transfer(address,uint256)", address(paymaster), 1);

        bytes memory callData = abi.encodeWithSignature("executeBatch((address,uint256,bytes)[])", executions);
        bytes memory paymasterAndData = abi.encodePacked(
            abi.encodePacked(address(paymaster), uint128(400000), uint128(400000)),
            abi.encode(address(token), uint256(10000e6))
        );

        bytes32 salt = bytes32(uint256(12));
        bytes[] memory modules = new bytes[](0);
        bytes32[] memory owners = new bytes32[](1);
        owners[0] = ownerAddr.toBytes32();

        bytes[] memory hooks = new bytes[](0);

        bytes memory initializer = abi.encodeWithSignature(
            "initialize(bytes32[],address,bytes[],bytes[])", owners, defaultCallbackHandler, modules, hooks
        );

        address cacluatedAddress = soulWalletFactory.getWalletAddress(initializer, salt);
        // deal some token to the wallet
        deal(address(token), cacluatedAddress, 10000e18);

        PackedUserOperation[] memory ops = new PackedUserOperation[](1);

        bytes memory soulWalletFactoryCall = abi.encodeWithSignature("createWallet(bytes,bytes32)", initializer, salt);
        bytes memory initCode = abi.encodePacked(address(soulWalletFactory), soulWalletFactoryCall);

        PackedUserOperation memory userOperation = UserOperationHelper.newUserOp({
            sender: cacluatedAddress,
            nonce: 0,
            initCode: initCode,
            callData: callData,
            callGasLimit: 5000000,
            verificationGasLimit: 1000000,
            preVerificationGas: 500000,
            maxFeePerGas: 10000,
            maxPriorityFeePerGas: 10000,
            paymasterAndData: paymasterAndData
        });
        userOperation.signature = signUserOp(userOperation, ownerKey, address(defaultValidator));

        ops[0] = userOperation;
        vm.expectRevert("invalid operation");
        entryPoint.handleOps(ops, payable(ownerAddr));
    }
}
