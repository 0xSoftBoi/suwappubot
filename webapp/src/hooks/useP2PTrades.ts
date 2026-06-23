import { useQuery } from '@tanstack/react-query'
import { api } from '../lib/api'

export function useP2PTrades() {
  return useQuery({
    queryKey: ['p2p', 'trades'],
    queryFn: () => api.getP2PTrades(),
    staleTime: 30 * 1000,
    gcTime: 5 * 60 * 1000,
    select: (data) => data.trades,
  })
}
