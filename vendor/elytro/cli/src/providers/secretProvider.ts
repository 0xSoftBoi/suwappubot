/**
 * SecretProvider — pluggable interface for vault key storage.
 *
 * The vault key (256-bit AES key) must be stored outside ~/.elytro/
 * to achieve domain separation: the encrypted vault and the key that
 * decrypts it live in different security domains.
 *
 * Resolution order (most secure → least secure):
 *   1. KeyringProvider (OS credential store: Keychain / Credential Manager / Secret Service)
 *   2. FileProvider (permission-guarded file fallback)
 *
 * Built providers:
 *   - KeyringProvider (@napi-rs/keyring — macOS, Windows, Linux desktop)
 *   - FileProvider (~/.elytro/.vault-key, chmod 0600)
 */

export interface SecretProvider {
  /** Human-readable provider name for display. */
  readonly name: string;

  /** Can this provider function in the current environment? */
  available(): Promise<boolean>;

  /**
   * Store a secret. Called once during `elytro init`.
   * Provider decides the storage mechanism (Keychain, file, etc.).
   */
  store(secret: Uint8Array): Promise<void>;

  /**
   * Load the secret. Called on every CLI invocation.
   * Returns null if no secret is stored (wallet not initialized).
   */
  load(): Promise<Uint8Array | null>;

  /**
   * Delete the stored secret. Called during `elytro reset` or key rotation.
   */
  delete(): Promise<void>;
}
