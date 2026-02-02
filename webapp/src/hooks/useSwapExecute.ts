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
 * Compute adaptive polling interval based on how long we've been polling.
 * - First 30s: 1s interval (fast feedback)
 * - 30s to 5min: 3s interval
 * - 5min to 30min: 10s interval
 * - After 30min: stop polling (likely stuck)
 */
function getAdaptiveInterval(startTime: number): number | false {
  const elapsed = Date.now() - startTime
  const THIRTY_SECONDS = 30 * 1000
  const FIVE_MINUTES = 5 * 60 * 1000
  const THIRTY_MINUTES = 30 * 60 * 1000

  if (elapsed > THIRTY_MINUTES) return false  // Stop polling
  if (elapsed > FIVE_MINUTES) return 10_000
  if (elapsed > THIRTY_SECONDS) return 3_000
  return 1_000
}

/**
 * Hook for polling swap status until completion or failure.
 * Uses adaptive polling: fast at first, slowing down over time.
 */
export function useSwapStatus(swapId: number | null) {
  const queryClient = useQueryClient()
  // Track when polling started for adaptive intervals
  const pollingStartRef = { current: swapId ? Date.now() : 0 }

  return useQuery<SwapStatusResponse>({
    queryKey: ['swap-status', swapId],
    queryFn: () => {
      if (!pollingStartRef.current) pollingStartRef.current = Date.now()
      return api.getSwapStatus(String(swapId!))
    },
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
      return getAdaptiveInterval(pollingStartRef.current)
    },
    refetchOnWindowFocus: false,
  })
}
