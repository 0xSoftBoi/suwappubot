import { useEffect, useState } from 'react'
import { acquireHlFeed, type HlFlowState } from '../lib/hyperliquidFeed'

const INITIAL: HlFlowState = {
  status: 'connecting',
  trades: [],
  cvd: 0,
  cvdSeries: [],
  bestBid: null,
  bestAsk: null,
  bidDepth: 0,
  askDepth: 0,
  imbalance: 0.5,
}

// Live order-flow (CVD, trade tape, book imbalance) for a HyperLiquid coin via
// the browser-direct WS feed. Pass the bare asset ("ETH") or "ETH-USD".
export function useHyperliquidFlow(market: string | null): HlFlowState {
  const coin = market ? market.split('-')[0].split('/')[0].toUpperCase() : null
  const [state, setState] = useState<HlFlowState>(INITIAL)

  useEffect(() => {
    if (!coin) {
      setState(INITIAL)
      return
    }
    setState(INITIAL)
    const unsub = acquireHlFeed(coin, setState)
    return unsub
  }, [coin])

  return state
}
