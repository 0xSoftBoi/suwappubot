import { Command } from 'commander';
import ora from 'ora';
import { isAddress } from 'viem';
import type { Address, Hex } from 'viem';
import { writeFileSync } from 'node:fs';
import type { AppContext } from '../context';
import type { ChainConfig } from '../types';
import { outputResult, outputError } from '../utils/display';
import { requestSponsorship, applySponsorToUserOp } from '../utils/sponsor';
import { SecurityHookService, createSignMessageForAuth } from '../services/securityHook';
import { savePendingOtpAndOutput } from '../services/pendingOtp';
import { serializeUserOpForPending } from '../utils/userOpSerialization';
import { SECURITY_HOOK_ADDRESS_MAP } from '../constants/securityHook';

const ERR_INVALID_PARAMS = -32602;
const ERR_ACCOUNT_NOT_READY = -32002;
const ERR_BUILD_FAILED = -32004;
const ERR_SEND_FAILED = -32005;
const ERR_INTERNAL = -32000;
const ERR_RECOVERY_BLOCKED = -32007;

/**
 * Register `elytro recovery` command and all subcommands.
 */
export function registerRecoveryCommand(program: Command, ctx: AppContext): void {
  const recovery = program.command('recovery').description('Social recovery management');

  // ─── recovery contacts ──────────────────────────────────────────

  const contacts = recovery.command('contacts').description('Guardian contacts management');

  // recovery contacts list
  contacts
    .command('list')
    .description('Query current on-chain guardian setup')
    .action(async () => {
      let spinner: ReturnType<typeof ora> | undefined;
      try {
        const account = requireCurrentAccount(ctx);
        spinner = ora('Querying recovery contacts...').start();

        const [contactsInfo, recoveryInfo] = await Promise.all([
          ctx.recovery.queryContacts(account.address),
          ctx.recovery.getRecoveryInfo(account.address),
        ]);

        spinner.stop();

        if (!contactsInfo || !contactsInfo.contacts.length) {
          outputResult({
            address: account.address,
            chainId: account.chainId,
            contacts: [],
            threshold: 0,
            contactsHash: recoveryInfo?.contactsHash ?? null,
            nonce: recoveryInfo ? Number(recoveryInfo.nonce) : 0,
            delayPeriod: recoveryInfo ? Number(recoveryInfo.delayPeriod) : 0,
          });
          return;
        }

        // Merge with local labels
        const labels = await ctx.recovery.getLocalLabels(account.address);
        const contactsList = contactsInfo.contacts.map((addr) => ({
          address: addr,
          ...(labels && labels[addr.toLowerCase()] ? { label: labels[addr.toLowerCase()] } : {}),
        }));

        outputResult({
          address: account.address,
          chainId: account.chainId,
          contacts: contactsList,
          threshold: contactsInfo.threshold,
          contactsHash: recoveryInfo?.contactsHash ?? null,
          nonce: recoveryInfo ? Number(recoveryInfo.nonce) : 0,
          delayPeriod: recoveryInfo ? Number(recoveryInfo.delayPeriod) : 0,
        });
      } catch (err) {
        spinner?.stop();
        outputError(ERR_INTERNAL, (err as Error).message);
      }
    });

  // recovery contacts set <addresses> --threshold N
  contacts
    .command('set <addresses>')
    .description('Set guardians and threshold (on-chain UserOp)')
    .requiredOption('--threshold <n>', 'Minimum signatures required', parseInt)
    .option('--label <labels>', 'Labels as "addr=name,addr=name"')
    .option('--privacy', 'Privacy mode: skip InfoRecorder plaintext storage')
    .option('--sponsor', 'Request paymaster sponsorship')
    .option('--no-hook', 'Skip SecurityHook authorization')
    .action(async (addressesArg: string, opts) => {
      let spinner: ReturnType<typeof ora> | undefined;
      try {
        const account = requireCurrentAccount(ctx);

        // Recovery guard: block if account is being recovered
        const guard = await ctx.recovery.recoveryGuard(account, 'write');
        if (guard.blocked) {
          outputRecoveryBlocked(account, guard.recoveryInfo);
          return;
        }

        // Parse addresses
        const addresses = addressesArg.split(',').map((a) => a.trim()) as Address[];
        for (const addr of addresses) {
          if (!isAddress(addr)) {
            outputError(ERR_INVALID_PARAMS, `Invalid address: ${addr}`);
            return;
          }
        }

        const threshold = opts.threshold as number;
        if (threshold < 1 || threshold > addresses.length) {
          outputError(ERR_INVALID_PARAMS, `Threshold must be between 1 and ${addresses.length}.`);
          return;
        }

        // Initialize chain before on-chain checks
        const chainConfig = resolveChainStrict(ctx, account.chainId);
        await ctx.sdk.initForChain(chainConfig);
        ctx.walletClient.initForChain(chainConfig);

        // Verify deployment on-chain (local isDeployed flag can be stale)
        const deployedOnChain = await ctx.walletClient.isContractDeployed(account.address);
        if (!deployedOnChain) {
          outputError(
            ERR_ACCOUNT_NOT_READY,
            `Account "${account.alias}" is not deployed on chain ${account.chainId}. Run \`elytro account activate\` first.`,
          );
          return;
        }

        // Check if hash actually changes
        const currentInfo = await ctx.recovery.getRecoveryInfo(account.address);
        const newHash = ctx.recovery.calculateContactsHash(
          addresses.map((a) => a.toLowerCase()),
          threshold,
        );
        if (currentInfo && currentInfo.contactsHash === newHash) {
          outputResult({
            message: 'No changes needed. Guardian configuration is already up to date.',
            contacts: addresses,
            threshold,
            contactsHash: newHash,
          });
          return;
        }

        // Generate transactions
        const txs = ctx.recovery.generateSetContactsTxs(addresses, threshold, !!opts.privacy);

        spinner = ora('Building UserOperation...').start();

        let userOp = await ctx.sdk.createSendUserOp(account.address, txs);
        const feeData = await ctx.sdk.getFeeData(chainConfig);
        userOp.maxFeePerGas = feeData.maxFeePerGas;
        userOp.maxPriorityFeePerGas = feeData.maxPriorityFeePerGas;

        // Estimate gas
        const gasLimits = await ctx.sdk.estimateUserOp(userOp);
        userOp.callGasLimit = gasLimits.callGasLimit;
        userOp.verificationGasLimit = gasLimits.verificationGasLimit;
        userOp.preVerificationGas = gasLimits.preVerificationGas;
        userOp.paymasterVerificationGasLimit = gasLimits.paymasterVerificationGasLimit;
        userOp.paymasterPostOpGasLimit = gasLimits.paymasterPostOpGasLimit;

        // Sponsor
        let sponsored = false;
        if (opts.sponsor !== false) {
          try {
            spinner.text = 'Requesting sponsorship...';
            const { sponsor: sponsorResult } = await requestSponsorship(
              ctx.chain.graphqlEndpoint,
              account.chainId,
              ctx.sdk.entryPoint,
              userOp,
            );
            if (sponsorResult) {
              applySponsorToUserOp(userOp, sponsorResult);
              sponsored = true;
            }
          } catch {
            // Sponsorship failed, continue without
          }
        }

        // Sign
        spinner.text = 'Signing UserOperation...';
        const { packedHash, validationData } = await ctx.sdk.getUserOpHash(userOp);
        const rawSignature = await ctx.keyring.signDigest(packedHash);

        // Hook check
        let hookSigned = false;
        if (opts.hook !== false) {
          const hookResult = await tryHookSign(
            ctx,
            account,
            chainConfig,
            userOp,
            rawSignature,
            validationData,
            spinner,
          );
          if (hookResult === 'deferred') return; // OTP deferred
          if (hookResult === 'signed') hookSigned = true;
        }

        if (!hookSigned) {
          userOp.signature = await ctx.sdk.packUserOpSignature(rawSignature, validationData);
        }

        // Send
        spinner.text = 'Sending to bundler...';
        const opHash = await ctx.sdk.sendUserOp(userOp);

        spinner.text = 'Waiting for on-chain confirmation...';
        const receipt = await ctx.sdk.waitForReceipt(opHash);
        spinner.stop();

        // Save labels
        if (opts.label) {
          const labelsMap: Record<string, string> = {};
          for (const pair of (opts.label as string).split(',')) {
            const [addr, name] = pair.split('=');
            if (addr && name) {
              labelsMap[addr.trim().toLowerCase()] = name.trim();
            }
          }
          await ctx.recovery.saveLocalLabels(account.address, labelsMap);
        }

        // Update account state
        await ctx.account.updateActiveRecoveryEnabled(account.address, account.chainId, true);

        outputResult({
          txHash: receipt.transactionHash,
          userOpHash: opHash,
          contacts: addresses,
          threshold,
          contactsHash: newHash,
          sponsored,
          success: receipt.success,
        });
      } catch (err) {
        spinner?.stop();
        outputError(ERR_INTERNAL, (err as Error).message);
      }
    });

  // recovery contacts clear
  contacts
    .command('clear')
    .description('Clear all guardians (on-chain UserOp)')
    .option('--sponsor', 'Request paymaster sponsorship')
    .option('--no-hook', 'Skip SecurityHook authorization')
    .action(async (opts) => {
      let spinner: ReturnType<typeof ora> | undefined;
      try {
        const account = requireCurrentAccount(ctx);

        const guard = await ctx.recovery.recoveryGuard(account, 'write');
        if (guard.blocked) {
          outputRecoveryBlocked(account, guard.recoveryInfo);
          return;
        }

        const chainConfig = resolveChainStrict(ctx, account.chainId);
        await ctx.sdk.initForChain(chainConfig);
        ctx.walletClient.initForChain(chainConfig);

        // Verify deployment on-chain (local isDeployed flag can be stale)
        const deployedOnChain = await ctx.walletClient.isContractDeployed(account.address);
        if (!deployedOnChain) {
          outputError(
            ERR_ACCOUNT_NOT_READY,
            `Account "${account.alias}" is not deployed on chain ${account.chainId}.`,
          );
          return;
        }

        const txs = ctx.recovery.generateClearContactsTxs();

        spinner = ora('Building UserOperation...').start();

        let userOp = await ctx.sdk.createSendUserOp(account.address, txs);
        const feeData = await ctx.sdk.getFeeData(chainConfig);
        userOp.maxFeePerGas = feeData.maxFeePerGas;
        userOp.maxPriorityFeePerGas = feeData.maxPriorityFeePerGas;

        const gasLimits = await ctx.sdk.estimateUserOp(userOp);
        userOp.callGasLimit = gasLimits.callGasLimit;
        userOp.verificationGasLimit = gasLimits.verificationGasLimit;
        userOp.preVerificationGas = gasLimits.preVerificationGas;
        userOp.paymasterVerificationGasLimit = gasLimits.paymasterVerificationGasLimit;
        userOp.paymasterPostOpGasLimit = gasLimits.paymasterPostOpGasLimit;

        let sponsored = false;
        if (opts.sponsor !== false) {
          try {
            spinner.text = 'Requesting sponsorship...';
            const { sponsor: sponsorResult } = await requestSponsorship(
              ctx.chain.graphqlEndpoint,
              account.chainId,
              ctx.sdk.entryPoint,
              userOp,
            );
            if (sponsorResult) {
              applySponsorToUserOp(userOp, sponsorResult);
              sponsored = true;
            }
          } catch {}
        }

        spinner.text = 'Signing UserOperation...';
        const { packedHash, validationData } = await ctx.sdk.getUserOpHash(userOp);
        const rawSignature = await ctx.keyring.signDigest(packedHash);

        let hookSigned = false;
        if (opts.hook !== false) {
          const hookResult = await tryHookSign(
            ctx,
            account,
            chainConfig,
            userOp,
            rawSignature,
            validationData,
            spinner,
          );
          if (hookResult === 'deferred') return;
          if (hookResult === 'signed') hookSigned = true;
        }

        if (!hookSigned) {
          userOp.signature = await ctx.sdk.packUserOpSignature(rawSignature, validationData);
        }

        spinner.text = 'Sending to bundler...';
        const opHash = await ctx.sdk.sendUserOp(userOp);

        spinner.text = 'Waiting for on-chain confirmation...';
        const receipt = await ctx.sdk.waitForReceipt(opHash);
        spinner.stop();

        await ctx.account.updateActiveRecoveryEnabled(account.address, account.chainId, false);

        outputResult({
          txHash: receipt.transactionHash,
          userOpHash: opHash,
          cleared: true,
          sponsored,
          success: receipt.success,
        });
      } catch (err) {
        spinner?.stop();
        outputError(ERR_INTERNAL, (err as Error).message);
      }
    });

  // ─── recovery backup ────────────────────────────────────────────

  const backup = recovery.command('backup').description('Backup and import recovery files');

  // recovery backup export
  backup
    .command('export')
    .description('Export recovery backup JSON')
    .option('--output <path>', 'Write to file instead of stdout')
    .action(async (opts) => {
      let spinner: ReturnType<typeof ora> | undefined;
      try {
        const account = requireCurrentAccount(ctx);
        spinner = ora('Exporting recovery backup...').start();

        const backupData = await ctx.recovery.exportBackup(account.address, account.chainId);
        spinner.stop();

        const json = JSON.stringify(backupData, null, 2);

        if (opts.output) {
          writeFileSync(opts.output as string, json, 'utf-8');
          outputResult({
            exported: true,
            path: opts.output,
            address: backupData.address,
            contactCount: backupData.contacts.length,
            threshold: backupData.threshold,
          });
        } else {
          // Output as structured result for pipe-friendliness
          outputResult({
            exported: true,
            backup: backupData,
          });
        }
      } catch (err) {
        spinner?.stop();
        outputError(ERR_INTERNAL, (err as Error).message);
      }
    });

  // recovery backup import <file>
  backup
    .command('import <file>')
    .description('Import recovery backup JSON')
    .action(async (filePath: string) => {
      try {
        const backupData = ctx.recovery.parseBackupFile(filePath);

        // Save labels from backup
        const labels: Record<string, string> = {};
        for (const contact of backupData.contacts) {
          if (contact.label) {
            labels[contact.address.toLowerCase()] = contact.label;
          }
        }
        if (Object.keys(labels).length > 0) {
          await ctx.recovery.saveLocalLabels(backupData.address, labels);
        }

        outputResult({
          imported: true,
          address: backupData.address,
          chainId: backupData.chainId,
          contacts: backupData.contacts,
          threshold: backupData.threshold,
        });
      } catch (err) {
        outputError(ERR_INTERNAL, (err as Error).message);
      }
    });

  // ─── recovery initiate ──────────────────────────────────────────

  recovery
    .command('initiate <wallet-address>')
    .description('Initiate recovery for a wallet address')
    .requiredOption('--chain <id>', 'Target chain ID', parseInt)
    .option('--from-backup <file>', 'Use backup file instead of on-chain query')
    .action(async (walletAddress: string, opts) => {
      let spinner: ReturnType<typeof ora> | undefined;
      try {
        if (!isAddress(walletAddress)) {
          outputError(ERR_INVALID_PARAMS, `Invalid wallet address: ${walletAddress}`);
          return;
        }

        if (!ctx.keyring.isUnlocked) {
          outputError(
            ERR_ACCOUNT_NOT_READY,
            'Keyring is locked. Run `elytro init` first to create a local key.',
          );
          return;
        }

        const chainId = opts.chain as number;
        const chainConfig = ctx.chain.chains.find((c) => c.id === chainId);
        if (!chainConfig) {
          outputError(ERR_INVALID_PARAMS, `Chain ${chainId} is not configured.`);
          return;
        }

        // Initialize SDK for the target chain
        await ctx.sdk.initForChain(chainConfig);
        ctx.walletClient.initForChain(chainConfig);

        spinner = ora('Initiating recovery...').start();

        const result = await ctx.recovery.initiateRecovery({
          walletAddress: walletAddress as Address,
          chainId,
          fromBackup: opts.fromBackup as string | undefined,
        });

        spinner.stop();

        outputResult({
          walletAddress: result.walletAddress,
          chainId: result.chainId,
          recoveryId: result.recoveryId,
          contacts: result.contacts,
          threshold: result.threshold,
          recoveryUrl: result.recoveryUrl,
          ...(result.recoveryRecordID && { recoveryRecordID: result.recoveryRecordID }),
        });
      } catch (err) {
        spinner?.stop();
        outputError(ERR_INTERNAL, (err as Error).message);
      }
    });

  // ─── recovery status ────────────────────────────────────────────

  recovery
    .command('status')
    .description('Query recovery progress (read-only)')
    .option('--wallet <address>', 'Wallet address (defaults to local record)')
    .option('--recovery-id <hex>', 'Recovery ID (defaults to local record)')
    .action(async (opts) => {
      let spinner: ReturnType<typeof ora> | undefined;
      try {
        // Load local record first so we can initialize SDK for the correct chain
        const localRecord = await ctx.recovery.getLocalRecoveryRecord();

        if (opts.wallet || opts.recoveryId) {
          // Manual query mode -- need both params
          if (!opts.wallet || !opts.recoveryId) {
            outputError(
              ERR_INVALID_PARAMS,
              'Both --wallet and --recovery-id are required for manual query.',
            );
            return;
          }

          if (
            !localRecord ||
            localRecord.walletAddress.toLowerCase() !== (opts.wallet as string).toLowerCase() ||
            localRecord.recoveryId !== opts.recoveryId
          ) {
            outputError(
              ERR_INVALID_PARAMS,
              'No matching local record found. Run `recovery initiate` first to create a recovery record for this wallet.',
            );
            return;
          }
        } else if (!localRecord) {
          outputError(
            ERR_INVALID_PARAMS,
            'No local recovery record found. Use --wallet and --recovery-id, or run `recovery initiate` first.',
          );
          return;
        }

        // Initialize SDK for the recovery record's chain to ensure we query the correct RPC
        const chainConfig = resolveChainStrict(ctx, localRecord!.chainId);
        await ctx.sdk.initForChain(chainConfig);

        spinner = ora('Querying recovery status...').start();

        let statusResult = await ctx.recovery.queryRecoveryStatusFromLocal();

        spinner.stop();

        // Handle completion
        await ctx.recovery.handleRecoveryCompletion(statusResult);

        // Build context-aware suggestion based on recovery status
        const suggestion: Array<{ action: string; description: string }> = [];
        switch (statusResult.status) {
          case 'WAITING_FOR_SIGNATURE':
            suggestion.push(
              {
                action: `Open ${statusResult.recoveryUrl}`,
                description: `Share approval link with guardians (${statusResult.signedCount}/${statusResult.threshold} signed)`,
              },
              {
                action: 'recovery status',
                description: 'Refresh to check for new guardian approvals',
              },
            );
            break;
          case 'SIGNATURE_COMPLETED':
            suggestion.push({
              action: `Open ${statusResult.recoveryUrl}`,
              description:
                'All signatures collected. Submit recovery transaction to start the delay period',
            });
            break;
          case 'RECOVERY_STARTED':
            suggestion.push({
              action: 'recovery status',
              description: `Recovery submitted. Delay period: ${formatRemaining(statusResult.remainingSeconds)} remaining before execution`,
            });
            break;
          case 'RECOVERY_READY':
            suggestion.push({
              action: `Open ${statusResult.recoveryUrl}`,
              description: 'Delay period passed. Execute recovery to transfer ownership now',
            });
            break;
          case 'RECOVERY_COMPLETED':
            suggestion.push({
              action: 'account list',
              description:
                'Recovery completed. The recovered wallet is now controlled by your local key',
            });
            break;
        }

        outputResult({
          walletAddress: statusResult.walletAddress,
          status: statusResult.status,
          contacts: statusResult.contacts,
          signedCount: statusResult.signedCount,
          threshold: statusResult.threshold,
          recoveryUrl: statusResult.recoveryUrl,
          validTime: statusResult.validTime,
          remainingSeconds: statusResult.remainingSeconds,
          suggestion,
        });
      } catch (err) {
        spinner?.stop();
        outputError(ERR_INTERNAL, (err as Error).message);
      }
    });
}

// ─── Helpers ──────────────────────────────────────────────────────

function requireCurrentAccount(ctx: AppContext) {
  const account = ctx.account.currentAccount;
  if (!account) {
    throw new Error(
      'No active account. Use `elytro account switch` or create one with `elytro account create`.',
    );
  }
  return account;
}

function resolveChainStrict(ctx: AppContext, chainId: number): ChainConfig {
  const chain = ctx.chain.chains.find((c) => c.id === chainId);
  if (!chain) {
    throw new Error(`Chain ${chainId} not configured.`);
  }
  return chain;
}

function formatRemaining(seconds: number | null): string {
  if (seconds == null || seconds <= 0) return '0s';
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (h > 0) return m > 0 ? `${h}h ${m}m` : `${h}h`;
  if (m > 0) return `${m}m`;
  return `${seconds}s`;
}

function outputRecoveryBlocked(
  account: {
    alias: string;
    address: Address;
    activeRecovery?: { status: string; recoveryId: string } | null;
  },
  recoveryInfo?: typeof account.activeRecovery,
): never {
  outputError(
    -32007,
    `Account ${account.alias} (${account.address}) is being recovered. Write operations are blocked.`,
    {
      ...(recoveryInfo && { recoveryStatus: recoveryInfo.status }),
      suggestion:
        'Run `elytro recovery status` to check progress, or `elytro account switch` to use a different account.',
    },
  );
}

/**
 * Try SecurityHook signing. Returns 'signed', 'deferred' (OTP), or 'none'.
 */
async function tryHookSign(
  ctx: AppContext,
  account: { address: Address; chainId: number },
  _chainConfig: ChainConfig,
  userOp: import('../types').ElytroUserOperation,
  rawSignature: Hex,
  validationData: Hex,
  spinner: ReturnType<typeof ora>,
): Promise<'signed' | 'deferred' | 'none'> {
  const hookAddress = SECURITY_HOOK_ADDRESS_MAP[account.chainId];
  if (!hookAddress) return 'none';

  const hookService = new SecurityHookService({
    store: ctx.store,
    graphqlEndpoint: ctx.chain.graphqlEndpoint,
    signMessageForAuth: createSignMessageForAuth({
      signDigest: (digest) => ctx.keyring.signDigest(digest),
      packRawHash: (hash) => ctx.sdk.packRawHash(hash),
      packSignature: (rawSig, valData) => ctx.sdk.packUserOpSignature(rawSig, valData),
    }),
    readContract: async (params) =>
      ctx.walletClient.readContract(params as Parameters<typeof ctx.walletClient.readContract>[0]),
    getBlockTimestamp: async () => {
      const blockNum = await ctx.walletClient.raw.getBlockNumber();
      const block = await ctx.walletClient.raw.getBlock({ blockNumber: blockNum });
      return block.timestamp;
    },
  });

  spinner.text = 'Checking SecurityHook status...';
  const hookStatus = await hookService.getHookStatus(account.address, account.chainId);

  if (!hookStatus.installed || !hookStatus.capabilities.preUserOpValidation) {
    return 'none';
  }

  // Pre-sign for authorization
  userOp.signature = await ctx.sdk.packUserOpSignature(rawSignature, validationData);

  spinner.text = 'Requesting hook authorization...';
  let hookResult = await hookService.getHookSignature(
    account.address,
    account.chainId,
    ctx.sdk.entryPoint,
    userOp,
  );

  if (hookResult.error) {
    const errCode = hookResult.error.code;
    if (errCode === 'OTP_REQUIRED' || errCode === 'SPENDING_LIMIT_EXCEEDED') {
      spinner.stop();

      if (!hookResult.error.challengeId) {
        const otpChallenge = await hookService.requestSecurityOtp(
          account.address,
          account.chainId,
          ctx.sdk.entryPoint,
          userOp,
        );
        hookResult.error.challengeId = otpChallenge.challengeId;
        hookResult.error.maskedEmail ??= otpChallenge.maskedEmail;
        hookResult.error.otpExpiresAt ??= otpChallenge.otpExpiresAt;
      }

      if (!hookResult.error.challengeId) {
        throw new Error('OTP challenge ID was not provided by Elytro API.');
      }

      const challengeId = hookResult.error.challengeId!;
      const authSessionId = await hookService.getAuthSession(account.address, account.chainId);
      await savePendingOtpAndOutput(ctx.store, {
        id: challengeId,
        account: account.address,
        chainId: account.chainId,
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
      return 'deferred';
    }

    throw new Error(`Hook authorization failed: ${hookResult.error.message ?? errCode}`);
  }

  // Pack with hook
  userOp.signature = await ctx.sdk.packUserOpSignatureWithHook(
    rawSignature,
    validationData,
    hookAddress,
    hookResult.signature! as Hex,
  );
  return 'signed';
}
