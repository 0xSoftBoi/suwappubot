import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { api } from '../../lib/api'
import type { PredictionMarket } from '../../types/api'
import { MarketCard } from './MarketCard'
import { TerminalEmptyState, TerminalSkeletonRows } from '../foundation'

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
        <h3 className="text-sm font-semibold text-terminal-text">Predictions</h3>
        <span className="terminal-theme-caption text-[10px] uppercase">via Polymarket</span>
      </div>

      <input
        type="text"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder="Search markets..."
        aria-label="Search prediction markets"
        className="terminal-input text-sm"
      />

      <div className="flex-1 space-y-2 overflow-y-auto">
        {isLoading ? (
          <TerminalSkeletonRows rows={6} columns={3} label="Loading prediction markets" />
        ) : markets?.length === 0 ? (
          <TerminalEmptyState
            kicker="Predictions"
            title={search ? `Nothing matches “${search}”` : 'No markets found'}
            description={
              search
                ? 'Try a shorter phrase — Polymarket titles are full questions, so single keywords match best.'
                : 'Polymarket returned no open markets right now. This list refreshes on its own.'
            }
          />
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
