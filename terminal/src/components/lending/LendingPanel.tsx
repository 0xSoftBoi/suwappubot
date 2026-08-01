import { useState } from 'react'
import { useLendingMarkets } from '../../hooks/useLending'
import { MarketCard } from './MarketCard'
import { TerminalSkeletonText } from '../foundation'

const chains = ['All', 'Ethereum', 'Base', 'Arbitrum', 'Optimism']

export function LendingPanel() {
  const [chainFilter, setChainFilter] = useState('All')
  const { data: markets, isLoading } = useLendingMarkets()

  const filtered = chainFilter === 'All'
    ? markets
    : markets?.filter(m => m.chain.toLowerCase() === chainFilter.toLowerCase())

  return (
    <div className="p-4 flex flex-col gap-3 h-full">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-terminal-text">Morpho Blue Markets</h3>
        <select
          value={chainFilter}
          onChange={e => setChainFilter(e.target.value)}
          className="terminal-input text-xs py-1 px-2"
          aria-label="Filter by chain"
        >
          {chains.map(c => (
            <option key={c} value={c}>{c}</option>
          ))}
        </select>
      </div>

      <div className="flex-1 overflow-y-auto">
        {isLoading ? (
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="rounded-lg border border-terminal-border bg-terminal-bg p-3">
                <TerminalSkeletonText lines={3} label={i === 0 ? 'Loading lending markets' : undefined} />
              </div>
            ))}
          </div>
        ) : filtered?.length === 0 ? (
          <div className="text-center text-terminal-text-muted text-sm py-8">
            No provider-backed lending markets available.
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {filtered?.map(market => (
              <MarketCard key={market.id} market={market} />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
