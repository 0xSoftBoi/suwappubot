import { useState, useMemo } from 'react'
import { ChartToolbar } from '../chart/ChartToolbar'
import { CandleChartCore } from '../chart/CandleChartCore'
import { usePerpsCandles } from '../../hooks/usePerpsCandles'

interface Props {
  /** HyperLiquid market, e.g. "ETH-USD". */
  market: string
}

function formatPrice(n: number) {
  if (n >= 1000) return n.toLocaleString('en-US', { maximumFractionDigits: 2 })
  if (n >= 1) return n.toFixed(2)
  return n.toPrecision(4)
}

// Live candlestick chart for a single HyperLiquid perp. Owns its own interval +
// chart-type toggle and renders a header band with last price / session change
// derived from the candle window.
export function PerpsChart({ market }: Props) {
  const [interval, setInterval] = useState('1h')
  const [chartType, setChartType] = useState<'candle' | 'line'>('candle')

  const { data: candles, isLoading } = usePerpsCandles(market, interval)

  const stats = useMemo(() => {
    if (!candles || candles.length === 0) return null
    const last = candles[candles.length - 1].close
    const first = candles[0].open
    const change = last - first
    const changePct = first !== 0 ? (change / first) * 100 : 0
    const high = Math.max(...candles.map((c) => c.high))
    const low = Math.min(...candles.map((c) => c.low))
    return { last, change, changePct, high, low }
  }, [candles])

  const up = (stats?.change ?? 0) >= 0

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between gap-3 border-b border-terminal-border px-3 py-2">
        <div className="flex items-baseline gap-2.5">
          <span className="text-sm font-bold tracking-tight text-terminal-text">{market}</span>
          <span className="rounded bg-sakura-500/12 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-sakura-600">
            Perp
          </span>
          {stats && (
            <>
              <span className="font-mono text-lg font-bold leading-none text-terminal-text tabular-nums">
                ${formatPrice(stats.last)}
              </span>
              <span
                className={`rounded px-1.5 py-0.5 font-mono text-[11px] font-semibold ${
                  up ? 'bg-bull-dim text-bull' : 'bg-bear-dim text-bear'
                }`}
              >
                {up ? '+' : ''}
                {stats.changePct.toFixed(2)}%
              </span>
            </>
          )}
        </div>
        {stats && (
          <div className="hidden items-center gap-3 font-mono text-[11px] text-terminal-text-secondary sm:flex">
            <span className="flex flex-col items-end leading-tight">
              <span className="text-[9px] uppercase tracking-wide text-terminal-text-muted">24h H</span>
              <span className="tabular-nums">${formatPrice(stats.high)}</span>
            </span>
            <span className="flex flex-col items-end leading-tight">
              <span className="text-[9px] uppercase tracking-wide text-terminal-text-muted">24h L</span>
              <span className="tabular-nums">${formatPrice(stats.low)}</span>
            </span>
          </div>
        )}
      </div>
      <ChartToolbar
        interval={interval}
        onIntervalChange={setInterval}
        chartType={chartType}
        onChartTypeChange={setChartType}
      />
      <div className="min-h-0 flex-1">
        <CandleChartCore
          candles={candles}
          isLoading={isLoading}
          chartType={chartType}
          label={market}
          emptyState={{
            title: 'No candle data for this market.',
            subtitle: 'HyperLiquid has not returned candles for this perp yet.',
          }}
        />
      </div>
    </div>
  )
}
