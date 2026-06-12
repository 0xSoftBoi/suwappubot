import type { AccountInfo } from '../types';
import { outputError } from './display';

/**
 * Quick synchronous check whether an account's cached activeRecovery
 * should block a write operation.
 *
 * This is a lightweight guard based on cached state.
 * The RecoveryService.recoveryGuard() method does the full on-chain
 * probe; this function is for immediate short-circuit checks.
 *
 * If blocked, outputs a structured error and exits the process.
 * If not blocked, returns false so the caller can proceed.
 */
export function checkRecoveryBlocked(account: AccountInfo): false {
  if (!account.activeRecovery) {
    return false;
  }

  outputError(
    -32007,
    `Account ${account.alias} (${account.address}) is being recovered. Write operations are blocked.`,
    {
      recoveryStatus: account.activeRecovery.status,
      suggestion:
        'Run `elytro recovery status` to check progress, or `elytro account switch` to use a different account.',
    },
  );
}
