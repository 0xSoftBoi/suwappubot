import { useQuery } from '@tanstack/react-query'
import { api } from '../lib/api'

export function usePredictionMarkets(params?: { query?: string; category?: string; limit?: number }) {
  return useQuery({
    queryKey: ['prediction', 'markets', params],
    queryFn: () => api.getPredictionMarkets(params),
    staleTime: 30 * 1000,
    gcTime: 5 * 60 * 1000,
    select: (data) => data.markets,
  })
}
