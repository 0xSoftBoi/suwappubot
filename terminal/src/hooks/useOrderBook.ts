import { useQuery } from '@tanstack/react-query'
import { api } from '../lib/api'
import type { OrderBookData, OrderBookLevel } from '../types/api'

export type { OrderBookData, OrderBookLevel }
export type OrderBookViewMode = 'both' | 'bids' | 'asks'
export type PrecisionStep = 0.01 | 0.1 | 1 | 10

const EMPTY_BOOK: OrderBookData = {
  bids: [],
  asks: [],
  spread: 0,
  spreadPercent: 0,
  midPrice: 0,
}

export function useOrderBook(_precision: PrecisionStep = 0.01) {
  const { data: book = EMPTY_BOOK, isError } = useQuery({
    queryKey: ['terminal-orderbook', 'ETHUSDC'],
    queryFn: () => api.getOrderBook('ETHUSDC', 15),
    refetchInterval: 3_000,
    staleTime: 1_000,
  })

  const maxTotal = Math.max(
    book.bids.length > 0 ? book.bids[book.bids.length - 1].total : 0,
    book.asks.length > 0 ? book.asks[book.asks.length - 1].total : 0,
  )

  return {
    book,
    isConnected: !isError && (book.bids.length > 0 || book.asks.length > 0),
    maxTotal,
  }
}
