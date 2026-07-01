import { useQuery } from '@tanstack/react-query'
import { api } from '../lib/api'

// Always-on macro context for the header strip (Fear&Greed, BTC dominance,
// total market cap, stablecoin supply). Slow-moving data — poll every 2 min.
export function useMarketRegime() {
  return useQuery({
    queryKey: ['market-regime'],
    queryFn: () => api.getMarketRegime(),
    staleTime: 60_000,
    refetchInterval: 120_000,
  })
}
