import { useMemo, useState } from 'react'
import { TerminalEmptyState, TerminalSkeletonRows } from '../foundation'
import { MiniLineChart } from './MiniLineChart'
import { useMarketDataPerpsHistory, useMarketDataPerpsMarkets } from '../../hooks/useMarketDataStore'
import { formatCompactUsd, formatFundingPct, formatPrice, toNum, tsToUnixSeconds } from '../../lib/marketDataFormat'
import type { MarketDataPerpMarket } from '../../types/marketData'
import type { UTCTimestamp } from 'lightweight-charts'

type SortKey = 'symbol' | 'funding_rate' | 'open_interest' | 'mark_price'

export function PerpsTab() {
  const { data, isLoading, isError, error, refetch } = useMarketDataPerpsMarkets(100)
  const [sortKey, setSortKey] = useState<SortKey>('funding_rate')
  const [sortDesc, setSortDesc] = useState(true)
  const [selected, setSelected] = useState<{ symbol: string; venue: string } | null>(null)

  const markets = data?.markets ?? []

  const sorted = useMemo(() => {
    const copy = [...markets]
    copy.sort((a, b) => {
      if (sortKey === 'symbol') {
        return sortDesc ? b.symbol.localeCompare(a.symbol) : a.symbol.localeCompare(b.symbol)
      }
      const av = toNum(a[sortKey]) ?? -Infinity
      const bv = toNum(b[sortKey]) ?? -Infinity
      return sortDesc ? bv - av : av - bv
    })
    return copy
  }, [markets, sortKey, sortDesc])

  const historyQuery = useMarketDataPerpsHistory(selected?.symbol ?? null, selected?.venue ?? null, 200)
  const historyPoints = useMemo(() => {
    const metrics = historyQuery.data?.metrics
    if (!metrics) return undefined
    return metrics
      .map((m) => {
        const time = tsToUnixSeconds(m.ts)
        const value = toNum(m.funding_rate)
        if (time === null || value === null) return null
        return { time: time as UTCTimestamp, value: value * 100 }
      })
      .filter((p): p is { time: UTCTimestamp; value: number } => p !== null)
      .sort((a, b) => a.time - b.time)
  }, [historyQuery.data])

  const toggleSort = (key: SortKey) => {
    if (key === sortKey) setSortDesc((d) => !d)
    else {
      setSortKey(key)
      setSortDesc(true)
    }
  }

  if (isError) {
    return (
      <div className="p-3">
        <TerminalEmptyState
          kicker="Load failed"
          title="Couldn't load perps markets"
          description={
            typeof error === 'object' && error && 'detail' in error
              ? String((error as { detail?: string }).detail)
              : "Couldn't reach the market-data perps endpoint."
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

  if (isLoading) {
    return (
      <div className="p-3">
        <TerminalSkeletonRows rows={6} columns={5} />
      </div>
    )
  }

  if (markets.length === 0) {
    return (
      <div className="p-3">
        <TerminalEmptyState
          kicker="No data yet"
          title="No perp funding/OI captured yet"
          description="The capture service hasn't populated this dataset yet — expected before deploy."
        />
      </div>
    )
  }

  return (
    <div className="flex h-full flex-col gap-2 p-2 lg:flex-row">
      <div className="min-h-0 flex-1 overflow-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-terminal-border text-terminal-text-muted">
              <SortHeader label="Venue" />
              <SortHeader label="Symbol" active={sortKey === 'symbol'} desc={sortDesc} onClick={() => toggleSort('symbol')} />
              <SortHeader label="Funding" align="right" active={sortKey === 'funding_rate'} desc={sortDesc} onClick={() => toggleSort('funding_rate')} />
              <SortHeader label="Open Interest" align="right" active={sortKey === 'open_interest'} desc={sortDesc} onClick={() => toggleSort('open_interest')} />
              <SortHeader label="Mark Price" align="right" active={sortKey === 'mark_price'} desc={sortDesc} onClick={() => toggleSort('mark_price')} />
            </tr>
          </thead>
          <tbody>
            {sorted.map((m: MarketDataPerpMarket, idx) => {
              const fundingNum = toNum(m.funding_rate)
              const isSelected = selected?.symbol === m.symbol && selected?.venue === m.venue
              return (
                <tr
                  key={`${m.venue}-${m.symbol}-${idx}`}
                  onClick={() => setSelected({ symbol: m.symbol, venue: m.venue })}
                  className={`cursor-pointer border-b border-terminal-border/50 transition-colors hover:bg-terminal-bg-tertiary/50 ${
                    isSelected ? 'bg-terminal-bg-tertiary/70' : ''
                  }`}
                >
                  <td className="px-2 py-1.5 text-terminal-text-muted">{m.venue}</td>
                  <td className="px-2 py-1.5 font-medium text-terminal-text">{m.symbol}</td>
                  <td className={`tnum px-2 py-1.5 text-right font-mono ${fundingNum !== null && fundingNum >= 0 ? 'text-bull' : 'text-bear'}`}>
                    {formatFundingPct(m.funding_rate)}
                  </td>
                  <td className="tnum px-2 py-1.5 text-right font-mono text-terminal-text-secondary">
                    {formatCompactUsd(m.open_interest)}
                  </td>
                  <td className="tnum px-2 py-1.5 text-right font-mono text-terminal-text">
                    {formatPrice(m.mark_price)}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      <div className="flex min-h-[200px] w-full flex-col gap-1.5 lg:w-[360px] lg:shrink-0">
        <div className="text-[10px] uppercase text-terminal-text-muted">
          {selected ? `${selected.symbol} funding rate history` : 'Select a market for its funding history'}
        </div>
        {selected ? (
          <MiniLineChart data={historyPoints} isLoading={historyQuery.isLoading} emptyLabel="No funding history captured yet." />
        ) : (
          <div className="hairline flex h-full min-h-[160px] items-center justify-center rounded-[10px] text-xs text-terminal-text-muted">
            Click a row to see its funding history
          </div>
        )}
      </div>
    </div>
  )
}

function SortHeader({
  label,
  align = 'left',
  active,
  desc,
  onClick,
}: {
  label: string
  align?: 'left' | 'right'
  active?: boolean
  desc?: boolean
  onClick?: () => void
}) {
  return (
    <th
      className={`px-2 py-1.5 font-medium ${align === 'right' ? 'text-right' : 'text-left'} ${
        onClick ? 'cursor-pointer select-none hover:text-terminal-text' : ''
      } ${active ? 'text-terminal-text' : ''}`}
      onClick={onClick}
    >
      {label}
      {active ? <span className="ml-1">{desc ? '▼' : '▲'}</span> : null}
    </th>
  )
}
