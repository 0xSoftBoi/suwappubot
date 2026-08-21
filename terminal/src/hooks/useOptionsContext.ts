import { useQuery } from '@tanstack/react-query'
import { api } from '../lib/api'

// Deribit options intel (DVOL, skew, max pain, OI walls) for BTC/ETH — the
// options-flow view of positioning. Options data moves slower than perps, so
// poll gently. `currency` is null when the selected market isn't BTC/ETH;
// the query stays disabled rather than firing a request that can't resolve.
export function useOptionsContext(currency: 'BTC' | 'ETH' | null) {
  return useQuery({
    queryKey: ['options-context', currency],
    queryFn: () => api.getOptionsContext(currency as 'BTC' | 'ETH'),
    enabled: !!currency,
    staleTime: 120_000,
    refetchInterval: 300_000,
  })
}
