import { useEffect, useMemo, useRef } from 'react'
import { useQuery } from '@tanstack/react-query'
import { api } from '../lib/api'
import { usePair } from '../contexts/PairContext'
import { cexSymbol, coinbaseProductId, type FeedStatus } from '../lib/marketSupport'
import { useCoinbaseFeed } from './useCoinbaseFeed'
import type { TerminalTrade } from '../types/api'

export type Trade = TerminalTrade
export type { FeedStatus }

const LIMIT = 50

export function useRecentTrades() {
  const { selectedPair, selectedChain } = usePair()
  const symbol = cexSymbol(selectedPair.base?.address, selectedChain, selectedPair.base?.symbol)
  const productId = coinbaseProductId(symbol)

  const feed = useCoinbaseFeed(productId)
  const wsLive = feed?.status === 'live' && feed.trades.length > 0

  // REST fallback: poll only until the WS tape is live, then stop.
  const {
    data: restTrades = [],
    isError,
    isLoading,
  } = useQuery({
    queryKey: ['terminal-recent-trades', symbol],
    queryFn: () => api.getRecentTrades(symbol!, LIMIT),
    enabled: !!symbol && !wsLive,
    refetchInterval: wsLive ? false : 3_000,
    staleTime: 1_000,
  })

  // Top trade id from the previous render, so trades that arrived since then
  // flash (`isNew`). Updated in an effect (not during render) to stay safe under
  // React StrictMode's double-invocation.
  const lastSeenId = useRef<string | null>(null)

  const trades = useMemo<TerminalTrade[]>(() => {
    if (!(wsLive && feed)) return restTrades
    const prev = lastSeenId.current
    let passed = prev == null // first render: nothing flashes (matches REST)
    return feed.trades.slice(0, LIMIT).map((t) => {
      const isNew = !passed
      if (t.id === prev) passed = true
      return { id: t.id, price: t.price, size: t.size, side: t.side, time: t.time, isNew }
    })
  }, [wsLive, feed, restTrades])

  useEffect(() => {
    if (trades.length > 0) lastSeenId.current = trades[0].id
  }, [trades])

  const status: FeedStatus = !symbol
    ? 'unsupported'
    : wsLive
    ? 'connected'
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
