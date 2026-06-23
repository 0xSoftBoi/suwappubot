import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import type { PulseFilters, PulseToken } from '../types/api'
import { fetchPulseFeed } from '../lib/dexscreener'
import { enrichWithSafety } from '../lib/helius'

type PulseStage = 'new' | 'final_stretch' | 'migrated'

// Pulse is a memecoin-discovery surface — Solana is the canonical new-pair chain.
const PULSE_CHAIN = 'solana'

const DEFAULT_FILTERS: PulseFilters = {
  minMarketCap: null,
  maxMarketCap: null,
  minLiquidity: null,
  minVolume: null,
  minTxns: null,
  maxAgeMinutes: null,
  maxTopHolderPercent: null,
  maxDevPercent: null,
  maxSniperPercent: null,
  maxBundleCount: null,
  minHolders: null,
}

// Pure filter application: select the active lifecycle stage and apply every
// active filter. On-chain-signal filters (holder concentration, dev/sniper %,
// bundle count) only constrain when the token actually carries that datum, so a
// token whose provider didn't supply the signal isn't wrongly excluded.
export function applyPulseFilters(
  tokens: PulseToken[],
  filters: PulseFilters,
  stage: PulseStage,
  now: number = Date.now(),
): PulseToken[] {
  return tokens.filter((t) => {
    if (t.stage !== stage) return false
    if (filters.minMarketCap != null && t.marketCap < filters.minMarketCap) return false
    if (filters.maxMarketCap != null && t.marketCap > filters.maxMarketCap) return false
    if (filters.minLiquidity != null && t.liquidityUsd < filters.minLiquidity) return false
    if (filters.minVolume != null && t.volume24h < filters.minVolume) return false
    if (filters.minTxns != null && (t.txns24h ?? 0) < filters.minTxns) return false
    if (filters.maxAgeMinutes != null) {
      const ageMin = (now - new Date(t.createdAt).getTime()) / 60_000
      if (Number.isFinite(ageMin) && ageMin > filters.maxAgeMinutes) return false
    }
    if (
      filters.maxTopHolderPercent != null &&
      t.topHolderPercent > 0 &&
      t.topHolderPercent > filters.maxTopHolderPercent
    )
      return false
    if (filters.maxDevPercent != null && t.devPercent > 0 && t.devPercent > filters.maxDevPercent)
      return false
    if (
      filters.maxSniperPercent != null &&
      t.sniperPercent > 0 &&
      t.sniperPercent > filters.maxSniperPercent
    )
      return false
    if (filters.maxBundleCount != null && (t.bundleCount ?? 0) > filters.maxBundleCount) return false
    if (filters.minHolders != null && t.holders > 0 && t.holders < filters.minHolders) return false
    return true
  })
}

export function usePulse() {
  const [activeStage, setActiveStage] = useState<PulseStage>('new')
  const [filters, setFilters] = useState<PulseFilters>(DEFAULT_FILTERS)

  // Live feed from the public DexScreener API (no key). Refreshes every 30s.
  const feed = useQuery({
    queryKey: ['pulse-feed', PULSE_CHAIN],
    queryFn: () => fetchPulseFeed(PULSE_CHAIN),
    staleTime: 15_000,
    refetchInterval: 30_000,
  })

  const baseTokens = useMemo<PulseToken[]>(() => {
    if (!feed.data) return []
    // 'final_stretch' (pump.fun bonding in progress) has no DexScreener source.
    return [...feed.data.new, ...feed.data.migrated]
  }, [feed.data])

  // Layer live safety signals (top-holder %, authority risk) onto the feed via
  // Helius — but only for the tokens actually on screen (the active stage, capped)
  // so we stay within RPC rate limits. Results are cached by mint, so switching
  // stages or refreshing is cheap. The raw feed renders immediately; enriched
  // values replace it as they resolve.
  const stageTokens = useMemo(
    () => baseTokens.filter((t) => t.stage === activeStage).slice(0, 10),
    [baseTokens, activeStage],
  )
  const mintsKey = useMemo(() => stageTokens.map((t) => t.address).join(','), [stageTokens])
  const safety = useQuery({
    queryKey: ['pulse-safety', mintsKey],
    queryFn: () => enrichWithSafety(stageTokens),
    enabled: stageTokens.length > 0,
    staleTime: 5 * 60_000,
  })

  const enrichedByMint = useMemo(() => {
    const m = new Map<string, PulseToken>()
    for (const t of safety.data ?? []) m.set(t.address, t)
    return m
  }, [safety.data])

  // Overlay ONLY the safety fields — never the stage — so a token that appears in
  // both the new and migrated lists keeps its per-row stage.
  const rawTokens = useMemo(
    () =>
      baseTokens.map((t) => {
        const e = enrichedByMint.get(t.address)
        return e
          ? {
              ...t,
              topHolderPercent: e.topHolderPercent,
              trustScore: e.trustScore,
              riskLevel: e.riskLevel,
              holders: e.holders,
            }
          : t
      }),
    [baseTokens, enrichedByMint],
  )

  const tokens = useMemo(
    () => applyPulseFilters(rawTokens, filters, activeStage),
    [rawTokens, filters, activeStage],
  )

  return {
    activeStage,
    setActiveStage,
    tokens,
    filters,
    setFilters,
    resetFilters: () => setFilters(DEFAULT_FILTERS),
    isLoading: feed.isLoading,
    isError: feed.isError,
    // final_stretch needs a pump.fun bonding-curve feed we don't source yet.
    stageUnavailable: activeStage === 'final_stretch',
    lastUpdated: feed.dataUpdatedAt || Date.now(),
  }
}
