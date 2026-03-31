import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { api } from '../../lib/api'
import { MarketCard } from './MarketCard'

export function PredictionPanel() {
  const [search, setSearch] = useState('')

  const { data: markets, isLoading } = useQuery({
    queryKey: ['prediction-markets', search],
    queryFn: () => api.getPredictionMarkets(search || undefined),
    staleTime: 60_000,
  })

  return (
    <div className="p-4 flex flex-col gap-3 h-full">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold">Predictions</h3>
        <span className="text-xs text-terminal-text-muted">via Polymarket</span>
      </div>

      <input
        type="text"
        value={search}
        onChange={e => setSearch(e.target.value)}
        placeholder="Search markets..."
        className="terminal-input text-sm"
      />

      <div className="flex-1 overflow-y-auto space-y-2">
        {isLoading ? (
          <div className="text-center text-terminal-text-muted text-sm animate-pulse py-8">
            Loading markets...
          </div>
        ) : markets?.length === 0 ? (
          <div className="text-center text-terminal-text-muted text-sm py-8">
            No markets found
          </div>
        ) : (
          markets?.map(market => (
            <MarketCard key={market.id} market={market} />
          ))
        )}
      </div>
    </div>
  )
}
