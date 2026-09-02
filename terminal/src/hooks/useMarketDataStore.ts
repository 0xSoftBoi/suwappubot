import { useQuery } from '@tanstack/react-query'
import { api } from '../lib/api'
import { useAuth } from '../contexts/AuthContext'

// Hooks for the proprietary market-data store (GET /webapp/data/*). Named
// "…Store" to avoid colliding with the existing `useMarketData` (live
// price/change/volume for the market info bar).

export function useMarketDataStatus() {
  // /webapp/data/* is flexAuth-gated: a signed-out visitor got 401s rendered as
  // "session expired" errors. Do not query until there is a session.
  const { isAuthenticated } = useAuth()
  return useQuery({
    queryKey: ['market-data-store', 'status'],
    queryFn: () => api.getMarketDataStatus(),
    enabled: isAuthenticated,
    staleTime: 15_000,
    refetchInterval: 30_000,
  })
}

export function useMarketDataOhlcv(symbol: string, chain: string, timeframe: string, limit = 200) {
  // /webapp/data/* is flexAuth-gated: a signed-out visitor got 401s rendered as
  // "session expired" errors. Do not query until there is a session.
  const { isAuthenticated } = useAuth()
  return useQuery({
    queryKey: ['market-data-store', 'ohlcv', symbol, chain, timeframe, limit],
    queryFn: () => api.getMarketDataOhlcv(symbol, chain, timeframe, limit),
    enabled: isAuthenticated && Boolean(symbol && chain && timeframe),
    staleTime: 15_000,
  })
}

export function useMarketDataPerpsMarkets(limit = 100) {
  // /webapp/data/* is flexAuth-gated: a signed-out visitor got 401s rendered as
  // "session expired" errors. Do not query until there is a session.
  const { isAuthenticated } = useAuth()
  return useQuery({
    queryKey: ['market-data-store', 'perps', 'markets', limit],
    queryFn: () => api.getMarketDataPerpsMarkets(limit),
    enabled: isAuthenticated,
    staleTime: 15_000,
    refetchInterval: 30_000,
  })
}

export function useMarketDataPerpsHistory(symbol: string | null, venue: string | null, limit = 200) {
  // /webapp/data/* is flexAuth-gated: a signed-out visitor got 401s rendered as
  // "session expired" errors. Do not query until there is a session.
  const { isAuthenticated } = useAuth()
  return useQuery({
    queryKey: ['market-data-store', 'perps', 'history', symbol, venue, limit],
    queryFn: () => api.getMarketDataPerpsHistory(symbol!, venue!, limit),
    enabled: isAuthenticated && Boolean(symbol && venue),
    staleTime: 15_000,
  })
}

export function useMarketDataPredictionMarkets(q = '', limit = 50) {
  // /webapp/data/* is flexAuth-gated: a signed-out visitor got 401s rendered as
  // "session expired" errors. Do not query until there is a session.
  const { isAuthenticated } = useAuth()
  return useQuery({
    queryKey: ['market-data-store', 'predictions', 'markets', q, limit],
    queryFn: () => api.getMarketDataPredictionMarkets(q, limit),
    enabled: isAuthenticated,
    staleTime: 15_000,
  })
}

export function useMarketDataPredictionHistory(
  marketId: string | null,
  outcome: string | null,
  limit = 200
) {
  // /webapp/data/* is flexAuth-gated: a signed-out visitor got 401s rendered as
  // "session expired" errors. Do not query until there is a session.
  const { isAuthenticated } = useAuth()
  return useQuery({
    queryKey: ['market-data-store', 'predictions', 'history', marketId, outcome, limit],
    queryFn: () => api.getMarketDataPredictionHistory(marketId!, outcome!, limit),
    enabled: isAuthenticated && Boolean(marketId && outcome),
    staleTime: 15_000,
  })
}

export function useMarketDataLendMarkets(limit = 50) {
  // /webapp/data/* is flexAuth-gated: a signed-out visitor got 401s rendered as
  // "session expired" errors. Do not query until there is a session.
  const { isAuthenticated } = useAuth()
  return useQuery({
    queryKey: ['market-data-store', 'lend', 'markets', limit],
    queryFn: () => api.getMarketDataLendMarkets(limit),
    enabled: isAuthenticated,
    staleTime: 15_000,
    refetchInterval: 30_000,
  })
}
