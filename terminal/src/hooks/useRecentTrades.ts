import { useQuery } from '@tanstack/react-query'
import { api } from '../lib/api'
import { usePair } from '../contexts/PairContext'
import { cexSymbol, type FeedStatus } from '../lib/marketSupport'
import type { TerminalTrade } from '../types/api'

export type Trade = TerminalTrade
export type { FeedStatus }

export function useRecentTrades() {
  const { selectedPair, selectedChain } = usePair()
  const symbol = cexSymbol(selectedPair.base?.address, selectedChain)

  const { data: trades = [], isError, isLoading } = useQuery({
    queryKey: ['terminal-recent-trades', symbol],
    queryFn: () => api.getRecentTrades(symbol!, 50),
    enabled: !!symbol, // only query when a central trade feed exists (ETH/USDC)
    refetchInterval: 3_000,
    staleTime: 1_000,
  })

  const status: FeedStatus = !symbol
    ? 'unsupported'
    : isError
    ? 'error'
    : isLoading && trades.length === 0
    ? 'loading'
    : 'connected'

  return {
    trades,
    status,
    isConnected: status === 'connected' && trades.length > 0,
  }
}
