import { useQuery } from '@tanstack/react-query'
import { api } from '../lib/api'

// Smart-money positioning for a HyperLiquid market (top accounts' live
// long-vs-short). The backend samples ~60 accounts per call, so poll modestly.
export function usePerpsWhales(market: string | null) {
  return useQuery({
    queryKey: ['perps-whales', market],
    queryFn: () => api.getPerpsWhales(market!),
    enabled: !!market,
    staleTime: 30_000,
    refetchInterval: 45_000,
  })
}
