import { Command } from 'commander';
import ora from 'ora';
import type { AppContext } from '../context';
import { TokenService } from '../services/token';
import { outputResult, outputError } from '../utils/display';

// ─── Error Codes ─────────────────────────────────────────────────────

const ERR_INVALID_PARAMS = -32602;
const ERR_ACCOUNT_NOT_READY = -32002;
const ERR_INTERNAL = -32000;

// ─── Command Registration ────────────────────────────────────────────

/**
 * `elytro token` — Look up token addresses from the Uniswap default-token-list.
 *
 * Data is fetched from GitHub and cached locally (~/.elytro/cache/) for 24h.
 * Supported mainnet chains: 1 (Ethereum), 10 (Optimism), 137 (Polygon), 42161 (Arbitrum), 8453 (Base).
 *
 * Usage:
 *   elytro token                     # all tokens on the current account's chain
 *   elytro token --search usdc       # fuzzy search by symbol or name
 *   elytro token --chain 8453        # tokens on a specific chain
 */
export function registerTokenCommand(program: Command, ctx: AppContext): void {
  const tokenService = new TokenService(ctx.store);

  program
    .command('token')
    .description('Look up token addresses (source: Uniswap default-token-list)')
    .option('--chain <id>', 'Chain ID (default: account chain)', parseChainId)
    .option('--search <query>', 'Filter by symbol or name (case-insensitive)')
    .argument('[account]', 'Account to infer chain from (default: current)')
    .action(
      async (
        target?: string,
        opts?: {
          chain?: number;
          search?: string;
        },
      ) => {
        let spinner: ReturnType<typeof ora> | undefined;
        try {
          let chainId: number;

          if (opts?.chain) {
            chainId = opts.chain;
          } else {
            const identifier =
              target ?? ctx.account.currentAccount?.alias ?? ctx.account.currentAccount?.address;
            if (!identifier) {
              outputError(ERR_ACCOUNT_NOT_READY, 'No account selected and no --chain specified.', {
                hint: 'Use --chain <id> or create an account first.',
                supportedChains: tokenService.supportedChains,
              });
              return;
            }
            const account = ctx.account.resolveAccount(identifier);
            if (!account) {
              outputError(ERR_ACCOUNT_NOT_READY, `Account "${identifier}" not found.`, {
                identifier,
              });
              return;
            }
            chainId = account.chainId;
          }

          if (!tokenService.supportedChains.includes(chainId)) {
            outputError(ERR_INVALID_PARAMS, `No token list available for chain ${chainId}.`, {
              supportedChains: tokenService.supportedChains,
              hint: `Supported chains: ${tokenService.supportedChains.join(', ')}. Testnets have no token list.`,
            });
            return;
          }

          spinner = ora('Fetching token list...').start();

          const tokens = opts?.search
            ? await tokenService.search(chainId, opts.search)
            : await tokenService.getTokens(chainId);

          spinner.stop();

          outputResult({
            chainId,
            ...(opts?.search ? { search: opts.search } : {}),
            count: tokens.length,
            tokens: tokens.map((t) => ({
              symbol: t.symbol,
              name: t.name,
              address: t.address,
              decimals: t.decimals,
            })),
          });
        } catch (err) {
          spinner?.stop();
          outputError(ERR_INTERNAL, (err as Error).message ?? String(err));
        }
      },
    );
}

// ─── Helpers ─────────────────────────────────────────────────────────

function parseChainId(value: string): number {
  const parsed = parseInt(value, 10);
  if (isNaN(parsed) || parsed <= 0) {
    throw new Error(`Invalid chain ID: "${value}".`);
  }
  return parsed;
}
