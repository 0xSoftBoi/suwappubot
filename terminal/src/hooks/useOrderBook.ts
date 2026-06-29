import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { api } from '../lib/api'
import { usePair } from '../contexts/PairContext'
import { cexSymbol, coinbaseProductId, type FeedStatus } from '../lib/marketSupport'
import { useCoinbaseFeed } from './useCoinbaseFeed'
import type { BookLevel } from '../lib/coinbaseFeed'
import type { OrderBookData, OrderBookLevel } from '../types/api'

export type { OrderBookData, OrderBookLevel }
export type OrderBookViewMode = 'both' | 'bids' | 'asks'
export type PrecisionStep = 0.01 | 0.1 | 1 | 10
export type { FeedStatus }

const DEPTH = 15

const EMPTY_BOOK: OrderBookData = {
  bids: [],
  asks: [],
  spread: 0,
  spreadPercent: 0,
  midPrice: 0,
}

/** Take top-N levels and attach the running cumulative `total` the UI draws. */
function withTotals(levels: BookLevel[]): OrderBookLevel[] {
  const out: OrderBookLevel[] = []
  let total = 0
  for (const { price, size } of levels.slice(0, DEPTH)) {
    total += size
    out.push({ price, size, total })
  }
  return out
}

/** Build an `OrderBookData` (bids/asks + spread/mid) from the live WS feed. */
function bookFromFeed(bids: BookLevel[], asks: BookLevel[]): OrderBookData {
  const b = withTotals(bids)
  const a = withTotals(asks)
  const bestBid = b[0]?.price ?? 0
  const bestAsk = a[0]?.price ?? 0
  const spread = bestBid && bestAsk ? bestAsk - bestBid : 0
  const midPrice = bestBid && bestAsk ? (bestBid + bestAsk) / 2 : bestBid || bestAsk
  const spreadPercent = midPrice ? (spread / midPrice) * 100 : 0
  return { bids: b, asks: a, spread, spreadPercent, midPrice }
}

export function useOrderBook(_precision: PrecisionStep = 0.01) {
  const { selectedPair, selectedChain } = usePair()
  const symbol = cexSymbol(selectedPair.base?.address, selectedChain, selectedPair.base?.symbol)
  const productId = coinbaseProductId(symbol)

  // Live WS feed (browser-direct to Coinbase). null when no CEX market.
  const feed = useCoinbaseFeed(productId)
  const wsLive = feed?.status === 'live' && (feed.bids.length > 0 || feed.asks.length > 0)

  // REST fallback: keep polling only until the WS book is live, then stop so we
  // don't double-fetch. If WS drops, `wsLive` flips false and polling resumes.
  const {
    data: restBook = EMPTY_BOOK,
    isError,
    isLoading,
  } = useQuery({
    queryKey: ['terminal-orderbook', symbol],
    queryFn: () => api.getOrderBook(symbol!, DEPTH),
    enabled: !!symbol && !wsLive,
    refetchInterval: wsLive ? false : 3_000,
    staleTime: 1_000,
  })

  const book = useMemo(
    () => (wsLive && feed ? bookFromFeed(feed.bids, feed.asks) : restBook),
    [wsLive, feed, restBook],
  )

  const maxTotal = Math.max(
    book.bids.length > 0 ? book.bids[book.bids.length - 1].total : 0,
    book.asks.length > 0 ? book.asks[book.asks.length - 1].total : 0,
  )

  const status: FeedStatus = !symbol
    ? 'unsupported'
    : wsLive
    ? 'connected'
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
