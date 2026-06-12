// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Base64Url} from "./Base64Url.sol";
import {P256} from "@openzeppelin/contracts/utils/cryptography/P256.sol";
import {RSA} from "@openzeppelin/contracts/utils/cryptography/RSA.sol";

library WebAuthn {
    /**
     * @dev Prefix for client data
     * defined in:
     * 1. https://www.w3.org/TR/webauthn-2/#dictdef-collectedclientdata
     * 2. https://www.w3.org/TR/webauthn-2/#clientdatajson-serialization
     */
    string private constant ClIENTDATA_PREFIX = "{\"type\":\"webauthn.get\",\"challenge\":\"";

    function decodeP256Signature(bytes calldata packedSignature)
        internal
        pure
        returns (
            uint256 r,
            uint256 s,
            uint256 x,
            uint256 y,
            bytes calldata authenticatorData,
            bytes calldata clientDataPrefix,
            bytes calldata clientDataSuffix
        )
    {
        /*
        signature layout:
        1. r (32 bytes)
        2. s (32 bytes)
        3. x (32 byte)
        4. y (32 byte)
        5. authenticatorData length (2 byte max 65535)
        6. clientDataPrefix length (2 byte max 65535)
        7. authenticatorData
        8. clientDataPrefix
        9. clientDataSuffix
        */
        uint256 authenticatorDataLength;
        uint256 clientDataPrefixLength;
        assembly ("memory-safe") {
            let calldataOffset := packedSignature.offset
            r := calldataload(calldataOffset)
            s := calldataload(add(calldataOffset, 0x20))
            x := calldataload(add(calldataOffset, 0x40))
            y := calldataload(add(calldataOffset, 0x60))
            let lengthData :=
                and(
                    calldataload(add(calldataOffset, 0x64 /* 32 * 3 + 4 */ )),
                    0xffffffff /* authenticatorDataLength+clientDataPrefixLength */
                )
            authenticatorDataLength := and(shr(0x10, lengthData), 0xffff)
            clientDataPrefixLength := and(lengthData, 0xffff)
        }
        unchecked {
            uint256 _dataOffset1 = 0x84; // 32+32+32+32+2+2
            uint256 _dataOffset2 = _dataOffset1 + authenticatorDataLength;
            authenticatorData = packedSignature[_dataOffset1:_dataOffset2];

            _dataOffset1 = _dataOffset2 + clientDataPrefixLength;
            clientDataPrefix = packedSignature[_dataOffset2:_dataOffset1];

            clientDataSuffix = packedSignature[_dataOffset1:];
        }
    }

    function decodeRS256Signature(bytes calldata packedSignature)
        internal
        pure
        returns (
            bytes calldata n,
            bytes calldata signature,
            bytes calldata authenticatorData,
            bytes calldata clientDataPrefix,
            bytes calldata clientDataSuffix
        )
    {
        /*
        Note: currently use a fixed public exponent=0x010001. This is enough for the currently WebAuthn implementation.
        signature layout:
        1. n(exponent) length (2 byte max to 8192 bits key)
        2. authenticatorData length (2 byte max 65535)
        3. clientDataPrefix length (2 byte max 65535)
        4. n(exponent) (exponent,dynamic bytes)
        5. signature (signature,signature.length== n.length)
        6. authenticatorData
        7. clientDataPrefix
        8. clientDataSuffix
        */

        uint256 exponentLength;
        uint256 authenticatorDataLength;
        uint256 clientDataPrefixLength;
        assembly ("memory-safe") {
            let calldataOffset := packedSignature.offset
            let lengthData :=
                shr(
                    0xd0, // 8*(32-6), exponentLength+authenticatorDataLength+clientDataPrefixLength
                    calldataload(calldataOffset)
                )
            exponentLength := shr(0x20, /* 4*8 */ lengthData)
            authenticatorDataLength := and(shr(0x10, /* 2*8 */ lengthData), 0xffff)
            clientDataPrefixLength := and(lengthData, 0xffff)
        }
        unchecked {
            uint256 _dataOffset1 = 0x06; // 2+2+2
            uint256 _dataOffset2 = 0x06 + exponentLength;
            n = packedSignature[_dataOffset1:_dataOffset2];

            _dataOffset1 = _dataOffset2 + exponentLength;
            signature = packedSignature[_dataOffset2:_dataOffset1];

            _dataOffset2 = _dataOffset1 + authenticatorDataLength;
            authenticatorData = packedSignature[_dataOffset1:_dataOffset2];

            _dataOffset1 = _dataOffset2 + clientDataPrefixLength;
            clientDataPrefix = packedSignature[_dataOffset2:_dataOffset1];

            clientDataSuffix = packedSignature[_dataOffset1:];
        }
    }

    function recover_rs256(bytes32 userOpHash, bytes calldata packedSignature) internal view returns (bytes32) {
        bytes calldata n;
        bytes calldata signature;
        bytes calldata authenticatorData;
        bytes calldata clientDataPrefix;
        bytes calldata clientDataSuffix;

        (n, signature, authenticatorData, clientDataPrefix, clientDataSuffix) = decodeRS256Signature(packedSignature);

        bytes memory challengeBase64 = bytes(Base64Url.encode(bytes.concat(userOpHash)));
        bytes memory clientDataJSON;
        if (clientDataPrefix.length == 0) {
            clientDataJSON = bytes.concat(bytes(ClIENTDATA_PREFIX), challengeBase64, clientDataSuffix);
        } else {
            clientDataJSON = bytes.concat(clientDataPrefix, challengeBase64, clientDataSuffix);
        }
        bytes32 clientHash = sha256(clientDataJSON);
        bytes32 messageHash = sha256(bytes.concat(authenticatorData, clientHash));

        // Note: currently use a fixed public exponent=0x010001. This is enough for the currently WebAuthn implementation.
        bytes memory e = hex"0000000000000000000000000000000000000000000000000000000000010001";

        bool success = RSA.pkcs1Sha256(messageHash, signature, e, n);
        if (success) {
            return keccak256(abi.encodePacked(e, n));
        } else {
            return bytes32(0);
        }
    }

    function recover_p256(bytes32 userOpHash, bytes calldata packedSignature) internal view returns (bytes32) {
        uint256 r;
        uint256 s;
        uint256 x;
        uint256 y;
        bytes calldata authenticatorData;
        bytes calldata clientDataPrefix;
        bytes calldata clientDataSuffix;
        (r, s, x, y, authenticatorData, clientDataPrefix, clientDataSuffix) = decodeP256Signature(packedSignature);
        bytes memory challengeBase64 = bytes(Base64Url.encode(bytes.concat(userOpHash)));
        bytes memory clientDataJSON;
        if (clientDataPrefix.length == 0) {
            clientDataJSON = bytes.concat(bytes(ClIENTDATA_PREFIX), challengeBase64, clientDataSuffix);
        } else {
            clientDataJSON = bytes.concat(clientDataPrefix, challengeBase64, clientDataSuffix);
        }
        bytes32 clientHash = sha256(clientDataJSON);
        bytes32 message = sha256(bytes.concat(authenticatorData, clientHash));
        bool success = P256.verify(message, bytes32(r), bytes32(s), bytes32(x), bytes32(y));

        // If empty ret, return false
        if (success == false) {
            return bytes32(0);
        } else {
            return keccak256(abi.encodePacked(x, y));
        }
    }

    function recover(bytes32 hash, bytes calldata signature) internal view returns (bytes32) {
        /*
            signature layout:
            1. algorithmType (1 bytes)
            2. signature

            algorithmType:
            0x0: ES256(P256)
            0x1: RS256(e=65537)
        */
        uint8 algorithmType = uint8(signature[0]);
        if (algorithmType == 0x0) {
            return recover_p256(hash, signature[1:]);
        } else if (algorithmType == 0x1) {
            return recover_rs256(hash, signature[1:]);
        } else {
            revert("invalid algorithm type");
        }
    }
}
