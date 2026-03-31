import { useMemo } from 'react'

export type HistoryPeriod = '24h' | '7d' | '30d' | 'all'

export interface PortfolioHistoryPoint {
  time: number
  value: number
}

const POINT_COUNTS: Record<HistoryPeriod, number> = {
  '24h': 24,
  '7d': 168,
  '30d': 30,
  'all': 90,
}

const INTERVAL_MS: Record<HistoryPeriod, number> = {
  '24h': 3600 * 1000,        // 1 hour
  '7d': 3600 * 1000,         // 1 hour
  '30d': 86400 * 1000,       // 1 day
  'all': 86400 * 1000,       // 1 day
}

function generateMockHistory(period: HistoryPeriod): PortfolioHistoryPoint[] {
  const count = POINT_COUNTS[period]
  const intervalMs = INTERVAL_MS[period]
  const now = Date.now()
  const startTime = now - count * intervalMs

  // Seeded pseudo-random for stable output per period
  let seed = period.length * 1337
  const rand = () => {
    seed = (seed * 16807 + 0) % 2147483647
    return (seed - 1) / 2147483646
  }

  const points: PortfolioHistoryPoint[] = []
  let value = 10000

  for (let i = 0; i < count; i++) {
    const change = (rand() - 0.45) * 200 // slight upward bias
    value = Math.max(value + change, 5000)
    points.push({
      time: Math.floor((startTime + i * intervalMs) / 1000),
      value: Math.round(value * 100) / 100,
    })
  }

  return points
}

export function usePortfolioHistory(period: HistoryPeriod) {
  const data = useMemo(() => generateMockHistory(period), [period])
  return { data }
}
