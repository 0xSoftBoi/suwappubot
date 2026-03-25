import { useQuery } from '@tanstack/react-query'
import { api } from '../lib/api'

export function usePredictionPositions() {
  return useQuery({
    queryKey: ['prediction', 'positions'],
    queryFn: () => api.getPredictionPositions(),
    staleTime: 30 * 1000,
    gcTime: 5 * 60 * 1000,
    select: (data) => data.positions,
  })
}
