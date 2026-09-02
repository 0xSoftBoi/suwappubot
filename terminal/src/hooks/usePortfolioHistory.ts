import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import type { UTCTimestamp } from 'lightweight-charts'
import { api } from '../lib/api'
import { useAuth } from '../contexts/AuthContext'

export type HistoryPeriod = '24h' | '7d' | '30d' | 'all'

export interface PortfolioHistoryPoint {
  time: UTCTimestamp
  value: number
}

export function usePortfolioHistory(period: HistoryPeriod) {
  const { isAuthenticated } = useAuth()

  const query = useQuery({
    queryKey: ['portfolio-history', period],
    queryFn: () => api.getPortfolioHistory(period),
    enabled: isAuthenticated,
    staleTime: 60_000,
    refetchInterval: 5 * 60_000,
  })

  const data = useMemo<PortfolioHistoryPoint[]>(() => {
    const points = query.data?.points ?? []
    const byTime = new Map<number, number>()
    for (const p of points) {
      byTime.set(p.time, p.value)
    }
    return Array.from(byTime.entries())
      .sort(([a], [b]) => a - b)
      .map(([time, value]) => ({ time: time as UTCTimestamp, value }))
  }, [query.data])

  return {
    data,
    isLoading: query.isLoading,
    isError: query.isError,
    refetch: query.refetch,
  }
}
