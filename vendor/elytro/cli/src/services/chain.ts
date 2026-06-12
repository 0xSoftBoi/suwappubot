import type { StorageAdapter, ChainConfig, CliConfig, UserKeys, EncryptedData } from '../types';
import { getDefaultConfig, buildChains } from '../utils/config';
import { encryptWithKey, decryptWithKey } from '../utils/passworder';

const STORAGE_KEY = 'config';
const USER_KEYS_KEY = 'user-keys';

/**
 * ChainService — multi-chain configuration management.
 *
 * Business intent (from extension's ChainService):
 * - Maintain a list of supported chains with RPC / bundler endpoints
 * - Track the currently selected chain
 * - Allow switching and custom chain addition
 *
 * CLI differences:
 * - No reactive store / eventBus — single-process, imperative
 * - Config persisted as a single JSON file
 * - No version-migration logic (fresh start for CLI)
 *
 * API keys:
 * - Stored separately in user-keys.json (encrypted with vault key when available)
 * - Resolved at init: userKeys > env vars > public fallback
 * - Before vault key is available, user keys are loaded but not decrypted
 *   (endpoints fall back to public). Call `unlockUserKeys(vaultKey)` after
 *   the vault key is available to decrypt and activate user-configured endpoints.
 *
 * Migration:
 * - If user-keys.json contains plaintext (legacy format without `version` field),
 *   `unlockUserKeys()` automatically encrypts it with the vault key on first load.
 */
export class ChainService {
  private store: StorageAdapter;
  private config: CliConfig;
  private userKeys: UserKeys = {};
  /** Vault key for encrypting/decrypting user keys. null = vault not yet unlocked. */
  private vaultKey: Uint8Array | null = null;

  constructor(store: StorageAdapter) {
    this.store = store;
    this.config = getDefaultConfig();
  }

  /**
   * Load persisted config (non-sensitive).
   * User keys are NOT loaded here — call `unlockUserKeys()` after the
   * vault key becomes available.
   */
  async init(): Promise<void> {
    const saved = await this.store.load<CliConfig>(STORAGE_KEY);
    if (saved) {
      this.config = { ...getDefaultConfig(), ...saved };
    }

    // Build chains with public endpoints initially.
    // User-configured endpoints are activated by unlockUserKeys().
    this.config.chains = buildChains(undefined, undefined);
  }

  /**
   * Decrypt (or migrate) user API keys using the vault key.
   * Call this after the vault key is available (post keyring.unlock).
   *
   * - If user-keys.json is encrypted (has `version` field): decrypt with vault key.
   * - If user-keys.json is plaintext (legacy): load, encrypt, overwrite.
   * - If user-keys.json is absent: no-op.
   */
  async unlockUserKeys(vaultKey: Uint8Array): Promise<void> {
    this.vaultKey = new Uint8Array(vaultKey);

    const raw = await this.store.load<EncryptedData | UserKeys>(USER_KEYS_KEY);
    if (!raw) {
      // No user keys stored — nothing to decrypt
      this.config.chains = buildChains(undefined, undefined);
      return;
    }

    // Detect format: encrypted (has `version` + `data` + `iv`) vs plaintext (has alchemyKey/pimlicoKey)
    if (isEncryptedData(raw)) {
      // Decrypt with vault key
      this.userKeys = await decryptWithKey<UserKeys>(vaultKey, raw);
    } else {
      // Legacy plaintext — migrate to encrypted format
      this.userKeys = raw as UserKeys;
      await this.persistUserKeys();
    }

    // Rebuild chain endpoints with decrypted keys
    this.config.chains = buildChains(this.userKeys.alchemyKey, this.userKeys.pimlicoKey);
  }

  /** Clear vault key and plaintext user keys from memory. Called on CLI exit. */
  lockUserKeys(): void {
    if (this.vaultKey) {
      this.vaultKey.fill(0);
      this.vaultKey = null;
    }
    this.userKeys = {};
  }

  // ─── User Keys ──────────────────────────────────────────────────

  /** Get current user keys (for display — values are masked). */
  getUserKeys(): UserKeys {
    return { ...this.userKeys };
  }

  /** Set a user API key and rebuild chain endpoints. */
  async setUserKey(key: keyof UserKeys, value: string): Promise<void> {
    this.userKeys[key] = value;
    await this.persistUserKeys();
    this.config.chains = buildChains(this.userKeys.alchemyKey, this.userKeys.pimlicoKey);
  }

  /** Remove a user API key and fall back to env / public endpoints. */
  async removeUserKey(key: keyof UserKeys): Promise<void> {
    delete this.userKeys[key];
    await this.persistUserKeys();
    this.config.chains = buildChains(this.userKeys.alchemyKey, this.userKeys.pimlicoKey);
  }

  // ─── Getters ────────────────────────────────────────────────────

  get currentChain(): ChainConfig {
    const chain = this.config.chains.find((c) => c.id === this.config.currentChainId);
    if (!chain) {
      throw new Error(`Chain ${this.config.currentChainId} not found in config.`);
    }
    return chain;
  }

  get currentChainId(): number {
    return this.config.currentChainId;
  }

  get chains(): ChainConfig[] {
    return this.config.chains;
  }

  get graphqlEndpoint(): string {
    return this.config.graphqlEndpoint;
  }

  get fullConfig(): CliConfig {
    return { ...this.config };
  }

  // ─── Mutations ──────────────────────────────────────────────────

  async switchChain(chainId: number): Promise<ChainConfig> {
    const chain = this.config.chains.find((c) => c.id === chainId);
    if (!chain) {
      throw new Error(`Chain ${chainId} is not configured.`);
    }
    this.config.currentChainId = chainId;
    await this.persist();
    return chain;
  }

  async addChain(chain: ChainConfig): Promise<void> {
    if (this.config.chains.some((c) => c.id === chain.id)) {
      throw new Error(`Chain ${chain.id} already exists.`);
    }
    this.config.chains.push(chain);
    await this.persist();
  }

  async removeChain(chainId: number): Promise<void> {
    if (chainId === this.config.currentChainId) {
      throw new Error('Cannot remove the currently selected chain.');
    }
    this.config.chains = this.config.chains.filter((c) => c.id !== chainId);
    await this.persist();
  }

  // ─── Internal ───────────────────────────────────────────────────

  private async persist(): Promise<void> {
    await this.store.save(STORAGE_KEY, this.config);
  }

  /**
   * Persist user keys — encrypted if vault key is available, plaintext otherwise.
   * The plaintext path only applies before `elytro init` (no vault key yet).
   */
  private async persistUserKeys(): Promise<void> {
    const hasKeys = this.userKeys.alchemyKey || this.userKeys.pimlicoKey;
    if (!hasKeys) {
      // Remove the file entirely if no keys remain
      await this.store.remove(USER_KEYS_KEY);
      return;
    }

    if (this.vaultKey) {
      const encrypted = await encryptWithKey(this.vaultKey, this.userKeys);
      await this.store.save(USER_KEYS_KEY, encrypted);
    } else {
      // Pre-init fallback: store plaintext (will be migrated on next unlockUserKeys)
      process.stderr.write(
        '[elytro] Warning: vault not initialized — API key stored in plaintext. ' +
          'Run `elytro init` to encrypt it.\n',
      );
      await this.store.save(USER_KEYS_KEY, this.userKeys);
    }
  }
}

// ─── Module-level helpers ────────────────────────────────────────

/** Type guard: does this JSON blob look like EncryptedData (version + data + iv)? */
function isEncryptedData(obj: unknown): obj is EncryptedData {
  if (typeof obj !== 'object' || obj === null) return false;
  const o = obj as Record<string, unknown>;
  return (
    typeof o.data === 'string' && typeof o.iv === 'string' && (o.version === 1 || o.version === 2)
  );
}
