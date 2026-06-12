import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import type { Address, Hex } from 'viem';
import { encryptWithKey, decryptWithKey, encrypt, decrypt } from '../utils/passworder';
import type { StorageAdapter, VaultData, OwnerKey, EncryptedData } from '../types';

const STORAGE_KEY = 'keyring';

/**
 * KeyringService — EOA private key management.
 *
 * All routine operations use a vault key (256-bit raw key from SecretProvider).
 * Password-based encryption is only used for export/import (backup).
 *
 * Lifecycle:
 *   init  → createNewOwner(vaultKey) → vault encrypted with vault key
 *   boot  → unlock(vaultKey) automatically by context via SecretProvider
 *   use   → signMessage / getAccount (vault already in memory)
 *   exit  → lock() clears vault AND vault key from memory
 *   export → exportVault(password) re-encrypts with user password
 *   import → importVault(encrypted, password, vaultKey) decrypts then re-encrypts
 *
 * Memory security:
 *   Private keys are held as Uint8Array (scrubbable) in `keyBuffers`, NOT as
 *   hex strings. The VaultData still uses hex for JSON serialization, but the
 *   hex strings are only created transiently during encrypt/sign operations.
 *   On lock(), all Uint8Array key buffers are zero-filled before release.
 */
export class KeyringService {
  private store: StorageAdapter;
  private vault: VaultData | null = null;
  /** Vault key kept in memory for re-encryption operations (addOwner, switchOwner). */
  private vaultKey: Uint8Array | null = null;
  /**
   * In-memory private key buffers indexed by owner address.
   * These are the scrubbable counterparts of VaultData.owners[].key.
   * Zero-filled on lock().
   */
  private keyBuffers: Map<Address, Uint8Array> = new Map();

  constructor(store: StorageAdapter) {
    this.store = store;
  }

  // ─── Initialization ─────────────────────────────────────────────

  /** Check if a vault (encrypted keyring) already exists on disk. */
  async isInitialized(): Promise<boolean> {
    return this.store.exists(STORAGE_KEY);
  }

  /**
   * Create a brand-new vault with one owner.
   * Called during `elytro init`. Encrypts with vault key.
   */
  async createNewOwner(vaultKey: Uint8Array): Promise<Address> {
    const privateKey = generatePrivateKey();
    const account = privateKeyToAccount(privateKey);

    const owner: OwnerKey = { id: account.address, key: privateKey };
    const vault: VaultData = {
      owners: [owner],
      currentOwnerId: account.address,
    };

    // Encrypt before hydrating (hydration scrubs hex keys from the in-memory vault)
    const encrypted = await encryptWithKey(vaultKey, vault);
    await this.store.save(STORAGE_KEY, encrypted);

    this.vault = vault;
    this.vaultKey = new Uint8Array(vaultKey);
    this.hydrateKeyBuffers(vault);
    return account.address;
  }

  // ─── Unlock / Access ────────────────────────────────────────────

  /**
   * Decrypt the vault with the vault key.
   * Called automatically by context at CLI startup via SecretProvider.
   */
  async unlock(vaultKey: Uint8Array): Promise<void> {
    const encrypted = await this.store.load<EncryptedData>(STORAGE_KEY);
    if (!encrypted) {
      throw new Error('Keyring not initialized. Run `elytro init` first.');
    }
    this.vault = await decryptWithKey<VaultData>(vaultKey, encrypted);
    this.vaultKey = new Uint8Array(vaultKey);
    this.hydrateKeyBuffers(this.vault);
  }

  /** Lock the vault, clearing decrypted keys and vault key from memory. */
  lock(): void {
    // Zero-fill all private key buffers before releasing
    for (const buf of this.keyBuffers.values()) {
      buf.fill(0);
    }
    this.keyBuffers.clear();

    this.vault = null;
    if (this.vaultKey) {
      this.vaultKey.fill(0);
      this.vaultKey = null;
    }
  }

  get isUnlocked(): boolean {
    return this.vault !== null;
  }

  // ─── Current owner ──────────────────────────────────────────────

  get currentOwner(): Address | null {
    return (this.vault?.currentOwnerId as Address) ?? null;
  }

  get owners(): Address[] {
    return this.vault?.owners.map((o) => o.id) ?? [];
  }

  // ─── Signing ────────────────────────────────────────────────────

  async signMessage(message: Hex): Promise<Hex> {
    const key = this.getCurrentKey();
    const account = privateKeyToAccount(key);
    return account.signMessage({ message: { raw: message } });
  }

  /**
   * Raw ECDSA sign over a 32-byte digest (no EIP-191 prefix).
   *
   * Equivalent to extension's `ethers.SigningKey.signDigest()`.
   * Used for ERC-4337 UserOperation signing where the hash is
   * already computed by the SDK (userOpHash → packRawHash).
   */
  async signDigest(digest: Hex): Promise<Hex> {
    const key = this.getCurrentKey();
    const account = privateKeyToAccount(key);
    return account.sign({ hash: digest });
  }

  /**
   * Get a viem LocalAccount for the current owner.
   * Useful for SDK operations that need a signer.
   */
  getAccount() {
    const key = this.getCurrentKey();
    return privateKeyToAccount(key);
  }

  // ─── Multi-owner management ─────────────────────────────────────

  async addOwner(): Promise<Address> {
    this.ensureUnlocked();

    const privateKey = generatePrivateKey();
    const account = privateKeyToAccount(privateKey);

    // Push a key-less entry; the actual key lives solely in keyBuffers.
    // persistVault() reconstructs full VaultData from keyBuffers before encrypting.
    this.vault!.owners.push({ id: account.address, key: '' as Hex });
    this.keyBuffers.set(account.address, hexToBytes(privateKey));
    await this.persistVault();
    return account.address;
  }

  async switchOwner(ownerId: Address): Promise<void> {
    this.ensureUnlocked();

    const exists = this.vault!.owners.some((o) => o.id === ownerId);
    if (!exists) {
      throw new Error(`Owner ${ownerId} not found in vault.`);
    }

    this.vault!.currentOwnerId = ownerId;
    await this.persistVault();
  }

  // ─── Export / Import (password-based for portability) ───────────

  /**
   * Export vault encrypted with a user-provided password.
   * The output can be imported on another device.
   */
  async exportVault(password: string): Promise<EncryptedData> {
    this.ensureUnlocked();
    // Reconstruct full VaultData (keys scrubbed from this.vault; live in keyBuffers)
    return encrypt(password, this.buildVaultWithKeys());
  }

  /**
   * Import vault from a password-encrypted backup.
   * Decrypts with the backup password, then re-encrypts with vault key.
   */
  async importVault(
    encrypted: EncryptedData,
    password: string,
    vaultKey: Uint8Array,
  ): Promise<void> {
    const vault = await decrypt<VaultData>(password, encrypted);
    if (this.vaultKey) this.vaultKey.fill(0);
    this.vaultKey = new Uint8Array(vaultKey);
    // Encrypt before hydrating: hydrateKeyBuffers scrubs hex keys from vault
    const reEncrypted = await encryptWithKey(vaultKey, vault);
    await this.store.save(STORAGE_KEY, reEncrypted);
    this.vault = vault;
    this.hydrateKeyBuffers(vault);
  }

  // ─── Rekey (vault key rotation) ───────────────────────────────

  async rekey(newVaultKey: Uint8Array): Promise<void> {
    this.ensureUnlocked();
    if (this.vaultKey) this.vaultKey.fill(0);
    this.vaultKey = new Uint8Array(newVaultKey);
    await this.persistVault();
  }

  // ─── Internal ───────────────────────────────────────────────────

  /**
   * Get the current owner's private key as Hex for signing.
   *
   * Reads from the scrubbable Uint8Array keyBuffers and converts to Hex
   * on the fly. The returned Hex string is short-lived (used immediately
   * by viem's privateKeyToAccount, then goes out of scope for GC).
   */
  private getCurrentKey(): Hex {
    if (!this.vault) {
      throw new Error('Keyring is locked. Cannot sign.');
    }
    const ownerId = this.vault.currentOwnerId as Address;
    const buf = this.keyBuffers.get(ownerId);
    if (!buf) {
      throw new Error('Current owner key not found in vault.');
    }
    // Convert raw bytes → 0x-prefixed hex string (transient, GC'd after use)
    return `0x${Buffer.from(buf).toString('hex')}` as Hex;
  }

  private ensureUnlocked(): void {
    if (!this.vault) {
      throw new Error('Keyring is locked. Run `elytro init` first.');
    }
  }

  private async persistVault(): Promise<void> {
    if (!this.vault) throw new Error('No vault to persist.');
    if (!this.vaultKey) throw new Error('No vault key available for re-encryption.');
    const encrypted = await encryptWithKey(this.vaultKey, this.buildVaultWithKeys());
    await this.store.save(STORAGE_KEY, encrypted);
  }

  /**
   * Reconstruct a complete VaultData with hex keys sourced from keyBuffers.
   * Used by persistVault and exportVault — the live this.vault has keys scrubbed.
   */
  private buildVaultWithKeys(): VaultData {
    return {
      ...this.vault!,
      owners: this.vault!.owners.map((owner) => {
        const buf = this.keyBuffers.get(owner.id);
        if (!buf) throw new Error(`Key buffer missing for owner ${owner.id}`);
        return { ...owner, key: `0x${Buffer.from(buf).toString('hex')}` as Hex };
      }),
    };
  }

  /**
   * Convert vault owner hex keys into scrubbable Uint8Array buffers,
   * then scrub the hex strings from the in-memory vault so the sole live
   * copy of each private key is the zero-fillable Uint8Array in keyBuffers.
   * Called after decryption (unlock, createNewOwner, importVault).
   */
  private hydrateKeyBuffers(vault: VaultData): void {
    // Clear any previous buffers (zero-fill first)
    for (const buf of this.keyBuffers.values()) {
      buf.fill(0);
    }
    this.keyBuffers.clear();

    for (const owner of vault.owners) {
      this.keyBuffers.set(owner.id, hexToBytes(owner.key));
      // Scrub hex key from in-memory vault — keyBuffers is now the sole live copy
      owner.key = '' as Hex;
    }
  }
}

// ─── Module-level helpers ────────────────────────────────────────

/** Convert a 0x-prefixed hex string to Uint8Array. */
function hexToBytes(hex: Hex): Uint8Array {
  const clean = hex.startsWith('0x') ? hex.slice(2) : hex;
  return new Uint8Array(Buffer.from(clean, 'hex'));
}
