import { useMemo, useState } from 'react'
import type { PulseFilters, PulseToken } from '../types/api'

type PulseStage = 'new' | 'final_stretch' | 'migrated'

const DEFAULT_FILTERS: PulseFilters = {
  minMarketCap: null,
  maxMarketCap: null,
  minLiquidity: null,
  maxTopHolderPercent: null,
  maxDevPercent: null,
  maxSniperPercent: null,
  minHolders: null,
}

export function usePulse() {
  const [activeStage, setActiveStage] = useState<PulseStage>('new')
  const [filters, setFilters] = useState<PulseFilters>(DEFAULT_FILTERS)
  const tokens = useMemo<PulseToken[]>(() => [], [])

  return {
    activeStage,
    setActiveStage,
    tokens,
    filters,
    setFilters,
    resetFilters: () => setFilters(DEFAULT_FILTERS),
    lastUpdated: Date.now(),
  }
}
