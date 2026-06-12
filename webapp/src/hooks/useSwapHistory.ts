import { useQuery } from '@tanstack/react-query'
import { api } from '../lib/api'

export function useSwapHistory(limit = 20) {
  return useQuery({
    queryKey: ['swaps', limit],
    queryFn: () => api.getSwaps(limit),
    staleTime: 30 * 1000, // 30 seconds
    refetchOnWindowFocus: true,
  })
}
