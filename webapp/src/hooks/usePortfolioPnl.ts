import { useQuery } from '@tanstack/react-query'
import { api } from '../lib/api'
import type { PortfolioPnl } from '../types/api'

export type PnlPeriod = '7d' | '30d' | '90d' | 'all'

export function usePortfolioPnl(period: PnlPeriod = '30d') {
  return useQuery<PortfolioPnl>({
    queryKey: ['portfolio-pnl', period],
    queryFn: () => api.getPortfolioPnl(period),
    staleTime: 60 * 1000, // 1 minute
    refetchOnWindowFocus: false,
  })
}
