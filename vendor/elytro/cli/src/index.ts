import { Command } from 'commander';
import { createAppContext } from './context';
import { registerInitCommand } from './commands/init';
import { registerAccountCommand } from './commands/account';
import { registerTxCommand } from './commands/tx';
import { registerQueryCommand } from './commands/query';
import { registerSecurityCommand } from './commands/security';
import { registerDelegationCommand } from './commands/delegation';
import { registerRequestCommand } from './commands/request';
import { registerOtpCommand } from './commands/otp';
import { registerConfigCommand } from './commands/config';
import { registerUpdateCommand } from './commands/update';
import { registerRecoveryCommand } from './commands/recovery';
import { registerServicesCommand } from './commands/services';
import { registerSwapCommand } from './commands/swap';
import { registerTokenCommand } from './commands/token';
import { runPrune } from './commands/prune';
import { outputError, sanitizeErrorMessage } from './utils/display';
import { VERSION } from './version';

/**
 * Elytro CLI entry point.
 *
 * Architecture:
 *   1. Bootstrap the app context (all services, auto-unlock via device key)
 *   2. Register commands — each command receives the context
 *   3. Parse argv and execute
 *   4. Lock keyring on exit to clear keys from memory
 */

const program = new Command();

program
  .name('elytro')
  .description('Elytro — ERC-4337 Smart Account Wallet CLI')
  .version(VERSION)
  .addHelpText('after', '\nLearn how to use Elytro skills: https://github.com/Elytro-eth/skills\n');

async function main(): Promise<void> {
  // Prune runs before context — clears all local data for internal testing.
  // Hidden from help; works even when wallet is corrupted.
  if (process.argv.includes('prune')) {
    await runPrune();
    return;
  }

  let ctx: Awaited<ReturnType<typeof createAppContext>> | null = null;
  try {
    ctx = await createAppContext();

    registerInitCommand(program, ctx);
    registerAccountCommand(program, ctx);
    registerTxCommand(program, ctx);
    registerQueryCommand(program, ctx);
    registerSecurityCommand(program, ctx);
    registerDelegationCommand(program, ctx);
    registerRequestCommand(program, ctx);
    registerOtpCommand(program, ctx);
    registerConfigCommand(program, ctx);
    registerUpdateCommand(program);
    registerServicesCommand(program);

    registerRecoveryCommand(program, ctx);
    registerSwapCommand(program, ctx);
    registerTokenCommand(program, ctx);
    // Phase 4: registerCallCommand(program, ctx);

    await program.parseAsync(process.argv);
  } catch (err) {
    outputError(-32000, sanitizeErrorMessage((err as Error).message));
  } finally {
    // Clear decrypted keys from memory
    ctx?.keyring.lock();
    ctx?.chain.lockUserKeys();
  }
}

main();
