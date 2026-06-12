import { Command } from 'commander';
import { outputError, outputResult } from '../utils/display';
import { type AppContext, syncContextForAccount } from '../context';
import { X402Service } from '../services/x402';
import { checkRecoveryBlocked } from '../utils/recoveryGuard';

/**
 * Attempt to parse a string as JSON so it embeds as a structured object
 * in the output rather than a double-serialized string.
 * Returns the original string on failure (non-JSON bodies, truncated responses, etc.).
 */
function tryParseResponseBody(body: string | undefined): unknown {
  if (body === undefined) return undefined;
  try {
    return JSON.parse(body);
  } catch {
    return body;
  }
}

/**
 * Map known x402 facilitator error strings to actionable suggestions.
 *
 * Facilitator error codes are not standardized, so we match on substrings
 * observed across common implementations (Coinbase x402, run402, agentmail).
 */
function paymentFailureSuggestion(reason: string): string {
  const r = reason.toLowerCase();

  if (r.includes('insufficient_balance') || r.includes('insufficient balance'))
    return 'Check token balance with `query balance --token <asset>`. Fund the account if needed.';

  if (r.includes('invalid_signature') || r.includes('signature'))
    return 'EIP-3009 signature rejected. Verify the account is deployed (`account info`) and the EIP-712 domain matches (check `extra.name`/`extra.version` in the payment requirement).';

  if (r.includes('expired') || r.includes('timeout'))
    return 'Payment authorization expired before the facilitator could settle. Retry with a shorter network latency or check system clock.';

  if (r.includes('simulation_failed') || r.includes('transaction_simulation'))
    return 'On-chain simulation reverted. Likely causes: insufficient token balance, undeployed account, or invalid delegation. Run `account info` and `query balance --token <asset>`.';

  if (r.includes('payment required'))
    return 'Facilitator returned a generic rejection. Run with `--verbose` to inspect the full EIP-3009 signing flow and facilitator response headers.';

  return 'Run with `--verbose` for detailed diagnostics.';
}

interface RequestOptions {
  method?: string;
  header?: string[];
  body?: string;
  json?: string;
  account?: string;
  dryRun?: boolean;
  verbose?: boolean;
}

function parseHeaders(values: string[] | undefined): Record<string, string> {
  const headers: Record<string, string> = {};
  if (!values) return headers;
  for (const entry of values) {
    const idx = entry.indexOf(':');
    if (idx === -1) {
      throw new Error(`Invalid header "${entry}". Use "Key: Value" format.`);
    }
    const key = entry.slice(0, idx).trim();
    const value = entry.slice(idx + 1).trim();
    if (!key) {
      throw new Error(`Header "${entry}" has an empty key.`);
    }
    headers[key] = value;
  }
  return headers;
}

function buildBody(options: RequestOptions, headers: Record<string, string>): string | undefined {
  if (options.body && options.json) {
    throw new Error('Use either --body or --json, not both.');
  }
  if (options.json) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(options.json);
    } catch (err) {
      throw new Error(`Invalid JSON for --json: ${(err as Error).message}`);
    }
    const hasContentType = Object.keys(headers).some((key) => key.toLowerCase() === 'content-type');
    if (!hasContentType) {
      headers['Content-Type'] = 'application/json';
    }
    return JSON.stringify(parsed);
  }
  return options.body;
}

export function registerRequestCommand(program: Command, ctx: AppContext): void {
  const x402 = new X402Service({
    account: ctx.account,
    keyring: ctx.keyring,
    sdk: ctx.sdk,
    delegation: ctx.delegation,
  });

  program
    .command('request')
    .description('Send an HTTP request with automatic x402 payment handling')
    .argument('<url>', 'Target URL')
    .option('--method <method>', 'HTTP method (default: GET)')
    .option(
      '--header <key:value>',
      'Custom headers',
      (value, prev: string[]) => {
        prev.push(value);
        return prev;
      },
      [],
    )
    .option('--body <string>', 'Raw request body (string)')
    .option(
      '--json <json>',
      'JSON body (stringified). Sets Content-Type: application/json if missing.',
    )
    .option('--account <aliasOrAddress>', 'Account alias/address to pay from (default: current)')
    .option('--dry-run', 'Preview payment requirements without paying')
    .option('--verbose', 'Log request/response debug details')
    .action(async (url: string, options: RequestOptions & { header: string[] }) => {
      const method = (options.method ?? 'GET').toUpperCase();
      try {
        // Recovery guard for payment requests
        const currentAcct = ctx.account.currentAccount;
        if (currentAcct && checkRecoveryBlocked(currentAcct)) return;

        const headers = parseHeaders(options.header);
        const body = buildBody(options, headers);

        const targetAccount = options.account
          ? ctx.account.resolveAccount(options.account)
          : ctx.account.currentAccount;
        if (targetAccount) {
          await syncContextForAccount(ctx, targetAccount);
        }

        const result = await x402.performRequest({
          url,
          method,
          headers,
          body,
          account: options.account,
          dryRun: options.dryRun ?? false,
          verbose: options.verbose ?? false,
        });

        if (result.type === 'preview') {
          outputResult({
            type: 'preview',
            method: result.payment?.method,
            initialStatus: result.initial.status,
            requirement: {
              amount: result.payment?.requirement.amount,
              asset: result.payment?.requirement.asset,
              payTo: result.payment?.requirement.payTo,
              network: result.payment?.requirement.network,
              maxTimeoutSeconds: result.payment?.requirement.maxTimeoutSeconds,
            },
            resource: result.payment?.resource,
          });
          return;
        }

        if (result.type === 'payment_failed') {
          const reason = result.payment?.failureReason ?? 'Payment failed';
          outputError(-32005, reason, {
            method: result.payment?.method,
            initialStatus: result.initial.status,
            finalStatus: result.final?.status,
            payment: {
              amount: result.payment?.requirement.amount,
              asset: result.payment?.requirement.asset,
              payTo: result.payment?.requirement.payTo,
              network: result.payment?.requirement.network,
            },
            facilitatorResponse: tryParseResponseBody(result.final?.body),
            suggestion: paymentFailureSuggestion(reason),
          });
          return;
        }

        if (result.type === 'paid') {
          outputResult({
            type: 'paid',
            method: result.payment?.method,
            initialStatus: result.initial.status,
            finalStatus: result.final?.status,
            responseBody: tryParseResponseBody(result.final?.body),
            payment: {
              amount: result.payment?.requirement.amount,
              asset: result.payment?.requirement.asset,
              payTo: result.payment?.requirement.payTo,
              network: result.payment?.requirement.network,
              delegationId: result.payment?.delegationId,
              authorization: result.payment?.authorization ?? null,
              settlement: result.payment?.settlement ?? null,
            },
          });
          return;
        }

        outputResult({
          type: 'plain',
          status: result.final?.status,
          responseBody: tryParseResponseBody(result.final?.body),
        });
      } catch (err) {
        outputError(-32000, (err as Error).message);
      }
    });
}
