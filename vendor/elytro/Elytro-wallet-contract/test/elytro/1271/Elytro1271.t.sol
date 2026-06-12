// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "forge-std/Test.sol";
import "../base/ElytroInstence.sol";

import "@source/libraries/TypeConversion.sol";
import "@source/abstract/DefaultCallbackHandler.sol";
import {IERC1271} from "@openzeppelin/contracts/interfaces/IERC1271.sol";
import {EntryPoint} from "@account-abstraction/contracts/core/EntryPoint.sol";

contract DeployDirectTest is Test {
    using TypeConversion for address;

    bytes4 internal constant MAGICVALUE = 0x1626ba7e;
    bytes4 internal constant INVALID_ID = 0xffffffff;

    IElytro elytro;
    ElytroInstence elytroInstence;
    ElytroDefaultValidator elytroDefaultValidator;
    address public walletOwner;
    uint256 public walletOwnerPrivateKey;
    bytes32 private constant ELYTRO_WALLET_MSG_TYPEHASH = keccak256("ElytroMessage(bytes32 message)");

    bytes32 private constant DOMAIN_SEPARATOR_TYPEHASH =
        keccak256("EIP712Domain(uint256 chainId,address verifyingContract)");

    function encodeRawHash(bytes32 rawHash, address account) private view returns (bytes32) {
        bytes32 encode1271MessageHash = keccak256(abi.encode(ELYTRO_WALLET_MSG_TYPEHASH, rawHash));
        bytes32 domainSeparator = keccak256(abi.encode(DOMAIN_SEPARATOR_TYPEHASH, getChainId(), address(account)));
        return keccak256(abi.encodePacked(bytes1(0x19), bytes1(0x01), domainSeparator, encode1271MessageHash));
    }

    function getChainId() private view returns (uint256) {
        uint256 id;
        // solhint-disable-next-line no-inline-assembly
        assembly {
            id := chainid()
        }
        return id;
    }

    function setUp() public {
        (walletOwner, walletOwnerPrivateKey) = makeAddrAndKey("owner");
        bytes[] memory modules = new bytes[](0);
        bytes[] memory hooks = new bytes[](0);
        bytes32 salt = bytes32(0);
        DefaultCallbackHandler defaultCallbackHandler = new DefaultCallbackHandler();
        bytes32[] memory owners = new bytes32[](1);
        owners[0] = walletOwner.toBytes32();
        elytroInstence = new ElytroInstence(address(defaultCallbackHandler), owners, modules, hooks, salt);
        elytroDefaultValidator = elytroInstence.defaultValidator();
        elytro = elytroInstence.elytro();
    }

    function signMsg(uint256 privateKey, bytes32 _hash, address validatorAddress)
        private
        pure
        returns (bytes memory signature)
    {
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(privateKey, _hash);
        bytes memory signatureData = abi.encodePacked(r, s, v);
        uint8 signType = 0;
        bytes4 signatureLength = bytes4(uint32(1 + signatureData.length));
        return abi.encodePacked(address(validatorAddress), signatureLength, signType, signatureData);
    }

    function testVerify1271Signature() public view {
        bytes32 hash = keccak256("hello world");
        bytes32 rawHash = encodeRawHash(hash, address(elytro));
        bytes memory signature = signMsg(walletOwnerPrivateKey, rawHash, address(elytroDefaultValidator));
        console.log("elytro", address(elytro));
        bytes4 result = IERC1271(address(elytro)).isValidSignature(hash, signature);
        assertEq(result, MAGICVALUE);
    }
}
