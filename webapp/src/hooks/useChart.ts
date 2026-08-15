import { useQuery } from '@tanstack/react-query'

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

interface ChartCandle {
  time: number
  open: number
  high: number
  low: number
  close: number
}

interface ChartDataResponse {
  candles: ChartCandle[]
}

const DEXSCREENER_API = 'https://api.dexscreener.com/latest/dex'

export function useTrendingTokens(chain?: string) {
  return useQuery<TrendingToken[]>({
    queryKey: ['trending-tokens', chain],
    queryFn: async () => {
      const url = chain
        ? `${DEXSCREENER_API}/search?q=trending&chain=${chain}`
        : `${DEXSCREENER_API}/search?q=trending`
      const res = await fetch(url)
      if (!res.ok) return []
      const data = await res.json()
      return (data.pairs || []).slice(0, 20).map((pair: any) => ({
        chainId: pair.chainId || '',
        tokenAddress: pair.baseToken?.address || '',
        name: pair.baseToken?.name || 'Unknown',
        symbol: pair.baseToken?.symbol || '',
        icon: pair.info?.imageUrl,
        price: pair.priceUsd ? parseFloat(pair.priceUsd) : 0,
        priceChange24h: pair.priceChange?.h24 || 0,
      }))
    },
    staleTime: 30_000,
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
  })
}

export function useTokenChart(chain: string, address: string, timeframe: string) {
  return useQuery<ChartDataResponse>({
    queryKey: ['token-chart', chain, address, timeframe],
    queryFn: async () => {
      // DexScreener doesn't provide candle data via public API
      // Return empty data — the chart component handles this gracefully
      return { candles: [] }
    },
    enabled: !!chain && !!address,
    staleTime: 60_000,
  })
}
