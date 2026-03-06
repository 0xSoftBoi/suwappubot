/**
 * React Query hook for swap transaction history.
 */
import { useQuery } from '@tanstack/react-query'
import { api } from '../lib/api'

export function useSwapHistory(limit = 20, offset = 0) {
  return useQuery({
    queryKey: ['swapHistory', limit, offset],
    queryFn: () => api.getSwaps(limit, offset),
  })
}
