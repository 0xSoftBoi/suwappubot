import { useQuery } from '@tanstack/react-query'
import { useMemo } from 'react'
import { api } from '../lib/api'
import type { PerpsMarketContext } from '../types/api'

// Live per-market intelligence for the perps desk (OI, basis, funding, 24h
// stats) from HyperLiquid's public metaAndAssetCtxs feed. One call covers every
// market; components look theirs up by asset/name.
export function usePerpsContext() {
  return useQuery({
    queryKey: ['perps-context'],
    queryFn: () => api.getPerpsContext(),
    staleTime: 15_000,
    refetchInterval: 20_000,
  })
}

// Convenience: the context row for a single market ("ETH-USD" or "ETH").
export function usePerpsMarketContext(market: string | null): PerpsMarketContext | undefined {
  const { data } = usePerpsContext()
  return useMemo(() => {
    if (!data || !market) return undefined
    const asset = market.split('-')[0].split('/')[0].toUpperCase()
    return data.find((m) => m.asset === asset || m.name === market)
  }, [data, market])
}
