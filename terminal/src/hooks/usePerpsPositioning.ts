import { useQuery } from '@tanstack/react-query'
import { api } from '../lib/api'

// Cross-venue positioning for a perp — OKX retail long/short + taker flow
// (major coins only; null otherwise) plus the OKX-vs-HL funding spread
// (works for any HL market). Polls faster than options, slower than the
// live order-flow WebSocket.
export function usePerpsPositioning(coin: string | null) {
  return useQuery({
    queryKey: ['perps-positioning', coin],
    queryFn: () => api.getPerpsPositioning(coin!),
    enabled: !!coin,
    staleTime: 45_000,
    refetchInterval: 60_000,
  })
}
