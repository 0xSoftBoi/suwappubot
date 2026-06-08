import type { UTCTimestamp } from 'lightweight-charts'

export type HistoryPeriod = '24h' | '7d' | '30d' | 'all'

export interface PortfolioHistoryPoint {
  time: UTCTimestamp
  value: number
}

export function usePortfolioHistory(_period: HistoryPeriod) {
  const data: PortfolioHistoryPoint[] = []
  return { data }
}
