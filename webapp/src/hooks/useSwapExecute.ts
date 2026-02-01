import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '../lib/api'
import type { SwapExecuteRequest, SwapExecuteResult, SwapStatusResponse } from '../types/swap'

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
 * Hook for polling swap status until completion or failure.
 * Uses useQuery with refetchInterval for automatic polling.
 */
export function useSwapStatus(swapId: number | null) {
  const queryClient = useQueryClient()

  return useQuery<SwapStatusResponse>({
    queryKey: ['swap-status', swapId],
    queryFn: () => api.getSwapStatus(String(swapId!)),
    enabled: swapId != null,
    refetchInterval: (query) => {
      const status = query.state.data?.status
      // Stop polling when swap reaches a terminal state
      if (status === 'completed' || status === 'failed') {
        // Refresh portfolio and swap history
        queryClient.invalidateQueries({ queryKey: ['portfolio'] })
        queryClient.invalidateQueries({ queryKey: ['swaps'] })
        queryClient.invalidateQueries({ queryKey: ['tokens'] })
        return false
      }
      return 3000 // Poll every 3 seconds
    },
    refetchOnWindowFocus: false,
  })
}
