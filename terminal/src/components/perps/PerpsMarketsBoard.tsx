import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { api } from '../../lib/api'
import type { HLMarket } from '../../types/api'
import { usePerpsFunding, formatFundingPct } from '../../hooks/usePerpsFunding'

interface Props {
  selectedMarket: string
  onSelectMarket: (market: string) => void
}

// Funding cell uses the shared funding hook so the rate matches the order ticket.
function FundingCell({ market }: { market: HLMarket }) {
  const funding = usePerpsFunding(market)
  return (
    <span className={`font-mono ${funding.hourlyRate >= 0 ? 'text-bull' : 'text-bear'}`}>
      {formatFundingPct(funding.hourlyRate)}
    </span>
  )
}

// The full HyperLiquid markets board — every perp with live mark, funding and max
// leverage. Selecting a row drives the order ticket. This is the perps desk's
// equivalent of the spot pair list.
export function PerpsMarketsBoard({ selectedMarket, onSelectMarket }: Props) {
  const [search, setSearch] = useState('')
  const { data: markets, isLoading } = useQuery({
    queryKey: ['perps-markets'],
    queryFn: () => api.getPerpsMarkets(),
    staleTime: 15_000,
    refetchInterval: 20_000,
  })

  const filtered = useMemo(() => {
    const list = markets ?? []
    const q = search.trim().toUpperCase()
    const matched = q ? list.filter((m) => m.name.toUpperCase().includes(q)) : list
    return [...matched].sort((a, b) => b.markPrice - a.markPrice)
  }, [markets, search])

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between gap-2 border-b border-terminal-border px-3 py-2">
        <h3 className="text-sm font-semibold text-terminal-text">Markets</h3>
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search…"
          className="terminal-input h-7 w-28 text-xs"
        />
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {isLoading ? (
          <div className="py-8 text-center text-sm text-terminal-text-muted animate-pulse">
            Loading markets…
          </div>
        ) : filtered.length === 0 ? (
          <div className="py-8 text-center text-sm text-terminal-text-muted">No markets</div>
        ) : (
          <table className="w-full text-xs">
            <thead className="sticky top-0 bg-terminal-panel">
              <tr className="text-terminal-text-muted border-b border-terminal-border">
                <th className="text-left py-1.5 px-3 font-medium">Market</th>
                <th className="text-right py-1.5 px-3 font-medium">Mark</th>
                <th className="text-right py-1.5 px-3 font-medium">Funding/1h</th>
                <th className="text-right py-1.5 px-3 font-medium">Max Lev</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((m) => {
                const active = m.name === selectedMarket
                return (
                  <tr
                    key={m.name}
                    onClick={() => onSelectMarket(m.name)}
                    className={`cursor-pointer border-b border-terminal-border/40 transition-colors
                      ${active ? 'bg-sakura-500/10' : 'hover:bg-terminal-bg-tertiary/50'}`}
                  >
                    <td className="py-1.5 px-3">
                      <span
                        className={`font-medium ${active ? 'text-sakura-400' : 'text-terminal-text'}`}
                      >
                        {m.name}
                      </span>
                    </td>
                    <td className="py-1.5 px-3 text-right font-mono">${m.markPrice.toFixed(2)}</td>
                    <td className="py-1.5 px-3 text-right">
                      <FundingCell market={m} />
                    </td>
                    <td className="py-1.5 px-3 text-right font-mono text-terminal-text-secondary">
                      {m.maxLeverage}x
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}
