import { TypedDataDomain, TypedDataField, ethers } from 'ethers';
import {
    ElytroWallet,
    UserOperation,
    PackedUserOperation,
    UserOpUtils,
    UserOpErrors,
    UserOpErrorCodes,
    // L1KeyStore,
    SocialRecovery,
    Ok, Err, Result,
    UserOpReceipt,
    UserOpDetail,
    UserOpGas,
    Bundler,
    Transaction,
    // KeyStoreInfo,
    GuardianSignature,
    // KeyStoreTypedDataType,
    InitialKey,
    ECCPoint,
    SignkeyType,
    P256Lib,
    WebAuthN,
    Base64Url,
    WalletFactory
} from '..';
import { describe, expect, test } from '@jest/globals';
import { webcrypto } from 'node:crypto';
import { Hex } from '../src/tools/hex';
import {
    randomBytes
} from 'crypto';
import { ABI_SocialRecoveryModule } from "@elytro/abi";

describe('ActivateWallet', () => {
    test('Activate', async () => {
        if (true) {
            return;
        }
        const RPC = "https://sepolia.optimism.io";
        let signkeyType: SignkeyType;
        signkeyType = SignkeyType.EOA;
        const pimlicoAPIKEY = "";
        const BundlerRPC = `https://api-dev.soulwallet.io/walletapi/bundler/optimism-sepolia/rpc`;
        const pimlicoSponsorRPC = `https://api.pimlico.io/v2/optimism/rpc?apikey=${pimlicoAPIKEY}`;

        const ElytroWalletDefaultValidator = '0x82621ac52648b738fEdd381a3678851933505762';
        const ElytroWalletFactory = '0xF78Ae187CED0Ca5Fb98100d3F0EAB7a6461d6fC6';
        const DefaultCallbackHandler = '0x880c6eb80583795625935B08AA28EB37F16732C7';
        const SocialRecoveryModule = "0x3Cc36538cf53A13AF5C28BB693091e23CF5BB567";

        const Web3RPC = new ethers.JsonRpcProvider(RPC);


        const elytroWallet = new ElytroWallet(
            Web3RPC,
            BundlerRPC,
            ElytroWalletFactory,
            DefaultCallbackHandler,
            SocialRecoveryModule
        );

        const guardian1 = new ethers.Wallet('0x1000000000000000000000000000000000000000000000000000000000000001');
        const guardian2 = new ethers.Wallet('0x1000000000000000000000000000000000000000000000000000000000000002');
        const threshold = 2;
        const initialGuardianSafePeriod = 2;
        const initialGuardianHash = SocialRecovery.calcGuardianHash([
            guardian1.address,
            guardian2.address
        ], threshold);
        // ethers.solidityPacked(["uint256", "uint256"], [recover[0].x, recover[0].y])

        // new EOASigner  
        //const signer = ethers.Wallet.createRandom();
        const signer = new ethers.Wallet('0x0000000000000000000000000000000000000000000000000000000000000001');

        // new webauthn signer
        const { privateKeyBase64, publicKeyBase64, X, Y } = await WebAuthNMock.createPassKey();
        const p256KeyHash = WebAuthN.publicKeyToKeyhash({
            x: WebAuthNMock.paddingZero(X, 32),
            y: WebAuthNMock.paddingZero(Y, 32)
        });

        const index: number = 0;
        let initialKeys: InitialKey[] = [];
        if (signkeyType.valueOf() === SignkeyType.EOA.valueOf()) {
            initialKeys.push(signer.address);
        } else {
            initialKeys.push(p256KeyHash);
        }

        const _walletAddress = await elytroWallet.calcWalletAddress(
            index,
            initialKeys,
            initialGuardianHash,
            initialGuardianSafePeriod
        );
        expect(_walletAddress.isOk()).toBe(true);
        const walletAddress = _walletAddress.OK;
        console.log('walletAddress', walletAddress);
        const code = await Web3RPC.getCode(walletAddress);
        if (code === '0x') {
            const calldata = "0x";
            const _userOp = await elytroWallet.createUnsignedDeployWalletUserOp(
                index,
                initialKeys,
                initialGuardianHash,
                calldata,
                initialGuardianSafePeriod
            );

            expect(_userOp.isOk()).toBe(true);
            const userOp = _userOp.OK;

            {

                // get gas price
                const gasPrice = await Web3RPC.getFeeData();
                expect(gasPrice).not.toBeNull();
                expect(gasPrice.maxFeePerGas).not.toBeNull();
                expect(gasPrice.maxPriorityFeePerGas).not.toBeNull();
                userOp.maxFeePerGas = gasPrice.maxFeePerGas!;
                userOp.maxPriorityFeePerGas = gasPrice.maxPriorityFeePerGas!;
            }

            {
                const re = await elytroWallet.estimateUserOperationGas(ElytroWalletDefaultValidator, userOp, undefined, signkeyType);
                if (userOp.callData === '0x') {
                    userOp.callGasLimit = 1;
                }
                expect(re.isOk()).toBe(true);
            }

            let usePaymaster = false;
            if (usePaymaster) {
                const entryPoint = (await elytroWallet.entryPoint()).OK;
                const chainId = '0x' + ((await Web3RPC.getNetwork()).chainId).toString(16);
                userOp.paymaster = "";
                userOp.paymasterVerificationGasLimit = 0;
                userOp.paymasterPostOpGasLimit = 0;
                userOp.paymasterData = "0x";
                userOp.signature = (await elytroWallet.getSemiValidSignature(ElytroWalletDefaultValidator, userOp, signkeyType)).OK;
                const usePimlico = true;
                if (usePimlico) {
                    const SponsorRPC = new ethers.JsonRpcProvider(
                        pimlicoSponsorRPC, undefined, { batchMaxCount: 1 }
                    );

                    const json = await SponsorRPC.send(
                        "pm_sponsorUserOperation", [
                        JSON.parse(UserOpUtils.userOperationToJSON(userOp)),
                        entryPoint,
                        {
                            sponsorshipPolicyId: "sp_slow_vivisector"
                        }
                    ]);
                    if (
                        typeof json === 'object' &&
                        typeof json.callGasLimit === 'string' &&
                        typeof json.paymaster === 'string' &&
                        typeof json.paymasterData === 'string' &&
                        typeof json.paymasterPostOpGasLimit === 'string' &&
                        typeof json.paymasterVerificationGasLimit === 'string' &&
                        typeof json.verificationGasLimit === 'string'
                    ) {
                        userOp.callGasLimit = BigInt(json.callGasLimit);
                        userOp.paymaster = json.paymaster;
                        userOp.paymasterData = json.paymasterData;
                        userOp.paymasterPostOpGasLimit = BigInt(json.paymasterPostOpGasLimit);
                        userOp.paymasterVerificationGasLimit = BigInt(json.paymasterVerificationGasLimit);
                        userOp.preVerificationGas = BigInt(json.preVerificationGas);
                        userOp.verificationGasLimit = BigInt(json.verificationGasLimit);
                    } else {
                        throw new Error('sponsor failed');
                    }
                    console.log('json', json);
                } else {
                    const sponsorUrl = "https://api.stable.cash/alpha1/appapi/sponsor/sponsor-op";
                    const sponsorData = {
                        chainId: chainId,
                        entryPoint: entryPoint,
                        op: JSON.parse(UserOpUtils.userOperationToJSON(userOp))
                    };
                    const re = await fetch(sponsorUrl, {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json',
                        },
                        body: JSON.stringify(sponsorData),
                    });
                    const json = await re.json();
                    if (
                        typeof json === 'object' &&
                        typeof json.msg === 'string' &&
                        json.msg === "success" &&
                        typeof json.data === 'object' &&
                        typeof json.data.callGasLimit === 'string' &&
                        typeof json.data.paymaster === 'string' &&
                        typeof json.data.paymasterData === 'string' &&
                        typeof json.data.paymasterPostOpGasLimit === 'string' &&
                        typeof json.data.paymasterVerificationGasLimit === 'string' &&
                        typeof json.data.verificationGasLimit === 'string'
                    ) {
                        userOp.callGasLimit = BigInt(json.data.callGasLimit);
                        userOp.paymaster = json.data.paymaster;
                        userOp.paymasterData = json.data.paymasterData;
                        userOp.paymasterPostOpGasLimit = BigInt(json.data.paymasterPostOpGasLimit);
                        userOp.paymasterVerificationGasLimit = BigInt(json.data.paymasterVerificationGasLimit);
                        userOp.preVerificationGas = BigInt(json.data.preVerificationGas);
                        userOp.verificationGasLimit = BigInt(json.data.verificationGasLimit);
                    } else {
                        throw new Error('sponsor failed');
                    }
                    console.log('json', json);
                }



            } else {
                const preFund = await elytroWallet.preFund(userOp);
                expect(preFund.isOk()).toBe(true);
                // get balance
                const _balance = await Web3RPC.getBalance(walletAddress);
                const missfund = BigInt(preFund.OK.missfund);
                if (missfund > _balance) {
                    const errStr = `balance:${ethers.formatEther(_balance)} missfund:${ethers.formatEther(missfund)}`;
                    console.error(errStr);
                    throw new Error(errStr);
                    debugger;
                }
                expect(_balance >= missfund).toBe(true);
            }

            {
                const _userOpHash = await elytroWallet.userOpHash(userOp);
                expect(_userOpHash.isOk()).toBe(true);
                const userOpHash = _userOpHash.OK;
                const dateNow = Math.floor(new Date().getTime() / 1000);
                const _re = await elytroWallet.packRawHash(userOpHash, dateNow - 1000 * 60 * 60, dateNow + 1000 * 60 * 60);
                expect(_re.isOk()).toBe(true);
                const packedHash: string = _re.OK.packedHash;
                const validationData: string = _re.OK.validationData;

                if (signkeyType.valueOf() === SignkeyType.EOA.valueOf()) {
                    const _signature = signer.signMessageSync(ethers.getBytes(packedHash));
                    const signature = await elytroWallet.packUserOpEOASignature(ElytroWalletDefaultValidator, _signature, validationData);
                    expect(signature.isOk()).toBe(true);
                    userOp.signature = signature.OK;
                } else {
                    const { r, s, authenticatorData, clientDataSuffix, _message } = await WebAuthNMock.signPassKey(privateKeyBase64, publicKeyBase64, packedHash);

                    const signature = await elytroWallet.packUserOpP256Signature(ElytroWalletDefaultValidator, {
                        messageHash: packedHash,
                        publicKey: {
                            x: WebAuthNMock.paddingZero(X, 32),
                            y: WebAuthNMock.paddingZero(Y, 32)
                        },
                        r: WebAuthNMock.paddingZero(r, 32),
                        s: WebAuthNMock.paddingZero(s, 32),
                        authenticatorData: authenticatorData,
                        clientDataSuffix: clientDataSuffix
                    }, validationData);
                    expect(signature.isOk()).toBe(true);
                    userOp.signature = signature.OK;
                }
            }
            {
                const packedUserOp = UserOpUtils.packUserOp(userOp);
                const packedUserOpJson = UserOpUtils.packedUserOperationToJSON(packedUserOp);
                const tupleStr = UserOpUtils.packedUserOperationToTuple(packedUserOp);
                console.log('packedUserOp', packedUserOp);
                const re = await elytroWallet.sendUserOperation(userOp);
                if (re.isErr()) {
                    debugger;
                    console.log('error', re.ERR.toString());
                }
                expect(re.isOk()).toBe(true);
            }
        }
        {
            // wait for the wallet to be deployed
            while (true) {
                console.log('waiting for the wallet to be deployed');
                const code = await Web3RPC.getCode(walletAddress);
                if (code !== '0x') {
                    break;
                }
                await new Promise((resolve) => setTimeout(resolve, 1000));
            }
            console.log('wallet deployed');
        }
        {
            // get nonce
            const _SocialRecoveryModule = new ethers.Contract(SocialRecoveryModule, ABI_SocialRecoveryModule, Web3RPC);
            const SocialRecoveryNonce: bigint = await _SocialRecoveryModule.getFunction("walletNonce").staticCall(walletAddress);
            const newOwner = new ethers.Wallet('0x2000000000000000000000000000000000000000000000000000000000000001');
            const bytes32NewOwners: string[] = [SocialRecovery.addressToBytes32(newOwner.address)];
            // social recovery
            const typedData = SocialRecovery.getSocialRecoveryTypedData(
                Number((await Web3RPC.getNetwork()).chainId),
                SocialRecoveryModule,
                walletAddress,
                Number(SocialRecoveryNonce),
                bytes32NewOwners
            );
            const signature1 = await guardian1.signTypedData(typedData.domain, typedData.types, typedData.message);
            const signature2 = await guardian2.signTypedData(typedData.domain, typedData.types, typedData.message);

            const guardianSignature: GuardianSignature[] = [
                {
                    signatureType: 2,
                    address: guardian1.address,
                    signature: signature1
                },
                {
                    signatureType: 2,
                    address: guardian2.address,
                    signature: signature2
                }
            ];

            const rawGuardian: string = SocialRecovery.getGuardianBytes([
                guardian1.address,
                guardian2.address
            ], threshold)

            const packedGuardianSignature = await SocialRecovery.packGuardianSignature(guardianSignature);
            const re_scheduleRecovery = await _SocialRecoveryModule.getFunction("scheduleRecovery").call(
                walletAddress,
                bytes32NewOwners,
                rawGuardian,
                packedGuardianSignature
            );
            console.log('re_scheduleRecovery', re_scheduleRecovery);
            await new Promise((resolve) => setTimeout(resolve, initialGuardianSafePeriod * 1000));
            const re_executeRecovery = await _SocialRecoveryModule.getFunction("executeRecovery").call(
                walletAddress,
                bytes32NewOwners
            );
            console.log('re_executeRecovery', re_executeRecovery);

        }










    }, 1000 * 60 * 10);
});



class WebAuthNMock {

    public static paddingZero(value: string | number | bigint, bytesLen?: number): string {
        if (typeof value === 'string') {
            if (value.startsWith('0x')) {
                value = value.slice(2);
            }
            let len = 0;
            if (bytesLen === undefined) {
                len = value.length + (value.length % 2);
            } else {
                len = bytesLen * 2;
            }
            if (value.length > len) {
                throw new Error(`value ${value} length is greater than ${len}`);
            }
            return '0x' + '0'.repeat(len - value.length) + value.toLowerCase();
        }
        else if (typeof value === 'number' || typeof value === 'bigint') {
            return this.paddingZero(value.toString(16), bytesLen);
        } else {
            throw new Error(`value ${value} is not string | number | bigint`);
        }
    }

    /**
   * base64Url
   *
   * @static
   * @param {string} data
   * @return {*} 
   * @memberof Base64Url
   */
    private static base64Url(data: string) {
        return btoa(data).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
    }

    /**
     * base64UrlToBytes32
     *
     * @static
     * @param {string} bytes32Str
     * @return {*} 
     * @memberof Base64Url
     */
    private static bytes32Tobase64Url(bytes32Str: string) {
        const userOpHashForBytes = bytes32Str.startsWith('0x') ? bytes32Str.slice(2) : bytes32Str;
        const byteArray = new Uint8Array(32);
        for (let i = 0; i < 64; i += 2) {
            byteArray[i / 2] = parseInt(userOpHashForBytes.substring(i, i + 2), 16);
        }
        return WebAuthNMock.base64Url(String.fromCharCode(...byteArray));
    }

    private static uint8ArrayToHex(uint8Array: Uint8Array): string {
        return '0x' + Array.from(uint8Array).map(b => b.toString(16).padStart(2, '0')).join('');
    }

    private static hexToUint8Array(hex: string): Uint8Array {
        if (hex.startsWith('0x')) hex = hex.slice(2);
        const len = hex.length;
        const uint8Array = new Uint8Array(len / 2);
        for (let i = 0; i < len; i += 2) {
            uint8Array[i / 2] = parseInt(hex.substring(i, i + 2), 16);
        }
        return uint8Array;
    }

    private static arrayBufferToBase64(buffer: ArrayBuffer) {
        let binary = '';
        const bytes = new Uint8Array(buffer);
        for (let i = 0; i < bytes.byteLength; i++) {
            binary += String.fromCharCode(bytes[i]);
        }
        return Buffer.from(binary, 'binary').toString('base64');
    }
    private static base64ToArrayBuffer(base64: string) {
        const binary_string = Buffer.from(base64, 'base64').toString('binary');
        const len = binary_string.length;
        const bytes = new Uint8Array(len);
        for (let i = 0; i < len; i++) {
            bytes[i] = binary_string.charCodeAt(i);
        }
        return bytes.buffer;
    }

    public static async createPassKey() {
        const algoParams = {
            name: 'ECDSA',
            namedCurve: 'P-256',
            hash: 'SHA-256'
        };
        const keyPair = await webcrypto.subtle.generateKey(algoParams, true, ['sign', 'verify']);
        let X: bigint;
        let Y: bigint;
        // keyPair.publicKey to x,y
        const publicKeyBuffer = await webcrypto.subtle.exportKey('spki', keyPair.publicKey);
        if (publicKeyBuffer.byteLength === 91) {
            // ASN.1 DER format
            const _buffer: Uint8Array = new Uint8Array(publicKeyBuffer);
            if (_buffer[26] !== 0x04) {
                throw new Error('Unexpected public key format');
            }
            const x = publicKeyBuffer.slice(27, 59);
            const y = publicKeyBuffer.slice(59, 91);
            X = BigInt(WebAuthNMock.uint8ArrayToHex(new Uint8Array(x)));
            Y = BigInt(WebAuthNMock.uint8ArrayToHex(new Uint8Array(y)));
        } else {
            throw new Error('Unexpected public key format');
        }
        const privateKeyBase64 = WebAuthNMock.arrayBufferToBase64(await webcrypto.subtle.exportKey('pkcs8', keyPair.privateKey));
        const publicKeyBase64 = WebAuthNMock.arrayBufferToBase64(await webcrypto.subtle.exportKey('spki', keyPair.publicKey));

        return {
            privateKeyBase64,
            publicKeyBase64,
            X,
            Y
        };
    }

    public static async signPassKey(privateKeyBase64: string, publicKeyBase64: string, userOpHash: string) {

        const algoParams = {
            name: 'ECDSA',
            namedCurve: 'P-256',
            hash: 'SHA-256'
        };

        const publicKey: webcrypto.CryptoKey = await webcrypto.subtle.importKey(
            'spki',
            WebAuthNMock.base64ToArrayBuffer(publicKeyBase64),
            algoParams,
            true,
            ['verify']
        );
        const privateKey: webcrypto.CryptoKey = await webcrypto.subtle.importKey(
            'pkcs8',
            WebAuthNMock.base64ToArrayBuffer(privateKeyBase64),
            algoParams,
            true,
            ['sign']
        );
        const keyPair = {
            publicKey,
            privateKey
        };
        const challengeBase64 = WebAuthNMock.bytes32Tobase64Url(userOpHash);
        const clientDataSuffix = '","origin":"https://webauthn-mock.soulwallet.io","crossOrigin":false}';
        const clientDataJSON = `{"type":"webauthn.get","challenge":"${challengeBase64}${clientDataSuffix}`;
        const jsonBytes = ethers.toUtf8Bytes(clientDataJSON);
        const jsonBytesHex = '0x' + Array.from(jsonBytes).map(b => b.toString(16).padStart(2, '0')).join('');
        let clientDataJSONHash: string = ethers.sha256(jsonBytesHex);
        let authenticatorData = '0x49960de5880e8c687434170f6476605b8fe4aeb9a28632c7995cf3ba831d97630500000000';
        if (clientDataJSONHash.startsWith('0x')) clientDataJSONHash = clientDataJSONHash.slice(2);
        const message = authenticatorData + clientDataJSONHash;
        const _message = ethers.sha256(message);

        const signature = await webcrypto.subtle.sign(
            algoParams,
            keyPair.privateKey,
            Buffer.from(message.slice(2), 'hex')
        );
        const isValid = await webcrypto.subtle.verify(algoParams, keyPair.publicKey, signature, Buffer.from(message.slice(2), 'hex'));
        if (isValid !== true) {
            throw new Error('sign failed');
        }

        const r = WebAuthNMock.uint8ArrayToHex(new Uint8Array(signature.slice(0, 32)));
        const s = WebAuthNMock.uint8ArrayToHex(new Uint8Array(signature.slice(32, 64)));
        return {
            r,
            s,
            authenticatorData,
            clientDataSuffix,
            _message
        }
    }
}

