// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "forge-std/Test.sol";
import "../../elytro/base/ElytroInstence.sol";
import {ElytroDefaultValidator} from "@source/validator/ElytroDefaultValidator.sol";
import {Crypto2FAHook} from "@source/hooks/2fa/Crypto2FAHook.sol";
import {EntryPoint} from "@account-abstraction/contracts/core/EntryPoint.sol";
import {UserOpHelper} from "../../helper/UserOpHelper.t.sol";
import {MessageHashUtils} from "@openzeppelin/contracts/utils/cryptography/MessageHashUtils.sol";
import {Bundler} from "../../helper/Bundler.t.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {UserOperationHelper} from "@elytro-wallet-core/test/dev/userOperationHelper.sol";

contract Crypto2FAHookTest is Test, UserOpHelper {
    using TypeConversion for address;
    using ECDSA for bytes32;
    using MessageHashUtils for bytes32;

    ElytroInstence public elytroInstence;
    ElytroDefaultValidator public elytroDefaultValidator;
    IElytro public elytro;
    address public walletOwner;
    uint256 public walletOwnerPrivateKey;

    address public wallet2faOwner;
    uint256 public wallet2faOwnerPrivateKey;

    Crypto2FAHook public crypto2FAHook;

    Bundler public bundler;

    function setUp() public {
        (walletOwner, walletOwnerPrivateKey) = makeAddrAndKey("owner");
        (wallet2faOwner, wallet2faOwnerPrivateKey) = makeAddrAndKey("2fa");
        crypto2FAHook = new Crypto2FAHook();

        bytes[] memory modules = new bytes[](0);
        bytes[] memory hooks = new bytes[](1);
        uint8 capabilityFlags = 3;
        // 3 means preUserOpValidationHook and preIsValidSignatureHook
        hooks[0] = abi.encodePacked(address(crypto2FAHook), address(wallet2faOwner), capabilityFlags);

        bytes32[] memory owners = new bytes32[](1);
        owners[0] = walletOwner.toBytes32();
        EntryPoint entryPoint = new EntryPoint();
        elytroDefaultValidator = new ElytroDefaultValidator(address(entryPoint));
        bytes32 salt = bytes32(0);
        elytroInstence = new ElytroInstence(address(0), owners, modules, hooks, salt);
        elytroDefaultValidator = elytroInstence.defaultValidator();
        elytro = elytroInstence.elytro();
        (address[] memory preIsValidSignatureHooks, address[] memory preUserOpValidationHooks) = elytro.listHook();
        assertEq(preIsValidSignatureHooks.length, 1, "preIsValidSignatureHooks length error");
        assertEq(preUserOpValidationHooks.length, 1, "preUserOpValidationHooks length error");
        assertEq(preIsValidSignatureHooks[0], address(crypto2FAHook), "preIsValidSignatureHooks address error");
        assertEq(preUserOpValidationHooks[0], address(crypto2FAHook), "preUserOpValidationHooks address error");
    }

    function test_hook() public {
        vm.deal(address(elytro), 1000 ether);
        uint256 nonce = 0;
        bytes memory initCode;
        bytes memory callData;
        uint256 callGasLimit;
        uint256 verificationGasLimit;
        uint256 preVerificationGas;
        uint256 maxFeePerGas;
        uint256 maxPriorityFeePerGas;
        bytes memory paymasterAndData;
        {
            callGasLimit = 900000;
            callData = abi.encodeWithSelector(IStandardExecutor.execute.selector, address(10), 1 ether, "");
            verificationGasLimit = 1000000;
            preVerificationGas = 300000;
            maxFeePerGas = 100 gwei;
            maxPriorityFeePerGas = 100 gwei;
        }
        PackedUserOperation memory userOperation = UserOperationHelper.newUserOp({
            sender: address(elytro),
            nonce: nonce,
            initCode: initCode,
            callData: callData,
            callGasLimit: callGasLimit,
            verificationGasLimit: verificationGasLimit,
            preVerificationGas: preVerificationGas,
            maxFeePerGas: maxFeePerGas,
            maxPriorityFeePerGas: maxPriorityFeePerGas,
            paymasterAndData: paymasterAndData
        });
        bytes32 hookSignHash = elytroInstence.entryPoint().getUserOpHash(userOperation);
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(wallet2faOwnerPrivateKey, hookSignHash.toEthSignedMessageHash());
        bytes memory hookSignatureData = abi.encodePacked(r, s, v);
        bytes4 hookSignatureLength = bytes4(uint32(hookSignatureData.length));

        bytes memory hookAndData = abi.encodePacked(address(crypto2FAHook), hookSignatureLength, hookSignatureData);
        vm.startBroadcast(wallet2faOwnerPrivateKey);
        PackedUserOperation[] memory ops = new PackedUserOperation[](1);
        userOperation.signature = signUserOp(
            elytroInstence.entryPoint(),
            userOperation,
            walletOwnerPrivateKey,
            address(elytroDefaultValidator),
            hookAndData
        );
        ops[0] = userOperation;
        elytroInstence.entryPoint().handleOps(ops, payable(walletOwner));
    }

    function test_applyChange2faWithoutInitiateChange2FA() public {
        vm.startPrank(address(elytro));
        vm.expectRevert("No pending change");
        crypto2FAHook.applyChange2FA();
    }
}
