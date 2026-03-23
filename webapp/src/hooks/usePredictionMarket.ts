import { useQuery } from '@tanstack/react-query'
import { api } from '../lib/api'

export function usePredictionMarket(id: string | null) {
  return useQuery({
    queryKey: ['prediction', 'market', id],
    queryFn: () => api.getPredictionMarket(id!),
    enabled: id !== null,
    staleTime: 15 * 1000,
    gcTime: 5 * 60 * 1000,
  })
}
