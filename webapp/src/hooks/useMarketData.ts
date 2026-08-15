import { useQuery } from '@tanstack/react-query'
import { api } from '../lib/api'

export function useMarketDataStatus() {
  return useQuery({
    queryKey: ['market-data', 'status'],
    queryFn: () => api.getMarketDataStatus(),
    staleTime: 30 * 1000,
    gcTime: 5 * 60 * 1000,
  })
}

export function useMarketDataOhlcv(symbol: string, chain: string, timeframe: string, limit = 200) {
  return useQuery({
    queryKey: ['market-data', 'ohlcv', symbol, chain, timeframe, limit],
    queryFn: () => api.getMarketDataOhlcv({ symbol, chain, timeframe, limit }),
    enabled: !!symbol && !!chain && !!timeframe,
    staleTime: 15 * 1000,
    gcTime: 5 * 60 * 1000,
  })
}

export function useMarketDataPerpMarkets(limit = 100) {
  return useQuery({
    queryKey: ['market-data', 'perps', 'markets', limit],
    queryFn: () => api.getMarketDataPerpMarkets(limit),
    select: (data) => data.markets,
    staleTime: 15 * 1000,
    gcTime: 5 * 60 * 1000,
  })
}

export function useMarketDataPerpHistory(symbol: string, venue: string, limit = 200) {
  return useQuery({
    queryKey: ['market-data', 'perps', 'history', symbol, venue, limit],
    queryFn: () => api.getMarketDataPerpHistory(symbol, venue, limit),
    enabled: !!symbol && !!venue,
    staleTime: 15 * 1000,
    gcTime: 5 * 60 * 1000,
  })
}

export function useMarketDataPredictionMarkets(q = '', limit = 50) {
  return useQuery({
    queryKey: ['market-data', 'predictions', 'markets', q, limit],
    queryFn: () => api.getMarketDataPredictionMarkets(q, limit),
    select: (data) => data.markets,
    staleTime: 30 * 1000,
    gcTime: 5 * 60 * 1000,
  })
}

export function useMarketDataPredictionHistory(marketId: string, outcome: string, limit = 200) {
  return useQuery({
    queryKey: ['market-data', 'predictions', 'history', marketId, outcome, limit],
    queryFn: () => api.getMarketDataPredictionHistory(marketId, outcome, limit),
    enabled: !!marketId && !!outcome,
    staleTime: 30 * 1000,
    gcTime: 5 * 60 * 1000,
  })
}

export function useMarketDataLendMarkets(limit = 50) {
  return useQuery({
    queryKey: ['market-data', 'lend', 'markets', limit],
    queryFn: () => api.getMarketDataLendMarkets(limit),
    select: (data) => data.markets,
    staleTime: 30 * 1000,
    gcTime: 5 * 60 * 1000,
  })
}
