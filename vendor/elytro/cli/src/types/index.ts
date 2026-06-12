import type { Address, Hex } from 'viem';

// ─── Account ────────────────────────────────────────────────────────

export interface AccountInfo {
  /** Smart account contract address */
  address: Address;
  /** Chain ID this account is deployed on (or will be) */
  chainId: number;
  /** Human-readable alias (e.g. "swift-panda") */
  alias: string;
  /** EOA owner address — internal only, never exposed to user */
  owner: Address;
  /** CREATE2 index — allows multiple accounts per owner per chain */
  index: number;
  /** Whether the smart contract has been deployed on-chain */
  isDeployed: boolean;
  /** Whether social recovery guardians have been set */
  isRecoveryEnabled: boolean;
  /**
   * Temporary security intent from `account create`.
   * Consumed and deleted by `activate`. Existence = not yet executed.
   */
  securityIntent?: SecurityIntent;
  /**
   * Persistent on-chain security state, written by `activate`.
   * Absent = hook never installed via create→activate flow.
   */
  securityStatus?: SecurityStatus;
  /**
   * @deprecated Delegations are now stored separately via DelegationStore.
   * This field exists only for migration from older data files.
   * New code must use DelegationStore / DelegationService.
   */
  delegations?: DelegationInfo[];
  /** Non-null when this account is being recovered; blocks write operations */
  activeRecovery?: {
    status: RecoveryStatus;
    newOwner: Address;
    recoveryId: string;
    lastCheckedAt: number;
  } | null;
}

// ─── Security Intent (temporary, create → activate) ────────────

/**
 * User's security preferences captured at `account create` time.
 * Consumed and **deleted** during `activate` — existence implies
 * "not yet executed". Per-account, per-chain.
 *
 * After activate, relevant state moves to `SecurityStatus`.
 */
export interface SecurityIntent {
  /** Email for OTP-based 2FA */
  email?: string;
  /** Daily spending limit in whole USD */
  dailyLimitUsd?: number;
  /** Transient backend binding ID from requestEmailBinding attempt */
  emailBindingId?: string;
}

// ─── Security Status (persistent, post-activate) ───────────────

/**
 * On-chain security state tracked locally after `activate`.
 * Survives indefinitely — reflects what actually happened on-chain.
 * Backend-side state (email, spending limit) is queried via SecurityHookService.
 */
export interface SecurityStatus {
  /** Whether the SecurityHook was installed during activate */
  hookInstalled: boolean;
}

// ─── Delegations (ERC-7710) ──────────────────────────────────────

export interface DelegationInfo {
  /** Local identifier for CLI reference */
  id: string;
  /** DelegationManager contract address */
  manager: Address;
  /** Token contract address this delegation covers */
  token: Address;
  /** Destination address locked into the delegation */
  payee: Address;
  /** Authorized amount in token's smallest unit (string for large ints) */
  amount: string;
  /** Raw permission context blob required by the manager */
  permissionContext: string;
  /** Optional expiration timestamp (ISO string) */
  expiresAt?: string;
  /** Optional human-readable note */
  note?: string;
}

// ─── Keyring ────────────────────────────────────────────────────────

export interface OwnerKey {
  /** EOA address derived from the private key */
  id: Address;
  /** Hex-encoded private key (stored encrypted on disk) */
  key: Hex;
}

export interface VaultData {
  owners: OwnerKey[];
  currentOwnerId: Address;
}

export interface EncryptedData {
  data: string;
  iv: string;
  /**
   * Present for version 1 (PBKDF2) blobs. Absent for version 2 (raw key) blobs.
   * Do not use an empty string as a sentinel — omit the field entirely for v2.
   */
  salt?: string;
  /** 1 = PBKDF2 password-based, 2 = raw vault key (via SecretProvider). Absent treated as 1. */
  version?: 1 | 2;
}

// ─── Chain ──────────────────────────────────────────────────────────

export interface ChainConfig {
  id: number;
  name: string;
  /** RPC endpoint URL */
  endpoint: string;
  /** Pimlico bundler URL */
  bundler: string;
  /** Native currency symbol */
  nativeCurrency: {
    name: string;
    symbol: string;
    decimals: number;
  };
  /** Block explorer URL */
  blockExplorer?: string;
  /** Stablecoin definitions for this chain */
  stablecoins?: { name: string; address: string[] }[];
}

// ─── Config ─────────────────────────────────────────────────────────

export interface CliConfig {
  /** Currently selected chain ID */
  currentChainId: number;
  /** Available chains */
  chains: ChainConfig[];
  /** GraphQL API endpoint */
  graphqlEndpoint: string;
}

/** User-configured API keys persisted in ~/.elytro/user-keys.json */
export interface UserKeys {
  /** Alchemy API key — unlocks higher RPC rate limits */
  alchemyKey?: string;
  /** Pimlico API key — unlocks higher bundler rate limits */
  pimlicoKey?: string;
}

// ─── Storage ────────────────────────────────────────────────────────

export interface StorageAdapter {
  load<T>(key: string): Promise<T | null>;
  save<T>(key: string, data: T): Promise<void>;
  remove(key: string): Promise<void>;
  exists(key: string): Promise<boolean>;
}

// ─── UserOperation (ERC-4337) ───────────────────────────────────────

export interface ElytroUserOperation {
  sender: Address;
  nonce: bigint;
  factory: Address | null;
  factoryData: Hex | null;
  callData: Hex;
  callGasLimit: bigint;
  verificationGasLimit: bigint;
  preVerificationGas: bigint;
  maxFeePerGas: bigint;
  maxPriorityFeePerGas: bigint;
  paymaster: Address | null;
  paymasterVerificationGasLimit: bigint | null;
  paymasterPostOpGasLimit: bigint | null;
  paymasterData: Hex | null;
  signature: Hex;
}

// ─── Sponsor ────────────────────────────────────────────────────────

export interface SponsorResult {
  paymaster: Address;
  paymasterData: Hex;
  callGasLimit: string;
  verificationGasLimit: string;
  preVerificationGas: string;
  paymasterVerificationGasLimit?: string;
  paymasterPostOpGasLimit?: string;
}

// ─── UserOp Receipt ─────────────────────────────────────────────────

export interface UserOpReceipt {
  userOpHash: Hex;
  entryPoint: Address;
  sender: Address;
  nonce: string;
  paymaster?: Address;
  actualGasCost: string;
  actualGasUsed: string;
  success: boolean;
  reason?: string;
  receipt?: {
    transactionHash: Hex;
    blockNumber: string;
    blockHash: Hex;
    gasUsed: string;
  };
}

// ─── Security Hook ─────────────────────────────────────────────────

export interface HookStatus {
  installed: boolean;
  hookAddress: Address;
  capabilities: {
    preUserOpValidation: boolean;
    preIsValidSignature: boolean;
  };
  forceUninstall: {
    initiated: boolean;
    canExecute: boolean;
    /** ISO timestamp or null */
    availableAfter: string | null;
  };
}

export interface SecurityProfile {
  email?: string;
  emailVerified?: boolean;
  maskedEmail?: string;
  dailyLimitUsdCents?: number;
  createdAt?: string;
  updatedAt?: string;
}

export interface HookError {
  code?: string;
  challengeId?: string;
  currentSpendUsdCents?: number;
  dailyLimitUsdCents?: number;
  maskedEmail?: string;
  otpExpiresAt?: string;
  projectedSpendUsdCents?: number;
  message?: string;
}

// ─── Pending OTP (deferred input) ──────────────────────────────────

export type PendingOtpAction =
  | 'email_bind'
  | 'email_change'
  | 'spending_limit'
  | 'tx_send'
  | '2fa_uninstall';

export type PendingOtpData =
  | { email: string }
  | { dailyLimitUsdCents: number }
  | { userOp: Record<string, string | null>; entryPoint: string; txSpec?: string[] }
  | { userOp: Record<string, string | null>; entryPoint: string };

export interface PendingOtpState {
  id: string;
  account: string;
  chainId: number;
  action: PendingOtpAction;
  challengeId?: string;
  bindingId?: string;
  /** Auth session that created the challenge; required for verifySecurityOtp when resuming */
  authSessionId?: string;
  maskedEmail?: string;
  otpExpiresAt?: string;
  createdAt: string;
  data: PendingOtpData;
}

export interface PendingOtpsStore {
  [id: string]: PendingOtpState;
}

// ─── Social Recovery ────────────────────────────────────────────────

export interface RecoveryContact {
  address: Address;
  label?: string;
  /** Persisted across polls: true once guardian's ApproveHash is seen on-chain. */
  signed?: boolean;
}

export interface RecoveryContactsInfo {
  salt: string;
  threshold: number;
  contacts: string[];
}

export interface RecoveryBackup {
  address: Address;
  chainId: number;
  contacts: RecoveryContact[];
  threshold: string;
}

/** Written by `recovery initiate`, read by `recovery status` */
export interface LocalRecoveryRecord {
  walletAddress: Address;
  chainId: number;
  newOwner: Address;
  recoveryId: string;
  approveHash: string;
  contacts: RecoveryContact[];
  threshold: number;
  fromBlock: string;
  recoveryUrl: string;
  recoveryRecordID?: string;
}

export enum RecoveryStatus {
  WAITING_FOR_SIGNATURE = 'WAITING_FOR_SIGNATURE',
  SIGNATURE_COMPLETED = 'SIGNATURE_COMPLETED',
  RECOVERY_STARTED = 'RECOVERY_STARTED',
  RECOVERY_READY = 'RECOVERY_READY',
  RECOVERY_COMPLETED = 'RECOVERY_COMPLETED',
}

export interface RecoveryStatusResult {
  walletAddress: Address;
  newOwner: Address;
  status: RecoveryStatus;
  contacts: Array<RecoveryContact & { signed: boolean }>;
  signedCount: number;
  threshold: number;
  recoveryUrl: string;
  validTime: number | null;
  remainingSeconds: number | null;
}

// ─── Nullable helper ────────────────────────────────────────────────

export type Nullable<T> = T | null | undefined;
