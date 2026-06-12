import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { constants } from 'node:fs';
import type { SecretProvider } from './secretProvider';

/**
 * FileProvider — stores the vault key in a permission-restricted file.
 *
 * Follows the SSH model: `~/.elytro/.vault-key`, chmod 0600 (owner read/write only).
 *
 * This is the fallback when the OS credential store is unavailable. It is used
 * for headless Linux and for any other runtime where `@napi-rs/keyring` cannot
 * access a working platform backend.
 *
 * Security properties:
 *   - File permissions enforced: 0600 (owner-only read/write)
 *   - Permission drift detection: refuses to load if permissions are wider than 0600
 *   - Survives process restart without relying on env var injection
 *   - The file is only readable by the current OS user via 0600 permissions
 *
 * Limitations:
 *   - Not encrypted at rest (relies on filesystem ACLs, like SSH private keys)
 *   - Same-UID root can still read the file
 *   - Weaker domain separation than the OS keychain
 *   - Same-UID code can still read the file
 *
 * Security tradeoff rationale:
 *   When the platform credential store is unavailable, a permission-guarded file
 *   is the least-surprising non-interactive fallback. Elytro keeps that file
 *   private to the CLI user via strict POSIX permissions.
 */
export class FileProvider implements SecretProvider {
  readonly name = 'file-protected';

  private readonly keyPath: string;

  /**
   * @param dataDir — the ~/.elytro/ directory path (from FileStore.dataDir).
   *                   Defaults to ~/.elytro if not provided.
   */
  constructor(dataDir?: string) {
    const base = dataDir ?? path.join(process.env.HOME || '~', '.elytro');
    this.keyPath = path.join(base, '.vault-key');
  }

  async available(): Promise<boolean> {
    // Available if the key file exists, or if we can create it.
    try {
      await fs.access(this.keyPath, constants.R_OK);
      return true;
    } catch {
      try {
        await fs.mkdir(path.dirname(this.keyPath), { recursive: true, mode: 0o700 });
        await fs.chmod(path.dirname(this.keyPath), 0o700).catch(() => {});
        await fs.access(path.dirname(this.keyPath), constants.W_OK);
        return true;
      } catch {
        return false;
      }
    }
  }

  async store(secret: Uint8Array): Promise<void> {
    validateKeyLength(secret);
    const b64 = Buffer.from(secret).toString('base64');

    // Write atomically: temp file → rename (prevents partial reads)
    const tmpPath = this.keyPath + '.tmp';
    try {
      await fs.mkdir(path.dirname(this.keyPath), { recursive: true, mode: 0o700 });
      await fs.chmod(path.dirname(this.keyPath), 0o700).catch(() => {});
      await fs.writeFile(tmpPath, b64, { encoding: 'utf-8', mode: 0o600 });
      await fs.rename(tmpPath, this.keyPath);
      // Ensure final permissions are locked even if rename preserved old perms
      await fs.chmod(this.keyPath, 0o600);
    } catch (err) {
      // Clean up temp file on failure
      try {
        await fs.unlink(tmpPath);
      } catch {
        // Ignore cleanup errors
      }
      throw new Error(`Failed to store vault key to file: ${(err as Error).message}`);
    }
  }

  async load(): Promise<Uint8Array | null> {
    try {
      // Check permissions BEFORE reading — refuse to load if permissions drifted
      const stat = await fs.stat(this.keyPath);
      const mode = stat.mode & 0o777;
      if (mode !== 0o600) {
        throw new Error(
          `Vault key file has insecure permissions: ${modeToOctal(mode)} (expected 0600).\n` +
            `Fix with: chmod 600 ${this.keyPath}\n` +
            'Refusing to load until permissions are corrected.',
        );
      }

      const raw = await fs.readFile(this.keyPath, 'utf-8');
      const trimmed = raw.trim();
      if (!trimmed) return null;

      const key = Buffer.from(trimmed, 'base64');
      if (key.length !== 32) {
        throw new Error(
          `Vault key file has invalid content: expected 32 bytes (base64), got ${key.length}.`,
        );
      }
      return new Uint8Array(key);
    } catch (err) {
      // File doesn't exist = not initialized, return null
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw err;
    }
  }

  async delete(): Promise<void> {
    try {
      await fs.unlink(this.keyPath);
    } catch {
      // Ignore "not found" — idempotent delete
    }
  }
}

function validateKeyLength(key: Uint8Array): void {
  if (key.length !== 32) {
    throw new Error(`Invalid vault key: expected 32 bytes, got ${key.length}.`);
  }
}

function modeToOctal(mode: number): string {
  return '0' + mode.toString(8);
}
