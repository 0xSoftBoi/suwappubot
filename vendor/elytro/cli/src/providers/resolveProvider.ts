import type { SecretProvider } from './secretProvider';
import { KeyringProvider } from './keyringProvider';
import { FileProvider } from './fileProvider';

/**
 * Auto-detect the best available SecretProvider.
 *
 * Resolution order (most secure → least secure):
 *
 *   1. KeyringProvider (OS credential store)
 *      macOS: Keychain | Windows: Credential Manager | Linux: Secret Service
 *      → Best option. Encrypted at rest, managed by OS, separate security domain.
 *
 *   2. FileProvider (permission-guarded file)
 *      ~/.elytro/.vault-key, chmod 0600
 *      → Universal fallback when the OS credential store is unavailable.
 *        Same security model as SSH private keys.
 *
 * Returns separate providers for init (store) and runtime (load):
 *   - initProvider: must support store() — both built-in providers do
 *   - loadProvider: must support load() — same as initProvider here
 */
export async function resolveProvider(): Promise<{
  initProvider: SecretProvider | null;
  loadProvider: SecretProvider | null;
}> {
  const keyringProvider = new KeyringProvider();
  const fileProvider = new FileProvider();

  // ── Priority 1: OS credential store (all platforms) ──
  if (await keyringProvider.available()) {
    return {
      initProvider: keyringProvider,
      loadProvider: keyringProvider,
    };
  }

  // ── Priority 2: Permission-guarded file fallback ──
  // If the OS credential store is unavailable, fall back to the CLI-owned key file.
  if (await fileProvider.available()) {
    process.stderr.write(
      '[elytro] Warning: OS credential store unavailable. Vault key will be stored in ' +
        '~/.elytro/.vault-key (chmod 0600). This is less secure than the OS keychain.\n',
    );
    return {
      initProvider: fileProvider,
      loadProvider: fileProvider,
    };
  }

  // ── No provider available ──
  return { initProvider: null, loadProvider: null };
}
