import { Command } from 'commander';
import ora from 'ora';
import { formatEther, padHex } from 'viem';
import type { Hex } from 'viem';
import { type AppContext, syncContextForAccount } from '../context';
import type { SecurityIntent } from '../types';
import { askSelect } from '../utils/prompt';
import { registerAccount, requestSponsorship, applySponsorToUserOp } from '../utils/sponsor';
import { encodeInstallHook } from '../utils/contracts/securityHook';
import {
  SECURITY_HOOK_ADDRESS_MAP,
  DEFAULT_CAPABILITY,
  DEFAULT_SAFETY_DELAY,
} from '../constants/securityHook';
import { SecurityHookService, createSignMessageForAuth } from '../services/securityHook';
import {
  address as shortAddr,
  outputResult,
  outputError,
  sanitizeErrorMessage,
} from '../utils/display';
import { checkRecoveryBlocked } from '../utils/recoveryGuard';

const ERR_INVALID_PARAMS = -32602;
const ERR_ACCOUNT_NOT_READY = -32002;
const ERR_SPONSOR_FAILED = -32003;
const ERR_BUILD_FAILED = -32004;
const ERR_SEND_FAILED = -32005;
const ERR_REVERTED = -32006;
const ERR_INTERNAL = -32000;

/**
 * `elytro account` — Smart account management.
 *
 * All subcommands output structured JSON:
 *   { "success": true, "result": { ... } }
 *   { "success": false, "error": { "code": <number>, "message": <string> } }
 */
export function registerAccountCommand(program: Command, ctx: AppContext): void {
  const account = program.command('account').description('Manage smart accounts');

  // ─── create ───────────────────────────────────────────────────

  account
    .command('create')
    .description('Create a new smart account')
    .requiredOption('-c, --chain <chainId>', 'Target chain ID')
    .option('-a, --alias <alias>', 'Human-readable alias (default: random)')
    .option('-e, --email <email>', '2FA email for SecurityHook OTP (strongly recommended)')
    .option('-l, --daily-limit <usd>', 'Daily spending limit in USD (e.g. "100")')
    .action(async (opts) => {
      if (!ctx.keyring.isUnlocked) {
        outputError(ERR_ACCOUNT_NOT_READY, 'Wallet not initialized. Run `elytro init` first.');
        return;
      }

      const chainId = Number(opts.chain);
      if (Number.isNaN(chainId)) {
        outputError(ERR_INVALID_PARAMS, 'Invalid chain ID.', { chain: opts.chain });
        return;
      }

      // Validate chain is supported
      const chainConfig = ctx.chain.chains.find((c) => c.id === chainId);
      if (!chainConfig) {
        const supported = ctx.chain.chains.map((c) => `${c.id} (${c.name})`);
        outputError(ERR_INVALID_PARAMS, `Chain ${chainId} is not supported.`, {
          supportedChains: supported,
        });
        return;
      }

      // Validate --daily-limit if provided
      let dailyLimitUsd: number | undefined;
      if (opts.dailyLimit !== undefined) {
        dailyLimitUsd = parseFloat(opts.dailyLimit);
        if (isNaN(dailyLimitUsd) || dailyLimitUsd < 0) {
          outputError(
            ERR_INVALID_PARAMS,
            'Invalid --daily-limit. Provide a positive number in USD (e.g. "100").',
          );
          return;
        }
      }

      // Build security intent if any security flags provided
      const securityIntent: SecurityIntent | undefined =
        opts.email || dailyLimitUsd !== undefined
          ? {
              ...(opts.email && { email: opts.email }),
              ...(dailyLimitUsd !== undefined && { dailyLimitUsd }),
            }
          : undefined;

      const spinner = ora('Creating smart account...').start();
      try {
        // Initialize SDK for the target chain before address calculation
        const chainName = chainConfig.name;
        await ctx.sdk.initForChain(chainConfig);
        ctx.walletClient.initForChain(chainConfig);

        const accountInfo = await ctx.account.createAccount(chainId, opts.alias, securityIntent);

        // Register with Elytro backend (required for sponsorship)
        spinner.text = 'Registering with backend...';
        const { guardianHash, guardianSafePeriod } = ctx.sdk.initDefaults;
        const paddedKey = padHex(accountInfo.owner, { size: 32 });
        const { error: regError } = await registerAccount(
          ctx.chain.graphqlEndpoint,
          accountInfo.address,
          chainId,
          accountInfo.index,
          [paddedKey],
          guardianHash,
          guardianSafePeriod,
        );

        // ─── Email binding (off-chain, async) ───────────────────
        let emailBindingStarted = false;
        if (opts.email && chainConfig) {
          spinner.text = 'Initiating email binding...';
          try {
            const hookService = createHookServiceForAccount(ctx, chainConfig);
            const bindingResult = await hookService.requestEmailBinding(
              accountInfo.address,
              chainId,
              opts.email,
            );
            await ctx.account.updateSecurityIntent(accountInfo.address, chainId, {
              emailBindingId: bindingResult.bindingId,
            });
            emailBindingStarted = true;
          } catch {
            // Email binding requires deployed account — expected to fail on new accounts
          }
        }

        spinner.stop();

        outputResult({
          alias: accountInfo.alias,
          address: accountInfo.address,
          chain: chainName,
          chainId,
          deployed: false,
          ...(securityIntent
            ? {
                security: {
                  ...(opts.email ? { email: opts.email, emailBindingStarted } : {}),
                  ...(dailyLimitUsd !== undefined ? { dailyLimitUsd } : {}),
                  hookPending: true,
                },
              }
            : { security: null }),
          ...(regError ? { warning: `Backend registration failed: ${regError}` } : {}),
        });
      } catch (err) {
        spinner.stop();
        outputError(ERR_INTERNAL, (err as Error).message);
      }
    });

  // ─── activate ───────────────────────────────────────────────────

  account
    .command('activate')
    .description('Deploy the smart contract on-chain')
    .argument('[account]', 'Alias or address (default: current)')
    .option('--no-sponsor', 'Skip sponsorship check (user pays gas)')
    .action(async (target?: string, opts?: { sponsor?: boolean }) => {
      if (!ctx.keyring.isUnlocked) {
        outputError(ERR_ACCOUNT_NOT_READY, 'Wallet not initialized. Run `elytro init` first.');
        return;
      }

      // 1. Resolve account
      const identifier =
        target ?? ctx.account.currentAccount?.alias ?? ctx.account.currentAccount?.address;
      if (!identifier) {
        outputError(
          ERR_ACCOUNT_NOT_READY,
          'No account selected. Specify an alias/address or create an account first.',
        );
        return;
      }

      const accountInfo = ctx.account.resolveAccount(identifier);
      if (!accountInfo) {
        outputError(ERR_ACCOUNT_NOT_READY, `Account "${identifier}" not found.`);
        return;
      }

      // Recovery guard
      if (checkRecoveryBlocked(accountInfo)) return;

      // 2. Check if already deployed (verify on-chain, not just local flag)
      const chainConfig = ctx.chain.chains.find((c) => c.id === accountInfo.chainId);
      const chainName = chainConfig?.name ?? String(accountInfo.chainId);

      if (!chainConfig) {
        outputError(ERR_ACCOUNT_NOT_READY, `Chain ${accountInfo.chainId} not configured.`);
        return;
      }

      // Ensure SDK is initialized for the account's chain
      await ctx.sdk.initForChain(chainConfig);
      ctx.walletClient.initForChain(chainConfig);

      const deployedOnChain = await ctx.walletClient.isContractDeployed(accountInfo.address);

      if (deployedOnChain) {
        // Sync local state if it was out of date
        if (!accountInfo.isDeployed) {
          await ctx.account.markDeployed(accountInfo.address, accountInfo.chainId);
        }
        outputResult({
          alias: accountInfo.alias,
          address: accountInfo.address,
          status: 'already_deployed',
        });
        return;
      }

      // Local state says deployed but chain says otherwise -- fix the drift
      if (accountInfo.isDeployed && !deployedOnChain) {
        accountInfo.isDeployed = false;
      }

      const spinner = ora(`Activating "${accountInfo.alias}" on ${chainName}...`).start();

      // Determine if we should batch security hook installation
      const intent = accountInfo.securityIntent;
      const hookAddress = SECURITY_HOOK_ADDRESS_MAP[accountInfo.chainId];
      const shouldInstallHook = !!(
        intent &&
        hookAddress &&
        (intent.email || intent.dailyLimitUsd !== undefined)
      );

      try {
        // 3. Create unsigned deploy UserOp
        spinner.text = 'Building deployment UserOp...';

        let deployCallData: Hex | undefined;
        let hookBatched = false;
        if (shouldInstallHook) {
          const installTx = encodeInstallHook(
            accountInfo.address,
            hookAddress,
            DEFAULT_SAFETY_DELAY,
            DEFAULT_CAPABILITY,
          );
          deployCallData = installTx.data;
        }

        const userOp = await ctx.sdk.createDeployUserOp(accountInfo.owner, accountInfo.index);

        if (shouldInstallHook && deployCallData) {
          try {
            const hookInstallOp = await ctx.sdk.createSendUserOp(accountInfo.address, [
              {
                to: accountInfo.address,
                value: '0',
                data: deployCallData,
              },
            ]);
            userOp.callData = hookInstallOp.callData;
            hookBatched = true;
          } catch {
            // Fall back to deploy-only. Hook can be installed separately.
          }
        }

        // 4. Get fee data from Pimlico bundler
        spinner.text = 'Fetching gas prices...';
        const feeData = await ctx.sdk.getFeeData(chainConfig);
        userOp.maxFeePerGas = feeData.maxFeePerGas;
        userOp.maxPriorityFeePerGas = feeData.maxPriorityFeePerGas;

        // 5. Estimate gas (with fakeBalance to prevent AA21)
        spinner.text = 'Estimating gas...';
        const gasEstimate = await ctx.sdk.estimateUserOp(userOp, { fakeBalance: true });
        userOp.callGasLimit = gasEstimate.callGasLimit;
        userOp.verificationGasLimit = gasEstimate.verificationGasLimit;
        userOp.preVerificationGas = gasEstimate.preVerificationGas;

        // 6. Try sponsorship
        let sponsored = false;
        if (opts?.sponsor !== false) {
          spinner.text = 'Checking sponsorship...';
          const { sponsor: sponsorResult, error: sponsorError } = await requestSponsorship(
            ctx.chain.graphqlEndpoint,
            accountInfo.chainId,
            ctx.sdk.entryPoint,
            userOp,
          );

          if (sponsorResult) {
            applySponsorToUserOp(userOp, sponsorResult);
            sponsored = true;
          } else {
            spinner.text = 'Sponsorship unavailable, checking balance...';
            const { ether: balance } = await ctx.walletClient.getBalance(accountInfo.address);
            if (parseFloat(balance) === 0) {
              spinner.stop();
              outputError(
                ERR_SPONSOR_FAILED,
                `Sponsorship failed: ${sponsorError ?? 'unknown'}. Account has no ETH to pay gas.`,
                {
                  account: accountInfo.alias,
                  address: accountInfo.address,
                  chain: chainName,
                },
              );
              return;
            }
          }
        }

        // 7. Sign
        spinner.text = 'Signing UserOperation...';
        const { packedHash, validationData } = await ctx.sdk.getUserOpHash(userOp);
        const rawSignature = await ctx.keyring.signDigest(packedHash);
        userOp.signature = await ctx.sdk.packUserOpSignature(rawSignature, validationData);

        // 8. Send
        spinner.text = 'Sending to bundler...';
        const opHash = await ctx.sdk.sendUserOp(userOp);

        // 9. Wait for receipt
        spinner.text = 'Waiting for on-chain confirmation...';
        const receipt = await ctx.sdk.waitForReceipt(opHash);

        // 10. Update local state
        await ctx.account.markDeployed(accountInfo.address, accountInfo.chainId);
        const hookInstalled = shouldInstallHook && hookBatched && receipt.success;
        if (hookInstalled) {
          await ctx.account.finalizeSecurityIntent(accountInfo.address, accountInfo.chainId);
        } else if (intent) {
          await ctx.account.clearSecurityIntent(accountInfo.address, accountInfo.chainId);
        }

        spinner.stop();

        if (receipt.success) {
          outputResult({
            alias: accountInfo.alias,
            address: accountInfo.address,
            chain: chainName,
            chainId: accountInfo.chainId,
            transactionHash: receipt.transactionHash,
            gasCost: `${formatEther(BigInt(receipt.actualGasCost))} ETH`,
            sponsored,
            hookInstalled,
            ...(hookInstalled && intent?.email ? { emailPending: intent.email } : {}),
            ...(hookInstalled && intent?.dailyLimitUsd !== undefined
              ? { dailyLimitPending: intent.dailyLimitUsd }
              : {}),
            ...(chainConfig.blockExplorer
              ? { explorer: `${chainConfig.blockExplorer}/tx/${receipt.transactionHash}` }
              : {}),
          });
        } else {
          outputError(ERR_REVERTED, 'UserOp included but execution reverted.', {
            alias: accountInfo.alias,
            transactionHash: receipt.transactionHash,
            block: receipt.blockNumber,
          });
        }
      } catch (err) {
        spinner.stop();
        outputError(ERR_SEND_FAILED, (err as Error).message);
      }
    });

  // ─── list ─────────────────────────────────────────────────────

  account
    .command('list')
    .description('List all accounts (or query one by alias/address)')
    .argument('[account]', 'Filter by alias or address')
    .option('-c, --chain <chainId>', 'Filter by chain ID')
    .action(async (target?: string, opts?: { chain?: string }) => {
      let accounts = opts?.chain
        ? ctx.account.getAccountsByChain(Number(opts.chain))
        : ctx.account.allAccounts;

      if (target) {
        const matched = ctx.account.resolveAccount(target);
        if (!matched) {
          outputError(ERR_ACCOUNT_NOT_READY, `Account "${target}" not found.`);
          return;
        }
        accounts = [matched];
      }

      const current = ctx.account.currentAccount;

      outputResult({
        accounts: accounts.map((a) => {
          const chainConfig = ctx.chain.chains.find((c) => c.id === a.chainId);
          return {
            active: a.address === current?.address,
            alias: a.alias,
            address: a.address,
            chain: chainConfig?.name ?? String(a.chainId),
            chainId: a.chainId,
            deployed: a.isDeployed,
            recovery: a.isRecoveryEnabled,
          };
        }),
        total: accounts.length,
      });
    });

  // ─── info ─────────────────────────────────────────────────────

  account
    .command('info')
    .description('Show details for an account')
    .argument('[account]', 'Alias or address (default: current)')
    .action(async (target?: string) => {
      const identifier =
        target ?? ctx.account.currentAccount?.alias ?? ctx.account.currentAccount?.address;

      if (!identifier) {
        outputError(
          ERR_ACCOUNT_NOT_READY,
          'No account selected. Run `elytro account create` first.',
        );
        return;
      }

      const spinner = ora('Fetching on-chain data...').start();
      try {
        const accountInfo = ctx.account.resolveAccount(identifier);
        if (!accountInfo) {
          spinner.stop();
          outputError(ERR_ACCOUNT_NOT_READY, `Account "${identifier}" not found.`);
          return;
        }
        const chainConfig = ctx.chain.chains.find((c) => c.id === accountInfo.chainId);
        if (chainConfig) {
          ctx.walletClient.initForChain(chainConfig);
        }

        const detail = await ctx.account.getAccountDetail(identifier);
        spinner.stop();

        outputResult({
          alias: detail.alias,
          address: detail.address,
          chain: chainConfig?.name ?? String(detail.chainId),
          chainId: detail.chainId,
          deployed: detail.isDeployed,
          balance: `${detail.balance} ${chainConfig?.nativeCurrency.symbol ?? 'ETH'}`,
          recovery: detail.isRecoveryEnabled,
          ...(detail.securityStatus ? { securityStatus: detail.securityStatus } : {}),
          ...(detail.securityIntent ? { securityIntent: detail.securityIntent } : {}),
          ...(chainConfig?.blockExplorer
            ? { explorer: `${chainConfig.blockExplorer}/address/${detail.address}` }
            : {}),
        });
      } catch (err) {
        spinner.stop();
        outputError(ERR_INTERNAL, (err as Error).message);
      }
    });

  // ─── rename ──────────────────────────────────────────────────

  account
    .command('rename')
    .description('Rename an account alias')
    .argument('<account>', 'Current alias or address')
    .argument('<newAlias>', 'New alias')
    .action(async (target: string, newAlias: string) => {
      try {
        const renamed = await ctx.account.renameAccount(target, newAlias);
        const chainConfig = ctx.chain.chains.find((c) => c.id === renamed.chainId);
        outputResult({
          alias: renamed.alias,
          address: renamed.address,
          chain: chainConfig?.name ?? String(renamed.chainId),
          chainId: renamed.chainId,
        });
      } catch (err) {
        outputError(ERR_INTERNAL, (err as Error).message);
      }
    });

  // ─── switch ───────────────────────────────────────────────────

  account
    .command('switch')
    .description('Switch the active account')
    .argument('[account]', 'Alias or address')
    .action(async (target?: string) => {
      const accounts = ctx.account.allAccounts;
      if (accounts.length === 0) {
        outputError(ERR_ACCOUNT_NOT_READY, 'No accounts found. Run `elytro account create` first.');
        return;
      }

      let identifier = target;

      // Interactive selection if no target given
      if (!identifier) {
        const chainConfig = (chainId: number) => ctx.chain.chains.find((c) => c.id === chainId);

        identifier = await askSelect(
          'Select an account',
          accounts.map((a) => ({
            name: `${a.alias}  ${shortAddr(a.address)}  ${chainConfig(a.chainId)?.name ?? a.chainId}`,
            value: a.alias,
          })),
        );
      }

      try {
        const switched = await ctx.account.switchAccount(identifier);

        await syncContextForAccount(ctx, switched);
        const newChain = ctx.chain.chains.find((c) => c.id === switched.chainId);

        // Fetch on-chain data for the result
        let balance: string | null = null;
        try {
          const detail = await ctx.account.getAccountDetail(switched.alias);
          balance = `${detail.balance} ${newChain?.nativeCurrency.symbol ?? 'ETH'}`;
        } catch {
          // Non-fatal
        }

        outputResult({
          alias: switched.alias,
          address: switched.address,
          chain: newChain?.name ?? String(switched.chainId),
          chainId: switched.chainId,
          deployed: switched.isDeployed,
          ...(balance ? { balance } : {}),
          ...(newChain?.blockExplorer
            ? { explorer: `${newChain.blockExplorer}/address/${switched.address}` }
            : {}),
        });
      } catch (err) {
        outputError(ERR_INTERNAL, (err as Error).message);
      }
    });
}

// ─── Helpers ──────────────────────────────────────────────────────

/**
 * Create a SecurityHookService instance for off-chain operations (email binding).
 */
function createHookServiceForAccount(
  ctx: AppContext,
  chainConfig: { id: number },
): SecurityHookService {
  return new SecurityHookService({
    store: ctx.store,
    graphqlEndpoint: ctx.chain.graphqlEndpoint,
    signMessageForAuth: createSignMessageForAuth({
      signDigest: (digest) => ctx.keyring.signDigest(digest),
      packRawHash: (hash) => ctx.sdk.packRawHash(hash),
      packSignature: (rawSig, valData) => ctx.sdk.packUserOpSignature(rawSig, valData),
    }),
    readContract: async (params) => {
      return ctx.walletClient.readContract(
        params as Parameters<typeof ctx.walletClient.readContract>[0],
      );
    },
    getBlockTimestamp: async () => {
      const blockNumber = await ctx.walletClient.raw.getBlockNumber();
      const block = await ctx.walletClient.raw.getBlock({ blockNumber });
      return block.timestamp;
    },
  });
}
