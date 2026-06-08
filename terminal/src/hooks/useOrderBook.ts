import { useQuery } from '@tanstack/react-query'
import { api } from '../lib/api'
import { usePair } from '../contexts/PairContext'
import { cexSymbol, type FeedStatus } from '../lib/marketSupport'
import type { OrderBookData, OrderBookLevel } from '../types/api'

export type { OrderBookData, OrderBookLevel }
export type OrderBookViewMode = 'both' | 'bids' | 'asks'
export type PrecisionStep = 0.01 | 0.1 | 1 | 10
export type { FeedStatus }

const EMPTY_BOOK: OrderBookData = {
  bids: [],
  asks: [],
  spread: 0,
  spreadPercent: 0,
  midPrice: 0,
}

export function useOrderBook(_precision: PrecisionStep = 0.01) {
  const { selectedPair, selectedChain } = usePair()
  const symbol = cexSymbol(selectedPair.base?.address, selectedChain)

  const { data: book = EMPTY_BOOK, isError, isLoading } = useQuery({
    queryKey: ['terminal-orderbook', symbol],
    queryFn: () => api.getOrderBook(symbol!, 15),
    enabled: !!symbol, // only query when a central order book exists (ETH/USDC)
    refetchInterval: 3_000,
    staleTime: 1_000,
  })

  const maxTotal = Math.max(
    book.bids.length > 0 ? book.bids[book.bids.length - 1].total : 0,
    book.asks.length > 0 ? book.asks[book.asks.length - 1].total : 0,
  )

  const status: FeedStatus = !symbol
    ? 'unsupported'
    : isError
    ? 'error'
    : isLoading && book.bids.length === 0
    ? 'loading'
    : 'connected'

  return {
    book,
    status,
    isConnected: status === 'connected' && (book.bids.length > 0 || book.asks.length > 0),
    maxTotal,
  }
}
