import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { VersionedTransaction } from '@solana/web3.js'
import { getPhantom } from '../lib/phantom'
import { api } from '../lib/api'
import type { SwapExecutionStage } from '../lib/swapExecutionStage'
import type { SwapBuildResult, SwapRecordResult, SolanaPriorityTier } from '../types/api'

export interface SolanaSwapParams {
  fromToken: string
  toToken: string
  amount: string
  slippage?: number
  priority?: SolanaPriorityTier
  computeUnitPriceMicroLamports?: number
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

function bytesToBase64(bytes: Uint8Array): string {
  let binary = ''
  for (let i = 0; i < bytes.length; i += 1) binary += String.fromCharCode(bytes[i])
  return btoa(binary)
}

// Non-custodial Solana swap: the server BUILDS a Jupiter swap tx for the connected
// pubkey, Phantom signs + sends it, then we RECORD the signature. The key never
// leaves Phantom. Same-chain Solana only.
export function useSolanaSwap() {
  const queryClient = useQueryClient()
  const [stage, setStage] = useState<SwapExecutionStage | null>(null)

  const mutation = useMutation<SolanaSwapResult, unknown, SolanaSwapParams>({
    mutationFn: async (params) => {
      const provider = getPhantom()
      if (!provider) {
        throw { detail: 'Phantom wallet not found. Install the Phantom extension.', status: 0 }
      }
      if (!provider.publicKey) {
        setStage('connecting-wallet')
        await provider.connect()
      }
      const address = provider.publicKey?.toString()
      if (!address) {
        throw { detail: 'Connect your Phantom wallet first.', status: 0 }
      }

      setStage('building')
      const build = await api.buildSwap({
        fromToken: params.fromToken,
        toToken: params.toToken,
        fromChain: 'solana',
        toChain: 'solana',
        amount: params.amount,
        slippage: params.slippage,
        fromAddress: address,
        priority: params.priority,
        computeUnitPriceMicroLamports: params.computeUnitPriceMicroLamports,
      })
      if (!build.swapTransaction) {
        throw { detail: 'No transaction to sign.', status: 0 }
      }

      const tx = VersionedTransaction.deserialize(base64ToBytes(build.swapTransaction))

      // Jito (turbo): sign locally, then submit to the Jito block engine via the
      // server so it lands as an MEV-protected bundle (the baked-in tip only pays
      // off through Jito, not a normal RPC). Otherwise let Phantom broadcast.
      let signature: string
      if (build.jito) {
        setStage('signing-swap')
        const signed = await provider.signTransaction(tx)
        setStage('submitting-swap')
        const res = await api.submitJitoSwap(bytesToBase64(signed.serialize()))
        signature = res.signature
      } else {
        // Phantom exposes signing + broadcast as one observable await here.
        setStage('signing-and-submitting-swap')
        ;({ signature } = await provider.signAndSendTransaction(tx))
      }

      // Record for history; never lose the signature on a record failure.
      setStage('recording-submission')
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
    onSettled: () => {
      setStage(null)
    },
  })

  return { ...mutation, stage: mutation.isPending ? stage : null }
}
