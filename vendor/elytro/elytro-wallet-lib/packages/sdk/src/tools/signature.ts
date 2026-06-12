import { TypeGuard } from './typeGuard.js';
import { Hex } from "./hex.js";
import { ethers } from 'ethers';
import { HookInputDataItem, SignkeyType } from '../interface/IElytroWallet.js';
import { ECCPoint, RSAPublicKey, WebAuthN } from './webauthn.js';

export class Signature {
    /*
    signature format

    +-----------------------------------------------------------------------------------------------------+
    |                                           |                                                         |
    |                                           |                   validator signature                   |
    |                                           |                                                         |
    +---------------+---------------------------+--------------------------+-----------------------------+
    |     data type | data type dynamic data    |     signature type       |       signature data        |
    +---------------+---------------------------+--------------------------+-----------------------------+
    |               |                           |                          |                             |
    |    1 byte     |      ..........           |        1 byte            |          ......             |
    |               |                           |                          |                             |
    +-----------------------------------------------------------------------------------------------------+


    A: data type 0: no plugin data
    +-----------------------------------------------------------------------------------------------------+
    |                                           |                                                         |
    |                                           |                   validator signature                   |
    |                                           |                                                         |
    +---------------+---------------------------+--------------------------+-----------------------------+
    |     data type | data type dynamic data    |     signature type       |       signature data        |
    +---------------+---------------------------+--------------------------+-----------------------------+
    |               |                           |                          |                             |
    |     0x00      |      empty bytes          |        1 byte            |          ......             |
    |               |                           |                          |                             |
    +-----------------------------------------------------------------------------------------------------+




     B: data type 1: plugin data

    +-----------------------------------------------------------------------------------------------------+
    |                                           |                                                         |
    |                                           |                   validator signature                   |
    |                                           |                                                         |
    +---------------+---------------------------+--------------------------+-----------------------------+
    |     data type | data type dynamic data    |     signature type       |       signature data        |
    +---------------+---------------------------+--------------------------+-----------------------------+
    |               |                           |                          |                             |
    |     0x01      |      .............        |        1 byte            |          ......             |
    |               |                           |                          |                             |
    +-----------------------------------------------------------------------------------------------------+



    +-------------------------+-------------------------------------+
    |                                                               |
    |                  data type dynamic data                       |
    |                                                               |
    +-------------------------+-------------------------------------+
    | dynamic data length     | multi-hookInputData            |
    +-------------------------+-------------------------------------+
    | uint256 32 bytes        | dynamic data without length header  |
    +-------------------------+-------------------------------------+


    +--------------------------------------------------------------------------------+
    |                            multi-hookInputData                            |
    +--------------------------------------------------------------------------------+
    |   hookInputData  |  hookInputData   |   ...  |  hookInputData   |
    +-----------------------+-----------------------+--------+-----------------------+
    |     dynamic data      |     dynamic data      |   ...  |     dynamic data      |
    +--------------------------------------------------------------------------------+

    +----------------------------------------------------------------------+
    |                                hookInputData                    |
    +----------------------------------------------------------------------+
    |   hook address  |   input data length   |      input data       |
    +----------------------+-----------------------+-----------------------+
    |        20bytes       |     6bytes(uint48)    |         bytes         |
    +----------------------------------------------------------------------+

    Note: The order of hookInputData must be the same as the order in HookManager.listHook()!

     */

    static onlyEOASignature(signature: string): void {
        if (TypeGuard.onlyBytes(signature).isErr() === true) throw new Error('invalid EOA signature');
        if (signature.length !== 132) {
            throw new Error('invalid EOA signature');
        }
    }


    static packSignature(
        validatorAddress: string,
        signkeyType: SignkeyType,
        rawSignature: string,
        validationData: string,
        sortedHookInputDataItem?: HookInputDataItem[]): string {
        if (TypeGuard.onlyAddress(validatorAddress).isErr() === true) throw new Error('invalid validatorAddress');

        // `Signature`:
        // [0:20]: `validator address`
        let packedSignature = validatorAddress;
        // [20:24]: n = `validator signature length`, bytes4 max to 16777215 bytes
        let validatorSignature = '';
        {
            const _validationData = BigInt(validationData);
            const hasValidationData = _validationData > BigInt(0);
            if (signkeyType === SignkeyType.EOA) {
                if (hasValidationData) {
                    validatorSignature += "01";
                } else {
                    validatorSignature += "00";
                }
            } else if (signkeyType === SignkeyType.P256 || signkeyType === SignkeyType.RS256) {
                if (hasValidationData) {
                    validatorSignature += "03";
                } else {
                    validatorSignature += "02";
                }
            } else {
                throw new Error('invalid signkeyType');
            }
            let _validationDataHex = '';
            if (hasValidationData) {
                // validationData to 32 bytes hex string
                _validationDataHex = Hex.paddingZero(_validationData, 32).slice(2);
            }
            validatorSignature += _validationDataHex;
            if (rawSignature.startsWith('0x')) {
                rawSignature = rawSignature.slice(2);
            }
            validatorSignature += rawSignature;

        }
        packedSignature += (Hex.paddingZero(validatorSignature.length / 2, 4).slice(2));
        // [24:24+n]: `validator signature`
        packedSignature += validatorSignature;
        // `hook signature`:

        let hookInputDataBytes: string = '';
        if (sortedHookInputDataItem !== undefined && sortedHookInputDataItem.length > 0) {
            for (let i = 0; i < sortedHookInputDataItem.length; i++) {
                const inputItem = sortedHookInputDataItem[i];
                if (TypeGuard.onlyAddress(inputItem.hookAddress).isErr() === true) throw new Error('invalid sortedHookInputDataItem');
                if (inputItem.inputData.length < 4 /* 0x, 0x? */) {
                    continue;
                }
                if (TypeGuard.onlyBytes(inputItem.inputData).isErr() === true) throw new Error('invalid sortedHookInputDataItem');

                hookInputDataBytes += inputItem.hookAddress.slice(2);
                const hookInputData = inputItem.inputData.substring(2);
                const hookInputDataLength = hookInputData.length / 2;
                if (hookInputDataLength > Math.pow(2, 48 - 2)) {
                    throw new Error('invalid hookInputData');
                } else if (hookInputDataLength === 0) {
                    throw new Error('invalid hookInputData');
                }
                hookInputDataBytes += hookInputDataLength.toString(16).padStart(8, '0');
                hookInputDataBytes += inputItem.inputData.substring(2);
            }
        }

        packedSignature += hookInputDataBytes;
        return packedSignature.toLowerCase();
    }


    /**
     * pack EOA signature
     *
     * @static
     * @param {string} validatorAddress validator contract address
     * @param {string} signature signature signature 65 bytes signature
     * @param {string} [validationData] validationData validationData 32 bytes validationData
     * @param {HookInputDataItem[]} [sortedHookInputDataItem] 
     * Hint: The SortedHookInputData array **must be sorted exactly in the same order** as returned by the contract interface listHook().
     * Example code:
     * ```
     * const elytroWallet = new ethers.Contract(walletAddress, ABI_Elytro, this.provider);
     * const { preIsValidSignatureHooks, preUserOpValidationHooks } = await elytroWallet.listHook();
     * ```
     * 1. If you need to **pack a userOp signature**, you must sort the SortedHookInputData array in the **same order** as the preUserOpValidationHooks array.
     * 2. If you need to **pack an EIP-1271 signature**, you must sort the SortedHookInputData array in the **same order** as the preIsValidSignatureHooks array.
     * 
     * @return {*}  {string}
     * @memberof Signature
     */
    static packEOASignature(
        validatorAddress: string,
        signature: string, validationData: string, sortedHookInputDataItem?: HookInputDataItem[]): string {
        Signature.onlyEOASignature(signature);
        return Signature.packSignature(validatorAddress, SignkeyType.EOA, signature, validationData, sortedHookInputDataItem);
    }

    /**
     * pack P256 signature
     *
     * @static
     * @param {string} validator contract address
     * @param {{
     *             messageHash:string,
     *             publicKey: ECCPoint | string
     *             r: string,
     *             s: string,
     *             authenticatorData: string,
     *             clientDataSuffix: string
     *         }} signatureData
     * @param {string} validationData
     * @param {HookInputDataItem[]} [sortedHookInputDataItem] 
     * Hint: The SortedHookInputData array **must be sorted exactly in the same order** as returned by the contract interface listHook().
     * Example code:
     * ```
     * const elytroWallet = new ethers.Contract(walletAddress, ABI_Elytro, this.provider);
     * const { preIsValidSignatureHooks, preUserOpValidationHooks } = await elytroWallet.listHook();
     * ```
     * 1. If you need to **pack a userOp signature**, you must sort the SortedHookInputData array in the **same order** as the preUserOpValidationHooks array.
     * 2. If you need to **pack an EIP-1271 signature**, you must sort the SortedHookInputData array in the **same order** as the preIsValidSignatureHooks array.
     * 
     * @return {*}  {string}
     * @memberof Signature
     */
    static packP256Signature(
        validatorAddress: string,
        signatureData: {
            messageHash: string,
            publicKey: ECCPoint | string,
            r: string,
            s: string,
            authenticatorData: string,
            clientDataSuffix: string
        },
        validationData: string,
        sortedHookInputDataItem?: HookInputDataItem[]
    ): string {
        if (TypeGuard.onlyBytes32(signatureData.messageHash).isErr() === true) throw new Error('invalid messageHash');
        let publicKeyhash = '';
        if (typeof signatureData.publicKey === 'string') {
            if (TypeGuard.onlyBytes32(signatureData.publicKey).isErr() === true) {
                throw new Error('invalid publicKey:' + signatureData.publicKey);
            }
            publicKeyhash = signatureData.publicKey.toLowerCase();
        } else {
            const _key = WebAuthN.publicKeyToKeyhash(signatureData.publicKey);
            publicKeyhash = _key.toLowerCase();
        }
        if (TypeGuard.onlyBytes32(signatureData.r).isErr() === true) throw new Error('invalid r');
        if (TypeGuard.onlyBytes32(signatureData.s).isErr() === true) throw new Error('invalid s');
        if (TypeGuard.onlyBytes(signatureData.authenticatorData).isErr() === true) throw new Error('invalid authenticatorData');
        if (!signatureData.clientDataSuffix.startsWith('"')) {
            throw new Error('invalid clientDataSuffix');
        }
        let v = ''
        {
            const recover = WebAuthN.recoverWebAuthN(signatureData.messageHash, signatureData.r, signatureData.s, signatureData.authenticatorData, signatureData.clientDataSuffix);
            if (
                ethers.keccak256(ethers.solidityPacked(["uint256", "uint256"], [recover[0].x, recover[0].y])).toLowerCase() === publicKeyhash
            ) {
                v = '1b';// 27
            } else if (
                ethers.keccak256(ethers.solidityPacked(["uint256", "uint256"], [recover[1].x, recover[1].y])).toLowerCase() === publicKeyhash
            ) {
                v = '1c';// 28
            } else {
                throw new Error('invalid signature');
            }
        }

        /*
            webauthn signature type:
             0x0: p256
             0x1: rs256
        */
        let rawSignature = '00';

        /*
            signature layout:
            1. r (32 bytes)
            2. s (32 bytes)
            3. v (1 byte)
            4. authenticatorData length (2 byte max 65535)
            5. clientDataPrefix length (2 byte max 65535)
            6. authenticatorData
            7. clientDataPrefix
            8. clientDataSuffix
            
        */
        rawSignature += signatureData.r.slice(2);
        rawSignature += signatureData.s.slice(2);
        rawSignature += v;
        let _authenticatorData = signatureData.authenticatorData;
        if (_authenticatorData.startsWith('0x')) {
            _authenticatorData = _authenticatorData.slice(2);
        }
        rawSignature += Hex.paddingZero(_authenticatorData.length / 2, 2).slice(2);
        rawSignature += "0000"; // clientDataPrefix length = 0
        rawSignature += _authenticatorData;
        rawSignature += ethers.hexlify(ethers.toUtf8Bytes(signatureData.clientDataSuffix)).slice(2);

        return Signature.packSignature(validatorAddress, SignkeyType.P256, rawSignature, validationData, sortedHookInputDataItem);
    }


    /**
     * pack RS256 signature
     *
     * @static
     * @param {string} validator contract address
     * @param {{
     *             messageHash:string,
     *             publicKey: InitialKey,
     *             r: string,
     *             s: string,
     *             authenticatorData: string,
     *             clientDataSuffix: string
     *         }} signatureData
     * @param {string} validationData
     * @param {HookInputDataItem[]} [sortedHookInputDataItem] 
     * Hint: The SortedHookInputData array **must be sorted exactly in the same order** as returned by the contract interface listHook().
     * Example code:
     * ```
     * const elytroWallet = new ethers.Contract(walletAddress, ABI_Elytro, this.provider);
     * const { preIsValidSignatureHooks, preUserOpValidationHooks } = await elytroWallet.listHook();
     * ```
     * 1. If you need to **pack a userOp signature**, you must sort the SortedHookInputData array in the **same order** as the preUserOpValidationHooks array.
     * 2. If you need to **pack an EIP-1271 signature**, you must sort the SortedHookInputData array in the **same order** as the preIsValidSignatureHooks array.
     * 
     * @return {*}  {string}
     * @memberof Signature
     */
    static packRS256Signature(
        validatorAddress: string,
        signatureData: {
            messageHash: string,
            publicKey: RSAPublicKey,
            signature: string,
            authenticatorData: string,
            clientDataSuffix: string
        },
        validationData: string,
        sortedHookInputDataItem?: HookInputDataItem[]
    ): string {
        if (TypeGuard.onlyBytes32(signatureData.messageHash).isErr() === true) throw new Error('invalid messageHash');
        if (TypeGuard.onlyHex(signatureData.publicKey.e).isErr() === true) {
            throw new Error('invalid publicKey.e');
        } else {
            if (BigInt(signatureData.publicKey.e) !== BigInt(65537)) {
                throw new Error('e!=65537 is not supported yet');
            }
        }
        if (TypeGuard.onlyHex(signatureData.publicKey.n).isErr() === true) {
            throw new Error('invalid publicKey.n');
        } else {
            if ((signatureData.publicKey.n.length - 2) % 64 !== 0) {
                throw new Error('invalid publicKey.n length');
            }
        }
        if (TypeGuard.onlyBytes(signatureData.signature).isErr() === true) {
            throw new Error('invalid signature');
        }


        /*
            webauthn signature type:
             0x0: p256
             0x1: rs256
        */
        let rawSignature = '01';

        /*
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
        const _n = signatureData.publicKey.n.slice(2);
        // 1. n(exponent) length (2 byte max to 8192 bits key)
        rawSignature += Hex.paddingZero((_n.length / 2), 2).slice(2);

        let _authenticatorData = signatureData.authenticatorData;
        if (_authenticatorData.startsWith('0x')) {
            _authenticatorData = _authenticatorData.slice(2);
        }
        // 2. authenticatorData length (2 byte max 65535)
        rawSignature += Hex.paddingZero(_authenticatorData.length / 2, 2).slice(2);
        // 3. clientDataPrefix length (2 byte max 65535)
        rawSignature += "0000"; // clientDataPrefix length = 0
        // 4. n(exponent) (exponent,dynamic bytes)
        rawSignature += _n;

        const _s = signatureData.signature.slice(2);
        if (_s.length !== _n.length) {
            throw new Error('invalid signature');
        }
        // 5. signature (signature,signature.length== n.length)
        rawSignature += _s;
        // 6. authenticatorData
        rawSignature += _authenticatorData;
        // 7. clientDataPrefix
        // 8. clientDataSuffix
        rawSignature += ethers.hexlify(ethers.toUtf8Bytes(signatureData.clientDataSuffix)).slice(2);

        return Signature.packSignature(validatorAddress, SignkeyType.RS256, rawSignature, validationData, sortedHookInputDataItem);
    }

    static getSignatureType(EOASigner: boolean, validAfter?: number, validUntil?: number) {
        /*
        signatureType:0 , EOA signature 
        */
        if (EOASigner) {
            if (validAfter !== undefined || validUntil !== undefined) {
                return '01';
            } else {
                return '00';
            }
        } else {
            if (validAfter !== undefined || validUntil !== undefined) {
                return '03';
            } else {
                return '02';
            }
        }
    }


    /**
     *
     *
     * @static
     * @param {string} userOpHash
     * @param {number} [validAfter]
     * @param {number} [validUntil]
     * @return {*}  {string}
     * @memberof Signature
     */
    static packUserOpHash(userOpHash: string, validAfter?: number, validUntil?: number): {
        packedUserOpHash: string,
        validationData: string
    } {
        if (TypeGuard.onlyBytes32(userOpHash).isErr() === true) throw new Error('invalid userOpHash');

        if (validAfter !== undefined && validUntil !== undefined) {
            if (validAfter >= validUntil) {
                throw new Error('invalid validAfter and validUntil');
            }
        } else if (validAfter !== undefined || validUntil !== undefined) {
            throw new Error('invalid validAfter and validUntil');
        } else {
            return {
                packedUserOpHash: userOpHash,
                validationData: '0x0'
            };
        }

        if (!Number.isSafeInteger(validAfter)) {
            throw new Error('invalid validAfter');
        }
        if (!Number.isSafeInteger(validUntil)) {
            throw new Error('invalid validUntil');
        }

        // max to 2^(48 - 2) = 2 years
        if (validAfter > Math.pow(2, 48 - 2)) {
            throw new Error('invalid validAfter');
        }
        if (validUntil > Math.pow(2, 48 - 2)) {
            throw new Error('invalid validUntil');
        }

        let validationData = BigInt(0);
        //const aggregator = BigInt(0); 
        const _validAfter = BigInt(validAfter);
        const _validUntil = BigInt(validUntil);
        validationData = (_validUntil << BigInt(160)) + (_validAfter << BigInt(160 + 48))  /*.add(aggregator)*/;
        const validationDataHex = `0x${validationData.toString(16)}`;

        //  packedUserOpHash = keccak256(abi.encodePacked(hash, validationData));
        const _packedUserOpHash = ethers.solidityPacked(["bytes32", "uint256"], [userOpHash, validationDataHex]);
        // const abiEncoded = new ethers.AbiCoder().encode(["bytes32", "uint256"], [userOpHash, validationData]);
        // const keccak256 = ethers.keccak256(abiEncoded);
        // const _packedUserOpHash = keccak256(Buffer.concat([Buffer.from(userOpHash.slice(2), 'hex'), validationData.toBuffer()]));
        return {
            packedUserOpHash: ethers.keccak256(_packedUserOpHash),
            validationData: validationDataHex
        };

    }

}