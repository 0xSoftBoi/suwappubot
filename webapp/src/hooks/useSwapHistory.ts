import { useQuery } from '@tanstack/react-query'
import { api } from '../lib/api'

export function useSwapHistory(limit = 20, offset = 0) {
  return useQuery({
    queryKey: ['swaps', limit, offset],
    queryFn: () => api.getSwaps(limit, offset),
    staleTime: 30 * 1000, // 30 seconds
    refetchOnWindowFocus: true,
    retry: 3,
    retryDelay: (attemptIndex) => Math.min(1000 * 2 ** attemptIndex, 30000),
  })
}

export function useSwap(id: string) {
  return useQuery({
    queryKey: ['swap', id],
    queryFn: () => api.getSwap(id),
    enabled: !!id,
    retry: 3,
  })
}
