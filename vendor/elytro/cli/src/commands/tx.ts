import { Command } from 'commander';
import ora from 'ora';
import { isAddress, isHex, formatEther, parseEther, toHex } from 'viem';
import type { Address, Hex } from 'viem';
import type { AppContext } from '../context';
import type { ElytroUserOperation, AccountInfo, ChainConfig } from '../types';
import { requestSponsorship, applySponsorToUserOp } from '../utils/sponsor';
import {
  sanitizeErrorMessage,
  outputResult,
  outputError,
  outputStderrJson,
  maskApiKeys,
} from '../utils/display';
import { SecurityHookService, createSignMessageForAuth } from '../services/securityHook';
import { savePendingOtpAndOutput } from '../services/pendingOtp';
import { serializeUserOpForPending } from '../utils/userOpSerialization';
import { SECURITY_HOOK_ADDRESS_MAP } from '../constants/securityHook';
import { checkRecoveryBlocked } from '../utils/recoveryGuard';

// ─── Error Codes (JSON-RPC / MCP convention) ──────────────────────────
//
//   -32602  Invalid params (bad --tx spec, missing required fields)
//   -32001  Insufficient balance
//   -32002  Account not ready (not initialized, not deployed, not found)
//   -32003  Sponsorship failed
//   -32004  Build / estimation failed
//   -32005  Sign / send failed
//   -32006  Execution reverted (UserOp included but reverted on-chain)
//   -32000  Unknown / internal error

const ERR_INVALID_PARAMS = -32602;
const ERR_INSUFFICIENT_BALANCE = -32001;
const ERR_ACCOUNT_NOT_READY = -32002;
const ERR_SPONSOR_FAILED = -32003;
const ERR_BUILD_FAILED = -32004;
const ERR_SEND_FAILED = -32005;
const ERR_EXECUTION_REVERTED = -32006;
const ERR_INTERNAL = -32000;

/**
 * Structured error for tx commands.
 * Carries a JSON-RPC-style error code and optional data context.
 */
class TxError extends Error {
  code: number;
  data?: Record<string, unknown>;

  constructor(code: number, message: string, data?: Record<string, unknown>) {
    super(message);
    this.name = 'TxError';
    this.code = code;
    this.data = data;
  }
}

/**
 * Unified error handler for all tx subcommands.
 * Outputs structured JSON to stderr.
 */
function handleTxError(err: unknown): void {
  if (err instanceof TxError) {
    outputError(err.code, err.message, err.data);
  } else {
    outputError(ERR_INTERNAL, (err as Error).message ?? String(err));
  }
}

// ─── Types ────────────────────────────────────────────────────────────

/**
 * A single transaction parsed from --tx flag.
 * Mirrors eth_sendTransaction params (minus from/nonce/gas which are handled by the pipeline).
 */
interface TxSpec {
  to: Address;
  value?: string; // human-readable ETH amount (e.g. "0.1")
  data?: Hex; // calldata hex
}

/**
 * Transaction type detected from parsed tx specs.
 * - Single tx with only value → 'eth-transfer'
 * - Single tx with data → 'contract-call'
 * - Multiple txs → 'batch'
 */
type TxType = 'eth-transfer' | 'contract-call' | 'batch';

// ─── --tx Parser & Validator ──────────────────────────────────────────

/**
 * Parse a --tx spec string into a TxSpec object.
 *
 * Format: "to:0xAddr,value:0.1,data:0xAbcDef"
 *   - `to` is required
 *   - `value` and `data` are optional, but at least one must be present
 *
 * @param spec  Raw string from CLI --tx flag
 * @param index 0-based position (for error messages)
 * @returns     Validated TxSpec
 */
function parseTxSpec(spec: string, index: number): TxSpec {
  const prefix = `--tx #${index + 1}`;
  const fields: Record<string, string> = {};

  for (const part of spec.split(',')) {
    const colonIdx = part.indexOf(':');
    if (colonIdx === -1) {
      throw new TxError(
        ERR_INVALID_PARAMS,
        `${prefix}: invalid segment "${part}". Expected key:value format.`,
        {
          spec,
          index,
        },
      );
    }
    const key = part.slice(0, colonIdx).trim().toLowerCase();
    const val = part.slice(colonIdx + 1).trim();
    if (!key || !val) {
      throw new TxError(ERR_INVALID_PARAMS, `${prefix}: empty key or value in "${part}".`, {
        spec,
        index,
      });
    }
    if (fields[key]) {
      throw new TxError(ERR_INVALID_PARAMS, `${prefix}: duplicate key "${key}".`, {
        spec,
        index,
        key,
      });
    }
    fields[key] = val;
  }

  const knownKeys = new Set(['to', 'value', 'data']);
  for (const key of Object.keys(fields)) {
    if (!knownKeys.has(key)) {
      throw new TxError(
        ERR_INVALID_PARAMS,
        `${prefix}: unknown key "${key}". Allowed: to, value, data.`,
        {
          spec,
          index,
          key,
        },
      );
    }
  }

  if (!fields.to) {
    throw new TxError(ERR_INVALID_PARAMS, `${prefix}: "to" is required.`, { spec, index });
  }
  if (!isAddress(fields.to)) {
    throw new TxError(ERR_INVALID_PARAMS, `${prefix}: invalid address "${fields.to}".`, {
      spec,
      index,
      to: fields.to,
    });
  }

  if (!fields.value && !fields.data) {
    throw new TxError(
      ERR_INVALID_PARAMS,
      `${prefix}: at least one of "value" or "data" is required.`,
      { spec, index },
    );
  }

  if (fields.value) {
    try {
      const wei = parseEther(fields.value);
      if (wei < 0n) throw new Error('negative');
    } catch {
      throw new TxError(
        ERR_INVALID_PARAMS,
        `${prefix}: invalid ETH amount "${fields.value}". Use human-readable format (e.g. "0.1").`,
        { spec, index, value: fields.value },
      );
    }
  }

  if (fields.data) {
    if (!isHex(fields.data)) {
      throw new TxError(
        ERR_INVALID_PARAMS,
        `${prefix}: invalid hex in "data". Must start with 0x.`,
        {
          spec,
          index,
          data: fields.data,
        },
      );
    }
    if (fields.data.length > 2 && fields.data.length % 2 !== 0) {
      throw new TxError(
        ERR_INVALID_PARAMS,
        `${prefix}: "data" hex must have even length (complete bytes).`,
        {
          spec,
          index,
          data: fields.data,
        },
      );
    }
  }

  return {
    to: fields.to as Address,
    value: fields.value,
    data: fields.data as Hex | undefined,
  };
}

function detectTxType(specs: TxSpec[]): TxType {
  if (specs.length > 1) return 'batch';
  const tx = specs[0];
  if (tx.data && tx.data !== '0x') return 'contract-call';
  return 'eth-transfer';
}

function specsToTxs(specs: TxSpec[]): Array<{ to: string; value?: string; data?: string }> {
  return specs.map((s) => ({
    to: s.to,
    value: s.value ? toHex(parseEther(s.value)) : '0x0',
    data: s.data ?? '0x',
  }));
}

function totalEthValue(specs: TxSpec[]): bigint {
  let sum = 0n;
  for (const s of specs) {
    if (s.value) sum += parseEther(s.value);
  }
  return sum;
}

// ─── Display Helpers ──────────────────────────────────────────────────

function txTypeLabel(txType: TxType): string {
  switch (txType) {
    case 'eth-transfer':
      return 'ETH Transfer';
    case 'contract-call':
      return 'Contract Call';
    case 'batch':
      return 'Batch Transaction';
  }
}

function specToJson(spec: TxSpec): Record<string, unknown> {
  return {
    to: spec.to,
    ...(spec.value ? { value: spec.value } : {}),
    ...(spec.data && spec.data !== '0x'
      ? { data: spec.data, selector: spec.data.length >= 10 ? spec.data.slice(0, 10) : spec.data }
      : {}),
  };
}

// ─── Command Registration ─────────────────────────────────────────────

/**
 * `elytro tx` — Build, simulate, and send UserOperations.
 *
 * All subcommands use --tx flag(s) to specify transactions.
 * Multiple --tx flags are ordered and packed into a single UserOp (executeBatch).
 *
 * Format: --tx "to:0xAddr,value:0.1,data:0xAbcDef"
 */
export function registerTxCommand(program: Command, ctx: AppContext): void {
  const tx = program.command('tx').description('Build, simulate, and send transactions');

  // ─── build ──────────────────────────────────────────────────────

  tx.command('build')
    .description('Build an unsigned UserOp from transaction parameters')
    .argument('[account]', 'Source account alias or address (default: current)')
    .option(
      '--tx <spec...>',
      'Transaction spec: "to:0xAddr,value:0.1,data:0x..." (repeatable, ordered)',
    )
    .option('--no-sponsor', 'Skip sponsorship check')
    .action(async (target?: string, opts?: { tx?: string[]; sponsor?: boolean }) => {
      try {
        const specs = parseAllTxSpecs(opts?.tx);
        const { userOp, accountInfo, chainConfig, sponsored, txType } = await buildUserOp(
          ctx,
          target,
          specs,
          opts?.sponsor,
        );

        outputResult({
          userOp: serializeUserOp(userOp),
          account: accountInfo.alias,
          address: accountInfo.address,
          chain: chainConfig.name,
          chainId: chainConfig.id,
          txType: txTypeLabel(txType),
          ...(txType === 'batch' ? { txCount: specs.length } : {}),
          sponsored,
        });
      } catch (err) {
        handleTxError(err);
      }
    });

  // ─── send ───────────────────────────────────────────────────────

  tx.command('send')
    .description('Send a transaction on-chain')
    .argument('[account]', 'Source account alias or address (default: current)')
    .option(
      '--tx <spec...>',
      'Transaction spec: "to:0xAddr,value:0.1,data:0x..." (repeatable, ordered)',
    )
    .option('--no-sponsor', 'Skip sponsorship check')
    .option('--no-hook', 'Skip SecurityHook signing (bypass 2FA)')
    .option('--userop <json>', 'Send a pre-built UserOp JSON (skips build step)')
    .action(
      async (
        target?: string,
        opts?: { tx?: string[]; sponsor?: boolean; hook?: boolean; userop?: string },
      ) => {
        if (!ctx.keyring.isUnlocked) {
          handleTxError(
            new TxError(ERR_ACCOUNT_NOT_READY, 'Wallet not initialized. Run `elytro init` first.'),
          );
          return;
        }

        // Recovery guard: block write operations on accounts being recovered
        const currentAcct = ctx.account.currentAccount;
        if (currentAcct && checkRecoveryBlocked(currentAcct)) return;

        try {
          let userOp: ElytroUserOperation;
          let accountInfo: AccountInfo;
          let chainConfig: ChainConfig;
          let sponsored: boolean;
          let txType: TxType = 'contract-call';
          let specs: TxSpec[] = [];

          if (opts?.userop) {
            userOp = deserializeUserOp(opts.userop);
            sponsored = !!userOp.paymaster;

            const identifier =
              target ?? ctx.account.currentAccount?.alias ?? ctx.account.currentAccount?.address;
            if (!identifier) {
              throw new TxError(ERR_ACCOUNT_NOT_READY, 'No account selected.', {
                hint: 'Specify an alias/address or create an account first.',
              });
            }
            accountInfo = resolveAccountStrict(ctx, identifier);
            chainConfig = resolveChainStrict(ctx, accountInfo.chainId);

            await ctx.sdk.initForChain(chainConfig);
            ctx.walletClient.initForChain(chainConfig);
          } else {
            specs = parseAllTxSpecs(opts?.tx);
            const result = await buildUserOp(ctx, target, specs, opts?.sponsor);
            userOp = result.userOp;
            accountInfo = result.accountInfo;
            chainConfig = result.chainConfig;
            sponsored = result.sponsored;
            txType = result.txType;
          }

          // ── Summary to stderr (agents: obtain user approval before running tx send — see references/commands.md)
          const estimatedGas =
            userOp.callGasLimit + userOp.verificationGasLimit + userOp.preVerificationGas;
          outputStderrJson({
            summary: {
              txType: txTypeLabel(txType),
              from: accountInfo.alias,
              address: accountInfo.address,
              transactions: specs.map((s, i) => specToJson(s)),
              sponsored,
              estimatedGas: estimatedGas.toString(),
            },
          });

          // ── Sign + Send + Wait ──
          const spinner = ora('Signing UserOperation...').start();

          let opHash: Hex;
          try {
            const { packedHash, validationData } = await ctx.sdk.getUserOpHash(userOp);
            const rawSignature = await ctx.keyring.signDigest(packedHash);

            // Check if SecurityHook is installed and signing is needed
            const useHook = opts?.hook !== false; // --no-hook disables
            let hookSigned = false;

            if (useHook) {
              const hookAddress = SECURITY_HOOK_ADDRESS_MAP[accountInfo.chainId];
              if (hookAddress) {
                // Create a temporary hook service to check status
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

                spinner.text = 'Checking SecurityHook status...';
                const hookStatus = await hookService.getHookStatus(
                  accountInfo.address,
                  accountInfo.chainId,
                );

                if (hookStatus.installed && hookStatus.capabilities.preUserOpValidation) {
                  // Pre-sign: pack signature without hook first for authorization request
                  userOp.signature = await ctx.sdk.packUserOpSignature(
                    rawSignature,
                    validationData,
                  );

                  spinner.text = 'Requesting hook authorization...';
                  let hookResult = await hookService.getHookSignature(
                    accountInfo.address,
                    accountInfo.chainId,
                    ctx.sdk.entryPoint,
                    userOp,
                  );

                  // Handle OTP challenge
                  if (hookResult.error) {
                    spinner.stop();
                    const errCode = hookResult.error.code;

                    if (errCode === 'OTP_REQUIRED' || errCode === 'SPENDING_LIMIT_EXCEEDED') {
                      // Interactive OTP challenge info
                      if (!hookResult.error.challengeId) {
                        const otpRequestSpinner = ora('Requesting OTP challenge...').start();
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
                          otpRequestSpinner.stop();
                        } catch (otpErr) {
                          otpRequestSpinner.fail('Failed to request OTP challenge.');
                          throw new TxError(
                            ERR_SEND_FAILED,
                            `Unable to request OTP challenge: ${(otpErr as Error).message}`,
                          );
                        }
                      }

                      if (!hookResult.error.challengeId) {
                        throw new TxError(
                          ERR_SEND_FAILED,
                          'OTP challenge ID was not provided by Elytro API. Please try again.',
                        );
                      }

                      // Deferred OTP: save pending and exit (persist authSessionId for session-bound challenge)
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
                          txSpec: opts?.tx,
                        },
                      });
                      return;
                    } else {
                      throw new TxError(
                        ERR_SEND_FAILED,
                        `Hook authorization failed: ${hookResult.error.message ?? errCode}`,
                      );
                    }
                  }

                  // Pack signature with hook data
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

            // Standard signing (no hook or hook not installed)
            if (!hookSigned) {
              userOp.signature = await ctx.sdk.packUserOpSignature(rawSignature, validationData);
            }

            spinner.text = 'Sending to bundler...';
            opHash = await ctx.sdk.sendUserOp(userOp);
          } catch (err) {
            spinner.stop();
            throw new TxError(ERR_SEND_FAILED, (err as Error).message, {
              sender: accountInfo.address,
              chain: chainConfig.name,
            });
          }

          spinner.text = 'Waiting for on-chain confirmation...';
          const receipt = await ctx.sdk.waitForReceipt(opHash);

          spinner.stop();

          if (receipt.success) {
            outputResult({
              status: 'confirmed',
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
              'UserOp included but execution reverted on-chain.',
              {
                transactionHash: receipt.transactionHash,
                block: receipt.blockNumber,
                gasCost: `${formatEther(BigInt(receipt.actualGasCost))} ETH`,
                sender: accountInfo.address,
              },
            );
          }
        } catch (err) {
          handleTxError(err);
        }
      },
    );

  // ─── simulate ───────────────────────────────────────────────────

  tx.command('simulate')
    .description('Preview a transaction (gas estimate, sponsor check)')
    .argument('[account]', 'Source account alias or address (default: current)')
    .option(
      '--tx <spec...>',
      'Transaction spec: "to:0xAddr,value:0.1,data:0x..." (repeatable, ordered)',
    )
    .option('--no-sponsor', 'Skip sponsorship check')
    .action(async (target?: string, opts?: { tx?: string[]; sponsor?: boolean }) => {
      if (!ctx.keyring.isUnlocked) {
        handleTxError(
          new TxError(ERR_ACCOUNT_NOT_READY, 'Wallet not initialized. Run `elytro init` first.'),
        );
        return;
      }

      try {
        const specs = parseAllTxSpecs(opts?.tx);
        const { userOp, accountInfo, chainConfig, sponsored, txType } = await buildUserOp(
          ctx,
          target,
          specs,
          opts?.sponsor,
        );

        const { wei: ethBalance, ether: ethFormatted } = await ctx.walletClient.getBalance(
          accountInfo.address,
        );
        const nativeCurrency = chainConfig.nativeCurrency.symbol;

        const totalGas =
          userOp.callGasLimit + userOp.verificationGasLimit + userOp.preVerificationGas;
        const maxCostWei = totalGas * userOp.maxFeePerGas;
        const ethValueSum = totalEthValue(specs);

        // Build warnings array
        const warnings: string[] = [];
        if (ethValueSum > 0n && ethBalance < ethValueSum) {
          warnings.push(
            `Insufficient balance for value: need ${formatEther(ethValueSum)}, have ${ethFormatted} ${nativeCurrency}`,
          );
        }
        if (!sponsored && ethBalance < maxCostWei) {
          warnings.push(
            `Insufficient ${nativeCurrency} for gas: need ~${formatEther(maxCostWei)}, have ${ethFormatted}`,
          );
        }

        // Check if target is a contract (for single contract calls)
        let targetIsContract: boolean | undefined;
        if (txType === 'contract-call') {
          targetIsContract = await ctx.walletClient.isContractDeployed(specs[0].to);
          if (!targetIsContract) {
            warnings.push(
              'Target address has no deployed code. The call may be a no-op or revert.',
            );
          }
        }

        outputResult({
          txType: txTypeLabel(txType),
          account: accountInfo.alias,
          address: accountInfo.address,
          chain: chainConfig.name,
          chainId: chainConfig.id,
          transactions: specs.map((s) => specToJson(s)),
          ...(txType === 'contract-call' && targetIsContract !== undefined
            ? { targetIsContract }
            : {}),
          gas: {
            callGasLimit: userOp.callGasLimit.toString(),
            verificationGasLimit: userOp.verificationGasLimit.toString(),
            preVerificationGas: userOp.preVerificationGas.toString(),
            maxFeePerGas: userOp.maxFeePerGas.toString(),
            maxPriorityFeePerGas: userOp.maxPriorityFeePerGas.toString(),
            maxCost: `${formatEther(maxCostWei)} ${nativeCurrency}`,
          },
          sponsored,
          ...(sponsored && userOp.paymaster ? { paymaster: userOp.paymaster } : {}),
          balance: `${ethFormatted} ${nativeCurrency}`,
          ...(warnings.length > 0 ? { warnings } : {}),
        });
      } catch (err) {
        handleTxError(err);
      }
    });
}

// ─── Shared Build Logic ──────────────────────────────────────────────

interface BuildResult {
  userOp: ElytroUserOperation;
  accountInfo: AccountInfo;
  chainConfig: ChainConfig;
  sponsored: boolean;
  txType: TxType;
}

function parseAllTxSpecs(rawSpecs: string[] | undefined): TxSpec[] {
  if (!rawSpecs || rawSpecs.length === 0) {
    throw new TxError(
      ERR_INVALID_PARAMS,
      'At least one --tx is required. Format: --tx "to:0xAddr,value:0.1"',
    );
  }
  return rawSpecs.map((spec, i) => parseTxSpec(spec, i));
}

/**
 * Shared UserOp build pipeline used by build, send, and simulate.
 */
async function buildUserOp(
  ctx: AppContext,
  target: string | undefined,
  specs: TxSpec[],
  sponsor?: boolean,
): Promise<BuildResult> {
  // 1. Resolve account
  const identifier =
    target ?? ctx.account.currentAccount?.alias ?? ctx.account.currentAccount?.address;
  if (!identifier) {
    throw new TxError(ERR_ACCOUNT_NOT_READY, 'No account selected.', {
      hint: 'Specify an alias/address or create an account first.',
    });
  }

  const accountInfo = resolveAccountStrict(ctx, identifier);
  const chainConfig = resolveChainStrict(ctx, accountInfo.chainId);

  if (!accountInfo.isDeployed) {
    throw new TxError(ERR_ACCOUNT_NOT_READY, `Account "${accountInfo.alias}" is not deployed.`, {
      account: accountInfo.alias,
      address: accountInfo.address,
      hint: 'Run `elytro account activate` first.',
    });
  }

  await ctx.sdk.initForChain(chainConfig);
  ctx.walletClient.initForChain(chainConfig);

  // 2. Balance pre-check
  const ethValueTotal = totalEthValue(specs);
  if (ethValueTotal > 0n) {
    const { wei: ethBalance } = await ctx.walletClient.getBalance(accountInfo.address);
    if (ethBalance < ethValueTotal) {
      const have = formatEther(ethBalance);
      const need = formatEther(ethValueTotal);
      throw new TxError(ERR_INSUFFICIENT_BALANCE, 'Insufficient ETH balance for transfer value.', {
        need: `${need} ETH`,
        have: `${have} ETH`,
        account: accountInfo.address,
        chain: chainConfig.name,
      });
    }
  }

  // 3. Create unsigned UserOp (txs order preserved)
  const txType = detectTxType(specs);
  const txs = specsToTxs(specs);

  const spinner = ora('Building UserOp...').start();

  let userOp: ElytroUserOperation;
  try {
    userOp = await ctx.sdk.createSendUserOp(accountInfo.address, txs);
  } catch (err) {
    spinner.stop();
    throw new TxError(ERR_BUILD_FAILED, `Failed to build UserOp: ${(err as Error).message}`, {
      account: accountInfo.address,
      chain: chainConfig.name,
    });
  }

  // 4. Gas prices
  spinner.text = 'Fetching gas prices...';
  const feeData = await ctx.sdk.getFeeData(chainConfig);
  userOp.maxFeePerGas = feeData.maxFeePerGas;
  userOp.maxPriorityFeePerGas = feeData.maxPriorityFeePerGas;

  // 5. Estimate gas
  spinner.text = 'Estimating gas...';
  try {
    const gasEstimate = await ctx.sdk.estimateUserOp(userOp, { fakeBalance: true });
    userOp.callGasLimit = gasEstimate.callGasLimit;
    userOp.verificationGasLimit = gasEstimate.verificationGasLimit;
    userOp.preVerificationGas = gasEstimate.preVerificationGas;
  } catch (err) {
    spinner.stop();
    throw new TxError(ERR_BUILD_FAILED, `Gas estimation failed: ${(err as Error).message}`, {
      account: accountInfo.address,
      chain: chainConfig.name,
    });
  }

  // 6. Sponsorship
  let sponsored = false;
  if (sponsor !== false) {
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
        throw new TxError(
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

  spinner.stop();
  return { userOp, accountInfo, chainConfig, sponsored, txType };
}

// ─── Helpers ─────────────────────────────────────────────────────────

function resolveAccountStrict(ctx: AppContext, identifier: string): AccountInfo {
  const account = ctx.account.resolveAccount(identifier);
  if (!account) {
    throw new TxError(ERR_ACCOUNT_NOT_READY, `Account "${identifier}" not found.`, { identifier });
  }
  return account;
}

function resolveChainStrict(ctx: AppContext, chainId: number): ChainConfig {
  const chain = ctx.chain.chains.find((c) => c.id === chainId);
  if (!chain) {
    throw new TxError(ERR_ACCOUNT_NOT_READY, `Chain ${chainId} not configured.`, { chainId });
  }
  return chain;
}

function serializeUserOp(op: ElytroUserOperation): Record<string, string | null> {
  return {
    sender: op.sender,
    nonce: toHex(op.nonce),
    factory: op.factory,
    factoryData: op.factoryData,
    callData: op.callData,
    callGasLimit: toHex(op.callGasLimit),
    verificationGasLimit: toHex(op.verificationGasLimit),
    preVerificationGas: toHex(op.preVerificationGas),
    maxFeePerGas: toHex(op.maxFeePerGas),
    maxPriorityFeePerGas: toHex(op.maxPriorityFeePerGas),
    paymaster: op.paymaster,
    paymasterVerificationGasLimit: op.paymasterVerificationGasLimit
      ? toHex(op.paymasterVerificationGasLimit)
      : null,
    paymasterPostOpGasLimit: op.paymasterPostOpGasLimit ? toHex(op.paymasterPostOpGasLimit) : null,
    paymasterData: op.paymasterData,
    signature: op.signature,
  };
}

function deserializeUserOp(json: string): ElytroUserOperation {
  let raw: Record<string, string | null>;
  try {
    raw = JSON.parse(json);
  } catch {
    throw new TxError(
      ERR_INVALID_PARAMS,
      'Invalid UserOp JSON. Pass a JSON-encoded UserOp object.',
      { json },
    );
  }

  if (!raw.sender || !raw.callData) {
    throw new TxError(
      ERR_INVALID_PARAMS,
      'Invalid UserOp: missing required fields (sender, callData).',
    );
  }

  return {
    sender: raw.sender as Address,
    nonce: BigInt(raw.nonce ?? '0x0'),
    factory: (raw.factory as Address) ?? null,
    factoryData: (raw.factoryData as Hex) ?? null,
    callData: raw.callData as Hex,
    callGasLimit: BigInt(raw.callGasLimit ?? '0x0'),
    verificationGasLimit: BigInt(raw.verificationGasLimit ?? '0x0'),
    preVerificationGas: BigInt(raw.preVerificationGas ?? '0x0'),
    maxFeePerGas: BigInt(raw.maxFeePerGas ?? '0x0'),
    maxPriorityFeePerGas: BigInt(raw.maxPriorityFeePerGas ?? '0x0'),
    paymaster: (raw.paymaster as Address) ?? null,
    paymasterVerificationGasLimit: raw.paymasterVerificationGasLimit
      ? BigInt(raw.paymasterVerificationGasLimit)
      : null,
    paymasterPostOpGasLimit: raw.paymasterPostOpGasLimit
      ? BigInt(raw.paymasterPostOpGasLimit)
      : null,
    paymasterData: (raw.paymasterData as Hex) ?? null,
    signature: (raw.signature as Hex) ?? '0x',
  };
}
