import { Command } from 'commander';
import type { AppContext } from '../context';
import type { UserKeys } from '../types';
import { maskApiKeys, outputResult, outputError } from '../utils/display';

/**
 * `elytro config` — Manage CLI configuration.
 *
 * All subcommands output structured JSON.
 */

const KEY_MAP: Record<string, keyof UserKeys> = {
  'alchemy-key': 'alchemyKey',
  'pimlico-key': 'pimlicoKey',
};

const VALID_KEYS = Object.keys(KEY_MAP);

function maskKey(value: string): string {
  if (value.length <= 6) return '***';
  return value.slice(0, 4) + '***' + value.slice(-4);
}

export function registerConfigCommand(program: Command, ctx: AppContext): void {
  const configCmd = program.command('config').description('Manage CLI configuration (API keys, RPC endpoints)');

  // ── show ───────────────────────────────────────────────────────
  configCmd
    .command('show')
    .description('Show current endpoint configuration')
    .action(() => {
      const keys = ctx.chain.getUserKeys();
      const chain = ctx.chain.currentChain;

      outputResult({
        rpcProvider: keys.alchemyKey ? 'Alchemy (user-configured)' : 'Public (publicnode.com)',
        bundlerProvider: keys.pimlicoKey ? 'Pimlico (user-configured)' : 'Public (pimlico.io/public)',
        ...(keys.alchemyKey ? { alchemyKey: maskKey(keys.alchemyKey) } : {}),
        ...(keys.pimlicoKey ? { pimlicoKey: maskKey(keys.pimlicoKey) } : {}),
        currentChain: chain.name,
        chainId: chain.id,
        rpcEndpoint: maskApiKeys(chain.endpoint),
        bundler: maskApiKeys(chain.bundler),
      });
    });

  // ── set ────────────────────────────────────────────────────────
  configCmd
    .command('set <key> <value>')
    .description(`Set an API key (${VALID_KEYS.join(' | ')})`)
    .action(async (key: string, value: string) => {
      const mapped = KEY_MAP[key];
      if (!mapped) {
        outputError(-32602, `Unknown key "${key}". Valid keys: ${VALID_KEYS.join(', ')}`);
        return;
      }

      await ctx.chain.setUserKey(mapped, value);

      const chain = ctx.chain.currentChain;
      outputResult({
        key,
        status: 'saved',
        rpcEndpoint: maskApiKeys(chain.endpoint),
        bundler: maskApiKeys(chain.bundler),
      });
    });

  // ── remove ─────────────────────────────────────────────────────
  configCmd
    .command('remove <key>')
    .description(`Remove an API key and revert to public endpoint (${VALID_KEYS.join(' | ')})`)
    .action(async (key: string) => {
      const mapped = KEY_MAP[key];
      if (!mapped) {
        outputError(-32602, `Unknown key "${key}". Valid keys: ${VALID_KEYS.join(', ')}`);
        return;
      }

      await ctx.chain.removeUserKey(mapped);
      outputResult({
        key,
        status: 'removed',
      });
    });
}
