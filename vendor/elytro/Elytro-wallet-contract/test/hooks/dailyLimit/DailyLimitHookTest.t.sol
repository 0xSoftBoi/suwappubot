// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "forge-std/Test.sol";
import "../../elytro/base/ElytroInstence.sol";
import {ElytroDefaultValidator} from "@source/validator/ElytroDefaultValidator.sol";
import {DailyERC20SpendingLimitHook} from "@source/hooks/spendLimit/DailyERC20SpendingLimitHook.sol";
import {EntryPoint} from "@account-abstraction/contracts/core/EntryPoint.sol";
import {UserOpHelper} from "../../helper/UserOpHelper.t.sol";
import {UserOperationHelper} from "@elytro-wallet-core/test/dev/userOperationHelper.sol";
import "../../dev/tokens/TokenERC20.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IStandardExecutor} from "@elytro-wallet-core/contracts/interface/IStandardExecutor.sol";

contract DailyLimitHookTest is Test, UserOpHelper {
    using TypeConversion for address;

    ElytroInstence public elytroInstence;
    ElytroDefaultValidator public elytroDefaultValidator;
    IElytro public elytro;
    address public walletOwner;
    uint256 public walletOwnerPrivateKey;

    DailyERC20SpendingLimitHook public dailyLimitHook;
    uint256 public constant DAILY_LIMIT = 1 ether;
    TokenERC20 testLimitToken;
    TokenERC20 testNoLimitToken;
    EntryPoint public testEntryPoint;

    function setUp() public {
        (walletOwner, walletOwnerPrivateKey) = makeAddrAndKey("owner");
        dailyLimitHook = new DailyERC20SpendingLimitHook();
        testLimitToken = new TokenERC20(18);
        testNoLimitToken = new TokenERC20(18);

        bytes[] memory modules = new bytes[](0);
        bytes[] memory hooks = new bytes[](1);
        uint8 capabilityFlags = 2; // preUserOpValidationHook only
        address[] memory tokens = new address[](2);
        uint256[] memory limits = new uint256[](2);
        tokens[0] = address(testLimitToken);
        limits[0] = DAILY_LIMIT;
        tokens[1] = address(2);
        limits[1] = DAILY_LIMIT;
        bytes memory tokenAndLimit = abi.encode(tokens, limits);
        hooks[0] = abi.encodePacked(address(dailyLimitHook), tokenAndLimit, capabilityFlags);

        bytes32[] memory owners = new bytes32[](1);
        owners[0] = walletOwner.toBytes32();
        bytes32 salt = bytes32(0);
        elytroInstence = new ElytroInstence(address(0), owners, modules, hooks, salt);
        elytroDefaultValidator = elytroInstence.defaultValidator();
        elytro = elytroInstence.elytro();
        testEntryPoint = elytroInstence.entryPoint();
    }

    function test_ethUnderLimit() public {
        vm.deal(address(elytro), 1000 ether);

        bytes memory callData = abi.encodeWithSelector(IStandardExecutor.execute.selector, address(10), 0.5 ether, "");

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
        bytes memory hookAndData = returnDummyHookAndData();

        PackedUserOperation[] memory ops = new PackedUserOperation[](1);
        userOperation.signature = signUserOp(
            testEntryPoint, userOperation, walletOwnerPrivateKey, address(elytroDefaultValidator), hookAndData
        );
        ops[0] = userOperation;
        testEntryPoint.handleOps(ops, payable(walletOwner));
    }

    function test_ethOverLimit() public {
        vm.deal(address(elytro), 1000 ether);

        bytes memory callData = abi.encodeWithSelector(IStandardExecutor.execute.selector, address(10), 2 ether, "");

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
        bytes memory hookAndData = returnDummyHookAndData();

        PackedUserOperation[] memory ops = new PackedUserOperation[](1);
        userOperation.signature = signUserOp(
            testEntryPoint, userOperation, walletOwnerPrivateKey, address(elytroDefaultValidator), hookAndData
        );
        ops[0] = userOperation;
        vm.expectRevert();
        testEntryPoint.handleOps(ops, payable(walletOwner));
    }

    function test_multipleTxsInOneDay() public {
        vm.deal(address(elytro), 1000 ether);

        // First transaction: 0.4 ether
        _executeTransaction(0.4 ether, false);

        // Second transaction: 0.4 ether
        _executeTransaction(0.4 ether, false);

        _executeTransaction(0.3 ether, true);
    }

    function test_resetLimitNextDay() public {
        vm.deal(address(elytro), 1000 ether);

        // First day transactions
        _executeTransaction(0.5 ether, false);
        _executeTransaction(0.4 ether, false);

        // Move to next day
        vm.warp(block.timestamp + 24 hours);

        // Should work as limit is reset
        _executeTransaction(0.5 ether, false);
    }

    function _executeTransaction(uint256 amount, bool expectRevert) internal {
        bytes memory callData = abi.encodeWithSelector(IStandardExecutor.execute.selector, address(10), amount, "");

        PackedUserOperation memory userOperation = UserOperationHelper.newUserOp({
            sender: address(elytro),
            nonce: testEntryPoint.getNonce(address(elytro), 0),
            initCode: "",
            callData: callData,
            callGasLimit: 900000,
            verificationGasLimit: 1000000,
            preVerificationGas: 300000,
            maxFeePerGas: 100 gwei,
            maxPriorityFeePerGas: 100 gwei,
            paymasterAndData: ""
        });

        bytes memory hookAndData = returnDummyHookAndData();
        PackedUserOperation[] memory ops = new PackedUserOperation[](1);
        userOperation.signature = signUserOp(
            testEntryPoint, userOperation, walletOwnerPrivateKey, address(elytroDefaultValidator), hookAndData
        );
        ops[0] = userOperation;
        if (expectRevert) {
            vm.expectRevert();
        }
        testEntryPoint.handleOps(ops, payable(walletOwner));
    }

    function test_erc20UnderLimit() public {
        vm.deal(address(elytro), 1000 ether);
        // Mint tokens to the wallet
        testLimitToken.sudoMint(address(elytro), 1000 ether);

        bytes memory callData = abi.encodeWithSelector(
            IStandardExecutor.execute.selector,
            address(testLimitToken),
            0,
            abi.encodeWithSelector(IERC20.transfer.selector, address(10), 0.5 ether)
        );

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
        bytes memory hookAndData = returnDummyHookAndData();

        PackedUserOperation[] memory ops = new PackedUserOperation[](1);
        userOperation.signature = signUserOp(
            testEntryPoint, userOperation, walletOwnerPrivateKey, address(elytroDefaultValidator), hookAndData
        );
        ops[0] = userOperation;
        testEntryPoint.handleOps(ops, payable(walletOwner));
    }

    function test_erc20OverLimit() public {
        vm.deal(address(elytro), 1000 ether);
        // Mint tokens to the wallet
        testLimitToken.sudoMint(address(elytro), 1000 ether);

        bytes memory callData = abi.encodeWithSelector(
            IStandardExecutor.execute.selector,
            address(testLimitToken),
            0,
            abi.encodeWithSelector(IERC20.transfer.selector, address(10), 2 ether)
        );

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
        bytes memory hookAndData = returnDummyHookAndData();

        PackedUserOperation[] memory ops = new PackedUserOperation[](1);
        userOperation.signature = signUserOp(
            testEntryPoint, userOperation, walletOwnerPrivateKey, address(elytroDefaultValidator), hookAndData
        );
        ops[0] = userOperation;
        vm.expectRevert();
        testEntryPoint.handleOps(ops, payable(walletOwner));
    }

    function test_erc20MultipleTxsInOneDay() public {
        vm.deal(address(elytro), 1000 ether);
        // Mint tokens to the wallet
        testLimitToken.sudoMint(address(elytro), 1000 ether);

        // First transaction: 0.4 ether
        _executeERC20Transaction(0.4 ether, false);

        // Second transaction: 0.4 ether
        _executeERC20Transaction(0.4 ether, false);

        // Third transaction should revert as it exceeds daily limit
        _executeERC20Transaction(0.3 ether, true);
    }

    function test_erc20ResetLimitNextDay() public {
        vm.deal(address(elytro), 1000 ether);
        // Mint tokens to the wallet
        testLimitToken.sudoMint(address(elytro), 1000 ether);

        // First day transactions
        _executeERC20Transaction(0.5 ether, false);
        vm.warp(block.timestamp + 12 hours);
        _executeERC20Transaction(0.4 ether, false);
        // Move to next day
        vm.warp(block.timestamp + 13 hours);

        // Should work as limit is reset
        _executeERC20Transaction(0.5 ether, false);
    }

    function _executeERC20Transaction(uint256 amount, bool expectRevert) internal {
        bytes memory callData = abi.encodeWithSelector(
            IStandardExecutor.execute.selector,
            address(testLimitToken),
            0,
            abi.encodeWithSelector(IERC20.transfer.selector, address(10), amount)
        );

        PackedUserOperation memory userOperation = UserOperationHelper.newUserOp({
            sender: address(elytro),
            nonce: testEntryPoint.getNonce(address(elytro), 0),
            initCode: "",
            callData: callData,
            callGasLimit: 900000,
            verificationGasLimit: 1000000,
            preVerificationGas: 300000,
            maxFeePerGas: 100 gwei,
            maxPriorityFeePerGas: 100 gwei,
            paymasterAndData: ""
        });

        bytes memory hookAndData = returnDummyHookAndData();
        PackedUserOperation[] memory ops = new PackedUserOperation[](1);
        userOperation.signature = signUserOp(
            testEntryPoint, userOperation, walletOwnerPrivateKey, address(elytroDefaultValidator), hookAndData
        );
        ops[0] = userOperation;
        if (expectRevert) {
            vm.expectRevert();
        }
        testEntryPoint.handleOps(ops, payable(walletOwner));
    }

    function test_noLimitTokenMultipleTransfers() public {
        vm.deal(address(elytro), 1000 ether);
        // Mint tokens to the wallet
        testNoLimitToken.sudoMint(address(elytro), 1000 ether);

        // Should be able to make multiple large transfers since this token isn't limited
        _executeNoLimitTokenTransaction(2 ether);
        _executeNoLimitTokenTransaction(3 ether);
        _executeNoLimitTokenTransaction(4 ether);
    }

    function test_noLimitTokenTransfer() public {
        vm.deal(address(elytro), 1000 ether);
        // Mint tokens to the wallet
        testNoLimitToken.sudoMint(address(elytro), 1000 ether);

        // Should be able to transfer more than the daily limit since this token isn't limited
        bytes memory callData = abi.encodeWithSelector(
            IStandardExecutor.execute.selector,
            address(testNoLimitToken),
            0,
            abi.encodeWithSelector(IERC20.transfer.selector, address(10), 2 ether)
        );

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
        bytes memory hookAndData = returnDummyHookAndData();

        PackedUserOperation[] memory ops = new PackedUserOperation[](1);
        userOperation.signature = signUserOp(
            testEntryPoint, userOperation, walletOwnerPrivateKey, address(elytroDefaultValidator), hookAndData
        );
        ops[0] = userOperation;
        testEntryPoint.handleOps(ops, payable(walletOwner));
    }

    function _executeNoLimitTokenTransaction(uint256 amount) internal {
        bytes memory callData = abi.encodeWithSelector(
            IStandardExecutor.execute.selector,
            address(testNoLimitToken),
            0,
            abi.encodeWithSelector(IERC20.transfer.selector, address(10), amount)
        );

        PackedUserOperation memory userOperation = UserOperationHelper.newUserOp({
            sender: address(elytro),
            nonce: testEntryPoint.getNonce(address(elytro), 0),
            initCode: "",
            callData: callData,
            callGasLimit: 900000,
            verificationGasLimit: 1000000,
            preVerificationGas: 300000,
            maxFeePerGas: 100 gwei,
            maxPriorityFeePerGas: 100 gwei,
            paymasterAndData: ""
        });

        bytes memory hookAndData = returnDummyHookAndData();
        PackedUserOperation[] memory ops = new PackedUserOperation[](1);
        userOperation.signature = signUserOp(
            testEntryPoint, userOperation, walletOwnerPrivateKey, address(elytroDefaultValidator), hookAndData
        );
        ops[0] = userOperation;
        testEntryPoint.handleOps(ops, payable(walletOwner));
    }

    function returnDummyHookAndData() private view returns (bytes memory) {
        // just using dummy data for placeholder
        bytes memory hookData = hex"aa";
        bytes4 hookSignatureLength = bytes4(uint32(hookData.length));
        return abi.encodePacked(address(dailyLimitHook), hookSignatureLength, hookData);
    }

    function test_initiateAndApplyLimitChange() public {
        // Test initiating and applying a limit change
        uint256 newLimit = 2 ether;

        // Initiate limit change
        vm.prank(address(elytro));
        dailyLimitHook.initiateSetLimit(address(testLimitToken), newLimit);

        // Check pending limit
        (uint256 pendingLimit, uint256 effectiveTime) =
            dailyLimitHook.getPendingLimit(address(elytro), address(testLimitToken));
        assertEq(pendingLimit, newLimit);
        assertEq(effectiveTime, block.timestamp + 1 days);

        // Move time forward past the time lock
        vm.warp(block.timestamp + 1 days + 1);

        // Apply the limit change
        vm.prank(address(elytro));
        dailyLimitHook.applySetLimit(address(testLimitToken));

        // Verify new limit is set
        uint256 currentLimit = dailyLimitHook.getCurrentLimit(address(elytro), address(testLimitToken));
        assertEq(currentLimit, newLimit);
    }

    function test_cancelLimitChange() public {
        uint256 newLimit = 2 ether;
        uint256 originalLimit = dailyLimitHook.getCurrentLimit(address(elytro), address(testLimitToken));

        // Initiate limit change
        vm.prank(address(elytro));
        dailyLimitHook.initiateSetLimit(address(testLimitToken), newLimit);

        // Cancel the change
        vm.prank(address(elytro));
        dailyLimitHook.cancelSetLimit(address(testLimitToken));

        // Verify limit remains unchanged
        uint256 currentLimit = dailyLimitHook.getCurrentLimit(address(elytro), address(testLimitToken));
        assertEq(currentLimit, originalLimit);

        // Verify pending change is cleared
        (uint256 pendingLimit, uint256 effectiveTime) =
            dailyLimitHook.getPendingLimit(address(elytro), address(testLimitToken));
        assertEq(pendingLimit, 0);
        assertEq(effectiveTime, 0);
    }

    function test_cannotApplyLimitBeforeTimelock() public {
        uint256 newLimit = 2 ether;

        // Initiate limit change
        vm.prank(address(elytro));
        dailyLimitHook.initiateSetLimit(address(testLimitToken), newLimit);

        // Try to apply before timelock expires
        vm.warp(block.timestamp + 1 days - 1);
        vm.prank(address(elytro));
        vm.expectRevert("Time lock not expired");
        dailyLimitHook.applySetLimit(address(testLimitToken));
    }

    function test_cancelAfterTimelock() public {
        uint256 newLimit = 2 ether;

        // Initiate limit change
        vm.prank(address(elytro));
        dailyLimitHook.initiateSetLimit(address(testLimitToken), newLimit);

        // Move time forward past the time lock
        vm.warp(block.timestamp + 1 days + 1);

        // test cancel after timelock expires
        vm.prank(address(elytro));
        dailyLimitHook.cancelSetLimit(address(testLimitToken));
    }

    function test_cannotSetZeroLimit() public {
        // Try to set zero limit
        vm.prank(address(elytro));
        vm.expectRevert("newLimit must be greater than 0");
        dailyLimitHook.initiateSetLimit(address(testLimitToken), 0);
    }

    function test_spendingWithNewLimit() public {
        uint256 newLimit = 2 ether;

        // Initiate and apply new limit
        vm.startPrank(address(elytro));
        dailyLimitHook.initiateSetLimit(address(testLimitToken), newLimit);
        vm.warp(block.timestamp + 1 days + 1);
        dailyLimitHook.applySetLimit(address(testLimitToken));
        vm.stopPrank();

        // Test spending with new limit
        vm.deal(address(elytro), 1000 ether);
        testLimitToken.sudoMint(address(elytro), 1000 ether);

        // Should succeed with 1.5 ether (was impossible with old limit)
        _executeERC20Transaction(1.5 ether, false);

        // Should fail with amount over new limit
        _executeERC20Transaction(2.5 ether, true);
    }

    function test_newTokenLimitNoTimelock() public {
        TokenERC20 newToken = new TokenERC20(18);
        uint256 newLimit = 2 ether;

        // Set limit for new token
        vm.prank(address(elytro));
        dailyLimitHook.initiateSetLimit(address(newToken), newLimit);

        // Verify limit is set immediately
        uint256 currentLimit = dailyLimitHook.getCurrentLimit(address(elytro), address(newToken));
        assertEq(currentLimit, newLimit);

        // Verify no pending change
        (uint256 pendingLimit, uint256 effectiveTime) =
            dailyLimitHook.getPendingLimit(address(elytro), address(newToken));
        assertEq(pendingLimit, 0);
        assertEq(effectiveTime, 0);
    }

    function test_newTokenSpendingWithImmediateLimit() public {
        // Setup new token
        TokenERC20 newToken = new TokenERC20(18);
        uint256 newLimit = 2 ether;
        vm.deal(address(elytro), 1000 ether);
        newToken.sudoMint(address(elytro), 1000 ether);

        // Set limit for new token
        vm.prank(address(elytro));
        dailyLimitHook.initiateSetLimit(address(newToken), newLimit);

        // Should be able to spend immediately under the new limit
        bytes memory callData = abi.encodeWithSelector(
            IStandardExecutor.execute.selector,
            address(newToken),
            0,
            abi.encodeWithSelector(IERC20.transfer.selector, address(10), 1.5 ether)
        );

        PackedUserOperation memory userOperation = UserOperationHelper.newUserOp({
            sender: address(elytro),
            nonce: testEntryPoint.getNonce(address(elytro), 0),
            initCode: "",
            callData: callData,
            callGasLimit: 900000,
            verificationGasLimit: 1000000,
            preVerificationGas: 300000,
            maxFeePerGas: 100 gwei,
            maxPriorityFeePerGas: 100 gwei,
            paymasterAndData: ""
        });

        bytes memory hookAndData = returnDummyHookAndData();
        PackedUserOperation[] memory ops = new PackedUserOperation[](1);
        userOperation.signature = signUserOp(
            testEntryPoint, userOperation, walletOwnerPrivateKey, address(elytroDefaultValidator), hookAndData
        );
        ops[0] = userOperation;
        testEntryPoint.handleOps(ops, payable(walletOwner));

        // Should fail when trying to spend over the new limit
        callData = abi.encodeWithSelector(
            IStandardExecutor.execute.selector,
            address(newToken),
            0,
            abi.encodeWithSelector(IERC20.transfer.selector, address(10), 2.5 ether)
        );

        userOperation = UserOperationHelper.newUserOp({
            sender: address(elytro),
            nonce: testEntryPoint.getNonce(address(elytro), 0),
            initCode: "",
            callData: callData,
            callGasLimit: 900000,
            verificationGasLimit: 1000000,
            preVerificationGas: 300000,
            maxFeePerGas: 100 gwei,
            maxPriorityFeePerGas: 100 gwei,
            paymasterAndData: ""
        });

        ops[0] = userOperation;
        ops[0].signature = signUserOp(
            testEntryPoint, userOperation, walletOwnerPrivateKey, address(elytroDefaultValidator), hookAndData
        );
        vm.expectRevert();
        testEntryPoint.handleOps(ops, payable(walletOwner));
    }

    function test_erc20ApproveEnforcesDailyLimit() public {
        vm.deal(address(elytro), 1000 ether);
        testLimitToken.sudoMint(address(elytro), 1000 ether);

        _executeERC20Transaction(0.5 ether, false);

        uint256 remaining = dailyLimitHook.getRemainingLimit(address(elytro), address(testLimitToken));
        assertEq(remaining, 0.5 ether);

        // Try to approve 2 ether (should fail, exceeds daily limit)
        bytes memory callData = abi.encodeWithSelector(
            IStandardExecutor.execute.selector,
            address(testLimitToken),
            0,
            abi.encodeWithSelector(IERC20.approve.selector, address(10), 2 ether)
        );

        PackedUserOperation memory userOperation = UserOperationHelper.newUserOp({
            sender: address(elytro),
            nonce: testEntryPoint.getNonce(address(elytro), 0),
            initCode: "",
            callData: callData,
            callGasLimit: 900000,
            verificationGasLimit: 1000000,
            preVerificationGas: 300000,
            maxFeePerGas: 100 gwei,
            maxPriorityFeePerGas: 100 gwei,
            paymasterAndData: ""
        });

        bytes memory hookAndData = returnDummyHookAndData();
        PackedUserOperation[] memory ops = new PackedUserOperation[](1);
        userOperation.signature = signUserOp(
            testEntryPoint, userOperation, walletOwnerPrivateKey, address(elytroDefaultValidator), hookAndData
        );
        ops[0] = userOperation;

        // Should revert due to daily limit enforcement
        vm.expectRevert();
        testEntryPoint.handleOps(ops, payable(walletOwner));
    }

    function test_erc20IncreaseAllowanceEnforcesDailyLimit() public {
        vm.deal(address(elytro), 1000 ether);
        testLimitToken.sudoMint(address(elytro), 1000 ether);

        _executeERC20Transaction(0.5 ether, false);

        uint256 remaining = dailyLimitHook.getRemainingLimit(address(elytro), address(testLimitToken));
        assertEq(remaining, 0.5 ether);

        // Try to increaseAllowance by 2 ether (should fail, exceeds daily limit)
        bytes memory callData = abi.encodeWithSelector(
            IStandardExecutor.execute.selector,
            address(testLimitToken),
            0,
            abi.encodeWithSelector(testLimitToken.increaseAllowance.selector, address(10), 2 ether)
        );

        PackedUserOperation memory userOperation = UserOperationHelper.newUserOp({
            sender: address(elytro),
            nonce: testEntryPoint.getNonce(address(elytro), 0),
            initCode: "",
            callData: callData,
            callGasLimit: 900000,
            verificationGasLimit: 1000000,
            preVerificationGas: 300000,
            maxFeePerGas: 100 gwei,
            maxPriorityFeePerGas: 100 gwei,
            paymasterAndData: ""
        });

        bytes memory hookAndData = returnDummyHookAndData();
        PackedUserOperation[] memory ops = new PackedUserOperation[](1);
        userOperation.signature = signUserOp(
            testEntryPoint, userOperation, walletOwnerPrivateKey, address(elytroDefaultValidator), hookAndData
        );
        ops[0] = userOperation;

        // Should revert due to daily limit enforcement
        vm.expectRevert();
        testEntryPoint.handleOps(ops, payable(walletOwner));
    }

    function test_erc20IncreaseAllowanceWithinLimit() public {
        vm.deal(address(elytro), 1000 ether);
        testLimitToken.sudoMint(address(elytro), 1000 ether);

        // Try to increaseAllowance by 0.3 ether (should succeed, within daily limit)
        bytes memory callData = abi.encodeWithSelector(
            IStandardExecutor.execute.selector,
            address(testLimitToken),
            0,
            abi.encodeWithSelector(testLimitToken.increaseAllowance.selector, address(10), 0.3 ether)
        );

        PackedUserOperation memory userOperation = UserOperationHelper.newUserOp({
            sender: address(elytro),
            nonce: testEntryPoint.getNonce(address(elytro), 0),
            initCode: "",
            callData: callData,
            callGasLimit: 900000,
            verificationGasLimit: 1000000,
            preVerificationGas: 300000,
            maxFeePerGas: 100 gwei,
            maxPriorityFeePerGas: 100 gwei,
            paymasterAndData: ""
        });

        bytes memory hookAndData = returnDummyHookAndData();
        PackedUserOperation[] memory ops = new PackedUserOperation[](1);
        userOperation.signature = signUserOp(
            testEntryPoint, userOperation, walletOwnerPrivateKey, address(elytroDefaultValidator), hookAndData
        );
        ops[0] = userOperation;

        // Should succeed as it's within the daily limit
        testEntryPoint.handleOps(ops, payable(walletOwner));

        // Verify that the remaining limit is reduced
        uint256 remaining = dailyLimitHook.getRemainingLimit(address(elytro), address(testLimitToken));
        assertEq(remaining, 0.7 ether, "Remaining limit should be reduced by 0.3 ether");
    }

    function test_deInitClearsAllTokenLimits() public {
        vm.deal(address(elytro), 1000 ether);
        testLimitToken.sudoMint(address(elytro), 1000 ether);

        vm.prank(address(elytro));
        dailyLimitHook.initiateSetLimit(address(testLimitToken), 1 ether);
        vm.warp(block.timestamp + 1 days + 1);
        vm.prank(address(elytro));
        dailyLimitHook.applySetLimit(address(testLimitToken));

        // Verify limits are set
        uint256 limit1 = dailyLimitHook.getCurrentLimit(address(elytro), address(testLimitToken));
        assertEq(limit1, 1 ether);

        // DeInit the hook
        vm.prank(address(elytro));
        dailyLimitHook.DeInit();

        // Verify limits are cleared
        uint256 limit1After = dailyLimitHook.getCurrentLimit(address(elytro), address(testLimitToken));
        assertEq(limit1After, 0);

        // Verify remaining limits return max (no limits set)
        uint256 remaining1 = dailyLimitHook.getRemainingLimit(address(elytro), address(testLimitToken));
        assertEq(remaining1, type(uint256).max);
    }
}
