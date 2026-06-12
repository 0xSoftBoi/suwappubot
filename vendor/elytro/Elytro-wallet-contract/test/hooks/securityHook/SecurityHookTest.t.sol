// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "forge-std/Test.sol";
import "../../elytro/base/ElytroInstence.sol";
import {ElytroDefaultValidator} from "@source/validator/ElytroDefaultValidator.sol";
import {SecurityHook} from "@source/hooks/securityHook/SecurityHook.sol";
import {EntryPoint} from "@account-abstraction/contracts/core/EntryPoint.sol";
import {IEntryPoint} from "@account-abstraction/contracts/interfaces/IEntryPoint.sol";
import {UserOpHelper} from "../../helper/UserOpHelper.t.sol";
import {UserOperationHelper} from "@elytro-wallet-core/test/dev/userOperationHelper.sol";
import "../../dev/tokens/TokenERC20.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {IStandardExecutor} from "@elytro-wallet-core/contracts/interface/IStandardExecutor.sol";
import {IHookManager} from "@elytro-wallet-core/contracts/interface/IHookManager.sol";

contract SecurityHookTest is Test, UserOpHelper {
    using TypeConversion for address;
    using ECDSA for bytes32;

    ElytroInstence public elytroInstence;
    ElytroDefaultValidator public elytroDefaultValidator;
    IElytro public elytro;
    address public walletOwner;
    uint256 public walletOwnerPrivateKey;

    address public hook2faOwner;
    uint256 public hook2faOwnerPrivateKey;
    address public hook2faSigner;
    uint256 public hook2faSignerPrivateKey;

    SecurityHook public securityHook;

    function setUp() public {
        (walletOwner, walletOwnerPrivateKey) = makeAddrAndKey("owner");

        (hook2faOwner, hook2faOwnerPrivateKey) = makeAddrAndKey("2faOwner");
        (hook2faSigner, hook2faSignerPrivateKey) = makeAddrAndKey("2faSigner");
        securityHook = new SecurityHook(hook2faOwner, hook2faSigner);

        bytes[] memory modules = new bytes[](0);
        bytes[] memory hooks = new bytes[](0);

        bytes32[] memory owners = new bytes32[](1);
        owners[0] = walletOwner.toBytes32();
        bytes32 salt = bytes32(0);
        elytroInstence = new ElytroInstence(address(0), owners, modules, hooks, salt);
        elytroDefaultValidator = elytroInstence.defaultValidator();
        elytro = elytroInstence.elytro();
        entryPoint = elytroInstence.entryPoint();
    }

    function installHook() internal {
        bytes4 safetyDelay = bytes4(uint32(3600)); // 1 hour
        bytes memory hookAndData = abi.encodePacked(address(securityHook), safetyDelay);
        uint8 capabilityFlags = 3; // preUserOpValidationHook and preIsValidSignatureHook

        vm.startPrank(address(elytro));
        elytro.installHook(hookAndData, capabilityFlags);
        vm.stopPrank();
    }

    function test_install() public {
        (address[] memory preIsValidSignatureHooksBefore, address[] memory preUserOpValidationHooksBefore) =
            elytro.listHook();
        assertEq(preIsValidSignatureHooksBefore.length, 0, "preIsValidSignatureHooks length error");
        assertEq(preUserOpValidationHooksBefore.length, 0, "preUserOpValidationHooks length error");

        installHook();
        (address[] memory preIsValidSignatureHooksAfter, address[] memory preUserOpValidationHooksAfter) =
            elytro.listHook();
        assertEq(preIsValidSignatureHooksAfter.length, 1, "preIsValidSignatureHooks length error");
        assertEq(preUserOpValidationHooksAfter.length, 1, "preUserOpValidationHooks length error");
    }

    error MISSING_SECURITYHOOK_SIGNATURE();

    function hookSign(PackedUserOperation memory op) internal view returns (bytes memory hookSignatures) {
        bytes32 hash = entryPoint.getUserOpHash(op);
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(hook2faSignerPrivateKey, hash);
        bytes memory signatureData = abi.encodePacked(r, s, v);
        bytes4 signatureLength = bytes4(uint32(signatureData.length));
        hookSignatures = abi.encodePacked(address(securityHook), signatureLength, signatureData);
    }

    function test_fail() public {
        vm.deal(address(elytro), 100 ether);
        bytes memory callData = abi.encodeWithSelector(IStandardExecutor.execute.selector, address(0xff01), 1 ether, "");
        PackedUserOperation memory userOperation = UserOperationHelper.newUserOp({
            sender: address(elytro),
            nonce: 0,
            initCode: "",
            callData: callData,
            callGasLimit: 900000,
            verificationGasLimit: 1000000,
            preVerificationGas: 300000,
            maxFeePerGas: 100 gwei,
            maxPriorityFeePerGas: 100 gwei,
            paymasterAndData: ""
        });

        {
            bytes memory hookAndData = hex"";
            PackedUserOperation[] memory ops = new PackedUserOperation[](1);
            userOperation.signature = signUserOp(
                entryPoint, userOperation, walletOwnerPrivateKey, address(elytroDefaultValidator), hookAndData
            );
            ops[0] = userOperation;
            uint256 balanceBefore = address(0xff01).balance;
            entryPoint.handleOps(ops, payable(address(0xff00)));
            uint256 balanceAfter = address(0xff01).balance;
            assertEq(balanceAfter, balanceBefore + 1 ether, "balance error");
        }
        installHook();
        userOperation.nonce = 1;
        {
            bytes memory hookAndData = hex"";
            PackedUserOperation[] memory ops = new PackedUserOperation[](1);
            userOperation.signature = signUserOp(
                entryPoint, userOperation, walletOwnerPrivateKey, address(elytroDefaultValidator), hookAndData
            );
            ops[0] = userOperation;

            /*
                MISSING_SECURITYHOOK_SIGNATURE()
                FailedOp(0, "AA24 signature error")
            */
            vm.expectRevert(abi.encodeWithSelector(IEntryPoint.FailedOp.selector, 0, "AA24 signature error"));
            // vm.expectRevert(MISSING_SECURITYHOOK_SIGNATURE.selector);
            entryPoint.handleOps(ops, payable(address(0xff00)));
        }
    }

    function test_succ() public {
        vm.deal(address(elytro), 100 ether);
        bytes memory callData = abi.encodeWithSelector(IStandardExecutor.execute.selector, address(0xff01), 1 ether, "");
        PackedUserOperation memory userOperation = UserOperationHelper.newUserOp({
            sender: address(elytro),
            nonce: 0,
            initCode: "",
            callData: callData,
            callGasLimit: 900000,
            verificationGasLimit: 1000000,
            preVerificationGas: 300000,
            maxFeePerGas: 100 gwei,
            maxPriorityFeePerGas: 100 gwei,
            paymasterAndData: ""
        });

        {
            bytes memory hookAndData = hex"";
            PackedUserOperation[] memory ops = new PackedUserOperation[](1);
            userOperation.signature = signUserOp(
                entryPoint, userOperation, walletOwnerPrivateKey, address(elytroDefaultValidator), hookAndData
            );
            ops[0] = userOperation;
            uint256 balanceBefore = address(0xff01).balance;
            entryPoint.handleOps(ops, payable(address(0xff00)));
            uint256 balanceAfter = address(0xff01).balance;
            assertEq(balanceAfter, balanceBefore + 1 ether, "balance error");
        }
        installHook();
        userOperation.nonce = 1;
        {
            bytes memory hookAndData = hookSign(userOperation);
            PackedUserOperation[] memory ops = new PackedUserOperation[](1);
            userOperation.signature = signUserOp(
                entryPoint, userOperation, walletOwnerPrivateKey, address(elytroDefaultValidator), hookAndData
            );
            ops[0] = userOperation;
            uint256 balanceBefore = address(0xff01).balance;
            entryPoint.handleOps(ops, payable(address(0xff00)));
            uint256 balanceAfter = address(0xff01).balance;
            assertEq(balanceAfter, balanceBefore + 1 ether, "balance error");
        }
    }

    event forceUninstallRequested(address indexed user, uint64 forceUninstallAfter);

    function test_exit_window() public {
        vm.deal(address(elytro), 100 ether);
        installHook();

        PackedUserOperation memory userOperation = UserOperationHelper.newUserOp({
            sender: address(elytro),
            nonce: 0,
            initCode: "",
            callData: "",
            callGasLimit: 900000,
            verificationGasLimit: 1000000,
            preVerificationGas: 300000,
            maxFeePerGas: 100 gwei,
            maxPriorityFeePerGas: 100 gwei,
            paymasterAndData: ""
        });
        bytes memory uninstallCalldata;
        {
            bytes memory uninstallHookCallData =
                abi.encodeWithSelector(IHookManager.uninstallHook.selector, address(securityHook));
            uninstallCalldata = abi.encodeWithSelector(
                IStandardExecutor.execute.selector, address(elytro), 0 ether, uninstallHookCallData
            );
            userOperation.callData = uninstallCalldata;
            PackedUserOperation[] memory ops = new PackedUserOperation[](1);
            userOperation.signature =
                signUserOp(entryPoint, userOperation, walletOwnerPrivateKey, address(elytroDefaultValidator), "");
            ops[0] = userOperation;
            vm.expectRevert(abi.encodeWithSelector(IEntryPoint.FailedOp.selector, 0, "AA24 signature error"));
            entryPoint.handleOps(ops, payable(address(0xff00)));
        }

        uint64 forceUninstallAfter;
        {
            // `function forcePreUninstall() external`
            bytes memory preUninstallCallData = abi.encodeWithSelector(SecurityHook.forcePreUninstall.selector);
            bytes memory callData = abi.encodeWithSelector(
                IStandardExecutor.execute.selector, address(securityHook), 0 ether, preUninstallCallData
            );
            userOperation.callData = callData;
            bytes memory hookAndData = hex"";
            PackedUserOperation[] memory ops = new PackedUserOperation[](1);
            userOperation.signature = signUserOp(
                entryPoint, userOperation, walletOwnerPrivateKey, address(elytroDefaultValidator), hookAndData
            );
            ops[0] = userOperation;
            forceUninstallAfter = uint64(block.timestamp) + uint64(3600); // 1 hour
            vm.expectEmit(true, true, true, true);
            emit forceUninstallRequested(address(elytro), forceUninstallAfter);
            entryPoint.handleOps(ops, payable(address(0xff00)));
            userOperation.nonce += 1;
        }
        {
            userOperation.callData = uninstallCalldata;
            PackedUserOperation[] memory ops = new PackedUserOperation[](1);
            userOperation.signature =
                signUserOp(entryPoint, userOperation, walletOwnerPrivateKey, address(elytroDefaultValidator), "");
            ops[0] = userOperation;
            vm.expectRevert(abi.encodeWithSelector(IEntryPoint.FailedOp.selector, 0, "AA24 signature error"));
            entryPoint.handleOps(ops, payable(address(0xff00)));
        }
        {
            // wait for 1 hour
            vm.warp(forceUninstallAfter);
            userOperation.callData = uninstallCalldata;
            PackedUserOperation[] memory ops = new PackedUserOperation[](1);
            userOperation.signature =
                signUserOp(entryPoint, userOperation, walletOwnerPrivateKey, address(elytroDefaultValidator), "");
            ops[0] = userOperation;

            (address[] memory preIsValidSignatureHooksBefore, address[] memory preUserOpValidationHooksBefore) =
                elytro.listHook();
            assertEq(preIsValidSignatureHooksBefore.length, 1, "preIsValidSignatureHooks length error");
            assertEq(preUserOpValidationHooksBefore.length, 1, "preUserOpValidationHooks length error");
            entryPoint.handleOps(ops, payable(address(0xff00)));
            (address[] memory preIsValidSignatureHooksAfter, address[] memory preUserOpValidationHooksAfter) =
                elytro.listHook();
            assertEq(preIsValidSignatureHooksAfter.length, 0, "preIsValidSignatureHooks length error");
            assertEq(preUserOpValidationHooksAfter.length, 0, "preUserOpValidationHooks length error");
        }
    }
}
