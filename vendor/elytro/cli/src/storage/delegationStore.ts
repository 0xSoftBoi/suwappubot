import type { Address } from 'viem';
import type { StorageAdapter, DelegationInfo } from '../types';

/**
 * DelegationStore — isolated per-account delegation persistence.
 *
 * Stores each account's delegations in a separate file under
 * `delegations/<account-address-lowercase>` to decouple delegation
 * mutations from the main accounts.json, reducing write amplification
 * and blast radius on corruption.
 *
 * The store key is always the checksummed-then-lowercased account address
 * to guarantee a stable, unique filename per account.
 */

const KEY_PREFIX = 'delegations/';

interface DelegationFileData {
  /** Account address this file belongs to (for self-identification). */
  account: Address;
  delegations: DelegationInfo[];
}

function storageKey(account: Address): string {
  return `${KEY_PREFIX}${account.toLowerCase()}`;
}

export class DelegationStore {
  private store: StorageAdapter;
  /** In-memory cache keyed by lowercase account address. */
  private cache = new Map<string, DelegationInfo[]>();

  constructor(store: StorageAdapter) {
    this.store = store;
  }

  // ─── Read ────────────────────────────────────────────────────────

  async list(account: Address): Promise<DelegationInfo[]> {
    return [...(await this.ensureLoaded(account))];
  }

  async get(account: Address, delegationId: string): Promise<DelegationInfo | null> {
    const delegations = await this.ensureLoaded(account);
    return delegations.find((d) => d.id === delegationId) ?? null;
  }

  /**
   * Find the first delegation matching all of the given criteria.
   * Returns null if no match. Filters out expired delegations automatically.
   */
  async findMatch(
    account: Address,
    criteria: {
      manager: Address;
      token: Address;
      payee: Address;
      minAmount: bigint;
    },
  ): Promise<DelegationInfo | null> {
    const delegations = await this.ensureLoaded(account);
    const now = Date.now();

    return (
      delegations.find((d) => {
        if (d.manager.toLowerCase() !== criteria.manager.toLowerCase()) return false;
        if (d.token.toLowerCase() !== criteria.token.toLowerCase()) return false;
        if (d.payee.toLowerCase() !== criteria.payee.toLowerCase()) return false;
        if (BigInt(d.amount) < criteria.minAmount) return false;
        if (d.expiresAt && Date.parse(d.expiresAt) <= now) return false;
        return true;
      }) ?? null
    );
  }

  // ─── Write ───────────────────────────────────────────────────────

  async add(account: Address, delegation: DelegationInfo): Promise<DelegationInfo> {
    const delegations = await this.ensureLoaded(account);
    if (delegations.some((d) => d.id === delegation.id)) {
      throw new Error(`Delegation "${delegation.id}" already exists for account ${account}.`);
    }
    delegations.push(delegation);
    await this.persist(account, delegations);
    return delegation;
  }

  async update(
    account: Address,
    delegationId: string,
    patch: Partial<DelegationInfo>,
  ): Promise<DelegationInfo> {
    const delegations = await this.ensureLoaded(account);
    const idx = delegations.findIndex((d) => d.id === delegationId);
    if (idx === -1) {
      throw new Error(`Delegation "${delegationId}" not found for account ${account}.`);
    }
    // id is immutable
    const { id: _ignoreId, ...safePatch } = patch;
    delegations[idx] = { ...delegations[idx], ...safePatch };
    await this.persist(account, delegations);
    return delegations[idx];
  }

  async remove(account: Address, delegationId: string): Promise<void> {
    const delegations = await this.ensureLoaded(account);
    const before = delegations.length;
    const remaining = delegations.filter((d) => d.id !== delegationId);
    if (remaining.length === before) {
      throw new Error(`Delegation "${delegationId}" not found for account ${account}.`);
    }
    await this.persist(account, remaining);
  }

  async removeAll(account: Address): Promise<void> {
    await this.persist(account, []);
  }

  // ─── Migration helper ────────────────────────────────────────────

  /**
   * Import delegations from a legacy source (e.g. AccountInfo.delegations)
   * without overwriting any already-stored delegations.
   * Returns the count of newly imported delegations.
   */
  async importLegacy(account: Address, legacy: DelegationInfo[]): Promise<number> {
    if (!legacy.length) return 0;
    const existing = await this.ensureLoaded(account);
    const existingIds = new Set(existing.map((d) => d.id));
    const toImport = legacy.filter((d) => !existingIds.has(d.id));
    if (!toImport.length) return 0;
    existing.push(...toImport);
    await this.persist(account, existing);
    return toImport.length;
  }

  /**
   * Check whether an account has any delegations without fully loading.
   * Uses the cache if available, otherwise checks file existence.
   */
  async hasDelegations(account: Address): Promise<boolean> {
    const key = account.toLowerCase();
    const cached = this.cache.get(key);
    if (cached !== undefined) return cached.length > 0;
    const exists = await this.store.exists(storageKey(account));
    if (!exists) return false;
    const data = await this.ensureLoaded(account);
    return data.length > 0;
  }

  // ─── Internal ────────────────────────────────────────────────────

  private async ensureLoaded(account: Address): Promise<DelegationInfo[]> {
    const key = account.toLowerCase();
    const cached = this.cache.get(key);
    if (cached) return cached;

    const data = await this.store.load<DelegationFileData>(storageKey(account));
    const delegations = data?.delegations ?? [];
    this.cache.set(key, delegations);
    return delegations;
  }

  private async persist(account: Address, delegations: DelegationInfo[]): Promise<void> {
    const key = account.toLowerCase();
    this.cache.set(key, delegations);
    const data: DelegationFileData = { account, delegations };
    await this.store.save(storageKey(account), data);
  }
}
