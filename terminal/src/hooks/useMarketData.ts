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

    const price = candles[candles.length - 1].close
    const firstClose = candles[0].close
    const change24h = firstClose !== 0 ? ((price - firstClose) / firstClose) * 100 : 0
    const volume24h = candles.reduce((sum, c) => sum + c.volume, 0)

    // Mock values — replace with real API data later
    const marketCap = 389_000_000_000
    const fundingRate = 0.0125

    return { price, change24h, volume24h, marketCap, fundingRate, isLoading }
  }, [candles, isLoading])
}
