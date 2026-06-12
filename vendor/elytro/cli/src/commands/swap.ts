import { Command } from 'commander';
import ora from 'ora';
import { isAddress, formatUnits, formatEther, toHex, parseEther } from 'viem';
import type { Address, Hex } from 'viem';
import type { AppContext } from '../context';
import type { ElytroUserOperation, AccountInfo, ChainConfig } from '../types';
import { SwapService } from '../services/swap';
import type { SwapQuote, SwapQuoteParams } from '../services/swap';
import { requestSponsorship, applySponsorToUserOp } from '../utils/sponsor';
import {
  outputResult,
  outputError,
  outputStderrJson,
  sanitizeErrorMessage,
} from '../utils/display';
import { SecurityHookService, createSignMessageForAuth } from '../services/securityHook';
import { savePendingOtpAndOutput } from '../services/pendingOtp';
import { serializeUserOpForPending } from '../utils/userOpSerialization';
import { SECURITY_HOOK_ADDRESS_MAP } from '../constants/securityHook';
import { checkRecoveryBlocked } from '../utils/recoveryGuard';

// ─── Error Codes ─────────────────────────────────────────────────────

const ERR_INVALID_PARAMS = -32602;
const ERR_ACCOUNT_NOT_READY = -32002;
const ERR_SPONSOR_FAILED = -32003;
const ERR_BUILD_FAILED = -32004;
const ERR_SEND_FAILED = -32005;
const ERR_EXECUTION_REVERTED = -32006;
const ERR_INTERNAL = -32000;
const ERR_QUOTE_FAILED = -32008;

class SwapError extends Error {
  code: number;
  data?: Record<string, unknown>;

  constructor(code: number, message: string, data?: Record<string, unknown>) {
    super(message);
    this.name = 'SwapError';
    this.code = code;
    this.data = data;
  }
}

function handleSwapError(err: unknown): void {
  if (err instanceof SwapError) {
    outputError(err.code, err.message, err.data);
  } else {
    outputError(ERR_INTERNAL, (err as Error).message ?? String(err));
  }
}

// ─── Address Constants ───────────────────────────────────────────────

/** The zero address represents native ETH in LiFi conventions. */
const NATIVE_TOKEN_ADDRESS = '0x0000000000000000000000000000000000000000' as Address;

// ─── Command Registration ────────────────────────────────────────────

/**
 * `elytro swap` — Cross-chain token swaps and bridges via LiFi.
 *
 * Subcommands:
 *   quote  — Get a swap/bridge quote (read-only, no approval needed)
 *   send   — Execute a swap on-chain (requires user approval)
 */
export function registerSwapCommand(program: Command, ctx: AppContext): void {
  const swap = program.command('swap').description('Swap and bridge tokens via LiFi');

  const swapService = new SwapService();

  // ─── quote ─────────────────────────────────────────────────────

  swap
    .command('quote')
    .description('Get a swap/bridge quote (read-only)')
    .option('--from-chain <id>', 'Source chain ID (default: account chain)', parseChainId)
    .option('--to-chain <id>', 'Destination chain ID (default: same as source)', parseChainId)
    .requiredOption('--from-token <address>', 'Source token address (0x0...0 for native ETH)')
    .requiredOption('--to-token <address>', 'Destination token address')
    .requiredOption('--amount <value>', 'Amount in source token atomic units (wei)')
    .option('--slippage <pct>', 'Slippage tolerance, e.g. "0.5" for 0.5%')
    .argument('[account]', 'Source account alias or address (default: current)')
    .action(
      async (
        target?: string,
        opts?: {
          fromChain?: number;
          toChain?: number;
          fromToken: string;
          toToken: string;
          amount: string;
          slippage?: string;
        },
      ) => {
        try {
          if (!opts) throw new SwapError(ERR_INVALID_PARAMS, 'Missing required options.');

          validateTokenAddress(opts.fromToken, '--from-token');
          validateTokenAddress(opts.toToken, '--to-token');

          const accountInfo = resolveAccountStrict(ctx, target);

          const fromChain = opts.fromChain ?? accountInfo.chainId;
          const toChain = opts.toChain ?? fromChain;

          const spinner = ora('Fetching quote...').start();

          const params: SwapQuoteParams = {
            fromChain,
            toChain,
            fromToken: opts.fromToken as Address,
            toToken: opts.toToken as Address,
            fromAmount: opts.amount,
            fromAddress: accountInfo.address,
            slippage: opts.slippage ? normalizeSlippage(opts.slippage) : undefined,
          };

          let quote: SwapQuote;
          try {
            quote = await swapService.getQuote(params);
          } catch (err) {
            spinner.stop();
            throw new SwapError(ERR_QUOTE_FAILED, (err as Error).message, {
              hint: 'Check that the token pair and chains are supported.',
              fromChain,
              toChain,
            });
          }

          spinner.stop();

          outputResult({
            quoteId: quote.id,
            type: quote.type,
            tool: quote.toolDetails.name,
            from: {
              chain: fromChain,
              token: quote.fromToken.symbol,
              amount: formatTokenAmount(quote.fromAmount, quote.fromToken.decimals),
              amountRaw: quote.fromAmount,
            },
            to: {
              chain: toChain,
              token: quote.toToken.symbol,
              estimatedAmount: formatTokenAmount(quote.toAmount, quote.toToken.decimals),
              minimumAmount: formatTokenAmount(quote.toAmountMin, quote.toToken.decimals),
              estimatedAmountRaw: quote.toAmount,
              minimumAmountRaw: quote.toAmountMin,
            },
            ...(quote.gasCostUSD ? { gasCostUSD: quote.gasCostUSD } : {}),
            ...(quote.feeCosts && quote.feeCosts.length > 0
              ? {
                  fees: quote.feeCosts.map((f) => ({
                    name: f.name,
                    amount: f.amount,
                    amountUSD: f.amountUSD,
                  })),
                }
              : {}),
            ...(quote.estimatedExecutionSeconds
              ? { estimatedSeconds: quote.estimatedExecutionSeconds }
              : {}),
            account: accountInfo.alias,
            address: accountInfo.address,
            // Include the transaction details for swap send
            transactionRequest: {
              to: quote.transactionRequest.to,
              value: quote.transactionRequest.value,
              dataLength: quote.transactionRequest.data.length,
            },
          });
        } catch (err) {
          handleSwapError(err);
        }
      },
    );

  // ─── send ──────────────────────────────────────────────────────

  swap
    .command('send')
    .description('Execute a swap on-chain (requires user approval)')
    .option('--from-chain <id>', 'Source chain ID (default: account chain)', parseChainId)
    .option('--to-chain <id>', 'Destination chain ID (default: same as source)', parseChainId)
    .requiredOption('--from-token <address>', 'Source token address (0x0...0 for native ETH)')
    .requiredOption('--to-token <address>', 'Destination token address')
    .requiredOption('--amount <value>', 'Amount in source token atomic units (wei)')
    .option('--slippage <pct>', 'Slippage tolerance, e.g. "0.5" for 0.5%')
    .option('--no-sponsor', 'Skip sponsorship check')
    .option('--no-hook', 'Skip SecurityHook signing (bypass 2FA)')
    .argument('[account]', 'Source account alias or address (default: current)')
    .action(
      async (
        target?: string,
        opts?: {
          fromChain?: number;
          toChain?: number;
          fromToken: string;
          toToken: string;
          amount: string;
          slippage?: string;
          sponsor?: boolean;
          hook?: boolean;
        },
      ) => {
        if (!ctx.keyring.isUnlocked) {
          handleSwapError(
            new SwapError(
              ERR_ACCOUNT_NOT_READY,
              'Wallet not initialized. Run `elytro init` first.',
            ),
          );
          return;
        }

        const currentAcct = ctx.account.currentAccount;
        if (currentAcct && checkRecoveryBlocked(currentAcct)) return;

        try {
          if (!opts) throw new SwapError(ERR_INVALID_PARAMS, 'Missing required options.');

          validateTokenAddress(opts.fromToken, '--from-token');
          validateTokenAddress(opts.toToken, '--to-token');

          const accountInfo = resolveAccountStrict(ctx, target);
          const chainConfig = resolveChainStrict(ctx, accountInfo.chainId);

          const fromChain = opts.fromChain ?? accountInfo.chainId;
          const toChain = opts.toChain ?? fromChain;

          if (!accountInfo.isDeployed) {
            throw new SwapError(
              ERR_ACCOUNT_NOT_READY,
              `Account "${accountInfo.alias}" is not deployed.`,
              {
                account: accountInfo.alias,
                address: accountInfo.address,
                hint: 'Run `elytro account activate` first.',
              },
            );
          }

          // Verify source chain matches account chain
          if (fromChain !== accountInfo.chainId) {
            throw new SwapError(
              ERR_INVALID_PARAMS,
              'Source chain does not match the account chain.',
              {
                fromChain,
                accountChain: accountInfo.chainId,
                hint: `Switch to an account on chain ${fromChain} or change --from-chain to ${accountInfo.chainId}.`,
              },
            );
          }

          await ctx.sdk.initForChain(chainConfig);
          ctx.walletClient.initForChain(chainConfig);

          // ── Step 1: Fresh quote (always re-quote to avoid stale data) ──
          const spinner = ora('Fetching fresh quote...').start();

          const params: SwapQuoteParams = {
            fromChain,
            toChain,
            fromToken: opts.fromToken as Address,
            toToken: opts.toToken as Address,
            fromAmount: opts.amount,
            fromAddress: accountInfo.address,
            slippage: opts.slippage ? normalizeSlippage(opts.slippage) : undefined,
          };

          let quote: SwapQuote;
          try {
            quote = await swapService.getQuote(params);
          } catch (err) {
            spinner.stop();
            throw new SwapError(ERR_QUOTE_FAILED, (err as Error).message, {
              hint: 'Check that the token pair and chains are supported.',
            });
          }

          // ── Step 2: Build UserOp from the quote's transactionRequest ──
          spinner.text = 'Building UserOp...';

          const txReq = quote.transactionRequest;
          const txs = [
            {
              to: txReq.to,
              value:
                txReq.value && txReq.value !== '0' && txReq.value !== '0x0'
                  ? txReq.value.startsWith('0x')
                    ? txReq.value
                    : toHex(BigInt(txReq.value))
                  : '0x0',
              data: txReq.data,
            },
          ];

          let userOp: ElytroUserOperation;
          try {
            userOp = await ctx.sdk.createSendUserOp(accountInfo.address, txs);
          } catch (err) {
            spinner.stop();
            throw new SwapError(
              ERR_BUILD_FAILED,
              `Failed to build swap UserOp: ${(err as Error).message}`,
              {
                account: accountInfo.address,
                chain: chainConfig.name,
              },
            );
          }

          // ── Step 3: Gas prices ──
          spinner.text = 'Fetching gas prices...';
          const feeData = await ctx.sdk.getFeeData(chainConfig);
          userOp.maxFeePerGas = feeData.maxFeePerGas;
          userOp.maxPriorityFeePerGas = feeData.maxPriorityFeePerGas;

          // ── Step 4: Estimate gas ──
          spinner.text = 'Estimating gas...';
          try {
            const gasEstimate = await ctx.sdk.estimateUserOp(userOp, { fakeBalance: true });
            userOp.callGasLimit = gasEstimate.callGasLimit;
            userOp.verificationGasLimit = gasEstimate.verificationGasLimit;
            userOp.preVerificationGas = gasEstimate.preVerificationGas;
          } catch (err) {
            spinner.stop();
            throw new SwapError(
              ERR_BUILD_FAILED,
              `Gas estimation failed: ${(err as Error).message}`,
              {
                account: accountInfo.address,
                chain: chainConfig.name,
              },
            );
          }

          // ── Step 5: Sponsorship ──
          let sponsored = false;
          if (opts.sponsor !== false) {
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
              const { wei: balance } = await ctx.walletClient.getBalance(accountInfo.address);
              if (balance === 0n) {
                spinner.stop();
                throw new SwapError(
                  ERR_SPONSOR_FAILED,
                  'Sponsorship failed and account has no ETH to pay gas.',
                  {
                    reason: sponsorError ?? 'unknown',
                    account: accountInfo.address,
                    chain: chainConfig.name,
                    hint: `Fund ${accountInfo.address} on ${chainConfig.name}.`,
                  },
                );
              }
            }
          }

          // ── Summary to stderr (for agent to present to user) ──
          const estimatedGas =
            userOp.callGasLimit + userOp.verificationGasLimit + userOp.preVerificationGas;

          spinner.stop();

          outputStderrJson({
            summary: {
              type: 'swap',
              tool: quote.toolDetails.name,
              from: {
                chain: fromChain,
                token: quote.fromToken.symbol,
                amount: formatTokenAmount(quote.fromAmount, quote.fromToken.decimals),
              },
              to: {
                chain: toChain,
                token: quote.toToken.symbol,
                estimatedAmount: formatTokenAmount(quote.toAmount, quote.toToken.decimals),
                minimumAmount: formatTokenAmount(quote.toAmountMin, quote.toToken.decimals),
              },
              account: accountInfo.alias,
              address: accountInfo.address,
              router: txReq.to,
              sponsored,
              estimatedGas: estimatedGas.toString(),
            },
          });

          // ── Step 6: Sign + Send + Wait ──
          const sendSpinner = ora('Signing UserOperation...').start();

          let opHash: Hex;
          try {
            const { packedHash, validationData } = await ctx.sdk.getUserOpHash(userOp);
            const rawSignature = await ctx.keyring.signDigest(packedHash);

            // SecurityHook handling (same pattern as tx send)
            const useHook = opts.hook !== false;
            let hookSigned = false;

            if (useHook) {
              const hookAddress = SECURITY_HOOK_ADDRESS_MAP[accountInfo.chainId];
              if (hookAddress) {
                const hookService = new SecurityHookService({
                  store: ctx.store,
                  graphqlEndpoint: ctx.chain.graphqlEndpoint,
                  signMessageForAuth: createSignMessageForAuth({
                    signDigest: (digest) => ctx.keyring.signDigest(digest),
                    packRawHash: (hash) => ctx.sdk.packRawHash(hash),
                    packSignature: (rawSig, valData) =>
                      ctx.sdk.packUserOpSignature(rawSig, valData),
                  }),
                  readContract: async (params) =>
                    ctx.walletClient.readContract(
                      params as Parameters<typeof ctx.walletClient.readContract>[0],
                    ),
                  getBlockTimestamp: async () => {
                    const blockNum = await ctx.walletClient.raw.getBlockNumber();
                    const block = await ctx.walletClient.raw.getBlock({ blockNumber: blockNum });
                    return block.timestamp;
                  },
                });

                sendSpinner.text = 'Checking SecurityHook status...';
                const hookStatus = await hookService.getHookStatus(
                  accountInfo.address,
                  accountInfo.chainId,
                );

                if (hookStatus.installed && hookStatus.capabilities.preUserOpValidation) {
                  userOp.signature = await ctx.sdk.packUserOpSignature(
                    rawSignature,
                    validationData,
                  );

                  sendSpinner.text = 'Requesting hook authorization...';
                  let hookResult = await hookService.getHookSignature(
                    accountInfo.address,
                    accountInfo.chainId,
                    ctx.sdk.entryPoint,
                    userOp,
                  );

                  if (hookResult.error) {
                    sendSpinner.stop();
                    const errCode = hookResult.error.code;

                    if (errCode === 'OTP_REQUIRED' || errCode === 'SPENDING_LIMIT_EXCEEDED') {
                      if (!hookResult.error.challengeId) {
                        const otpSpinner = ora('Requesting OTP challenge...').start();
                        try {
                          const otpChallenge = await hookService.requestSecurityOtp(
                            accountInfo.address,
                            accountInfo.chainId,
                            ctx.sdk.entryPoint,
                            userOp,
                          );
                          hookResult.error.challengeId = otpChallenge.challengeId;
                          hookResult.error.maskedEmail ??= otpChallenge.maskedEmail;
                          hookResult.error.otpExpiresAt ??= otpChallenge.otpExpiresAt;
                          otpSpinner.stop();
                        } catch (otpErr) {
                          otpSpinner.fail('Failed to request OTP challenge.');
                          throw new SwapError(
                            ERR_SEND_FAILED,
                            `Unable to request OTP challenge: ${(otpErr as Error).message}`,
                          );
                        }
                      }

                      if (!hookResult.error.challengeId) {
                        throw new SwapError(
                          ERR_SEND_FAILED,
                          'OTP challenge ID was not provided by Elytro API. Please try again.',
                        );
                      }

                      const challengeId = hookResult.error.challengeId!;
                      const authSessionId = await hookService.getAuthSession(
                        accountInfo.address,
                        accountInfo.chainId,
                      );
                      await savePendingOtpAndOutput(ctx.store, {
                        id: challengeId,
                        account: accountInfo.address,
                        chainId: accountInfo.chainId,
                        action: 'tx_send',
                        challengeId,
                        authSessionId,
                        maskedEmail: hookResult.error.maskedEmail,
                        otpExpiresAt: hookResult.error.otpExpiresAt,
                        createdAt: new Date().toISOString(),
                        data: {
                          userOp: serializeUserOpForPending(userOp),
                          entryPoint: ctx.sdk.entryPoint,
                        },
                      });
                      return;
                    } else {
                      throw new SwapError(
                        ERR_SEND_FAILED,
                        `Hook authorization failed: ${hookResult.error.message ?? errCode}`,
                      );
                    }
                  }

                  userOp.signature = await ctx.sdk.packUserOpSignatureWithHook(
                    rawSignature,
                    validationData,
                    hookAddress,
                    hookResult.signature! as Hex,
                  );
                  hookSigned = true;
                }
              }
            }

            if (!hookSigned) {
              userOp.signature = await ctx.sdk.packUserOpSignature(rawSignature, validationData);
            }

            sendSpinner.text = 'Sending to bundler...';
            opHash = await ctx.sdk.sendUserOp(userOp);
          } catch (err) {
            sendSpinner.stop();
            if (err instanceof SwapError) throw err;
            throw new SwapError(ERR_SEND_FAILED, (err as Error).message, {
              sender: accountInfo.address,
              chain: chainConfig.name,
            });
          }

          sendSpinner.text = 'Waiting for on-chain confirmation...';
          const receipt = await ctx.sdk.waitForReceipt(opHash);

          sendSpinner.stop();

          if (receipt.success) {
            outputResult({
              status: 'confirmed',
              type: 'swap',
              tool: quote.toolDetails.name,
              from: {
                chain: fromChain,
                token: quote.fromToken.symbol,
                amount: formatTokenAmount(quote.fromAmount, quote.fromToken.decimals),
              },
              to: {
                chain: toChain,
                token: quote.toToken.symbol,
                estimatedAmount: formatTokenAmount(quote.toAmount, quote.toToken.decimals),
                minimumAmount: formatTokenAmount(quote.toAmountMin, quote.toToken.decimals),
              },
              account: accountInfo.alias,
              address: accountInfo.address,
              transactionHash: receipt.transactionHash,
              block: receipt.blockNumber,
              gasCost: `${formatEther(BigInt(receipt.actualGasCost))} ETH`,
              sponsored,
              ...(chainConfig.blockExplorer
                ? { explorer: `${chainConfig.blockExplorer}/tx/${receipt.transactionHash}` }
                : {}),
            });
          } else {
            outputError(
              ERR_EXECUTION_REVERTED,
              'Swap UserOp included but execution reverted on-chain.',
              {
                transactionHash: receipt.transactionHash,
                block: receipt.blockNumber,
                gasCost: `${formatEther(BigInt(receipt.actualGasCost))} ETH`,
                sender: accountInfo.address,
                hint: 'The swap may have failed due to slippage or insufficient balance. Try increasing slippage or checking token balance.',
              },
            );
          }
        } catch (err) {
          handleSwapError(err);
        }
      },
    );
}

// ─── Helpers ─────────────────────────────────────────────────────────

function parseChainId(value: string): number {
  const parsed = parseInt(value, 10);
  if (isNaN(parsed) || parsed <= 0) {
    throw new SwapError(ERR_INVALID_PARAMS, `Invalid chain ID: "${value}".`);
  }
  return parsed;
}

function validateTokenAddress(addr: string, flag: string): void {
  if (!isAddress(addr)) {
    throw new SwapError(ERR_INVALID_PARAMS, `${flag}: invalid address "${addr}".`, {
      address: addr,
    });
  }
}

/**
 * Normalize slippage input: "0.5" (percent) → "0.005" (decimal for LiFi).
 * If the input is already < 1, treat it as a decimal fraction directly.
 */
function normalizeSlippage(input: string): string {
  const num = parseFloat(input);
  if (isNaN(num) || num < 0 || num > 100) {
    throw new SwapError(ERR_INVALID_PARAMS, `Invalid slippage: "${input}". Use 0-100 (percent).`);
  }
  // LiFi expects decimal fraction (0.005 = 0.5%)
  if (num >= 1) {
    return String(num / 100);
  }
  // Already looks like a decimal fraction
  return String(num);
}

function resolveAccountStrict(ctx: AppContext, target?: string): AccountInfo {
  const identifier =
    target ?? ctx.account.currentAccount?.alias ?? ctx.account.currentAccount?.address;
  if (!identifier) {
    throw new SwapError(ERR_ACCOUNT_NOT_READY, 'No account selected.', {
      hint: 'Specify an alias/address or create an account first.',
    });
  }

  const account = ctx.account.resolveAccount(identifier);
  if (!account) {
    throw new SwapError(ERR_ACCOUNT_NOT_READY, `Account "${identifier}" not found.`, {
      identifier,
    });
  }
  return account;
}

function resolveChainStrict(ctx: AppContext, chainId: number): ChainConfig {
  const chain = ctx.chain.chains.find((c) => c.id === chainId);
  if (!chain) {
    throw new SwapError(ERR_ACCOUNT_NOT_READY, `Chain ${chainId} not configured.`, { chainId });
  }
  return chain;
}

/**
 * Format an atomic token amount to a human-readable string.
 * E.g. "1000000" with 6 decimals → "1.0"
 */
function formatTokenAmount(amount: string, decimals: number): string {
  try {
    return formatUnits(BigInt(amount), decimals);
  } catch {
    return amount;
  }
}
