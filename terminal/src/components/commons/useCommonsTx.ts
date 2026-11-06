import { useCallback, useState } from 'react'
import toast from 'react-hot-toast'
import { useQueryClient } from '@tanstack/react-query'
import { useAccount, useConfig, useSwitchChain } from 'wagmi'
import { getPublicClient, readContract, waitForTransactionReceipt, writeContract } from 'wagmi/actions'
import { BaseError, ContractFunctionRevertedError, type Abi, type Address } from 'viem'
import { COMMONS_CHAIN, erc20Abi, txUrl } from './contracts'

export type TxStep = {
  label: string
  address: Address
  abi: Abi
  functionName: string
  args: readonly unknown[]
}

type RunnableStep = TxStep & { allowanceOf?: { token: Address; spender: Address; amount: bigint } }

/** Human-readable revert reason from a viem error (custom error name if decoded). */
export function explain(err: unknown): string {
  if (err instanceof BaseError) {
    const revert = err.walk((e) => e instanceof ContractFunctionRevertedError)
    if (revert instanceof ContractFunctionRevertedError) {
      const name = revert.data?.errorName
      if (name) return ERROR_COPY[name] ?? name
      if (revert.reason) return revert.reason
    }
    if (/User rejected|denied/i.test(err.message)) return 'Rejected in wallet'
    return err.shortMessage
  }
  return err instanceof Error ? err.message : String(err)
}

/** Plain-language copy for the primitives' custom errors. */
const ERROR_COPY: Record<string, string> = {
  BadParams: 'Invalid parameters',
  BadStatus: 'Line is not in the right state for this',
  LimitExceeded: 'Over the credit limit your counterparty extended',
  NothingOwed: 'Nothing is owed on this line',
  BadCycle: 'Cycle invalid — needs 3+ distinct addresses, each owing the next',
  LtvExceeded: 'Would exceed the max loan-to-value',
  NotLiquidatable: 'Position is healthy — not liquidatable',
  DeadlinePassed: 'Deadline passed — try again',
  SlippageExceeded: 'Price moved beyond your slippage limit',
  GraceNotElapsed: 'Grace period has not elapsed yet',
  InsufficientReserve: 'Curve reserve cannot cover this sell',
  NonStandardToken: 'Fee-on-transfer / rebasing tokens are rejected',
  TransferFailed: 'Token transfer failed — check balance and allowance',
  ZeroAmount: 'Amount must be greater than zero',
  ZeroShares: 'Amount too small — rounds to zero shares',
  InsufficientCash: 'Not enough idle liquidity in the pool',
  NotOwner: 'Only the position owner can do that',
  // Commons v2 — CommonsClearingHouse
  TermsMismatch: 'Terms changed since you reviewed them — re-read and accept again',
  DemandOpen: 'A settlement demand is already open on this line',
  NotClearable: 'A line in this cycle did not consent to clearing',
  Unbalanced: 'Not a circulation — every address must owe out what it is owed in',
  BadPath: 'Invalid path — it must start with you and use existing lines',
  RoutingDisabled: 'An intermediary has not enabled routing for this token',
  RouteCapExceeded: 'An intermediary would exceed the routing cap it set for that line',
  FeeExceeded: 'Routing fees exceed your max fee',
  Reentrancy: 'Reentrant call blocked',
  Expired: 'Signed intent expired',
  NonceUsed: 'This signed intent was already used or cancelled',
  BadSignature: 'Signature does not match the signer',
}

export function useCommonsTx() {
  const config = useConfig()
  const queryClient = useQueryClient()
  const { address, chainId } = useAccount()
  const { switchChainAsync } = useSwitchChain()
  const [busy, setBusy] = useState<string | null>(null)

  const run = useCallback(
    async (name: string, steps: RunnableStep[]): Promise<boolean> => {
      if (!address) {
        toast.error('Connect a wallet first')
        return false
      }
      setBusy(name)
      const id = toast.loading(`${name}…`)
      try {
        if (chainId !== COMMONS_CHAIN.id) {
          toast.loading('Switching to Base Sepolia…', { id })
          await switchChainAsync({ chainId: COMMONS_CHAIN.id })
        }
        for (const [i, step] of steps.entries()) {
          if (step.allowanceOf) {
            const { token, spender, amount } = step.allowanceOf
            const current = await readContract(config, {
              address: token,
              abi: erc20Abi,
              functionName: 'allowance',
              args: [address, spender],
              chainId: COMMONS_CHAIN.id,
            })
            if (current >= amount) continue
          }
          const prefix = steps.length > 1 ? `(${i + 1}/${steps.length}) ` : ''
          toast.loading(`${prefix}${step.label} — confirm in wallet`, { id })
          const call = {
            address: step.address,
            abi: step.abi,
            functionName: step.functionName,
            args: step.args,
            chainId: COMMONS_CHAIN.id,
          }
          // Public-RPC estimates for these contracts were measured to undershoot
          // actual usage (an accept OOG'd on Base Sepolia) — always buffer 1.5x.
          const pc = getPublicClient(config, { chainId: COMMONS_CHAIN.id })
          if (!pc) throw new Error('No RPC client for Base Sepolia')
          const est = await pc.estimateContractGas({ ...call, account: address } as never)
          const hash = await writeContract(config, { ...call, gas: (est * 3n) / 2n } as never)
          toast.loading(`${prefix}${step.label} — waiting for block`, { id })
          const receipt = await waitForTransactionReceipt(config, { hash, chainId: COMMONS_CHAIN.id })
          if (receipt.status !== 'success') throw new Error(`${step.label} reverted · ${txUrl(hash)}`)
        }
        toast.success(`${name} confirmed`, { id })
        return true
      } catch (err) {
        toast.error(`${name}: ${explain(err)}`, { id, duration: 7000 })
        return false
      } finally {
        setBusy(null)
        await queryClient.invalidateQueries()
      }
    },
    [address, chainId, config, queryClient, switchChainAsync],
  )

  return { run, busy, address, wrongChain: !!address && chainId !== COMMONS_CHAIN.id }
}

/** Build an approve step that is skipped when the allowance already covers `amount`. */
export function approveIfNeeded(token: Address, spender: Address, amount: bigint, label: string): RunnableStep {
  return {
    label,
    address: token,
    abi: erc20Abi as Abi,
    functionName: 'approve',
    args: [spender, amount],
    allowanceOf: { token, spender, amount },
  }
}

export function call(
  label: string,
  address: Address,
  abi: Abi,
  functionName: string,
  args: readonly unknown[],
): RunnableStep {
  return { label, address, abi, functionName, args }
}
