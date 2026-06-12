import { rm } from 'node:fs/promises';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { KeyringProvider } from '../providers/keyringProvider';
import { FileProvider } from '../providers/fileProvider';
import { outputResult, outputError } from '../utils/display';

const DATA_DIR = join(homedir(), '.elytro');

/**
 * `elytro prune` — Internal testing only. Clears all local data and resets state.
 *
 * Removes:
 *   - ~/.elytro/ directory (keyring, accounts, config, user-keys, pending-otps, auth sessions)
 *   - Vault key from OS keychain (macOS/Windows/Linux desktop)
 *   - Vault key file ~/.elytro/.vault-key (Linux headless)
 *
 * Hidden from help. Run `elytro init` after prune to start fresh.
 */
export async function runPrune(): Promise<void> {
  try {
    // 1. Delete vault key from OS credential store (macOS Keychain, Windows Credential Manager, Linux Secret Service)
    const keyringProvider = new KeyringProvider();
    try {
      await keyringProvider.delete();
    } catch {
      // Ignore — may not have been used (e.g. Linux headless)
    }

    // 2. Delete vault key file (~/.elytro/.vault-key) — used on Linux headless
    const fileProvider = new FileProvider(DATA_DIR);
    try {
      await fileProvider.delete();
    } catch {
      // Ignore — may not exist
    }

    // 3. Remove entire ~/.elytro/ directory
    try {
      await rm(DATA_DIR, { recursive: true, force: true });
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code !== 'ENOENT') {
        throw err;
      }
      // Directory didn't exist — already clean
    }

    outputResult({
      status: 'pruned',
      dataDir: DATA_DIR,
      hint: 'All local data cleared. Run `elytro init` to create a new wallet.',
    });
  } catch (err) {
    outputError(-32000, (err as Error).message);
  }
}
