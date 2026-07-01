import { useQuery } from '@tanstack/react-query'
import { api } from '../lib/api'

// OHLCV candles for a HyperLiquid perp market (e.g. "ETH-USD"), via the public
// candleSnapshot feed. Mirrors useChartData's cadence so the perps chart stays
// live without hammering the upstream API.
export function usePerpsCandles(
  market: string | null,
  interval: string = '1h',
  limit: number = 300
) {
  return useQuery({
    queryKey: ['perps-candles', market, interval, limit],
    queryFn: () => api.getPerpsCandles(market!, interval, limit),
    enabled: !!market,
    staleTime: 15_000,
    refetchInterval: 30_000,
  })
}
