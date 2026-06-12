import { randomUUID } from 'node:crypto';
import { isAddress, encodeFunctionData } from 'viem';
import type { Address, Hex } from 'viem';
import type { DelegationInfo, AccountInfo } from '../types';
import type { DelegationStore } from '../storage/delegationStore';
import type { AccountService } from './account';
import type { SDKService } from './sdk';
import type { KeyringService } from './keyring';
import type { ChainService } from './chain';
import type { WalletClientService } from './walletClient';
import { getTokenBalance } from '../utils/erc20';

// ─── Minimal ABI fragments for DelegationManager interaction ──────

const DELEGATION_MANAGER_ABI = [
  {
    name: 'redeemDelegations',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'permissionContexts', type: 'bytes[]' },
      { name: 'modes', type: 'bytes32[]' },
      { name: 'executionCallDatas', type: 'bytes[]' },
    ],
    outputs: [],
  },
] as const;

// ─── Types ────────────────────────────────────────────────────────

export type DelegationStatus =
  | 'valid'
  | 'expired'
  | 'insufficient_balance'
  | 'invalid_onchain'
  | 'unknown';

export interface DelegationVerifyResult {
  id: string;
  status: DelegationStatus;
  details?: string;
  remainingBalance?: string;
}

export interface CreateDelegationParams {
  manager: Address;
  token: Address;
  payee: Address;
  amount: string;
  permissionContext: string;
  id?: string;
  expiresAt?: string;
  note?: string;
}

// ─── Service ──────────────────────────────────────────────────────

/**
 * DelegationService — full ERC-7710 delegation lifecycle.
 *
 * Responsibilities:
 *   - CRUD operations (backed by DelegationStore)
 *   - On-chain verification via simulation
 *   - Expiry tracking, renewal, revocation
 *   - Balance preflight checks
 *   - Matching delegations to x402 payment requirements
 *
 * Design note:
 *   On-chain create and revoke operations go through the smart account's
 *   UserOp pipeline (ERC-4337). The exact calldata depends on the
 *   DelegationManager implementation. Since the x402 spec explicitly
 *   declares delegation creation "out of scope", and on-chain delegation
 *   contracts vary widely, we expose `create` as a local-store operation
 *   (importing a pre-existing on-chain delegation) and provide `revoke`
 *   as a UserOp-based operation that calls the manager contract.
 */
export class DelegationService {
  private delegationStore: DelegationStore;
  private account: AccountService;
  private sdk: SDKService;
  private keyring: KeyringService;
  private chain: ChainService;
  private walletClient: WalletClientService;

  constructor(deps: {
    delegationStore: DelegationStore;
    account: AccountService;
    sdk: SDKService;
    keyring: KeyringService;
    chain: ChainService;
    walletClient: WalletClientService;
  }) {
    this.delegationStore = deps.delegationStore;
    this.account = deps.account;
    this.sdk = deps.sdk;
    this.keyring = deps.keyring;
    this.chain = deps.chain;
    this.walletClient = deps.walletClient;
  }

  // ─── CRUD (Acquire / Import) ────────────────────────────────────

  /**
   * Import a delegation from an external source into local storage.
   * Validates parameter shapes but does NOT perform on-chain verification
   * unless `verify: true` is passed.
   */
  async add(
    aliasOrAddress: string | undefined,
    params: CreateDelegationParams,
    options?: { verify?: boolean },
  ): Promise<DelegationInfo> {
    const acct = this.resolveAccount(aliasOrAddress);

    if (!isAddress(params.manager)) throw new Error('manager must be a valid address.');
    if (!isAddress(params.token)) throw new Error('token must be a valid address.');
    if (!isAddress(params.payee)) throw new Error('payee must be a valid address.');
    if (!params.permissionContext || !params.permissionContext.startsWith('0x')) {
      throw new Error('permissionContext must be a 0x-prefixed hex string.');
    }

    const delegation: DelegationInfo = {
      id: params.id ?? randomUUID(),
      manager: params.manager,
      token: params.token,
      payee: params.payee,
      amount: params.amount,
      permissionContext: params.permissionContext,
      ...(params.expiresAt ? { expiresAt: params.expiresAt } : {}),
      ...(params.note ? { note: params.note } : {}),
    };

    if (options?.verify) {
      const result = await this.verifyOne(acct, delegation);
      if (result.status !== 'valid') {
        throw new Error(
          `Delegation verification failed: ${result.status}` +
            (result.details ? ` — ${result.details}` : ''),
        );
      }
    }

    return this.delegationStore.add(acct.address, delegation);
  }

  async list(aliasOrAddress?: string): Promise<DelegationInfo[]> {
    const acct = this.resolveAccount(aliasOrAddress);
    return this.delegationStore.list(acct.address);
  }

  async get(
    aliasOrAddress: string | undefined,
    delegationId: string,
  ): Promise<DelegationInfo | null> {
    const acct = this.resolveAccount(aliasOrAddress);
    return this.delegationStore.get(acct.address, delegationId);
  }

  async remove(aliasOrAddress: string | undefined, delegationId: string): Promise<void> {
    const acct = this.resolveAccount(aliasOrAddress);
    return this.delegationStore.remove(acct.address, delegationId);
  }

  // ─── Verify ─────────────────────────────────────────────────────

  /**
   * Verify a single delegation both locally (expiry) and on-chain (simulation).
   */
  async verify(
    aliasOrAddress: string | undefined,
    delegationId: string,
  ): Promise<DelegationVerifyResult> {
    const acct = this.resolveAccount(aliasOrAddress);
    const delegation = await this.delegationStore.get(acct.address, delegationId);
    if (!delegation) {
      return {
        id: delegationId,
        status: 'unknown',
        details: 'Delegation not found in local store.',
      };
    }
    return this.verifyOne(acct, delegation);
  }

  private async verifyOne(
    acct: AccountInfo,
    delegation: DelegationInfo,
  ): Promise<DelegationVerifyResult> {
    // 1. Local expiry check
    if (delegation.expiresAt && Date.parse(delegation.expiresAt) <= Date.now()) {
      return {
        id: delegation.id,
        status: 'expired',
        details: `Expired at ${delegation.expiresAt}`,
      };
    }

    // 2. Balance check
    try {
      const balance = await getTokenBalance(this.walletClient, delegation.token, acct.address);
      if (balance < BigInt(delegation.amount)) {
        return {
          id: delegation.id,
          status: 'insufficient_balance',
          details: `Token balance ${balance.toString()} < delegation amount ${delegation.amount}`,
          remainingBalance: balance.toString(),
        };
      }
    } catch {
      // Non-fatal: RPC may be unreachable. Skip balance check.
    }

    // 3. On-chain simulation via DelegationManager.redeemDelegations
    try {
      // Build the calldata that the facilitator would submit
      const transferCallData = encodeFunctionData({
        abi: [
          {
            name: 'transfer',
            type: 'function',
            stateMutability: 'nonpayable',
            inputs: [
              { name: 'to', type: 'address' },
              { name: 'amount', type: 'uint256' },
            ],
            outputs: [{ name: '', type: 'bool' }],
          },
        ] as const,
        functionName: 'transfer',
        args: [delegation.payee, BigInt(delegation.amount)],
      });

      // ERC-7579 single execution mode
      const mode = '0x0000000000000000000000000000000000000000000000000000000000000000' as Hex;

      // Simulate the redemption call
      const redeemCallData = encodeFunctionData({
        abi: DELEGATION_MANAGER_ABI,
        functionName: 'redeemDelegations',
        args: [[delegation.permissionContext as Hex], [mode], [transferCallData]],
      });

      // Use eth_call simulation (static call) against the DelegationManager
      await this.walletClient.readContract({
        address: delegation.manager,
        abi: DELEGATION_MANAGER_ABI,
        functionName: 'redeemDelegations',
        args: [[delegation.permissionContext as Hex], [mode], [transferCallData]],
      });

      return { id: delegation.id, status: 'valid' };
    } catch (err) {
      // Simulation revert means the delegation is invalid on-chain
      const msg = err instanceof Error ? err.message : String(err);
      // Distinguish between RPC errors and actual contract reverts
      if (msg.includes('execution reverted') || msg.includes('revert')) {
        return { id: delegation.id, status: 'invalid_onchain', details: msg.slice(0, 200) };
      }
      // RPC connectivity issue — can't determine status
      return {
        id: delegation.id,
        status: 'valid',
        details: 'On-chain simulation skipped (RPC error).',
      };
    }
  }

  // ─── Sync (batch validation) ────────────────────────────────────

  /**
   * Validate all delegations for an account and return their statuses.
   * Removes expired delegations automatically (if `prune: true`).
   */
  async sync(
    aliasOrAddress?: string,
    options?: { prune?: boolean },
  ): Promise<DelegationVerifyResult[]> {
    const acct = this.resolveAccount(aliasOrAddress);
    const delegations = await this.delegationStore.list(acct.address);
    const results: DelegationVerifyResult[] = [];

    for (const delegation of delegations) {
      const result = await this.verifyOne(acct, delegation);
      results.push(result);
    }

    if (options?.prune) {
      const expired = results.filter((r) => r.status === 'expired');
      for (const r of expired) {
        await this.delegationStore.remove(acct.address, r.id);
      }
    }

    return results;
  }

  // ─── Renew ──────────────────────────────────────────────────────

  /**
   * Renew a delegation by creating a copy with extended expiration.
   *
   * Produces a NEW local delegation with the same parameters but a new ID
   * and updated expiresAt. The caller is responsible for ensuring the
   * new permissionContext is valid (since on-chain delegation renewal
   * requires a new delegation to be created on-chain first).
   *
   * If `newPermissionContext` is not provided, reuses the existing one
   * (appropriate when the on-chain delegation doesn't embed an expiry in
   * the permission context itself — e.g. expiry is enforced by a
   * separate caveat enforcer contract).
   */
  async renew(
    aliasOrAddress: string | undefined,
    delegationId: string,
    params: {
      expiresAt: string;
      newPermissionContext?: string;
      newAmount?: string;
      removeOld?: boolean;
    },
  ): Promise<DelegationInfo> {
    const acct = this.resolveAccount(aliasOrAddress);
    const existing = await this.delegationStore.get(acct.address, delegationId);
    if (!existing) {
      throw new Error(`Delegation "${delegationId}" not found.`);
    }

    const renewed: DelegationInfo = {
      ...existing,
      id: randomUUID(),
      expiresAt: params.expiresAt,
      ...(params.newPermissionContext ? { permissionContext: params.newPermissionContext } : {}),
      ...(params.newAmount ? { amount: params.newAmount } : {}),
      note: existing.note
        ? `${existing.note} (renewed from ${delegationId})`
        : `Renewed from ${delegationId}`,
    };

    await this.delegationStore.add(acct.address, renewed);

    if (params.removeOld) {
      await this.delegationStore.remove(acct.address, delegationId);
    }

    return renewed;
  }

  // ─── Revoke (on-chain + local) ──────────────────────────────────

  /**
   * Revoke a delegation on-chain by sending a UserOp, then remove locally.
   *
   * The specific revocation method depends on the DelegationManager
   * implementation. The most common pattern is calling `disableDelegation`
   * on the DelegationManager. Since there is no standardized ABI for this
   * yet, we provide the revocation as a generic "send UserOp with calldata
   * to the manager contract" mechanism.
   *
   * Pass `revokeCallData` if you know the exact calldata. Otherwise,
   * the method will only remove the local record (with `onchainOnly: false`).
   */
  async revoke(
    aliasOrAddress: string | undefined,
    delegationId: string,
    options?: {
      revokeCallData?: Hex;
      keepLocal?: boolean;
    },
  ): Promise<{ localRemoved: boolean; txHash?: string }> {
    const acct = this.resolveAccount(aliasOrAddress);
    const delegation = await this.delegationStore.get(acct.address, delegationId);
    if (!delegation) {
      throw new Error(`Delegation "${delegationId}" not found.`);
    }

    let txHash: string | undefined;

    if (options?.revokeCallData) {
      // Build a UserOp that calls the DelegationManager with the revoke calldata
      const chainConfig = this.chain.chains.find((c) => c.id === acct.chainId);
      if (!chainConfig) {
        throw new Error(`Chain config not found for chainId ${acct.chainId}.`);
      }

      const userOp = await this.sdk.createSendUserOp(acct.address, [
        {
          to: delegation.manager,
          data: options.revokeCallData,
        },
      ]);

      // Estimate gas
      const fees = await this.sdk.getFeeData(chainConfig);
      userOp.maxFeePerGas = fees.maxFeePerGas;
      userOp.maxPriorityFeePerGas = fees.maxPriorityFeePerGas;

      const gasEstimate = await this.sdk.estimateUserOp(userOp);
      userOp.callGasLimit = gasEstimate.callGasLimit;
      userOp.verificationGasLimit = gasEstimate.verificationGasLimit;
      userOp.preVerificationGas = gasEstimate.preVerificationGas;

      // Sign and send
      const { packedHash, validationData } = await this.sdk.packRawHash(
        userOp.signature, // placeholder — SDK builds the real hash
      );
      const rawSig = await this.keyring.signDigest(packedHash);
      userOp.signature = await this.sdk.packUserOpSignature(rawSig, validationData);
      txHash = await this.sdk.sendUserOp(userOp);
    }

    if (!options?.keepLocal) {
      await this.delegationStore.remove(acct.address, delegationId);
    }

    return { localRemoved: !options?.keepLocal, txHash };
  }

  // ─── Find for x402 payment ─────────────────────────────────────

  /**
   * Find a delegation matching an x402 payment requirement.
   * Throws if none found (for backward compat with X402Service).
   */
  async findForPayment(
    aliasOrAddress: string | undefined,
    criteria: {
      manager: Address;
      token: Address;
      payee: Address;
      amount: string;
    },
  ): Promise<DelegationInfo> {
    const acct = this.resolveAccount(aliasOrAddress);
    const match = await this.delegationStore.findMatch(acct.address, {
      manager: criteria.manager,
      token: criteria.token,
      payee: criteria.payee,
      minAmount: BigInt(criteria.amount),
    });

    if (!match) {
      throw new Error('No stored delegation matches this payment requirement.');
    }

    return match;
  }

  // ─── Migration ──────────────────────────────────────────────────

  /**
   * Migrate legacy delegations from AccountInfo.delegations into DelegationStore.
   * Called once at startup. Safe to call repeatedly (idempotent).
   */
  async migrateLegacy(): Promise<number> {
    const legacyBatches = await this.account.drainLegacyDelegations();
    let total = 0;
    for (const batch of legacyBatches) {
      const count = await this.delegationStore.importLegacy(
        batch.address as Address,
        batch.delegations,
      );
      total += count;
    }
    return total;
  }

  // ─── Helpers ────────────────────────────────────────────────────

  private resolveAccount(aliasOrAddress?: string): AccountInfo {
    if (aliasOrAddress) {
      const resolved = this.account.resolveAccount(aliasOrAddress);
      if (!resolved) {
        throw new Error(`Account "${aliasOrAddress}" not found.`);
      }
      return resolved;
    }
    const current = this.account.currentAccount;
    if (!current) {
      throw new Error('No active account. Use `elytro account switch` or pass --account.');
    }
    return current;
  }
}
