import { useQuery } from '@tanstack/react-query'

const API_BASE = import.meta.env.VITE_API_URL || ''

// Chains for which the backend can resolve a pool and return OHLCV.
// Mirrors GECKO_NETWORK in api/routes/terminal.py — keep in sync. Anything not
// listed here has no chart data source, which is different from "the request
// failed", and the UI must be able to tell those two apart.
const CHART_SUPPORTED_CHAINS = new Set([
  'abstract', 'apechain', 'arbitrum', 'arbitrum_one', 'avalanche', 'avax',
  'base', 'berachain', 'blast', 'bnb', 'bsc', 'eth', 'ethereum', 'fantom',
  'flare', 'flow', 'hyperevm', 'ink', 'linea', 'mantle', 'op', 'opbnb',
  'optimism', 'polygon', 'polygon_pos', 'robinhood', 'scroll', 'sei', 'sol',
  'solana', 'soneium', 'sonic', 'starknet', 'tron', 'unichain', 'zksync',
])

export function isChartSupported(chain: string): boolean {
  return CHART_SUPPORTED_CHAINS.has((chain || '').toLowerCase())
}

interface TrendingToken {
  chainId: string
  tokenAddress: string
  name: string
  symbol: string
  icon?: string
  price?: number
  priceChange24h?: number
  sparkline?: Array<{ time: number; value: number }>
}

interface TokenInfoResponse {
  pairs?: Array<{
    baseToken?: { name: string; symbol: string }
    priceUsd?: string
    priceChange?: { h24?: number }
    marketCap?: number
    fdv?: number
    volume?: { h24?: number }
    liquidity?: { usd?: number }
    dexId?: string
    pairAddress?: string
    chainId?: string
  }>
}

export interface ChartCandle {
  time: number
  open: number
  high: number
  low: number
  close: number
  volume?: number
}

export interface ChartDataResponse {
  candles: ChartCandle[]
  /** true when this chain has no OHLCV source at all (not a fetch failure). */
  unsupported: boolean
}

const DEXSCREENER_API = 'https://api.dexscreener.com/latest/dex'

export function useTrendingTokens(chain?: string) {
  return useQuery<TrendingToken[]>({
    queryKey: ['trending-tokens', chain],
    queryFn: async () => {
      // DexScreener's *boosted tokens* feed is a real discovery endpoint.
      // (Previously this hit `/search?q=trending`, which is a full-text search
      // for the literal word "trending" and returned tokens merely *named*
      // that — not a trending feed at all.)
      const res = await fetch('https://api.dexscreener.com/token-boosts/latest/v1')
      if (!res.ok) return []
      const boosts = (await res.json()) as Array<{
        tokenAddress?: string
        chainId?: string
        icon?: string
      }>
      const filtered = (Array.isArray(boosts) ? boosts : [])
        .filter(b => b.tokenAddress && b.chainId)
        .filter(b => (chain ? b.chainId === chain : true))
        .slice(0, 20)
      if (filtered.length === 0) return []

      // Boosts carry no price data; enrich from the pairs endpoint.
      const enriched = await Promise.all(
        filtered.map(async b => {
          try {
            const r = await fetch(`${DEXSCREENER_API}/tokens/${b.tokenAddress}`)
            const pair = r.ok ? ((await r.json()).pairs || [])[0] : null
            return {
              chainId: b.chainId as string,
              tokenAddress: b.tokenAddress as string,
              name: pair?.baseToken?.name || 'Unknown',
              symbol: pair?.baseToken?.symbol || '',
              icon: b.icon,
              price: pair?.priceUsd ? parseFloat(pair.priceUsd) : 0,
              priceChange24h: pair?.priceChange?.h24 || 0,
            }
          } catch {
            return null
          }
        })
      )
      return enriched.filter(Boolean) as TrendingToken[]
    },
    staleTime: 30_000,
    refetchInterval: 60_000,
    refetchIntervalInBackground: false,
  })
}

export function useTokenInfo(chain: string, address: string) {
  return useQuery<TokenInfoResponse>({
    queryKey: ['token-info', chain, address],
    queryFn: async () => {
      const res = await fetch(`${DEXSCREENER_API}/tokens/${address}`)
      if (!res.ok) throw new Error('Failed to fetch token info')
      return res.json()
    },
    enabled: !!chain && !!address,
    staleTime: 15_000,
    // Traders need the headline price to move, not sit frozen until a manual
    // refetch. Background refetch stays off to save mobile battery/data.
    refetchInterval: 20_000,
    refetchIntervalInBackground: false,
  })
}

export function useTokenChart(chain: string, address: string, timeframe: string) {
  return useQuery<ChartDataResponse>({
    queryKey: ['token-chart', chain, address, timeframe],
    queryFn: async () => {
      if (!isChartSupported(chain)) {
        return { candles: [], unsupported: true }
      }
      // Backed by GET /terminal/chart/ohlcv (Coinbase for ETH/USDC,
      // GeckoTerminal pool OHLCV otherwise). Returns a bare JSON array of
      // candles with `time` in SECONDS — which is what lightweight-charts
      // wants. Reachable via VITE_API_URL: api-ts proxies /terminal/* to the
      // Python API.
      const params = new URLSearchParams({
        pair: address,
        chain,
        interval: timeframe,
        limit: '300',
      })
      const res = await fetch(`${API_BASE}/terminal/chart/ohlcv?${params}`)
      if (!res.ok) throw new Error('Failed to fetch chart data')
      const raw = await res.json()
      const candles: ChartCandle[] = Array.isArray(raw) ? raw : (raw?.candles ?? [])
      return { candles, unsupported: false }
    },
    enabled: !!chain && !!address,
    staleTime: 30_000,
    // Keep the most recent candle live. The backend caches, so this is cheap.
    refetchInterval: 30_000,
    refetchIntervalInBackground: false,
  })
}
