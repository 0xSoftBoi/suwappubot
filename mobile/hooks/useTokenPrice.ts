/**
 * React Query hooks for token price data (OHLCV + current price).
 */
import { useQuery } from '@tanstack/react-query'
import { api } from '../lib/api'

export type Timeframe = '1h' | '1d' | '1w' | '1m' | '1y'

export interface PricePoint {
  timestamp: number
  value: number
}

export interface TokenPriceData {
  price: number
  change24h: number
  changePercent24h: number
  marketCap: number | null
  volume24h: number | null
  liquidity: number | null
  holders: number | null
  symbol: string
  name: string
  logoUrl: string | null
  prices: PricePoint[]
}

export function useTokenPrice(chain: string, address: string, timeframe: Timeframe = '1d') {
  return useQuery<TokenPriceData>({
    queryKey: ['tokenPrice', chain, address, timeframe],
    queryFn: () => api.getTokenPrice(chain, address, timeframe),
    staleTime: 30_000,
    refetchInterval: 60_000,
    enabled: !!chain && !!address,
  })
}

export function useTokenStats(chain: string, address: string) {
  return useQuery<TokenPriceData>({
    queryKey: ['tokenPrice', chain, address, '1d'],
    queryFn: () => api.getTokenPrice(chain, address, '1d'),
    staleTime: 30_000,
    enabled: !!chain && !!address,
  })
}
