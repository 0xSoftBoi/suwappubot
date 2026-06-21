import { useMutation, useQueryClient } from '@tanstack/react-query'
import {
  sendTransaction,
  switchChain,
  waitForTransactionReceipt,
  getAccount,
} from '@wagmi/core'
import { config } from '../lib/wagmi'
import { api } from '../lib/api'
import type { SwapBuildResult, SwapRecordResult } from '../types/api'

// wagmi types chainId as the literal union of the configured chains. The backend
// hands us a plain number, so narrow it at the boundary (a chain the wallet/config
// doesn't know will surface as a switchChain error, which we want anyway).
type ChainId = (typeof config)['chains'][number]['id']

export interface ExternalSwapParams {
  fromToken: string
  toToken: string
  fromChain: string
  toChain: string
  amount: string
  slippage?: number
}

export interface ExternalSwapResult extends SwapRecordResult {
  build: SwapBuildResult
}

// Non-custodial swap flow: ask the server to BUILD the unsigned tx(s) for the
// connected wallet, sign + broadcast them client-side (approval first when the
// sell token needs one), then RECORD the broadcast hash for history. The private
// key never leaves the wallet — every signature happens in MetaMask/WalletConnect.
export function useExternalSwap() {
  const queryClient = useQueryClient()

  return useMutation<ExternalSwapResult, unknown, ExternalSwapParams>({
    mutationFn: async (params) => {
      const account = getAccount(config)
      const address = account.address
      if (!address) {
        throw { detail: 'Connect your wallet first.', status: 0 }
      }

      const build = await api.buildSwap({
        fromToken: params.fromToken,
        toToken: params.toToken,
        fromChain: params.fromChain,
        toChain: params.toChain,
        amount: params.amount,
        slippage: params.slippage,
        fromAddress: address,
      })
      if (!build.tx || build.chainId == null) {
        throw { detail: 'This route can’t be signed by an external wallet.', status: 0 }
      }

      // Make sure the wallet is on the chain the tx targets before signing.
      if (account.chainId !== build.chainId) {
        await switchChain(config, { chainId: build.chainId as ChainId })
      }

      // ERC-20 approval (only present when the live allowance is short).
      if (build.approval) {
        const approvalHash = await sendTransaction(config, {
          to: build.approval.to as `0x${string}`,
          data: build.approval.data as `0x${string}`,
          value: BigInt(build.approval.value || '0x0'),
          chainId: build.chainId as ChainId,
        })
        await waitForTransactionReceipt(config, {
          hash: approvalHash,
          chainId: build.chainId as ChainId,
        })
      }

      // The swap itself.
      const txHash = await sendTransaction(config, {
        to: build.tx.to as `0x${string}`,
        data: build.tx.data as `0x${string}`,
        value: BigInt(build.tx.value || '0x0'),
        gas: build.tx.gas ? BigInt(build.tx.gas) : undefined,
        chainId: build.chainId as ChainId,
      })

      // Log it so it shows in portfolio/history. A record failure must NOT lose
      // the user's tx hash — surface it either way.
      try {
        const record = await api.recordSwap({ quoteId: build.quoteId, txHash })
        return { ...record, build }
      } catch {
        return {
          success: true,
          swapId: 0,
          status: 'pending',
          txHash,
          build,
        }
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['portfolio'] })
      queryClient.invalidateQueries({ queryKey: ['swap-history'] })
    },
  })
}
