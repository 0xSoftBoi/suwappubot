// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "forge-std/Test.sol";
import "../base/ElytroInstence.sol";
import {ElytroDefaultValidator} from "@source/validator/ElytroDefaultValidator.sol";

import "@source/libraries/TypeConversion.sol";
import "../../dev/tokens/TokenERC20.sol";
import "@source/abstract/DefaultCallbackHandler.sol";

contract DeployDirectTest is Test {
    using TypeConversion for address;

    function setUp() public {}

    error ERC20InsufficientBalance(address sender, uint256 balance, uint256 needed);

    function test_Deploy() public {
        bytes[] memory modules = new bytes[](0);
        bytes[] memory hooks = new bytes[](0);
        bytes32 salt = bytes32(0);
        DefaultCallbackHandler defaultCallbackHandler = new DefaultCallbackHandler();
        bytes32[] memory owners = new bytes32[](1);
        owners[0] = address(this).toBytes32();
        ElytroInstence elytroInstence =
            new ElytroInstence(address(defaultCallbackHandler), owners, modules, hooks, salt);
        IElytro elytro = elytroInstence.elytro();
        assertEq(elytro.isOwner(address(this).toBytes32()), true);
        assertEq(elytro.isOwner(address(0x1111).toBytes32()), false);

        TokenERC20 token = new TokenERC20(18);

        vm.startPrank(address(elytroInstence.entryPoint()));
        // execute(address dest, uint256 value, bytes calldata func)
        vm.expectRevert(
            abi.encodeWithSelector(ERC20InsufficientBalance.selector, address(elytroInstence.elytro()), 0, 1)
        );
        elytro.execute(address(token), 0, abi.encodeWithSignature("transfer(address,uint256)", address(0x1), 1));
        vm.stopPrank();
    }
}
