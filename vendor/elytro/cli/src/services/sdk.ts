import type { Address, Hex, PublicClient } from 'viem';
import {
  padHex,
  createPublicClient,
  http,
  toHex,
  parseEther,
  keccak256,
  encodeAbiParameters,
  parseAbiParameters,
  parseAbiItem,
  decodeAbiParameters,
  hashTypedData,
  zeroHash,
  parseAbi,
} from 'viem';
import { ABI_SocialRecoveryModule, ABI_Elytro } from '@elytro/abi';
import { SocialRecovery } from '@elytro/sdk';
import {
  GUARDIAN_INFO_KEY,
  INFO_RECORDER_ADDRESS,
  RecoveryOperationState,
} from '../constants/recovery';
import type { RecoveryContactsInfo } from '../types';
import type { ChainConfig, ElytroUserOperation } from '../types';
import { ElytroWallet, Bundler, type UserOperation } from '@elytro/sdk';

/**
 * SDKService — @elytro/sdk wrapper for ERC-4337 operations.
 *
 * Phase 1: address calculation for account creation.
 * Phase 2: full UserOp lifecycle (sign, send, estimate, receipt).
 */

/** Default guardian hash when no guardians are set. */
const DEFAULT_GUARDIAN_HASH =
  '0x0000000000000000000000000000000000000000000000000000000000000001' as Hex;

/** Default guardian safe period: 48 hours. */
const DEFAULT_GUARDIAN_SAFE_PERIOD = 172800;

/**
 * Contract addresses per entrypoint version.
 * Mirrors extension's constants/entrypoints.ts.
 */
const ENTRYPOINT_CONFIGS: Record<string, SDKContractConfig> = {
  'v0.7': {
    entryPoint: '0x0000000071727De22E5E9d8BAf0edAc6f37da032',
    factory: '0x70B616f23bDDB18c5c412dB367568Dc360e224Bb',
    fallback: '0xe4eA02c80C3CD86B2f23c8158acF2AAFcCa5A6b3',
    recovery: '0x36693563E41BcBdC8d295bD3C2608eb7c32b1cCb',
    validator: '0x162485941bA1FAF21013656DAB1E60e9D7226DC0',
    elytroWalletLogic: '0x186b91aE45dd22dEF329BF6b4233cf910E157C84',
    infoRecorder: INFO_RECORDER_ADDRESS,
  },
  'v0.8': {
    entryPoint: '0x4337084d9e255ff0702461cf8895ce9e3b5ff108',
    factory: '0x82a8B1a5986f565a1546672e8939daA1b20F441E',
    fallback: '0xB73Ec2FD0189202F6C22067Eeb19EAad25CAB551',
    recovery: '0xAFEF5D8Fb7B4650B1724a23e40633f720813c731',
    validator: '0xea50a2874df3eEC9E0365425ba948989cd63FED6',
    elytroWalletLogic: '0x2CC8A41e26dAC15F1D11F333f74D0451be6caE36',
    infoRecorder: INFO_RECORDER_ADDRESS,
  },
};

const DEFAULT_VERSION = 'v0.8';

/**
 * Default dummy signature for gas estimation.
 * Extension uses this same value when no hooks are present.
 */
const DUMMY_SIGNATURE =
  '0xea50a2874df3eEC9E0365425ba948989cd63FED6000000620100005f5e0fff000fffffffff0000000000000000000000000000000000000000b91467e570a6466aa9e9876cbcd013baba02900b8979d43fe208a4a4f339f5fd6007e74cd82e037b800186422fc2da167c747ef045e5d18a5f5d4300f8e1a0291c' as Hex;

interface SDKContractConfig {
  entryPoint: string;
  factory: string;
  fallback: string;
  recovery: string;
  validator: string;
  elytroWalletLogic: string;
  infoRecorder: string;
}

export class SDKService {
  private sdk: ElytroWallet | null = null;
  private bundlerInstance: Bundler | null = null;
  private chainConfig: ChainConfig | null = null;
  private contractConfig: SDKContractConfig = ENTRYPOINT_CONFIGS[DEFAULT_VERSION];

  async initForChain(
    chainConfig: ChainConfig,
    entrypointVersion: string = DEFAULT_VERSION,
  ): Promise<void> {
    this.chainConfig = chainConfig;
    const config = ENTRYPOINT_CONFIGS[entrypointVersion];
    if (!config) {
      throw new Error(
        `Unknown entrypoint version "${entrypointVersion}". Valid options: ${Object.keys(ENTRYPOINT_CONFIGS).join(', ')}`,
      );
    }
    this.contractConfig = config;

    // Import SDK and instantiate ElytroWallet
    const { ElytroWallet, Bundler } = await import('@elytro/sdk');

    this.sdk = new ElytroWallet(
      chainConfig.endpoint,
      chainConfig.bundler,
      this.contractConfig.factory,
      this.contractConfig.fallback,
      this.contractConfig.recovery,
      {
        chainId: chainConfig.id,
        entryPoint: this.contractConfig.entryPoint,
        elytroWalletLogic: this.contractConfig.elytroWalletLogic,
      },
    );

    this.bundlerInstance = new Bundler(chainConfig.bundler);
  }

  // ─── Phase 1: Address Calculation ──────────────────────────────

  /**
   * Calculate the counterfactual smart account address via CREATE2.
   *
   * The contract doesn't exist on-chain yet, but this address is
   * deterministic — guaranteed to be where it will deploy.
   */
  async calcWalletAddress(
    eoaAddress: Address,
    chainId: number,
    index: number = 0,
    initialGuardianHash: Hex = DEFAULT_GUARDIAN_HASH,
    initialGuardianSafePeriod: number = DEFAULT_GUARDIAN_SAFE_PERIOD,
  ): Promise<Address> {
    const sdk = this.ensureSDK();

    // Extension pads the EOA address to 32 bytes as initialKey
    const paddedKey = padHex(eoaAddress, { size: 32 });

    const result = await sdk.calcWalletAddress(
      index,
      [paddedKey],
      initialGuardianHash,
      initialGuardianSafePeriod,
      chainId,
    );

    if (result.isErr()) {
      throw new Error(`Failed to calculate wallet address: ${result.ERR}`);
    }

    return result.OK as Address;
  }

  // ─── Phase 2: UserOp Lifecycle ─────────────────────────────────

  /**
   * Create an unsigned UserOperation from transactions.
   *
   * Wraps the SDK's `fromTransaction()` which handles:
   * - Nonce fetching from the on-chain wallet
   * - callData encoding (single execute / batch executeBatch)
   * - Setting factory/factoryData to null (non-deploy op)
   *
   * Extension reference: sdk.ts#createUserOpFromTxs (line 1115-1122).
   *
   * @param senderAddress  Deployed smart account address
   * @param txs            Array of { to, value?, data? } in hex string format
   */
  async createSendUserOp(
    senderAddress: Address,
    txs: Array<{ to: string; value?: string; data?: string }>,
  ): Promise<ElytroUserOperation> {
    const sdk = this.ensureSDK();

    // Pass placeholder gas prices — caller fills with getFeeData() after
    const result = await sdk.fromTransaction('0x1', '0x1', senderAddress, txs);

    if (result.isErr()) {
      throw new Error(`Failed to build send UserOp: ${result.ERR}`);
    }

    return this.normalizeUserOp(result.OK as Record<string, unknown>);
  }

  /**
   * Create an unsigned deploy UserOperation.
   *
   * Builds a UserOp with factory + factoryData that, when sent to the
   * bundler, deploys the smart wallet contract at the counterfactual address.
   */
  async createDeployUserOp(
    eoaAddress: Address,
    index: number = 0,
    initialGuardianHash: Hex = DEFAULT_GUARDIAN_HASH,
    initialGuardianSafePeriod: number = DEFAULT_GUARDIAN_SAFE_PERIOD,
  ): Promise<ElytroUserOperation> {
    const sdk = this.ensureSDK();
    const paddedKey = padHex(eoaAddress, { size: 32 });

    const result = await sdk.createUnsignedDeployWalletUserOp(
      index,
      [paddedKey],
      initialGuardianHash,
      undefined, // callData
      initialGuardianSafePeriod,
    );

    if (result.isErr()) {
      throw new Error(`Failed to create deploy UserOp: ${result.ERR}`);
    }

    return this.normalizeUserOp(result.OK);
  }

  /**
   * Get gas price from Pimlico bundler.
   *
   * Uses the non-standard `pimlico_getUserOperationGasPrice` RPC method.
   * Returns { maxFeePerGas, maxPriorityFeePerGas } from the "fast" tier.
   */
  async getFeeData(
    chainConfig: ChainConfig,
  ): Promise<{ maxFeePerGas: bigint; maxPriorityFeePerGas: bigint }> {
    const client = createPublicClient({
      transport: http(chainConfig.bundler),
    });

    try {
      const result = await client.request({
        method: 'pimlico_getUserOperationGasPrice' as never,
        params: [] as never,
      });

      const fast = (result as Record<string, Record<string, string>>)?.fast;
      if (!fast) {
        throw new Error('Unexpected response from pimlico_getUserOperationGasPrice');
      }

      return {
        maxFeePerGas: BigInt(fast.maxFeePerGas),
        maxPriorityFeePerGas: BigInt(fast.maxPriorityFeePerGas),
      };
    } catch (err) {
      console.error(
        '[sdk] pimlico_getUserOperationGasPrice failed, using eth_gasPrice fallback:',
        (err as Error).message,
      );
      const gasPrice = await createPublicClient({
        transport: http(chainConfig.bundler),
      }).getGasPrice();

      return {
        maxFeePerGas: gasPrice,
        maxPriorityFeePerGas: 1n,
      };
    }
  }

  /**
   * Estimate gas limits for a UserOperation via the bundler.
   *
   * Sets a dummy signature for estimation (same as extension).
   * For undeployed accounts, pass `fakeBalance: true` to inject a
   * state override that gives the sender 1 ETH — prevents AA21.
   *
   * Extension reference: sdk.ts#estimateGas (lines 602-650).
   */
  async estimateUserOp(
    userOp: ElytroUserOperation,
    opts: { fakeBalance?: boolean } = {},
  ): Promise<{
    callGasLimit: bigint;
    verificationGasLimit: bigint;
    preVerificationGas: bigint;
    paymasterVerificationGasLimit: bigint | null;
    paymasterPostOpGasLimit: bigint | null;
  }> {
    const sdk = this.ensureSDK();

    // Set dummy signature for estimation
    const opForEstimate = { ...userOp, signature: DUMMY_SIGNATURE };

    // State override: fake sender balance to prevent AA21 for undeployed/unfunded accounts
    const stateOverride = opts.fakeBalance
      ? { [userOp.sender]: { balance: toHex(parseEther('1')) } }
      : undefined;

    const result = await sdk.estimateUserOperationGas(
      this.contractConfig.validator,
      this.toSDKUserOp(opForEstimate),
      stateOverride,
    );

    if (result.isErr()) {
      const err = result.ERR;
      throw new Error(
        `Gas estimation failed: ${typeof err === 'object' && err !== null && 'message' in err ? (err as { message: string }).message : String(err)}`,
      );
    }

    const gas = result.OK;
    return {
      callGasLimit: BigInt(gas.callGasLimit),
      verificationGasLimit: BigInt(gas.verificationGasLimit),
      preVerificationGas: BigInt(gas.preVerificationGas),
      paymasterVerificationGasLimit: gas.paymasterVerificationGasLimit
        ? BigInt(gas.paymasterVerificationGasLimit)
        : null,
      paymasterPostOpGasLimit: gas.paymasterPostOpGasLimit
        ? BigInt(gas.paymasterPostOpGasLimit)
        : null,
    };
  }

  /**
   * Compute the ERC-4337 UserOperation hash.
   *
   * Two-step: userOpHash → packRawHash to get the final digest for signing.
   */
  async getUserOpHash(
    userOp: ElytroUserOperation,
  ): Promise<{ packedHash: Hex; validationData: Hex }> {
    const sdk = this.ensureSDK();

    // Step 1: compute raw userOp hash
    const hashResult = await sdk.userOpHash(this.toSDKUserOp(userOp));
    if (hashResult.isErr()) {
      throw new Error(`Failed to compute userOpHash: ${hashResult.ERR}`);
    }

    // Step 2: pack with validation time bounds (0 = no time restriction)
    const packResult = await sdk.packRawHash(hashResult.OK as string);
    if (packResult.isErr()) {
      throw new Error(`Failed to pack raw hash: ${packResult.ERR}`);
    }

    return {
      packedHash: packResult.OK.packedHash as Hex,
      validationData: packResult.OK.validationData as Hex,
    };
  }

  /**
   * Pack a raw ECDSA signature into the format expected by the EntryPoint.
   *
   * Wraps the signature with validator address and validation data.
   */
  async packUserOpSignature(rawSignature: Hex, validationData: Hex): Promise<Hex> {
    const sdk = this.ensureSDK();

    const result = await sdk.packUserOpEOASignature(
      this.contractConfig.validator,
      rawSignature,
      validationData,
    );

    if (result.isErr()) {
      throw new Error(`Failed to pack signature: ${result.ERR}`);
    }

    return result.OK as Hex;
  }

  /**
   * Pack a raw ECDSA signature with hook input data.
   *
   * Used when SecurityHook is installed: the hook signature from the backend
   * must be included alongside the EOA signature.
   *
   * Extension reference: sdk.ts#signUserOperationWithHook (line 239-318)
   *
   * @param rawSignature  Raw ECDSA signature from device key
   * @param validationData  Validation data from packRawHash
   * @param hookAddress  SecurityHook contract address
   * @param hookSignature  Hook signature from authorizeUserOperation backend
   */
  async packUserOpSignatureWithHook(
    rawSignature: Hex,
    validationData: Hex,
    hookAddress: Address,
    hookSignature: Hex,
  ): Promise<Hex> {
    const sdk = this.ensureSDK();

    const hookInputData = [
      {
        hookAddress,
        inputData: hookSignature,
      },
    ];

    const result = await sdk.packUserOpEOASignature(
      this.contractConfig.validator,
      rawSignature,
      validationData,
      hookInputData,
    );

    if (result.isErr()) {
      throw new Error(`Failed to pack signature with hook: ${result.ERR}`);
    }

    return result.OK as Hex;
  }

  /**
   * Pack a raw hash with validation time bounds.
   *
   * Used for EIP-1271 auth signing flow — takes an arbitrary message hash
   * (not a userOp hash) and returns packedHash + validationData.
   */
  async packRawHash(hash: Hex): Promise<{ packedHash: Hex; validationData: Hex }> {
    const sdk = this.ensureSDK();
    const result = await sdk.packRawHash(hash);
    if (result.isErr()) {
      throw new Error(`Failed to pack raw hash: ${result.ERR}`);
    }
    return {
      packedHash: result.OK.packedHash as Hex,
      validationData: result.OK.validationData as Hex,
    };
  }

  /**
   * Send a signed UserOperation to the bundler.
   */
  async sendUserOp(userOp: ElytroUserOperation): Promise<Hex> {
    const sdk = this.ensureSDK();

    // The SDK's sendUserOperation returns true on success.
    // The actual opHash must be computed separately.
    const sendResult = await sdk.sendUserOperation(this.toSDKUserOp(userOp));
    if (sendResult.isErr()) {
      const err = sendResult.ERR;
      throw new Error(
        `Failed to send UserOp: ${typeof err === 'object' && err !== null && 'message' in err ? (err as { message: string }).message : String(err)}`,
      );
    }

    // Compute the opHash for receipt polling
    const hashResult = await sdk.userOpHash(this.toSDKUserOp(userOp));
    if (hashResult.isErr()) {
      throw new Error(`UserOp sent but failed to compute hash for tracking: ${hashResult.ERR}`);
    }

    return hashResult.OK as Hex;
  }

  /**
   * Poll the bundler for a UserOperation receipt.
   *
   * Exponential backoff: 2s → 1.5× → cap 15s, max 30 attempts (~90s).
   */
  async waitForReceipt(opHash: Hex): Promise<{
    success: boolean;
    actualGasCost: string;
    actualGasUsed: string;
    transactionHash: Hex;
    blockNumber: string;
  }> {
    const bundler = this.ensureBundler();

    let delay = 2000;
    const maxDelay = 15000;
    const maxAttempts = 30;

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      const result = await bundler.eth_getUserOperationReceipt(opHash);

      if (result.isErr()) {
        throw new Error(`Failed to poll receipt: ${result.ERR}`);
      }

      const receipt = result.OK;
      if (receipt) {
        return {
          success: receipt.success,
          actualGasCost: String(receipt.actualGasCost),
          actualGasUsed: String(receipt.actualGasUsed),
          transactionHash: (receipt.receipt?.transactionHash ?? opHash) as Hex,
          blockNumber: String(receipt.receipt?.blockNumber ?? '0'),
        };
      }

      // Increase delay with cap, then wait before next poll
      delay = Math.min(Math.floor(delay * 1.5), maxDelay);
      await sleep(delay);
    }

    throw new Error(
      `UserOperation receipt not found after ${maxAttempts} attempts (~90s). Hash: ${opHash}`,
    );
  }

  // ─── Accessors ─────────────────────────────────────────────────

  get isInitialized(): boolean {
    return this.sdk !== null;
  }

  get contracts(): SDKContractConfig {
    return this.contractConfig;
  }

  get entryPoint(): Address {
    return this.contractConfig.entryPoint as Address;
  }

  get validatorAddress(): Address {
    return this.contractConfig.validator as Address;
  }

  /** Default init params used for wallet creation — needed for backend registration. */
  get initDefaults(): { guardianHash: Hex; guardianSafePeriod: number } {
    return {
      guardianHash: DEFAULT_GUARDIAN_HASH,
      guardianSafePeriod: DEFAULT_GUARDIAN_SAFE_PERIOD,
    };
  }

  /** Expose the raw SDK instance for advanced operations. */
  get raw(): ElytroWallet {
    return this.ensureSDK();
  }

  // ─── Recovery ──────────────────────────────────────────────────

  /**
   * Read social recovery info from the SocialRecoveryModule contract.
   * Returns contactsHash, nonce, and delayPeriod.
   *
   * Extension reference: sdk.ts#getRecoveryInfo
   */
  async getRecoveryInfo(address: Address): Promise<{
    contactsHash: string;
    nonce: bigint;
    delayPeriod: bigint;
  } | null> {
    const client = this._getClient();

    try {
      const result = (await client.readContract({
        address: this.contractConfig.recovery as Address,
        abi: ABI_SocialRecoveryModule,
        functionName: 'getSocialRecoveryInfo',
        args: [address],
      })) as unknown[];

      if (!result || result.length !== 3) {
        throw new Error('Unexpected response from getSocialRecoveryInfo');
      }

      return {
        contactsHash: result[0] as string,
        nonce: result[1] as bigint,
        delayPeriod: result[2] as bigint,
      };
    } catch (error) {
      return null;
    }
  }

  /**
   * Query guardian contacts from InfoRecorder event logs.
   *
   * Looks up the latest DataRecorded event for the given wallet address
   * with the GUARDIAN_INFO_KEY category, then decodes the guardian data.
   *
   * Extension reference: sdk.ts#queryRecoveryContacts
   */
  async queryRecoveryContacts(address: Address): Promise<RecoveryContactsInfo | null> {
    const client = this._getClient();
    const infoRecorder = this.contractConfig.infoRecorder as Address;

    // Get the block number of the latest record
    const startBlock = await client.readContract({
      address: infoRecorder,
      abi: parseAbi([
        'function latestRecordAt(address addr, bytes32 category) external view returns (uint256 blockNumber)',
      ]),
      functionName: 'latestRecordAt',
      args: [address, GUARDIAN_INFO_KEY],
    });

    if (startBlock === 0n) {
      return null;
    }

    const fromBlock = startBlock - 10n > 0n ? startBlock - 10n : 0n;
    const currentBlock = await client.getBlockNumber();
    const toBlock = startBlock + 10n > currentBlock ? currentBlock : startBlock + 10n;

    const logs = await client.getLogs({
      address: infoRecorder,
      fromBlock,
      toBlock,
      event: parseAbiItem(
        'event DataRecorded(address indexed wallet, bytes32 indexed category, bytes data)',
      ),
      args: {
        wallet: address,
        category: GUARDIAN_INFO_KEY,
      },
    });

    if (!logs.length) {
      return null;
    }

    const lastLog = logs[logs.length - 1];
    if (!lastLog || !lastLog.args) {
      return null;
    }

    const parsed = decodeAbiParameters(
      parseAbiParameters(['address[]', 'uint256', 'bytes32']),
      (lastLog.args as { data: Hex }).data,
    );

    return {
      contacts: parsed[0] as string[],
      threshold: Number(parsed[1]),
      salt: parsed[2] as string,
    };
  }

  /**
   * Get current recovery nonce for a wallet.
   * Extension reference: sdk.ts#getRecoveryNonce
   */
  async getRecoveryNonce(address: Address): Promise<number> {
    const client = this._getClient();
    const nonce = await client.readContract({
      address: this.contractConfig.recovery as Address,
      abi: ABI_SocialRecoveryModule,
      functionName: 'walletNonce',
      args: [address],
    });
    return Number(nonce);
  }

  /**
   * Compute the on-chain recovery operation ID (keccak256).
   * Extension reference: sdk.ts#getRecoveryOnchainID
   */
  getRecoveryOnchainID(address: Address, nonce: number, newOwners: string[]): string {
    const ownersData = encodeAbiParameters(parseAbiParameters(['bytes32[]']), [
      newOwners.map((owner) => padHex(owner as Hex, { size: 32 })),
    ]);

    const onChainID = keccak256(
      encodeAbiParameters(
        parseAbiParameters(['address', 'uint256', 'bytes', 'address', 'uint256']),
        [
          address,
          BigInt(nonce),
          ownersData,
          this.contractConfig.recovery as Address,
          BigInt(this.ensureChainConfig().id),
        ],
      ),
    );

    return onChainID;
  }

  /**
   * Compute the EIP-712 typed data hash for recovery approval.
   * Extension reference: sdk.ts#generateRecoveryApproveHash
   */
  generateRecoveryApproveHash(address: Address, nonce: number, newOwners: string[]): string {
    const chainConfig = this.ensureChainConfig();

    const typedData = SocialRecovery.getSocialRecoveryTypedData(
      chainConfig.id,
      this.contractConfig.recovery as string,
      address,
      nonce,
      newOwners,
    );

    const domain = {
      chainId: Number(typedData.domain.chainId),
      ...(typedData.domain.name && { name: typedData.domain.name }),
      verifyingContract: typedData.domain.verifyingContract as Address,
      ...(typedData.domain.version && { version: typedData.domain.version }),
    };

    const sigHash = hashTypedData({
      domain,
      types: typedData.types,
      primaryType: typedData.primaryType,
      message: typedData.message,
    });

    return sigHash.toLowerCase();
  }

  /**
   * Check if a guardian has signed the recovery approval (ApproveHash event).
   * Extension reference: sdk.ts#checkIsGuardianSigned
   */
  async checkIsGuardianSigned(guardian: Address, fromBlock: bigint, hash?: Hex): Promise<boolean> {
    const logs = (await this._getLogsPaginated({
      address: this.contractConfig.recovery as Address,
      fromBlock,
      event: parseAbiItem('event ApproveHash(address indexed guardian, bytes32 hash)'),
      args: { guardian },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    })) as any[];

    if (hash) {
      return logs.some((log) => {
        const logArgs = log.args as { hash?: string } | undefined;
        return logArgs && logArgs.hash === hash;
      });
    }

    return logs.length > 0;
  }

  /**
   * Check if a specific guardian has approved a recovery hash on-chain.
   *
   * The contract's `approvedHashes` mapping is keyed by a composite key:
   *   keccak256(abi.encode(guardian, hash))
   * So we compute the key per-guardian and check the value (1 = approved).
   * Single `readContract` call per guardian -- no log scanning needed.
   */
  async isGuardianApprovedOnchain(guardian: Address, hash: Hex): Promise<boolean> {
    const client = this._getClient();

    const compositeKey = keccak256(
      encodeAbiParameters(parseAbiParameters(['address', 'bytes32']), [guardian, hash]),
    );

    const value = await client.readContract({
      address: this.contractConfig.recovery as Address,
      abi: ABI_SocialRecoveryModule,
      functionName: 'approvedHashes',
      args: [compositeKey],
    });

    return Number(value) > 0;
  }

  /**
   * Check approval status for all guardians in parallel.
   * Returns per-guardian boolean array + total signed count.
   */
  async checkGuardianApprovals(
    guardians: Address[],
    hash: Hex,
  ): Promise<{ results: boolean[]; signedCount: number }> {
    const results = await Promise.all(
      guardians.map((g) => this.isGuardianApprovedOnchain(g, hash)),
    );
    return {
      results,
      signedCount: results.filter(Boolean).length,
    };
  }

  /**
   * Read on-chain recovery operation state.
   * Returns RecoveryOperationState enum value (Unset/Waiting/Ready/Done).
   * Extension reference: sdk.ts#checkOnchainRecoveryStatus
   */
  async checkOnchainRecoveryStatus(wallet: Address, id: string): Promise<RecoveryOperationState> {
    const client = this._getClient();

    const status = await client.readContract({
      address: this.contractConfig.recovery as Address,
      abi: ABI_SocialRecoveryModule,
      functionName: 'getOperationState',
      args: [wallet, id],
    });

    return Number(status) as RecoveryOperationState;
  }

  /**
   * Read the valid time for a recovery operation.
   * Returns the Unix timestamp when the recovery becomes executable.
   */
  async getOperationValidTime(wallet: Address, id: string): Promise<number> {
    const client = this._getClient();

    const validTime = await client.readContract({
      address: this.contractConfig.recovery as Address,
      abi: ABI_SocialRecoveryModule,
      functionName: 'getOperationValidTime',
      args: [wallet, id],
    });

    return Number(validTime);
  }

  /**
   * Check if an address is an owner of the given wallet.
   * Used for self-recovery guard.
   * Calls isOwner(bytes32) on the Elytro smart wallet contract.
   */
  async isOwnerOfWallet(walletAddress: Address, ownerAddress: Address): Promise<boolean> {
    const client = this._getClient();
    const paddedOwner = padHex(ownerAddress, { size: 32 });

    try {
      const result = await client.readContract({
        address: walletAddress,
        abi: ABI_Elytro,
        functionName: 'isOwner',
        args: [paddedOwner],
      });
      return Boolean(result);
    } catch {
      // Contract may not be deployed
      return false;
    }
  }

  /**
   * Wrapper around SocialRecovery.calcGuardianHash.
   */
  calculateRecoveryContactsHash(contacts: string[], threshold: number): string {
    return SocialRecovery.calcGuardianHash(contacts, threshold, zeroHash);
  }

  /**
   * Get the current block number from the RPC.
   */
  async getBlockNumber(): Promise<bigint> {
    const client = this._getClient();
    return client.getBlockNumber();
  }

  /** Expose infoRecorder address from current config. */
  get infoRecorderAddress(): Address {
    return this.contractConfig.infoRecorder as Address;
  }

  /** Expose recovery module address from current config. */
  get recoveryModuleAddress(): Address {
    return this.contractConfig.recovery as Address;
  }

  // ─── Internal ──────────────────────────────────────────────────

  /**
   * Create a viem PublicClient for read-only RPC calls.
   * Extension reference: sdk.ts#_getClient
   */
  private _getClient(): PublicClient {
    const chainConfig = this.ensureChainConfig();
    return createPublicClient({
      transport: http(chainConfig.endpoint),
    });
  }

  /**
   * Paginated getLogs that respects public RPC block-range limits.
   * Mirrors extension's getLogsOnchain: walks forward in steps, halves on
   * "block range" errors, retries with backoff on transient failures.
   */
  private async _getLogsPaginated(
    args: Parameters<PublicClient['getLogs']>[0] & { fromBlock: bigint },
  ): Promise<Awaited<ReturnType<PublicClient['getLogs']>>> {
    const client = this._getClient();
    const { fromBlock, ...rest } = args;

    const latestBlock = await client.getBlockNumber();
    let cursor = fromBlock;
    let step = 10_000n;
    const MIN_STEP = 100n;
    const MAX_RETRIES = 3;
    const TIMEOUT_MS = 60_000;
    let retryCount = 0;
    const startTime = Date.now();

    while (cursor <= latestBlock) {
      if (Date.now() - startTime > TIMEOUT_MS) {
        throw new Error('getLogs paginated query timed out');
      }

      const end = cursor + step > latestBlock ? latestBlock : cursor + step;

      try {
        const logs = await client.getLogs({
          ...rest,
          fromBlock: cursor,
          toBlock: end,
        } as Parameters<PublicClient['getLogs']>[0]);

        if (logs.length > 0) {
          return logs;
        }
        cursor = end + 1n;
        retryCount = 0; // reset on success
      } catch (error) {
        if (error instanceof Error) {
          if (
            error.message.includes('block range') ||
            error.message.includes('exceed maximum block range') ||
            error.message.includes('Log response size exceeded')
          ) {
            step = step / 2n;
            if (step < MIN_STEP) break;
            continue;
          }
          retryCount++;
          if (retryCount >= MAX_RETRIES) throw error;
          await new Promise((r) => setTimeout(r, 1000 * retryCount));
          continue;
        }
        throw error;
      }
    }

    return [];
  }

  private ensureChainConfig(): ChainConfig {
    if (!this.chainConfig) {
      throw new Error('SDK not initialized. Call initForChain() first.');
    }
    return this.chainConfig;
  }

  private ensureSDK(): ElytroWallet {
    if (!this.sdk) {
      throw new Error('SDK not initialized. Call initForChain() first.');
    }
    return this.sdk;
  }

  private ensureBundler(): Bundler {
    if (!this.bundlerInstance) {
      throw new Error('Bundler not initialized. Call initForChain() first.');
    }
    return this.bundlerInstance;
  }

  /**
   * Normalize SDK UserOp (which uses string/BigNumberish) to our typed format.
   */
  private normalizeUserOp(sdkOp: Record<string, unknown>): ElytroUserOperation {
    return {
      sender: sdkOp.sender as string as Address,
      nonce: BigInt(sdkOp.nonce as string | number | bigint),
      factory: (sdkOp.factory as string as Address) ?? null,
      factoryData: (sdkOp.factoryData as Hex) ?? null,
      callData: (sdkOp.callData as Hex) ?? '0x',
      callGasLimit: BigInt((sdkOp.callGasLimit as string | number | bigint) || 0),
      verificationGasLimit: BigInt((sdkOp.verificationGasLimit as string | number | bigint) || 0),
      preVerificationGas: BigInt((sdkOp.preVerificationGas as string | number | bigint) || 0),
      maxFeePerGas: BigInt((sdkOp.maxFeePerGas as string | number | bigint) || 0),
      maxPriorityFeePerGas: BigInt((sdkOp.maxPriorityFeePerGas as string | number | bigint) || 0),
      paymaster: (sdkOp.paymaster as string as Address) ?? null,
      paymasterVerificationGasLimit: sdkOp.paymasterVerificationGasLimit
        ? BigInt(sdkOp.paymasterVerificationGasLimit as string | number | bigint)
        : null,
      paymasterPostOpGasLimit: sdkOp.paymasterPostOpGasLimit
        ? BigInt(sdkOp.paymasterPostOpGasLimit as string | number | bigint)
        : null,
      paymasterData: (sdkOp.paymasterData as Hex) ?? null,
      signature: (sdkOp.signature as Hex) ?? '0x',
    };
  }

  /**
   * Convert our typed UserOp back to the SDK's format (string-based BigNumberish).
   */
  private toSDKUserOp(op: ElytroUserOperation): UserOperation {
    return {
      sender: op.sender,
      nonce: toHex(op.nonce),
      factory: op.factory,
      factoryData: op.factoryData,
      callData: op.callData,
      callGasLimit: toHex(op.callGasLimit),
      verificationGasLimit: toHex(op.verificationGasLimit),
      preVerificationGas: toHex(op.preVerificationGas),
      maxFeePerGas: toHex(op.maxFeePerGas),
      maxPriorityFeePerGas: toHex(op.maxPriorityFeePerGas),
      paymaster: op.paymaster,
      paymasterVerificationGasLimit: op.paymasterVerificationGasLimit
        ? toHex(op.paymasterVerificationGasLimit)
        : null,
      paymasterPostOpGasLimit: op.paymasterPostOpGasLimit
        ? toHex(op.paymasterPostOpGasLimit)
        : null,
      paymasterData: op.paymasterData,
      signature: op.signature,
    };
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
