import { useQuery } from '@tanstack/react-query'
import { api } from '../lib/api'

export function useChartData(
  pair: string | null,
  chain: string,
  interval: string = '1h',
  limit: number = 300
) {
  return useQuery({
    queryKey: ['chart-ohlcv', pair, chain, interval, limit],
    queryFn: () => api.getOHLCV(pair!, chain, interval, limit),
    enabled: !!pair,
    staleTime: 30_000,
    refetchInterval: 60_000,
  })
}
