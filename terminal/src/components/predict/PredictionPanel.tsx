import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { api } from '../../lib/api'
import type { PredictionMarket } from '../../types/api'
import { MarketCard } from './MarketCard'

interface Props {
  selectedId?: string
  onSelect?: (market: PredictionMarket) => void
}

// Polymarket market browser. Search + scrollable list of markets. When given
// onSelect/selectedId it behaves as the selectable browse column of the
// predictions desk; standalone it's a read-only list.
export function PredictionPanel({ selectedId, onSelect }: Props) {
  const [search, setSearch] = useState('')

  const { data: markets, isLoading } = useQuery({
    queryKey: ['prediction-markets', search],
    queryFn: () => api.getPredictionMarkets(search || undefined),
    staleTime: 60_000,
  })

  return (
    <div className="flex h-full flex-col gap-3 p-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold">Predictions</h3>
        <span className="text-xs text-terminal-text-muted">via Polymarket</span>
      </div>

      <input
        type="text"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder="Search markets..."
        className="terminal-input text-sm"
      />

      <div className="flex-1 space-y-2 overflow-y-auto">
        {isLoading ? (
          <div className="animate-pulse py-8 text-center text-sm text-terminal-text-muted">
            Loading markets...
          </div>
        ) : markets?.length === 0 ? (
          <div className="py-8 text-center text-sm text-terminal-text-muted">No markets found</div>
        ) : (
          markets?.map((market) => (
            <MarketCard
              key={market.id}
              market={market}
              selected={selectedId === market.id}
              onSelect={onSelect}
            />
          ))
        )}
      </div>
    </div>
  )
}
