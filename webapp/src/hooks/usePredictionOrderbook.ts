import { useQuery } from '@tanstack/react-query'
import { api } from '../lib/api'

export function usePredictionOrderbook(id: string | null) {
  return useQuery({
    queryKey: ['prediction', 'orderbook', id],
    queryFn: () => api.getPredictionOrderbook(id!),
    enabled: id !== null,
    staleTime: 5 * 1000,
    gcTime: 30 * 1000,
    refetchInterval: 10 * 1000,
  })
}
