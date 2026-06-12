import { Command } from 'commander';
import ora from 'ora';
import type { Address, Hex } from 'viem';
import type { AppContext } from '../context';
import type { PendingOtpState } from '../types';
import {
  getPendingOtp,
  removePendingOtp,
  loadPendingOtps,
  clearPendingOtps,
} from '../services/pendingOtp';
import { SecurityHookService, createSignMessageForAuth } from '../services/securityHook';
import { SECURITY_HOOK_ADDRESS_MAP } from '../constants/securityHook';
import { outputResult, outputError } from '../utils/display';
import type { ElytroUserOperation } from '../types';
import { checkRecoveryBlocked } from '../utils/recoveryGuard';

const ERR_OTP_NOT_FOUND = -32013;
const ERR_OTP_EXPIRED = -32014;
const ERR_ACCOUNT_NOT_READY = -32002;

function isOtpExpired(otpExpiresAt?: string): boolean {
  if (!otpExpiresAt) return false;
  return new Date(otpExpiresAt).getTime() < Date.now();
}

export function registerOtpCommand(program: Command, ctx: AppContext): void {
  const otp = program.command('otp').description('Complete or manage deferred OTP verification');

  // ─── submit ─────────────────────────────────────────────────────

  otp
    .command('submit')
    .description('Complete a pending OTP verification')
    .argument('<id>', 'OTP id from the command that triggered OTP')
    .argument('<code>', '6-digit OTP code')
    .action(async (id: string, code: string) => {
      const pending = await getPendingOtp(ctx.store, id);
      if (!pending) {
        outputError(ERR_OTP_NOT_FOUND, 'Unknown OTP id. It may have expired or been completed.', {
          id,
        });
        return;
      }

      // Recovery guard: check the account that owns this pending OTP
      const pendingAccount = ctx.account.resolveAccount(pending.account);
      if (pendingAccount && checkRecoveryBlocked(pendingAccount)) return;

      if (isOtpExpired(pending.otpExpiresAt)) {
        await removePendingOtp(ctx.store, id);
        outputError(ERR_OTP_EXPIRED, 'OTP has expired. Please re-run the original command.', {
          id,
          action: pending.action,
        });
        return;
      }

      // Ensure current account matches pending
      const current = ctx.account.currentAccount;
      if (!current || current.address.toLowerCase() !== pending.account.toLowerCase()) {
        outputError(
          ERR_ACCOUNT_NOT_READY,
          `Switch to the account that initiated this OTP first: elytro account switch <alias>`,
          {
            pendingAccount: pending.account,
          },
        );
        return;
      }

      const accountInfo = ctx.account.resolveAccount(current.alias ?? current.address);
      if (!accountInfo) {
        outputError(ERR_ACCOUNT_NOT_READY, 'Account not found.');
        return;
      }

      const chainConfig = ctx.chain.chains.find((c) => c.id === pending.chainId);
      if (!chainConfig) {
        outputError(ERR_ACCOUNT_NOT_READY, `Chain ${pending.chainId} not configured.`);
        return;
      }

      await ctx.sdk.initForChain(chainConfig);
      ctx.walletClient.initForChain(chainConfig);

      const hookService = new SecurityHookService({
        store: ctx.store,
        graphqlEndpoint: ctx.chain.graphqlEndpoint,
        signMessageForAuth: createSignMessageForAuth({
          signDigest: (digest) => ctx.keyring.signDigest(digest),
          packRawHash: (hash) => ctx.sdk.packRawHash(hash),
          packSignature: (rawSig, valData) => ctx.sdk.packUserOpSignature(rawSig, valData),
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

      const spinner = ora('Completing OTP verification...').start();
      try {
        await completePendingOtp(ctx, hookService, accountInfo, pending, code.trim(), spinner);
        await removePendingOtp(ctx.store, id);
      } catch (err) {
        spinner.stop();
        outputError(-32000, (err as Error).message);
      }
    });

  // ─── cancel ─────────────────────────────────────────────────────

  otp
    .command('cancel')
    .description('Cancel pending OTP(s)')
    .argument('[id]', 'OTP id to cancel. Omit to cancel all for current account.')
    .action(async (id?: string) => {
      if (id) {
        const pending = await getPendingOtp(ctx.store, id);
        if (!pending) {
          outputError(ERR_OTP_NOT_FOUND, 'Unknown OTP id.', { id });
          return;
        }
        await removePendingOtp(ctx.store, id);
        outputResult({ status: 'cancelled', id });
      } else {
        const current = ctx.account.currentAccount;
        if (!current) {
          outputError(ERR_ACCOUNT_NOT_READY, 'No account selected.');
          return;
        }
        await clearPendingOtps(ctx.store, { account: current.address });
        outputResult({ status: 'cancelled', scope: 'account', account: current.address });
      }
    });

  // ─── list ───────────────────────────────────────────────────────

  otp
    .command('list')
    .description('List pending OTPs for current account')
    .action(async () => {
      const all = await loadPendingOtps(ctx.store);
      const current = ctx.account.currentAccount;
      const pendings = current
        ? Object.values(all).filter(
            (p) => p.account.toLowerCase() === current.address.toLowerCase(),
          )
        : Object.values(all);

      if (pendings.length === 0) {
        outputResult({ pendings: [], total: 0 });
        return;
      }

      outputResult({
        pendings: pendings.map((p) => ({
          id: p.id,
          action: p.action,
          maskedEmail: p.maskedEmail,
          otpExpiresAt: p.otpExpiresAt,
          submitCommand: `elytro otp submit ${p.id} <6-digit-code>`,
        })),
        total: pendings.length,
      });
    });
}

async function completePendingOtp(
  ctx: AppContext,
  hookService: SecurityHookService,
  account: { address: Address; chainId: number; alias: string },
  pending: PendingOtpState,
  code: string,
  spinner: ReturnType<typeof ora>,
): Promise<void> {
  switch (pending.action) {
    case 'email_bind':
    case 'email_change': {
      spinner.stop();
      if (!pending.bindingId) throw new Error('Missing bindingId for email action.');
      const email = 'email' in pending.data ? pending.data.email : '';
      const profile = await hookService.confirmEmailBinding(
        account.address as Address,
        account.chainId,
        pending.bindingId,
        code,
      );
      outputResult({
        status: pending.action === 'email_bind' ? 'email_bound' : 'email_changed',
        email: profile.maskedEmail ?? profile.email ?? email,
        emailVerified: profile.emailVerified,
      });
      break;
    }
    case 'spending_limit': {
      spinner.stop();
      const dailyLimitUsdCents = (pending.data as { dailyLimitUsdCents: number })
        .dailyLimitUsdCents;
      await hookService.setDailyLimit(
        account.address as Address,
        account.chainId,
        dailyLimitUsdCents,
        code,
      );
      outputResult({
        status: 'daily_limit_set',
        dailyLimitUsd: (dailyLimitUsdCents / 100).toFixed(2),
      });
      break;
    }
    case 'tx_send':
    case '2fa_uninstall': {
      if (!pending.challengeId) throw new Error('Missing challengeId for tx/2fa action.');
      spinner.text = 'Verifying OTP...';
      const { userOp: userOpJson, entryPoint } = pending.data as {
        userOp: Record<string, string | null>;
        entryPoint: string;
      };
      const userOp = deserializeUserOp(userOpJson);
      const authSessionId = pending.authSessionId;
      await hookService.verifySecurityOtp(
        account.address as Address,
        account.chainId,
        pending.challengeId,
        code,
        authSessionId,
      );
      spinner.text = 'Retrying authorization...';
      const hookResult = await hookService.getHookSignature(
        account.address as Address,
        account.chainId,
        entryPoint as Address,
        userOp,
        authSessionId,
      );
      if (hookResult.error) {
        throw new Error(`Authorization failed after OTP: ${hookResult.error.message}`);
      }
      const hookAddress = SECURITY_HOOK_ADDRESS_MAP[account.chainId];
      if (!hookAddress) throw new Error(`SecurityHook not deployed on chain ${account.chainId}.`);
      const { packedHash, validationData } = await ctx.sdk.getUserOpHash(userOp);
      const rawSignature = await ctx.keyring.signDigest(packedHash);
      userOp.signature = await ctx.sdk.packUserOpSignatureWithHook(
        rawSignature,
        validationData,
        hookAddress,
        hookResult.signature! as Hex,
      );
      spinner.text = 'Sending UserOp...';
      const opHash = await ctx.sdk.sendUserOp(userOp);
      spinner.text = 'Waiting for receipt...';
      const receipt = await ctx.sdk.waitForReceipt(opHash);
      if (!receipt.success) {
        throw new Error(`Transaction reverted: ${receipt.reason ?? 'unknown'}`);
      }
      spinner.stop();
      outputResult({
        status: pending.action === 'tx_send' ? 'sent' : 'uninstalled',
        userOpHash: opHash,
        transactionHash: receipt.transactionHash,
      });
      break;
    }
    default:
      throw new Error(`Unknown action: ${(pending as PendingOtpState).action}`);
  }
}

function deserializeUserOp(raw: Record<string, string | null>): ElytroUserOperation {
  return {
    sender: raw.sender! as Address,
    nonce: BigInt(raw.nonce ?? '0x0'),
    factory: (raw.factory as Address) ?? null,
    factoryData: (raw.factoryData as Hex) ?? null,
    callData: raw.callData! as Hex,
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
