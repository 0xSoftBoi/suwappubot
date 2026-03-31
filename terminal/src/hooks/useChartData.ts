import { useQuery } from '@tanstack/react-query'
import { api } from '../lib/api'
import type { OHLCVCandle } from '../types/api'

function generateMockOHLCV(count: number, interval: string): OHLCVCandle[] {
  const now = Math.floor(Date.now() / 1000)
  const intervalSeconds: Record<string, number> = {
    '1m': 60, '5m': 300, '15m': 900, '1h': 3600, '4h': 14400, '1D': 86400,
  }
  const step = intervalSeconds[interval] ?? 3600
  let price = 3245.5
  const candles: OHLCVCandle[] = []

  for (let i = count - 1; i >= 0; i--) {
    const time = now - i * step
    const change = (Math.random() - 0.48) * price * 0.015
    const open = price
    price = Math.max(price + change, 100)
    const close = price
    const high = Math.max(open, close) * (1 + Math.random() * 0.008)
    const low = Math.min(open, close) * (1 - Math.random() * 0.008)
    const volume = 50 + Math.random() * 500
    candles.push({ time, open, high, low, close, volume })
  }

  return candles
}

export function useChartData(
  pair: string | null,
  chain: string,
  interval: string = '1h',
  limit: number = 300
) {
  return useQuery({
    queryKey: ['chart-ohlcv', pair, chain, interval, limit],
    queryFn: async () => {
      try {
        return await api.getOHLCV(pair!, chain, interval, limit)
      } catch {
        return generateMockOHLCV(limit, interval)
      }
    },
    enabled: !!pair,
    staleTime: 30_000,
    refetchInterval: 60_000,
  })
}
