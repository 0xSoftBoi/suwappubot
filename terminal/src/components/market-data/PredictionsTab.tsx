import { useEffect, useMemo, useState } from 'react'
import { TerminalEmptyState, TerminalSkeletonRows, TerminalTextField } from '../foundation'
import { MiniLineChart } from './MiniLineChart'
import { useMarketDataPredictionHistory, useMarketDataPredictionMarkets } from '../../hooks/useMarketDataStore'
import { formatCompactUsd, formatProbabilityPct, toNum, tsToUnixSeconds } from '../../lib/marketDataFormat'
import type { UTCTimestamp } from 'lightweight-charts'

function useDebouncedValue(value: string, delayMs = 250) {
  const [debounced, setDebounced] = useState(value)
  useEffect(() => {
    const timeout = window.setTimeout(() => setDebounced(value), delayMs)
    return () => window.clearTimeout(timeout)
  }, [value, delayMs])
  return debounced
}

export function PredictionsTab() {
  const [searchInput, setSearchInput] = useState('')
  const debouncedSearch = useDebouncedValue(searchInput)
  const [selected, setSelected] = useState<{ marketId: string; outcome: string; question: string } | null>(null)

  const { data, isLoading, isError, error, refetch } = useMarketDataPredictionMarkets(debouncedSearch, 50)
  const markets = data?.markets ?? []

  const historyQuery = useMarketDataPredictionHistory(selected?.marketId ?? null, selected?.outcome ?? null, 200)
  const historyPoints = useMemo(() => {
    const outcomes = historyQuery.data?.outcomes
    if (!outcomes || !selected) return undefined
    const series = outcomes[selected.outcome]
    if (!series) return []
    return series
      .map((p) => {
        const time = tsToUnixSeconds(p.ts)
        const rawPrice = toNum(p.price)
        if (time === null || rawPrice === null) return null
        const value = rawPrice <= 1 ? rawPrice * 100 : rawPrice
        return { time: time as UTCTimestamp, value }
      })
      .filter((p): p is { time: UTCTimestamp; value: number } => p !== null)
      .sort((a, b) => a.time - b.time)
  }, [historyQuery.data, selected])

  if (isError) {
    return (
      <div className="p-3">
        <TerminalEmptyState
          kicker="Load failed"
          title="Couldn't load prediction markets"
          description={
            typeof error === 'object' && error && 'detail' in error
              ? String((error as { detail?: string }).detail)
              : "Couldn't reach the market-data predictions endpoint."
          }
          action={
            <button className="terminal-button px-3 py-1.5 text-xs" onClick={() => refetch()}>
              Retry
            </button>
          }
        />
      </div>
    )
  }

  return (
    <div className="flex h-full flex-col gap-2 p-2 lg:flex-row">
      <div className="flex min-h-0 flex-1 flex-col gap-2">
        <TerminalTextField
          aria-label="Search prediction markets"
          value={searchInput}
          onChange={(e) => setSearchInput(e.target.value)}
          placeholder="Search markets by question…"
        />

        <div className="min-h-0 flex-1 overflow-y-auto">
          {isLoading ? (
            <TerminalSkeletonRows rows={6} columns={3} />
          ) : markets.length === 0 ? (
            <TerminalEmptyState
              kicker="No data yet"
              title="No prediction markets captured yet"
              description="The capture service hasn't populated this dataset yet — expected before deploy."
            />
          ) : (
            <ul className="flex flex-col gap-1">
              {markets.map((m, idx) => {
                const isSelected = selected?.marketId === m.market_id && selected?.outcome === m.outcome
                return (
                  <li key={`${m.market_id}-${m.outcome}-${idx}`}>
                    <button
                      onClick={() => setSelected({ marketId: m.market_id, outcome: m.outcome, question: m.question })}
                      className={`terminal-theme-card flex w-full flex-col gap-0.5 px-2.5 py-2 text-left transition-colors hover:bg-terminal-bg-tertiary/50 ${
                        isSelected ? 'bg-terminal-bg-tertiary/70' : ''
                      }`}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="min-w-0 flex-1 truncate text-[12px] text-terminal-text">{m.question}</span>
                        <span className="tnum shrink-0 font-mono text-[12px] font-semibold text-terminal-accent">
                          {m.outcome}: {formatProbabilityPct(m.price)}
                        </span>
                      </div>
                      <div className="flex gap-3 text-[10px] text-terminal-text-muted">
                        <span>{m.venue}</span>
                        <span>Vol {formatCompactUsd(m.volume)}</span>
                        <span>Liq {formatCompactUsd(m.liquidity)}</span>
                      </div>
                    </button>
                  </li>
                )
              })}
            </ul>
          )}
        </div>
      </div>

      <div className="flex min-h-[200px] w-full flex-col gap-1.5 lg:w-[360px] lg:shrink-0">
        <div className="text-[10px] uppercase text-terminal-text-muted">
          {selected ? `${selected.outcome} odds history — ${selected.question}` : 'Select a market for its odds history'}
        </div>
        {selected ? (
          <MiniLineChart data={historyPoints} isLoading={historyQuery.isLoading} emptyLabel="No odds history captured yet." />
        ) : (
          <div className="hairline flex h-full min-h-[160px] items-center justify-center rounded-[10px] text-xs text-terminal-text-muted">
            Click a market to see its odds history
          </div>
        )}
      </div>
    </div>
  )
}
