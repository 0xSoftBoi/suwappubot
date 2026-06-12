import { webcrypto } from 'node:crypto';
import { Command } from 'commander';
import ora from 'ora';
import type { AppContext } from '../context';
import { resolveProvider } from '../providers';
import { askSelect } from '../utils/prompt';
import { outputResult, outputError, sanitizeErrorMessage } from '../utils/display';

/**
 * `elytro init` — Initialize a new wallet.
 *
 * Generates a 256-bit vault key and an EOA signing key.
 *
 * Key storage (auto-detected):
 *   - Preferred: OS credential store
 *   - Fallback:  ~/.elytro/.vault-key (chmod 0600)
 *
 * No password required — key management is handled by the SecretProvider.
 */
export function registerInitCommand(program: Command, ctx: AppContext): void {
  program
    .command('init')
    .description('Initialize a new Elytro wallet')
    .action(async () => {
      if (await ctx.keyring.isInitialized()) {
        outputResult({
          status: 'already_initialized',
          dataDir: ctx.store.dataDir,
          hint: 'Use `elytro account create` to create a smart account.',
        });
        return;
      }

      const spinner = ora('Setting up wallet...').start();
      try {
        // 1. Generate a cryptographically secure 256-bit vault key
        const vaultKey = webcrypto.getRandomValues(new Uint8Array(32));

        // 2. Resolve the init provider (persistent storage)
        const { initProvider } = await resolveProvider();

        if (!initProvider) {
          throw new Error(
            'No secret provider is available. Elytro requires either a working OS credential store ' +
              'or a writable vault key file at ~/.elytro/.vault-key.',
          );
        }

        if (initProvider.name === 'file-protected') {
          spinner.stop();
          const choice = await askSelect(
            'OS credential storage is unavailable. Elytro can continue by storing the vault key in ~/.elytro/.vault-key with owner-only permissions. This file is less protected than the system keychain. Continue?',
            [
              { name: 'Continue and use ~/.elytro/.vault-key', value: 'continue' },
              { name: 'Cancel initialization', value: 'cancel' },
            ],
          );

          if (choice !== 'continue') {
            vaultKey.fill(0);
            outputError(-32000, 'Initialization cancelled. Elytro did not create a wallet.');
            return;
          }

          spinner.start('Setting up wallet...');
        }

        await initProvider.store(vaultKey);
        const providerName = initProvider.name;

        // 3. Create the encrypted vault with the new key
        await ctx.keyring.createNewOwner(vaultKey);

        // Zero-fill the key buffer after use
        vaultKey.fill(0);

        spinner.stop();

        outputResult({
          status: 'initialized',
          dataDir: ctx.store.dataDir,
          secretProvider: providerName,
          nextStep:
            'Run `elytro account create --chain <chainId>` to create your first smart account.',
        });
      } catch (err) {
        spinner.fail('Failed to initialize wallet.');
        outputError(-32000, sanitizeErrorMessage((err as Error).message));
      }
    });
}
