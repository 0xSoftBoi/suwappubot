import { Command } from 'commander';
import type { Address } from 'viem';
import { isAddress } from 'viem';
import type { AppContext } from '../context';
import type { DelegationInfo } from '../types';
import { outputError, outputResult } from '../utils/display';

const ERR_INVALID_PARAMS = -32602;
const ERR_ACCOUNT_NOT_READY = -32002;

function parseAddress(label: string, value: string): Address {
  if (!isAddress(value)) {
    throw new Error(`${label} must be a valid address.`);
  }
  return value as Address;
}

function ensureHex(label: string, value: string): string {
  if (!value || !value.startsWith('0x')) {
    throw new Error(`${label} must be a 0x-prefixed hex string.`);
  }
  return value;
}

function mapDelegation(d: DelegationInfo) {
  return {
    id: d.id,
    manager: d.manager,
    token: d.token,
    payee: d.payee,
    amount: d.amount,
    permissionContext: d.permissionContext,
    expiresAt: d.expiresAt ?? null,
    note: d.note ?? null,
  };
}

function handleError(err: unknown): void {
  outputError(
    err instanceof Error && err.message.includes('No active account')
      ? ERR_ACCOUNT_NOT_READY
      : ERR_INVALID_PARAMS,
    (err as Error).message,
  );
}

export function registerDelegationCommand(program: Command, ctx: AppContext): void {
  const delegationCmd = program
    .command('delegation')
    .description('Manage ERC-7710 delegations for x402');

  // ─── list ──────────────────────────────────────────────────────

  delegationCmd
    .command('list')
    .description('List delegations stored for an account')
    .option('--account <aliasOrAddress>', 'Account alias/address (default: current)')
    .action(async (options: { account?: string }) => {
      try {
        const delegations = await ctx.delegation.list(options.account);
        outputResult({ delegations: delegations.map(mapDelegation) });
      } catch (err) {
        handleError(err);
      }
    });

  // ─── add (import existing delegation) ─────────────────────────

  delegationCmd
    .command('add')
    .description('Add an existing delegation (permission context) to an account')
    .requiredOption('--manager <address>', 'DelegationManager contract address')
    .requiredOption('--token <address>', 'Token contract address')
    .requiredOption('--payee <address>', 'Recipient/payee address this delegation covers')
    .requiredOption('--amount <amount>', 'Authorized amount (token smallest unit)')
    .requiredOption('--permission <hex>', 'Permission context blob provided by the manager/server')
    .option('--account <aliasOrAddress>', 'Account alias/address (default: current)')
    .option('--id <id>', 'Custom delegation identifier (default: random UUID)')
    .option('--expires-at <iso>', 'Optional expiration timestamp (ISO 8601)')
    .option('--note <text>', 'Optional note/description')
    .option('--verify', 'Verify the delegation on-chain before storing')
    .action(
      async (options: {
        manager: string;
        token: string;
        payee: string;
        amount: string;
        permission: string;
        account?: string;
        id?: string;
        expiresAt?: string;
        note?: string;
        verify?: boolean;
      }) => {
        try {
          if (!options.amount) {
            throw new Error('Amount is required.');
          }

          const delegation = await ctx.delegation.add(
            options.account,
            {
              manager: parseAddress('manager', options.manager),
              token: parseAddress('token', options.token),
              payee: parseAddress('payee', options.payee),
              amount: options.amount,
              permissionContext: ensureHex('permission', options.permission),
              id: options.id,
              expiresAt: options.expiresAt,
              note: options.note,
            },
            { verify: options.verify },
          );
          outputResult({ delegation: mapDelegation(delegation) });
        } catch (err) {
          handleError(err);
        }
      },
    );

  // ─── show ──────────────────────────────────────────────────────

  delegationCmd
    .command('show <delegationId>')
    .description('Show a specific delegation')
    .option('--account <aliasOrAddress>', 'Account alias/address (default: current)')
    .action(async (delegationId: string, options: { account?: string }) => {
      try {
        const delegation = await ctx.delegation.get(options.account, delegationId);
        if (!delegation) {
          outputError(ERR_INVALID_PARAMS, `Delegation "${delegationId}" not found.`);
          return;
        }
        outputResult({ delegation: mapDelegation(delegation) });
      } catch (err) {
        handleError(err);
      }
    });

  // ─── remove (local only) ───────────────────────────────────────

  delegationCmd
    .command('remove <delegationId>')
    .description('Remove a stored delegation (local only, does not revoke on-chain)')
    .option('--account <aliasOrAddress>', 'Account alias/address (default: current)')
    .action(async (delegationId: string, options: { account?: string }) => {
      try {
        await ctx.delegation.remove(options.account, delegationId);
        outputResult({ removed: delegationId });
      } catch (err) {
        handleError(err);
      }
    });

  // ─── verify ────────────────────────────────────────────────────

  delegationCmd
    .command('verify <delegationId>')
    .description('Verify a delegation locally (expiry) and on-chain (simulation)')
    .option('--account <aliasOrAddress>', 'Account alias/address (default: current)')
    .action(async (delegationId: string, options: { account?: string }) => {
      try {
        const result = await ctx.delegation.verify(options.account, delegationId);
        outputResult({ verification: result });
      } catch (err) {
        handleError(err);
      }
    });

  // ─── sync (batch verify all) ───────────────────────────────────

  delegationCmd
    .command('sync')
    .description('Verify all delegations for an account and optionally prune expired ones')
    .option('--account <aliasOrAddress>', 'Account alias/address (default: current)')
    .option('--prune', 'Remove expired delegations automatically')
    .action(async (options: { account?: string; prune?: boolean }) => {
      try {
        const results = await ctx.delegation.sync(options.account, { prune: options.prune });
        outputResult({
          total: results.length,
          valid: results.filter((r) => r.status === 'valid').length,
          expired: results.filter((r) => r.status === 'expired').length,
          invalid: results.filter((r) => r.status === 'invalid_onchain').length,
          insufficientBalance: results.filter((r) => r.status === 'insufficient_balance').length,
          delegations: results,
        });
      } catch (err) {
        handleError(err);
      }
    });

  // ─── renew ─────────────────────────────────────────────────────

  delegationCmd
    .command('renew <delegationId>')
    .description('Renew a delegation with extended expiration')
    .requiredOption('--expires-at <iso>', 'New expiration timestamp (ISO 8601)')
    .option('--account <aliasOrAddress>', 'Account alias/address (default: current)')
    .option(
      '--permission <hex>',
      'New permission context (if the on-chain delegation was recreated)',
    )
    .option('--amount <amount>', 'New authorized amount (if changed)')
    .option('--remove-old', 'Remove the old delegation after renewal')
    .action(
      async (
        delegationId: string,
        options: {
          expiresAt: string;
          account?: string;
          permission?: string;
          amount?: string;
          removeOld?: boolean;
        },
      ) => {
        try {
          const renewed = await ctx.delegation.renew(options.account, delegationId, {
            expiresAt: options.expiresAt,
            newPermissionContext: options.permission,
            newAmount: options.amount,
            removeOld: options.removeOld,
          });
          outputResult({ delegation: mapDelegation(renewed) });
        } catch (err) {
          handleError(err);
        }
      },
    );

  // ─── revoke (on-chain + local) ─────────────────────────────────

  delegationCmd
    .command('revoke <delegationId>')
    .description('Revoke a delegation on-chain and remove locally')
    .option('--account <aliasOrAddress>', 'Account alias/address (default: current)')
    .option('--calldata <hex>', 'Revocation calldata for the DelegationManager contract')
    .option('--keep-local', 'Keep the local record after on-chain revocation (for debugging)')
    .action(
      async (
        delegationId: string,
        options: { account?: string; calldata?: string; keepLocal?: boolean },
      ) => {
        try {
          const result = await ctx.delegation.revoke(options.account, delegationId, {
            revokeCallData: options.calldata as `0x${string}` | undefined,
            keepLocal: options.keepLocal,
          });
          outputResult({
            revoked: delegationId,
            localRemoved: result.localRemoved,
            txHash: result.txHash ?? null,
          });
        } catch (err) {
          handleError(err);
        }
      },
    );
}
