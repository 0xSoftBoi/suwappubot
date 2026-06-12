// SPDX-License-Identifier: GPL-3.0
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import {MessageHashUtils} from "@openzeppelin/contracts/utils/cryptography/MessageHashUtils.sol";
import "@source/validator/SoulWalletDefaultValidator.sol";
import "@source/libraries/TypeConversion.sol";
import {ISoulWallet} from "@source/interfaces/ISoulWallet.sol";
import "@source/abstract/DefaultCallbackHandler.sol";
import {SoulWalletInstence} from "../soulwallet/base/SoulWalletInstence.sol";
import {SoulWalletDefaultValidator} from "@source/validator/SoulWalletDefaultValidator.sol";
import {P256} from "@openzeppelin/contracts/utils/cryptography/P256.sol";

contract ValidatorSigDecoderTest is Test {
    bytes4 internal constant MAGICVALUE = 0x1626ba7e;
    // Constants indicating different invalid states
    bytes4 internal constant INVALID_ID = 0xffffffff;
    bytes4 internal constant INVALID_TIME_RANGE = 0xfffffffe;
    SoulWalletDefaultValidator soulWalletDefaultValidator;

    using TypeConversion for address;
    using MessageHashUtils for bytes32;

    address public owner;
    uint256 public ownerKey;
    SoulWalletInstence public soulWalletInstence;
    ISoulWallet soulWallet;

    function setUp() public {
        (owner, ownerKey) = makeAddrAndKey("owner");
        soulWalletDefaultValidator = new SoulWalletDefaultValidator();
        bytes[] memory modules = new bytes[](0);
        bytes[] memory hooks = new bytes[](0);
        bytes32 salt = bytes32(0);
        DefaultCallbackHandler defaultCallbackHandler = new DefaultCallbackHandler();
        bytes32[] memory owners = new bytes32[](2);
        owners[0] = (owner).toBytes32();
        //   bytes32 expected;
        uint256 Qx = uint256(0xEF1725ABD32B320321B811941E94FF32CD326B83A25D5BC19459FAF2EC98B41C);
        uint256 Qy = uint256(0xEC9087BA68464494F1BE48478E6D08FA0AFC45405E23B9B17BD9F8F76A6F51F4);
        bytes32 passkeyOwner = keccak256(abi.encodePacked(Qx, Qy));
        console.log("passkeyOwner");
        console.logBytes32(passkeyOwner);
        owners[1] = passkeyOwner;

        soulWalletInstence = new SoulWalletInstence(
            address(defaultCallbackHandler), address(new SoulWalletDefaultValidator()), owners, modules, hooks, salt
        );
        soulWallet = soulWalletInstence.soulWallet();
        assertEq(soulWallet.isOwner(owner.toBytes32()), true);
        assertEq(soulWallet.isOwner(passkeyOwner), true);
    }

    /*
    validator signature format
    +----------------------------------------------------------+
    |                                                          |
    |             validator signature                          |
    |                                                          |
    +-------------------------------+--------------------------+
    |         signature type        |       signature data     |
    +-------------------------------+--------------------------+
    |                               |                          |
    |            1 byte             |          ......          |
    |                               |                          |
    +-------------------------------+--------------------------+

    

    A: signature type 0: eoa sig without validation data

    +------------------------------------------------------------------------+
    |                                                                        |
    |                             validator signature                        |
    |                                                                        |
    +--------------------------+----------------------------------------------+
    |       signature type     |                signature data                |
    +--------------------------+----------------------------------------------+
    |                          |                                              |
    |           0x00           |                    65 bytes                  |
    |                          |                                              |
    +--------------------------+----------------------------------------------+
    */
    function test_ValidatorRecoverSignatureTypeA() public {
        bytes32 hash = keccak256(abi.encodePacked("hello world"));
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(ownerKey, hash);
        bytes memory sig = abi.encodePacked(r, s, v);
        assertEq(sig.length, 65);
        uint8 signType = 0;
        bytes memory validatorSignature = abi.encodePacked(signType, sig);
        vm.startPrank(address(soulWallet));
        bytes4 validateResult = soulWalletDefaultValidator.validateSignature(owner, hash, validatorSignature);
        assertEq(validateResult, MAGICVALUE);
    }
    /*
    B: signature type 1: eoa sig with validation data
    +-------------------------------------------------------------------------------------+
    |                                                                                     |
    |                                        validator signature                          |
    |                                                                                     |
    +-------------------------------+--------------------------+---------------------------+
    |         signature type        |      validationData      |       signature data      |
    +-------------------------------+--------------------------+---------------------------+
    |                               |                          |                           |
    |            0x01               |     uint256 32 bytes     |           65 bytes        |
    |                               |                          |                           |
    +-------------------------------+--------------------------+---------------------------+
    */

    function test_ValidatorRecoverSignatureTypeB() public {
        bytes32 hash = keccak256(abi.encodePacked("hello world"));
        uint48 validUntil = 0;
        uint48 validAfter = 1695199125;
        vm.warp(validAfter + 60);
        uint256 validationData = (uint256(validUntil) << 160) | (uint256(validAfter) << (160 + 48));
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(ownerKey, keccak256(abi.encodePacked(hash, validationData)));
        bytes memory sig = abi.encodePacked(r, s, v);
        assertEq(sig.length, 65);
        uint8 signType = 1;
        bytes memory validatorSignature = abi.encodePacked(signType, validationData, sig);
        vm.startPrank(address(soulWallet));
        bytes4 validateResult = soulWalletDefaultValidator.validateSignature(owner, hash, validatorSignature);
        assertEq(validateResult, MAGICVALUE);
    }
    /*
    C: signature type 2: passkey sig without validation data
    -----------------------------------------------------------------------------------------------------------------+
    |                                                                                                                |
    |                                     validator singature                                                        |
    |                                                                                                                |
    +-------------------+--------------------------------------------------------------------------------------------+
    |                   |                                                                                            |
    |   signature type  |                            signature data                                                  |
    |                   |                                                                                            |
    +----------------------------------------------------------------------------------------------------------------+
    |                   |                                                                                            |
    |     0x2           |                            dynamic signature                                               |
    |                   |                                                                                            |
    +-------------------+--------------------------------------------------------------------------------------------+

    */

    function test_SignValidatorTypeC() public {
        bytes memory sig = hex"00" // algorithmType
            hex"12ade0dca831d36d3645590fac16d8270927b336e563af886da93bfdf14fa184" // r
            hex"74bca343c4bc743ba6dd68e5f2c5e2ca1014112b9e0d43cfd4e28d8e7d646661" // s
            hex"EF1725ABD32B320321B811941E94FF32CD326B83A25D5BC19459FAF2EC98B41C" // x
            hex"EC9087BA68464494F1BE48478E6D08FA0AFC45405E23B9B17BD9F8F76A6F51F4" // y
            hex"00250000" // 0x00250000: authenticatorDataLength=0x25
            hex"49960de5880e8c687434170f6476605b8fe4aeb9a28632c7995cf3ba831d97630500000000222c226f726967696e223a2268747470733a2f2f776562617574686e2d6d6f636b2e736f756c77616c6c65742e696f222c2263726f73734f726967696e223a66616c73657d";
        bytes32 userOpHash = 0x355f84376b4cb4bc536c8e57f6607d0acac4db2a287734fd13a8eaee2edeaf75;

        uint8 signType = 0x2;
        bytes memory validatorSignature = abi.encodePacked(signType, sig);
        vm.startPrank(address(soulWallet));
        bytes4 result = soulWalletDefaultValidator.validateSignature(msg.sender, userOpHash, validatorSignature);
        assertEq(result, MAGICVALUE);
    }

    function test_p256() public view {
        bytes32 hash = 0x5f7bc87cdaf014addc19068b92d9c8f7b30ac415718163906171fc8eea9c80d6;
        bytes32 r = 0x12ade0dca831d36d3645590fac16d8270927b336e563af886da93bfdf14fa184;
        bytes32 s = 0x74bca343c4bc743ba6dd68e5f2c5e2ca1014112b9e0d43cfd4e28d8e7d646661;
        bytes32 x = 0xEF1725ABD32B320321B811941E94FF32CD326B83A25D5BC19459FAF2EC98B41C;
        bytes32 y = 0xEC9087BA68464494F1BE48478E6D08FA0AFC45405E23B9B17BD9F8F76A6F51F4;
        bool result = P256.verify(hash, r, s, x, y);
        assertEq(result, true);
    }
}
