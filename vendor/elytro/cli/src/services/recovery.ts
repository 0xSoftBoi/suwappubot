import type { Address, Hex } from 'viem';
import { padHex, zeroHash } from 'viem';
import { readFileSync } from 'node:fs';
import type { StorageAdapter } from '../types';
import type {
  AccountInfo,
  RecoveryContact,
  RecoveryContactsInfo,
  RecoveryBackup,
  LocalRecoveryRecord,
  RecoveryStatusResult,
} from '../types';
import { RecoveryStatus } from '../types';
import type { SDKService } from './sdk';
import type { ChainService } from './chain';
import type { AccountService } from './account';
import type { KeyringService } from './keyring';
import { RECOVERY_APP_URL, RecoveryOperationState } from '../constants/recovery';
import { encodeSetGuardian, encodeRecordGuardianInfo } from '../utils/contracts/socialRecovery';
import { requestGraphQL } from '../utils/graphqlClient';

const RECOVERY_RECORD_KEY = 'recovery-record';
const GUARDIAN_LABELS_PREFIX = 'guardian-labels-';

// ─── GraphQL Definitions ──────────────────────────────────────────

const CREATE_RECOVERY_RECORD_MUTATION = `
  mutation CreateRecoveryRecord($input: CreateRecoveryRecordInput!) {
    createRecoveryRecord(input: $input) {
      status
      recoveryRecordID
      guardianInfo {
        threshold
        salt
        guardians
      }
      onchainID
      nonce
      newOwners
      createTimestamp
      chainID
      address
    }
  }
`;

const GET_RECOVERY_RECORD_QUERY = `
  query GetRecoveryInfo($recoveryRecordId: String!) {
    getRecoveryInfo(recoveryRecordID: $recoveryRecordId) {
      recoveryRecordID
      onchainID
      address
      chainID
      createTimestamp
      nonce
      newOwners
      guardianInfo {
        salt
        threshold
        guardians
      }
      status
      guardianSignatures {
        recoveryRecordID
        guardian
        signatureType
        guardianSignature
        updateTimestamp
      }
      validTime
      emailGuardianStatus
    }
  }
`;

// ─── Service ──────────────────────────────────────────────────────

export class RecoveryService {
  private store: StorageAdapter;
  private sdk: SDKService;
  private chain: ChainService;
  private account: AccountService;
  private keyring: KeyringService;

  constructor(deps: {
    store: StorageAdapter;
    sdk: SDKService;
    chain: ChainService;
    account: AccountService;
    keyring: KeyringService;
  }) {
    this.store = deps.store;
    this.sdk = deps.sdk;
    this.chain = deps.chain;
    this.account = deps.account;
    this.keyring = deps.keyring;
  }

  // ─── Contacts Query ────────────────────────────────────────────

  /**
   * Query on-chain recovery contacts from InfoRecorder event logs.
   */
  async queryContacts(address: Address): Promise<RecoveryContactsInfo | null> {
    return this.sdk.queryRecoveryContacts(address);
  }

  /**
   * Get on-chain recovery info (hash, nonce, delay).
   */
  async getRecoveryInfo(address: Address) {
    return this.sdk.getRecoveryInfo(address);
  }

  /**
   * Compute guardian hash using SocialRecovery.calcGuardianHash.
   */
  calculateContactsHash(contacts: string[], threshold: number): string {
    return this.sdk.calculateRecoveryContactsHash(contacts, threshold);
  }

  // ─── Contacts Set (generate txs for UserOp) ───────────────────

  /**
   * Generate the internal transactions for setting guardians.
   *
   * Returns 1 or 2 transactions depending on privacy mode:
   *   (1) InfoRecorder.record(GUARDIAN_INFO_KEY, data) -- plaintext event log (skipped in privacy mode)
   *   (2) SocialRecoveryModule.setGuardian(newHash)
   */
  generateSetContactsTxs(
    contacts: Address[],
    threshold: number,
    privacyMode: boolean = false,
  ): Array<{ to: string; value?: string; data?: string }> {
    const txs: Array<{ to: string; value?: string; data?: string }> = [];

    if (!privacyMode) {
      const recordTx = encodeRecordGuardianInfo(
        contacts,
        threshold,
        zeroHash,
        this.sdk.infoRecorderAddress,
      );
      txs.push({ to: recordTx.to, value: recordTx.value, data: recordTx.data });
    }

    const newHash = this.calculateContactsHash(
      contacts.map((c) => c.toLowerCase()),
      threshold,
    );
    const setTx = encodeSetGuardian(newHash, this.sdk.recoveryModuleAddress);
    txs.push({ to: setTx.to, value: setTx.value, data: setTx.data });

    return txs;
  }

  /**
   * Generate txs for clearing all guardians (set hash to zero-like value).
   * Equivalent to contacts set with empty array.
   */
  generateClearContactsTxs(): Array<{ to: string; value?: string; data?: string }> {
    // setGuardian with zero hash clears guardians
    const clearHash = this.sdk.calculateRecoveryContactsHash([], 0);
    const setTx = encodeSetGuardian(clearHash, this.sdk.recoveryModuleAddress);
    return [{ to: setTx.to, value: setTx.value, data: setTx.data }];
  }

  // ─── Initiate Recovery ─────────────────────────────────────────

  /**
   * Initiate recovery -- pure off-chain computation.
   *
   * 1. Resolve new owner from keyring
   * 2. Self-recovery guard
   * 3. Fetch guardian contacts (from chain or backup file)
   * 4. Compute approveHash and recoveryID
   * 5. Build Recovery App URL
   * 6. Optionally create backend record
   * 7. Save local record
   */
  async initiateRecovery(params: {
    walletAddress: Address;
    chainId: number;
    fromBackup?: string;
  }): Promise<{
    walletAddress: Address;
    newOwner: Address;
    chainId: number;
    recoveryId: string;
    approveHash: string;
    contacts: RecoveryContact[];
    threshold: number;
    recoveryUrl: string;
    recoveryRecordID?: string;
  }> {
    const { walletAddress, chainId, fromBackup } = params;

    // 1. Resolve new owner silently from keyring
    const newOwner = this.keyring.currentOwner;
    if (!newOwner) {
      throw new Error(
        'Keyring is locked. Run `elytro init` first to create a local key before initiating recovery.',
      );
    }

    // 2. Self-recovery guard -- check if local key already owns the target wallet
    const isOwner = await this.sdk.isOwnerOfWallet(walletAddress, newOwner);
    if (isOwner) {
      throw new Error(
        'This address is already controlled by the local key. Recovery is unnecessary.',
      );
    }

    // Secondary guard: check local account registry
    const localAcct = this.account.resolveAccount(walletAddress);
    if (localAcct && localAcct.owner.toLowerCase() === newOwner.toLowerCase()) {
      throw new Error(
        'This address is already registered locally with the current owner. Recovery is unnecessary.',
      );
    }

    // 3. Get guardian info
    let contacts: RecoveryContact[];
    let threshold: number;

    if (fromBackup) {
      const backup = this.parseBackupFile(fromBackup);
      if (backup.address.toLowerCase() !== walletAddress.toLowerCase()) {
        throw new Error(
          `Backup file is for address ${backup.address}, but recovery target is ${walletAddress}.`,
        );
      }
      contacts = backup.contacts;
      threshold = Number(backup.threshold);
    } else {
      const contactsInfo = await this.sdk.queryRecoveryContacts(walletAddress);
      if (!contactsInfo || !contactsInfo.contacts.length) {
        throw new Error(
          'No recovery contacts found on-chain. Guardians may not have been set, or use --from-backup.',
        );
      }
      contacts = contactsInfo.contacts.map((addr) => ({ address: addr as Address }));
      threshold = contactsInfo.threshold;
    }

    // Merge local labels if available
    const labels = await this.getLocalLabels(walletAddress);
    if (labels) {
      for (const contact of contacts) {
        const label = labels[contact.address.toLowerCase()];
        if (label) {
          contact.label = label;
        }
      }
    }

    // 4. Compute recovery data
    const nonce = await this.sdk.getRecoveryNonce(walletAddress);
    const paddedOwner = padHex(newOwner, { size: 32 });

    const [approveHash, blockNumber, recoveryId] = await Promise.all([
      Promise.resolve(this.sdk.generateRecoveryApproveHash(walletAddress, nonce, [paddedOwner])),
      this.sdk.getBlockNumber(),
      Promise.resolve(this.sdk.getRecoveryOnchainID(walletAddress, nonce, [paddedOwner])),
    ]);

    const fromBlock = blockNumber.toString();

    // 5. Build Recovery App URL
    const recoveryUrl = this.buildShareLink({
      recoveryId,
      walletAddress,
      chainId,
      approveHash,
      fromBlock,
      newOwner,
      contacts,
      threshold,
    });

    // 6. Optionally create backend record (best-effort)
    let recoveryRecordID: string | undefined;
    try {
      const contactsInfo: RecoveryContactsInfo = {
        contacts: contacts.map((c) => c.address),
        threshold,
        salt: zeroHash,
      };
      const graphqlEndpoint = this.chain.graphqlEndpoint;
      const result = await requestGraphQL<{
        createRecoveryRecord: {
          recoveryRecordID: string;
          onchainID: string;
        };
      }>({
        endpoint: graphqlEndpoint,
        query: CREATE_RECOVERY_RECORD_MUTATION,
        variables: {
          input: {
            newOwners: [paddedOwner],
            chainID: `0x${chainId.toString(16)}`,
            address: walletAddress,
            guardianInfo: {
              guardians: contactsInfo.contacts,
              threshold: contactsInfo.threshold,
              salt: contactsInfo.salt,
            },
          },
        },
      });
      recoveryRecordID = result.createRecoveryRecord?.recoveryRecordID;
    } catch {
      // Backend record creation is optional; ignore failures
    }

    // 7. Save local record
    const record: LocalRecoveryRecord = {
      walletAddress,
      chainId,
      newOwner,
      recoveryId,
      approveHash,
      contacts,
      threshold,
      fromBlock,
      recoveryUrl,
      ...(recoveryRecordID && { recoveryRecordID }),
    };
    await this.saveLocalRecoveryRecord(record);

    // 8. If target wallet is in local registry, set activeRecovery
    if (localAcct) {
      await this.account.updateActiveRecovery(walletAddress, chainId, {
        status: RecoveryStatus.WAITING_FOR_SIGNATURE,
        newOwner,
        recoveryId,
        lastCheckedAt: Date.now(),
      });
    }

    return {
      walletAddress,
      newOwner,
      chainId,
      recoveryId,
      approveHash,
      contacts,
      threshold,
      recoveryUrl,
      recoveryRecordID,
    };
  }

  // ─── Status Query ──────────────────────────────────────────────

  /**
   * Query recovery status by combining on-chain state with local record.
   *
   * Uses only contract view calls (no log scanning):
   * 1. `getOperationState` for on-chain recovery state.
   * 2. `approvedHashes` per-guardian for signature status.
   * All are single `readContract` calls that return instantly.
   */
  async queryRecoveryStatus(params: {
    walletAddress: Address;
    recoveryId: string;
    approveHash: string;
    fromBlock: string;
    contacts: RecoveryContact[];
    threshold: number;
    newOwner: Address;
    recoveryUrl: string;
  }): Promise<RecoveryStatusResult> {
    const { walletAddress, recoveryId, approveHash, contacts, threshold, newOwner, recoveryUrl } =
      params;

    // All cheap contract view calls -- run in parallel
    const [onchainState, approvalResult] = await Promise.all([
      this.sdk.checkOnchainRecoveryStatus(walletAddress, recoveryId),
      this.sdk.checkGuardianApprovals(
        contacts.map((c) => c.address),
        approveHash as Hex,
      ),
    ]);

    const { results: approvalResults, signedCount } = approvalResult;

    // Compute valid time and remaining seconds for Waiting state
    let validTime: number | null = null;
    let remainingSeconds: number | null = null;

    if (onchainState === RecoveryOperationState.Waiting) {
      validTime = await this.sdk.getOperationValidTime(walletAddress, recoveryId);
      const nowSeconds = Math.floor(Date.now() / 1000);
      remainingSeconds = Math.max(0, validTime - nowSeconds);
    }

    // Derive status from on-chain state + approval count
    let status: RecoveryStatus;
    switch (onchainState) {
      case RecoveryOperationState.Done:
        status = RecoveryStatus.RECOVERY_COMPLETED;
        break;
      case RecoveryOperationState.Ready:
        status = RecoveryStatus.RECOVERY_READY;
        break;
      case RecoveryOperationState.Waiting:
        status = RecoveryStatus.RECOVERY_STARTED;
        break;
      case RecoveryOperationState.Unset:
      default:
        status =
          signedCount >= threshold
            ? RecoveryStatus.SIGNATURE_COMPLETED
            : RecoveryStatus.WAITING_FOR_SIGNATURE;
        break;
    }

    // Per-guardian signed status from contract view calls
    const allSigned = onchainState >= RecoveryOperationState.Waiting;
    const contactsWithSigned = contacts.map((c, i) => ({
      ...c,
      signed: allSigned || approvalResults[i],
    }));

    // Rewrite recoveryUrl path based on status:
    // - signatures not yet collected -> /contacts (guardian approval page)
    // - signatures collected or beyond -> /start (execute recovery page)
    const baseUrl = RECOVERY_APP_URL.replace(/\/$/, '');
    const queryString = recoveryUrl.includes('?')
      ? recoveryUrl.slice(recoveryUrl.indexOf('?'))
      : '';
    const statusRecoveryUrl =
      status === RecoveryStatus.WAITING_FOR_SIGNATURE
        ? `${baseUrl}/contacts${queryString}`
        : `${baseUrl}/start${queryString}`;

    return {
      walletAddress,
      newOwner,
      status,
      contacts: contactsWithSigned,
      signedCount: allSigned ? contacts.length : signedCount,
      threshold,
      recoveryUrl: statusRecoveryUrl,
      validTime,
      remainingSeconds,
    };
  }

  /**
   * Query status from local recovery record.
   */
  async queryRecoveryStatusFromLocal(): Promise<RecoveryStatusResult> {
    const record = await this.getLocalRecoveryRecord();
    if (!record) {
      throw new Error(
        'No local recovery record found. Use --wallet and --recovery-id, or run `recovery initiate` first.',
      );
    }

    return this.queryRecoveryStatus({
      walletAddress: record.walletAddress,
      recoveryId: record.recoveryId,
      approveHash: record.approveHash,
      fromBlock: record.fromBlock,
      contacts: record.contacts,
      threshold: record.threshold,
      newOwner: record.newOwner,
      recoveryUrl: record.recoveryUrl,
    });
  }

  /**
   * Handle recovery completion -- register recovered address as local account.
   */
  async handleRecoveryCompletion(statusResult: RecoveryStatusResult): Promise<void> {
    if (statusResult.status !== RecoveryStatus.RECOVERY_COMPLETED) {
      return;
    }

    const owner = this.keyring.currentOwner;
    if (!owner) return;

    // Check if newOwner matches local keyring
    if (statusResult.newOwner.toLowerCase() !== owner.toLowerCase()) {
      return;
    }

    // Read local recovery record to get the correct chainId before it's cleared
    const localRecord = await this.getLocalRecoveryRecord();
    const chainId = localRecord?.chainId ?? this.chain.currentChain.id;

    // Try to register the recovered wallet as a local account
    const existing = this.account.resolveAccount(statusResult.walletAddress);
    if (!existing) {
      try {
        // Import as a new local account
        await this.account.importAccounts([
          {
            address: statusResult.walletAddress,
            chainId,
            alias: `recovered-${statusResult.walletAddress.slice(2, 8).toLowerCase()}`,
            owner,
            index: 0,
            isDeployed: true,
            isRecoveryEnabled: true,
          },
        ]);
      } catch {
        // Best-effort; may fail if alias conflicts etc.
      }
    }

    // Clear activeRecovery on the account if it exists
    const acct = this.account.resolveAccount(statusResult.walletAddress);
    if (acct) {
      await this.account.clearActiveRecovery(statusResult.walletAddress, acct.chainId);
    }

    // Clear local recovery record
    await this.clearLocalRecoveryRecord();
  }

  // ─── Local Recovery Record ─────────────────────────────────────

  async getLocalRecoveryRecord(): Promise<LocalRecoveryRecord | null> {
    return this.store.load<LocalRecoveryRecord>(RECOVERY_RECORD_KEY);
  }

  async saveLocalRecoveryRecord(record: LocalRecoveryRecord): Promise<void> {
    await this.store.save(RECOVERY_RECORD_KEY, record);
  }

  async clearLocalRecoveryRecord(): Promise<void> {
    await this.store.remove(RECOVERY_RECORD_KEY);
  }

  /**
   * Persist guardian confirmed (signed) state to local record so subsequent
   * polls skip already-confirmed guardians (matches extension behaviour).
   */
  private async _updateLocalContactsConfirmed(
    walletAddress: Address,
    contactsWithSigned: Array<{ address: Address; signed: boolean; label?: string }>,
  ): Promise<void> {
    const record = await this.getLocalRecoveryRecord();
    if (!record || record.walletAddress.toLowerCase() !== walletAddress.toLowerCase()) return;

    record.contacts = record.contacts.map((c) => {
      const match = contactsWithSigned.find(
        (s) => s.address.toLowerCase() === c.address.toLowerCase(),
      );
      return match?.signed ? { ...c, signed: true } : c;
    });

    await this.saveLocalRecoveryRecord(record);
  }

  // ─── Backup ────────────────────────────────────────────────────

  async exportBackup(address: Address, chainId: number): Promise<RecoveryBackup> {
    const contactsInfo = await this.sdk.queryRecoveryContacts(address);
    if (!contactsInfo || !contactsInfo.contacts.length) {
      throw new Error('No recovery contacts found on-chain for this account.');
    }

    const labels = await this.getLocalLabels(address);
    const contacts: RecoveryContact[] = contactsInfo.contacts.map((addr) => {
      const contact: RecoveryContact = { address: addr as Address };
      if (labels && labels[addr.toLowerCase()]) {
        contact.label = labels[addr.toLowerCase()];
      }
      return contact;
    });

    return {
      address,
      chainId,
      contacts,
      threshold: String(contactsInfo.threshold),
    };
  }

  parseBackupFile(filePath: string): RecoveryBackup {
    let raw: string;
    try {
      raw = readFileSync(filePath, 'utf-8');
    } catch (err) {
      throw new Error(`Cannot read backup file: ${(err as Error).message}`);
    }

    let parsed: RecoveryBackup;
    try {
      parsed = JSON.parse(raw) as RecoveryBackup;
    } catch {
      throw new Error('Invalid backup file: not valid JSON.');
    }

    if (!parsed.address || !parsed.contacts || !parsed.threshold) {
      throw new Error(
        'Invalid backup file: missing required fields (address, contacts, threshold).',
      );
    }

    return parsed;
  }

  // ─── Local Labels ──────────────────────────────────────────────

  async getLocalLabels(address: Address): Promise<Record<string, string> | null> {
    return this.store.load<Record<string, string>>(
      `${GUARDIAN_LABELS_PREFIX}${address.toLowerCase()}`,
    );
  }

  async saveLocalLabels(address: Address, labels: Record<string, string>): Promise<void> {
    await this.store.save(`${GUARDIAN_LABELS_PREFIX}${address.toLowerCase()}`, labels);
  }

  // ─── Recovery Guard ────────────────────────────────────────────

  /**
   * Check if an account has an active recovery that should block write operations.
   *
   * On each call:
   *   1. If the account has no guardians (contactsHash === zero), skip.
   *   2. Otherwise, probe on-chain state and update local cache.
   *   3. Return whether write ops should be blocked.
   */
  async recoveryGuard(
    accountInfo: AccountInfo,
    commandType: 'read' | 'write',
  ): Promise<{
    blocked: boolean;
    recoveryInfo?: AccountInfo['activeRecovery'];
  }> {
    // Quick skip: if no recovery enabled and no active recovery cached
    if (!accountInfo.isRecoveryEnabled && !accountInfo.activeRecovery) {
      return { blocked: false };
    }

    // Probe on-chain state
    try {
      const info = await this.sdk.getRecoveryInfo(accountInfo.address);
      if (!info || info.contactsHash === zeroHash) {
        // No guardians set, clear any stale activeRecovery
        if (accountInfo.activeRecovery) {
          await this.account.clearActiveRecovery(accountInfo.address, accountInfo.chainId);
        }
        return { blocked: false };
      }

      // Check if there's a local recovery record for this account
      const localRecord = await this.getLocalRecoveryRecord();
      if (
        localRecord &&
        localRecord.walletAddress.toLowerCase() === accountInfo.address.toLowerCase()
      ) {
        // Re-query status to update
        const status = await this.queryRecoveryStatus({
          walletAddress: localRecord.walletAddress,
          recoveryId: localRecord.recoveryId,
          approveHash: localRecord.approveHash,
          fromBlock: localRecord.fromBlock,
          contacts: localRecord.contacts,
          threshold: localRecord.threshold,
          newOwner: localRecord.newOwner,
          recoveryUrl: localRecord.recoveryUrl,
        });

        if (status.status === RecoveryStatus.RECOVERY_COMPLETED) {
          await this.handleRecoveryCompletion(status);
          return { blocked: false };
        }

        await this.account.updateActiveRecovery(accountInfo.address, accountInfo.chainId, {
          status: status.status,
          newOwner: status.newOwner,
          recoveryId: localRecord.recoveryId,
          lastCheckedAt: Date.now(),
        });

        if (commandType === 'write') {
          return { blocked: true, recoveryInfo: accountInfo.activeRecovery };
        }
        return { blocked: false, recoveryInfo: accountInfo.activeRecovery };
      }

      // No local record; rely on cached activeRecovery
      if (accountInfo.activeRecovery) {
        if (commandType === 'write') {
          return { blocked: true, recoveryInfo: accountInfo.activeRecovery };
        }
        return { blocked: false, recoveryInfo: accountInfo.activeRecovery };
      }
    } catch {
      // On-chain query failed; rely on cached state
      if (accountInfo.activeRecovery && commandType === 'write') {
        return { blocked: true, recoveryInfo: accountInfo.activeRecovery };
      }
    }

    return { blocked: false };
  }

  // ─── Internal ──────────────────────────────────────────────────

  private buildShareLink(params: {
    recoveryId: string;
    walletAddress: Address;
    chainId: number;
    approveHash: string;
    fromBlock: string;
    newOwner: Address;
    contacts: RecoveryContact[];
    threshold: number;
  }): string {
    const searchParams = new URLSearchParams({
      id: params.recoveryId,
      address: params.walletAddress,
      chainId: params.chainId.toString(),
      hash: params.approveHash,
      from: params.fromBlock,
      owner: params.newOwner,
      contacts: params.contacts.map((c) => c.address).join(','),
      threshold: params.threshold.toString(),
    });

    const base = RECOVERY_APP_URL.replace(/\/$/, '');
    return `${base}?${searchParams.toString()}`;
  }
}
