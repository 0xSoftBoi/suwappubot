import { useEffect, useMemo, useRef, useState } from 'react'
import { useChartData } from './useChartData'
import { usePair } from '../contexts/PairContext'
import { cexSymbol, coinbaseProductId } from '../lib/marketSupport'
import { useCoinbaseFeed } from './useCoinbaseFeed'

export interface MarketData {
  price: number | null
  change24h: number | null
  volume24h: number | null
  isLoading: boolean
}

// Coinbase pushes trade/book updates far faster than the market bar needs to
// redraw; batch live-price commits to a fixed cadence so per-tick WS messages
// don't hammer re-renders.
const LIVE_PRICE_THROTTLE_MS = 250

export function useMarketData(): MarketData {
  const { selectedPair, selectedChain } = usePair()
  const address = selectedPair.base?.address ?? null
  const { data: candles, isLoading } = useChartData(address, selectedChain, '1h')

  // Same CEX resolution the order book / trades panel use — only majors with a
  // real public Coinbase market get a live price; everything else falls back to
  // the (up-to-1h-stale) candle close below.
  const symbol = cexSymbol(address, selectedChain, selectedPair.base?.symbol)
  const productId = coinbaseProductId(symbol)
  const feed = useCoinbaseFeed(productId)

  const [livePrice, setLivePrice] = useState<number | null>(null)
  const pendingPrice = useRef<number | null>(null)
  const throttleTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Reset on pair change so a stale live price from the previous product never
  // flashes under the newly selected one.
  useEffect(() => {
    setLivePrice(null)
    pendingPrice.current = null
    if (throttleTimer.current) {
      clearTimeout(throttleTimer.current)
      throttleTimer.current = null
    }
  }, [productId])

  useEffect(() => {
    if (!feed) return
    // Prefer the latest trade print; fall back to the book mid if no trade has
    // arrived yet but the book is already live.
    const nextPrice =
      feed.trades[0]?.price ??
      (feed.bids[0] && feed.asks[0] ? (feed.bids[0].price + feed.asks[0].price) / 2 : null)
    if (nextPrice == null) return

    pendingPrice.current = nextPrice
    if (throttleTimer.current) return
    throttleTimer.current = setTimeout(() => {
      throttleTimer.current = null
      setLivePrice(pendingPrice.current)
    }, LIVE_PRICE_THROTTLE_MS)
  }, [feed])

  useEffect(() => {
    return () => {
      if (throttleTimer.current) clearTimeout(throttleTimer.current)
    }
  }, [])

  return useMemo(() => {
    if (!candles || candles.length === 0) {
      return { price: livePrice, change24h: null, volume24h: null, isLoading }
    }

    // Candles are 1h; use only the last 24 for a true 24h window (was using all
    // ~300 candles ≈ 12 days, so change/volume in the market bar were wrong).
    const last24 = candles.slice(-24)
    const candlePrice = candles[candles.length - 1].close
    // Live WS price wins once it arrives; until then, the candle close is the
    // best we have (up to ~1h stale).
    const price = livePrice ?? candlePrice
    const firstClose = last24[0]?.close ?? candlePrice
    const change24h = firstClose !== 0 ? ((price - firstClose) / firstClose) * 100 : 0
    const volume24h = last24.reduce((sum, c) => sum + c.volume, 0)

    return { price, change24h, volume24h, isLoading }
  }, [candles, isLoading, livePrice])
}
