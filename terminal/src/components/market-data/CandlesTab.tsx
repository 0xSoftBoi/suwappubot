import { useMemo, useState } from 'react'
import { CandleChartCore } from '../chart/CandleChartCore'
import { TerminalEmptyState, TerminalSegmentedTabs, TerminalTextField } from '../foundation'
import { useMarketDataOhlcv } from '../../hooks/useMarketDataStore'
import { toNum, tsToUnixSeconds } from '../../lib/marketDataFormat'
import type { OHLCVCandle } from '../../types/api'

const TIMEFRAMES = [
  { id: '1m', label: '1m' },
  { id: '5m', label: '5m' },
  { id: '1h', label: '1h' },
  { id: '1d', label: '1d' },
]

const CHAINS = ['ethereum', 'base', 'arbitrum', 'solana', 'bsc', 'polygon']

export function CandlesTab() {
  const [symbol, setSymbol] = useState('ETH')
  const [chain, setChain] = useState('ethereum')
  const [timeframe, setTimeframe] = useState('1h')
  const [symbolInput, setSymbolInput] = useState('ETH')

  const { data, isLoading, isError, error, refetch } = useMarketDataOhlcv(symbol, chain, timeframe, 200)

  const candles = useMemo<OHLCVCandle[] | undefined>(() => {
    if (!data) return undefined
    return data.candles
      .map((c) => {
        const time = tsToUnixSeconds(c.ts)
        const open = toNum(c.open)
        const high = toNum(c.high)
        const low = toNum(c.low)
        const close = toNum(c.close)
        const volume = toNum(c.volume) ?? 0
        if (time === null || open === null || high === null || low === null || close === null) return null
        return { time, open, high, low, close, volume }
      })
      .filter((c): c is OHLCVCandle => c !== null)
  }, [data])

  return (
    <div className="flex h-full flex-col gap-2 p-2">
      <div className="flex shrink-0 flex-wrap items-center gap-2">
        <form
          className="flex items-center gap-1.5"
          onSubmit={(e) => {
            e.preventDefault()
            const trimmed = symbolInput.trim().toUpperCase()
            if (trimmed) setSymbol(trimmed)
          }}
        >
          <TerminalTextField
            aria-label="Symbol"
            value={symbolInput}
            onChange={(e) => setSymbolInput(e.target.value)}
            placeholder="Symbol (e.g. ETH)"
            mono
            className="w-28"
          />
        </form>
        <select
          value={chain}
          onChange={(e) => setChain(e.target.value)}
          className="text-xs bg-terminal-bg-secondary border border-terminal-border rounded px-2 py-1.5 text-terminal-text focus:outline-none focus:border-terminal-border-active"
          aria-label="Chain"
        >
          {CHAINS.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
        <TerminalSegmentedTabs activeId={timeframe} onChange={setTimeframe} options={TIMEFRAMES} />
      </div>

      <div className="min-h-0 flex-1">
        {isError ? (
          <TerminalEmptyState
            kicker="Load failed"
            title="Couldn't load candles"
            description={
              typeof error === 'object' && error && 'detail' in error
                ? String((error as { detail?: string }).detail)
                : "Couldn't reach the market-data OHLCV endpoint."
            }
            action={
              <button className="terminal-button px-3 py-1.5 text-xs" onClick={() => refetch()}>
                Retry
              </button>
            }
          />
        ) : (
          <CandleChartCore
            candles={candles}
            isLoading={isLoading}
            chartType="candle"
            label={`${symbol} ${timeframe}`}
            emptyState={{
              title: 'No candles captured yet for this symbol/timeframe.',
              subtitle: "The capture service hasn't populated this dataset yet — expected before deploy.",
            }}
          />
        )}
      </div>
    </div>
  )
}
