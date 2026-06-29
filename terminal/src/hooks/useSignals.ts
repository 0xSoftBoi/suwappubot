import { useQuery } from '@tanstack/react-query'
import { api } from '../lib/api'

// The cross-market Signals feed — a single scan of HL perps + macro regime.
// Refreshes on a relaxed cadence; the underlying data is 24h/funding-scale.
export function useSignals() {
  return useQuery({
    queryKey: ['market-signals'],
    queryFn: () => api.getSignals(),
    staleTime: 30_000,
    refetchInterval: 45_000,
  })
}
