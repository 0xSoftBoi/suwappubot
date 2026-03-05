import { useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '../lib/api'
import type { SwapExecuteRequest, SwapExecuteResult } from '../types/swap'

/**
 * Hook for executing a swap
 * 
 * Returns a mutation that:
 * - Submits the swap transaction
 * - Invalidates relevant queries on success
 * - Provides loading/error states
 */
export function useSwapExecute() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (request: SwapExecuteRequest): Promise<SwapExecuteResult> => {
      return api.executeSwap(request)
    },
    onSuccess: () => {
      // Invalidate portfolio to show updated balances
      queryClient.invalidateQueries({ queryKey: ['portfolio'] })
      // Invalidate swap history
      queryClient.invalidateQueries({ queryKey: ['swaps'] })
      // Invalidate token balances
      queryClient.invalidateQueries({ queryKey: ['tokens'] })
    },
  })
}

/**
 * Hook for tracking a pending swap status
 */
export function useSwapStatus(swapId: string | null) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async () => {
      if (!swapId) throw new Error('No swap ID')
      return api.getSwap(swapId)
    },
    onSuccess: (data) => {
      if (data.status === 'completed' || data.status === 'failed') {
        // Refresh data when swap completes
        queryClient.invalidateQueries({ queryKey: ['portfolio'] })
        queryClient.invalidateQueries({ queryKey: ['swaps'] })
      }
    },
  })
}
