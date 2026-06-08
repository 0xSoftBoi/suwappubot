import { useMemo } from 'react'
import { useChartData } from './useChartData'
import { usePair } from '../contexts/PairContext'

export interface MarketData {
  price: number | null
  change24h: number | null
  volume24h: number | null
  marketCap: number | null
  fundingRate: number | null
  isLoading: boolean
}

export function useMarketData(): MarketData {
  const { selectedPair, selectedChain } = usePair()
  const address = selectedPair.base?.address ?? null
  const { data: candles, isLoading } = useChartData(address, selectedChain, '1h')

  return useMemo(() => {
    if (!candles || candles.length === 0) {
      return { price: null, change24h: null, volume24h: null, marketCap: null, fundingRate: null, isLoading }
    }

    // Candles are 1h; use only the last 24 for a true 24h window (was using all
    // ~300 candles ≈ 12 days, so change/volume in the market bar were wrong).
    const last24 = candles.slice(-24)
    const price = candles[candles.length - 1].close
    const firstClose = last24[0]?.close ?? price
    const change24h = firstClose !== 0 ? ((price - firstClose) / firstClose) * 100 : 0
    const volume24h = last24.reduce((sum, c) => sum + c.volume, 0)

    return { price, change24h, volume24h, marketCap: null, fundingRate: null, isLoading }
  }, [candles, isLoading])
}
