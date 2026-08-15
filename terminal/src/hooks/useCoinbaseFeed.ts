import { useEffect, useState } from 'react'
import { subscribeCoinbase, type CoinbaseFeedState } from '../lib/coinbaseFeed'

const INITIAL: CoinbaseFeedState = {
  bids: [],
  asks: [],
  trades: [],
  status: 'connecting',
}

/**
 * Subscribes to the browser-direct Coinbase WS feed for a Coinbase product id
 * (e.g. `ETH-USD`). Pass `null` to stay disconnected (no supported CEX market).
 * Cleans up / re-subscribes automatically when the product changes or on unmount.
 */
export function useCoinbaseFeed(productId: string | null): CoinbaseFeedState | null {
  const [state, setState] = useState<CoinbaseFeedState | null>(
    productId ? INITIAL : null,
  )

  useEffect(() => {
    if (!productId) {
      setState(null)
      return
    }
    setState(INITIAL)
    const unsub = subscribeCoinbase(productId, setState)
    return unsub
  }, [productId])

  return state
}
