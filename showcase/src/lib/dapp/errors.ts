import {
  BaseError,
  ContractFunctionRevertedError,
  UserRejectedRequestError,
} from 'viem';

/**
 * Human-readable copy for every custom error the three primitives can revert with.
 * Keyed by Solidity error name — viem gives us the name when the ABI carries the
 * `error` definitions (see abis.ts).
 */
const ERROR_COPY: Record<string, string> = {
  // shared
  ZeroAmount: 'Amount must be greater than zero (and within your balance).',
  BadParams: 'One of the parameters is out of the range the contract allows.',
  TransferFailed: 'The token transfer failed. Check your balance and allowance.',
  DeadlinePassed:
    'Your transaction deadline expired before it was mined. Try again — raise the deadline in Settings if this repeats.',
  NonStandardToken:
    'This token takes a fee on transfer or rebases; the contract rejects it to avoid mis-accounting.',
  // curve
  SlippageExceeded:
    'Price moved beyond your slippage tolerance. Raise slippage in Settings or retry.',
  InsufficientReserve:
    "The curve's reserve can't cover this sale right now. Try a smaller amount.",
  // vault
  NotOwner: 'Only the position owner can do that.',
  ZeroShares: 'That deposit is too small to mint any pool shares.',
  LtvExceeded:
    'This would push the position past the maximum loan-to-value. Borrow less or add collateral.',
  InsufficientCash:
    'The pool does not have enough idle liquidity for this right now.',
  NotLiquidatable:
    'This position is still healthy — it cannot be liquidated.',
  // credit
  BadStatus:
    'The credit line is not in the right state for this action (check it is Active / Proposed).',
  LimitExceeded:
    'This exceeds the credit limit your counterparty extended to you.',
  NothingOwed: 'There is no outstanding balance to act on.',
  GraceNotElapsed:
    'The settlement grace period has not elapsed yet.',
  BadCycle:
    'Invalid netting cycle: it needs 3+ distinct addresses that each owe the next.',
};

export interface DecodedError {
  /** Short, user-facing sentence. */
  message: string;
  /** Solidity error name, when we could decode one. */
  name?: string;
  /** True when the user dismissed the wallet prompt — not a real failure. */
  rejected: boolean;
  /** Full text, for the details disclosure. */
  detail?: string;
}

export function decodeError(err: unknown): DecodedError {
  // User closed / rejected the wallet prompt.
  if (err instanceof BaseError) {
    const rejected = err.walk((e) => e instanceof UserRejectedRequestError);
    if (rejected) {
      return { message: 'You rejected the request in your wallet.', rejected: true };
    }

    const reverted = err.walk((e) => e instanceof ContractFunctionRevertedError);
    if (reverted instanceof ContractFunctionRevertedError) {
      const name = reverted.data?.errorName;
      if (name && ERROR_COPY[name]) {
        return { message: ERROR_COPY[name], name, rejected: false, detail: err.shortMessage };
      }
      // Solidity require("string") reverts
      const reason = reverted.reason;
      if (reason) {
        return { message: reason, name: name ?? 'Reverted', rejected: false, detail: err.shortMessage };
      }
      if (name) {
        return { message: `Reverted: ${name}`, name, rejected: false, detail: err.shortMessage };
      }
    }

    const short = err.shortMessage || err.message;
    if (/insufficient funds/i.test(short)) {
      return {
        message: 'Not enough ETH to cover gas on Base Sepolia. Grab some from a faucet.',
        rejected: false,
        detail: short,
      };
    }
    return { message: short, rejected: false, detail: err.message };
  }

  if (err instanceof Error) return { message: err.message, rejected: false };
  return { message: 'Something went wrong.', rejected: false };
}
