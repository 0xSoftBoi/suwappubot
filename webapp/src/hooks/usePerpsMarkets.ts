import { useQuery } from '@tanstack/react-query'
import { api } from '../lib/api'

export function usePerpsMarkets() {
  return useQuery({
    queryKey: ['perps', 'markets'],
    queryFn: () => api.getPerpsMarkets(),
    staleTime: 30 * 1000,
    gcTime: 5 * 60 * 1000,
    select: (data) => data.markets,
  })
}
