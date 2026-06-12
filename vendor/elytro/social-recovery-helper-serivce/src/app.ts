/*
 * @Description: 
 * @Version: 1.0
 * @Autor: z.cejay@gmail.com
 * @Date: 2022-08-08 21:53:06
 * @LastEditors: cejay
 * @LastEditTime: 2022-09-30 21:28:20
 */

import { YamlConfig } from './utils/yamlConfig';
import { Web3Helper } from './utils/web3Helper';
import { Utils } from './utils/utils';
import { walletABI } from './ABI/walletABI';

process.on('unhandledRejection', (err) => {
    console.error(err);
    process.exit(1);
});

const yamlConfig: YamlConfig = YamlConfig.getInstance();

async function init() {
    Web3Helper.init(yamlConfig.infuraProvider);

    // get chainId 
    chainId = await Web3Helper.web3.eth.getChainId();
}

var fromBlock = 0;

var chainId = 0;

/**
 * key: wallet address
 * value: guardians address
 */
const Wallets = new Map<string, Set<string>>();
const BlackWalletList = new Set<string>();

async function getLogs() {
    // get event signature
    const topic = Web3Helper.web3.eth.abi.encodeEventSignature('PendingRequestEvent(address,uint8,uint256)');

    // get last block number
    const lastBlockNumber = await Web3Helper.web3.eth.getBlockNumber() - 20;

    if (fromBlock === 0) {
        fromBlock = lastBlockNumber - 5000; //13065460;// 
    } else {
        fromBlock = lastBlockNumber - 5;
    }

    const logs = await Web3Helper.web3.eth.getPastLogs({
        fromBlock: fromBlock,
        toBlock: lastBlockNumber,
        topics: [
            topic
        ]
    });
    // each logs
    const logArr = [];
    for (const log of logs) {
        const sender = log.address;
        const blockNumber = log.blockNumber;

        // effectiveAt -> uint256
        const effectiveAtRaw = log.data;
        const effectiveAt = parseInt(Web3Helper.web3.utils.hexToNumberString(effectiveAtRaw).toString()
        );

        // hex -> address
        const guardianRaw = log.topics[1];
        const guardianAddress: string = <any>Web3Helper.web3.eth.abi.decodeParameter('address', guardianRaw);

        const pendingRequestTypeRaw = log.topics[2];
        // pendingRequestType -> uint8
        /* 
        none 0
        addGuardian 1
        revokeGuardian 2
        */
        const pendingRequestType = parseInt(
            Web3Helper.web3.eth.abi.decodeParameter('uint8', pendingRequestTypeRaw).toString()
        );

        logArr.push({
            sender: sender,
            effectiveAt: effectiveAt,
            guardianAddress: guardianAddress,
            pendingRequestType: pendingRequestType
        });
        // console.log(`sender: ${sender}, blockNumber: ${blockNumber}, effectiveAt: ${effectiveAt}, guardianAddress: ${guardianAddress}, pendingRequestType: ${pendingRequestType}`);

    }
    fromBlock = lastBlockNumber;
    return logArr;



}

async function logForever() {
    while (true) {
        try {
            const logs = await getLogs();
            console.log(`${new Date().toLocaleTimeString()}\tget log count: ${logs.length}`);
            for (const log of logs) {
                if (log.effectiveAt === 0) {
                    continue;
                }
                if (log.pendingRequestType === 0) {
                    continue;
                }
                if (BlackWalletList.has(log.sender)) {
                    continue;
                }

                const walletContract = new Web3Helper.web3.eth.Contract(walletABI, log.sender);

                if (!Wallets.has(log.sender)) {
                    // check if wallet is valid
                    try {
                        const walletEntryPoint: string = await walletContract.methods.entryPoint().call();
                        if (walletEntryPoint.toLowerCase() !== yamlConfig.entryPoint) {
                            BlackWalletList.add(log.sender);
                            console.log(`wallet ${log.sender} is not valid, unknown entryPoint: ${walletEntryPoint}`);
                        }
                    } catch (error) {
                        BlackWalletList.add(log.sender);
                        console.log(`wallet ${log.sender} is invalid`);
                    }
                }
                if (BlackWalletList.has(log.sender)) {
                    continue;
                }
                if (!Wallets.has(log.sender)) {
                    Wallets.set(log.sender, new Set<string>());
                }
                const wallet = Wallets.get(log.sender);
                if (!wallet) {
                    throw new Error('wallet is null');
                }
                // find if there is a pending request
                if (!wallet.has(log.guardianAddress)) {
                    wallet.add(log.guardianAddress);
                }
            }
        } catch (error) {
            console.log(error);
            await Utils.sleep(1000 * 60);
        }
        await Utils.sleep(1000 * 30);
    }
}

var sponsorsIndex = 0;

async function processGuardians() {

    for (const [wallet, guardians] of Wallets) {
        const walletContract = new Web3Helper.web3.eth.Contract(walletABI, wallet);
        const deleteGuardian = new Set<string>();
        for (const guardian of guardians) {
            try {
                const pendingGuardian = await walletContract.methods.pendingGuardian(guardian).call();
                if (pendingGuardian) {
                    const pendingRequestType = parseInt(pendingGuardian.pendingRequestType);
                    if (pendingRequestType == 0) {
                        // delete guardian
                        deleteGuardian.add(guardian);
                    } else {
                        // get unix timsstamp
                        const tsNow = Math.round(new Date().getTime() / 1000);

                        if (parseInt(pendingGuardian.effectiveAt) < tsNow) {
                            let callData: string;
                            if (pendingRequestType === 1) {
                                // PendingRequestType.addGuardian
                                // function grantGuardianConfirmation(address account)
                                //await walletContract.methods.grantGuardianConfirmation(guardian).send({ 
                                console.log(`grantGuardianConfirmation ${guardian} for wallet ${wallet}`);
                                callData = walletContract.methods.grantGuardianConfirmation(
                                    guardian
                                ).encodeABI();

                            } else if (pendingRequestType === 2) {
                                //PendingRequestType.revokeGuardian
                                //function revokeGuardianConfirmation(address account) external override {
                                console.log(`revokeGuardianConfirmation ${guardian} for wallet ${wallet}`);
                                callData = walletContract.methods.revokeGuardianConfirmation(
                                    guardian
                                ).encodeABI();

                            } else {
                                throw new Error('unknown pendingRequestType');
                            }

                            let maxFeePerGas = 0;
                            let maxPriorityFeePerGas = 0;

                            try {
                                const gasNow = await Utils.getGasPrice(chainId, 'high');
                                maxFeePerGas = parseInt(gasNow.Max, 10);
                                maxPriorityFeePerGas = parseInt(gasNow.MaxPriority, 10);
                            } catch (error) {
                                console.log('get gas now by codefi error:', error);
                                throw error;
                            }
                            const privateKey = yamlConfig.sponsors[(sponsorsIndex++) % yamlConfig.sponsors.length];
                            const gas = 200000;
                            try {
                                await Utils.signAndSendTransaction(
                                    privateKey,
                                    wallet,
                                    '0x00',
                                    gas,
                                    undefined,
                                    maxPriorityFeePerGas,
                                    maxFeePerGas * 2,
                                    callData);
                            } catch (error) {
                                console.log('signAndSendTransaction error:', error);
                            }

                        }
                    }

                } else {
                    throw new Error('pendingGuardian is null');
                }


            } catch (error) {
                console.log(`wallet: ${wallet}, guardian: ${guardian} is not guardian`);
            }
        }
        // deleteGuardian
        for (const guardian of deleteGuardian) {
            guardians.delete(guardian);
        }
    }
}

async function processGuardiansForever() {
    while (true) {
        try {
            await processGuardians();
        } catch (error) {
            console.log(error);
            await Utils.sleep(1000 * 60);
        }
        await Utils.sleep(1000 * 30);
    }
}

async function main() {
    await init();

    logForever();

    processGuardiansForever();
}

main();
