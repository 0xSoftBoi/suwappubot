import { useQuery } from '@tanstack/react-query'
import { api } from '../lib/api'
import type { TerminalTrade } from '../types/api'

export type Trade = TerminalTrade

export function useRecentTrades() {
  const { data: trades = [], isError } = useQuery({
    queryKey: ['terminal-recent-trades', 'ETHUSDC'],
    queryFn: () => api.getRecentTrades('ETHUSDC', 50),
    refetchInterval: 3_000,
    staleTime: 1_000,
  })

  return {
    trades,
    isConnected: !isError && trades.length > 0,
  }
}
