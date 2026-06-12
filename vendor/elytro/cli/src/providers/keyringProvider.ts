import { Entry } from '@napi-rs/keyring';
import type { SecretProvider } from './secretProvider';

/**
 * KeyringProvider — cross-platform OS keychain via @napi-rs/keyring (keyring-rs).
 *
 * Platform backends:
 *   - macOS:    Keychain (Security.framework)
 *   - Windows:  Credential Manager (DPAPI)
 *   - Linux:    Secret Service API (GNOME Keyring / KWallet via D-Bus)
 *
 * Replaces the old macOS-only KeychainProvider that shelled out to `security` CLI.
 * Uses native bindings (N-API) instead — no stdout parsing, no shell injection surface.
 *
 * Security properties:
 *   - Key encrypted at rest by the OS-managed credential store
 *   - Not co-located with ~/.elytro/ vault files (domain separation)
 *   - Zero-interaction on macOS/Windows (credential store unlocked with login session)
 *   - Linux desktop: works when a Secret Service provider (GNOME Keyring / KWallet) is running
 *
 * Limitations:
 *   - Linux headless (no D-Bus / no desktop session): falls through to FileProvider
 *   - No per-app ACL pinning without code-signed binary
 *   - Same-UID processes can read the credential on macOS/Windows
 */
export class KeyringProvider implements SecretProvider {
  readonly name: string;

  private readonly service = 'elytro-wallet';
  private readonly account = 'vault-key';

  constructor() {
    const platform = process.platform;
    if (platform === 'darwin') this.name = 'macos-keychain';
    else if (platform === 'win32') this.name = 'windows-credential-manager';
    else this.name = 'linux-secret-service';
  }

  async available(): Promise<boolean> {
    try {
      // Probe: attempt a read. If the OS credential store is reachable,
      // this either returns data or throws "not found" (both = available).
      // If the store is unreachable (no D-Bus, no desktop session),
      // it throws a platform error (= not available).
      const entry = new Entry(this.service, this.account);
      entry.getSecret();
      return true;
    } catch (err) {
      const msg = (err as Error).message || '';
      // "not found" / "No matching entry" means the store is reachable,
      // just no key stored yet — that's fine, we're available.
      if (isNotFoundError(msg)) return true;
      // Any other error = store not reachable (D-Bus down, no backend, etc.)
      return false;
    }
  }

  async store(secret: Uint8Array): Promise<void> {
    validateKeyLength(secret);
    try {
      const entry = new Entry(this.service, this.account);
      entry.setSecret(Buffer.from(secret));
    } catch (err) {
      throw new Error(`Failed to store vault key in OS credential store: ${(err as Error).message}`);
    }
  }

  async load(): Promise<Uint8Array | null> {
    try {
      const entry = new Entry(this.service, this.account);
      const raw = entry.getSecret();
      if (!raw || raw.length === 0) return null;

      const key = new Uint8Array(raw);
      if (key.length !== 32) {
        throw new Error(
          `OS credential store returned vault key with invalid length: expected 32 bytes, got ${key.length}.`
        );
      }
      return key;
    } catch (err) {
      const msg = (err as Error).message || '';
      // "not found" = no key stored yet, return null (not an error)
      if (isNotFoundError(msg)) return null;
      throw new Error(`Failed to load vault key from OS credential store: ${msg}`);
    }
  }

  async delete(): Promise<void> {
    try {
      const entry = new Entry(this.service, this.account);
      entry.deleteCredential();
    } catch {
      // Ignore "not found" — idempotent delete
    }
  }
}

/**
 * Detect "not found" errors across platforms.
 * keyring-rs error messages vary by backend.
 */
function isNotFoundError(msg: string): boolean {
  const lower = msg.toLowerCase();
  return (
    lower.includes('not found') ||
    lower.includes('no matching') ||
    lower.includes('no such') ||
    lower.includes('itemnotfound') ||
    lower.includes('element not found') || // Windows
    lower.includes('no result') ||
    lower.includes('no password')
  );
}

function validateKeyLength(key: Uint8Array): void {
  if (key.length !== 32) {
    throw new Error(`Invalid vault key: expected 32 bytes, got ${key.length}.`);
  }
}
