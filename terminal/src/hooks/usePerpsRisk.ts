import { useEffect, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { api } from '../lib/api'
import { useAuth } from '../contexts/AuthContext'
import type { MarginMode } from '../types/perps'

interface RiskInput {
  coin: string
  side: 'long' | 'short'
  size: number
  leverage: number
  marginMode: MarginMode
}

// Debounce the ticket's live inputs (not the request itself) — dragging the
// leverage slider or typing a size shouldn't fire a request per tick. Mirrors
// the debounced-state idiom in useTokens.ts's useDebouncedValue.
function useDebouncedRiskInput(input: RiskInput, delayMs = 400): RiskInput {
  const [debounced, setDebounced] = useState(input)

  useEffect(() => {
    const timeout = window.setTimeout(() => setDebounced(input), delayMs)
    return () => window.clearTimeout(timeout)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [input.coin, input.side, input.size, input.leverage, input.marginMode, delayMs])

  return debounced
}

// Capital-at-risk estimate for the live order ticket — dollar loss to
// liquidation and its share of the account, computed server-side against the
// real HyperLiquid margin math. `keepPreviousData` (via placeholderData) so
// the ticket never flickers blank while a new estimate is in flight.
export function usePerpsRisk(input: RiskInput) {
  const { isAuthenticated } = useAuth()
  const debounced = useDebouncedRiskInput(input)
  const enabled = isAuthenticated && debounced.size > 0 && !!debounced.coin

  return useQuery({
    queryKey: [
      'perps-risk',
      debounced.coin,
      debounced.side,
      debounced.size,
      debounced.leverage,
      debounced.marginMode,
    ],
    queryFn: () => api.getPerpsRisk(debounced),
    enabled,
    placeholderData: (previous) => previous,
    staleTime: 10_000,
  })
}
