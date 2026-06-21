import { useMutation, useQueryClient } from '@tanstack/react-query'
import { VersionedTransaction } from '@solana/web3.js'
import { getPhantom } from '../lib/phantom'
import { api } from '../lib/api'
import type { SwapBuildResult, SwapRecordResult } from '../types/api'

export interface SolanaSwapParams {
  fromToken: string
  toToken: string
  amount: string
  slippage?: number
}

export interface SolanaSwapResult extends SwapRecordResult {
  build: SwapBuildResult
}

function base64ToBytes(b64: string): Uint8Array {
  const binary = atob(b64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i)
  return bytes
}

// Non-custodial Solana swap: the server BUILDS a Jupiter swap tx for the connected
// pubkey, Phantom signs + sends it, then we RECORD the signature. The key never
// leaves Phantom. Same-chain Solana only.
export function useSolanaSwap() {
  const queryClient = useQueryClient()

  return useMutation<SolanaSwapResult, unknown, SolanaSwapParams>({
    mutationFn: async (params) => {
      const provider = getPhantom()
      if (!provider) {
        throw { detail: 'Phantom wallet not found. Install the Phantom extension.', status: 0 }
      }
      if (!provider.publicKey) {
        await provider.connect()
      }
      const address = provider.publicKey?.toString()
      if (!address) {
        throw { detail: 'Connect your Phantom wallet first.', status: 0 }
      }

      const build = await api.buildSwap({
        fromToken: params.fromToken,
        toToken: params.toToken,
        fromChain: 'solana',
        toChain: 'solana',
        amount: params.amount,
        slippage: params.slippage,
        fromAddress: address,
      })
      if (!build.swapTransaction) {
        throw { detail: 'No transaction to sign.', status: 0 }
      }

      const tx = VersionedTransaction.deserialize(base64ToBytes(build.swapTransaction))
      const { signature } = await provider.signAndSendTransaction(tx)

      // Record for history; never lose the signature on a record failure.
      try {
        const record = await api.recordSwap({ quoteId: build.quoteId, txHash: signature })
        return { ...record, build }
      } catch {
        return { success: true, swapId: 0, status: 'pending', txHash: signature, build }
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['portfolio'] })
      queryClient.invalidateQueries({ queryKey: ['swap-history'] })
    },
  })
}
