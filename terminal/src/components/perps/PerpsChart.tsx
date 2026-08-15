import { useState } from 'react'
import { ChartToolbar } from '../chart/ChartToolbar'
import { CandleChartCore } from '../chart/CandleChartCore'
import { usePerpsCandles } from '../../hooks/usePerpsCandles'
import { usePerpsMarketContext } from '../../hooks/usePerpsContext'

interface Props {
  /** HyperLiquid market, e.g. "ETH-USD". */
  market: string
}

function formatPrice(n: number) {
  if (n >= 1000) return n.toLocaleString('en-US', { maximumFractionDigits: 2 })
  if (n >= 1) return n.toFixed(2)
  return n.toPrecision(4)
}

// Compact USD magnitude, e.g. $2.1B / $340M / $12K.
function formatUsd(n: number) {
  if (n >= 1e9) return `$${(n / 1e9).toFixed(2)}B`
  if (n >= 1e6) return `$${(n / 1e6).toFixed(1)}M`
  if (n >= 1e3) return `$${(n / 1e3).toFixed(0)}K`
  return `$${n.toFixed(0)}`
}

// A single labelled stat in the instrument header strip.
function Stat({ label, value, tone }: { label: string; value: string; tone?: 'bull' | 'bear' }) {
  return (
    <span className="flex flex-col items-end leading-tight">
      <span className="terminal-theme-caption text-[9px] uppercase">{label}</span>
      <span
        className={`tnum ${
          tone === 'bull'
            ? 'text-bull'
            : tone === 'bear'
              ? 'text-bear'
              : 'text-terminal-text-secondary'
        }`}
      >
        {tone ? <span aria-hidden="true">{tone === 'bull' ? '▲' : '▼'} </span> : null}
        {value}
      </span>
    </span>
  )
}

// Live candlestick chart for a single HyperLiquid perp, with a pro instrument
// header: real mark price + 24h change, plus the market-intel strip (open
// interest, basis, funding, 24h volume) from HyperLiquid's public feed.
export function PerpsChart({ market }: Props) {
  const [interval, setInterval] = useState('1h')
  const [chartType, setChartType] = useState<'candle' | 'line'>('candle')

  const { data: candles, isLoading } = usePerpsCandles(market, interval)
  const ctx = usePerpsMarketContext(market)

  // Prefer the live mark + real 24h change from the context feed; fall back to
  // the latest candle close before the feed lands.
  const last = ctx?.markPrice ?? (candles && candles.length ? candles[candles.length - 1].close : null)
  const changePct = ctx?.dayChangePct ?? null
  const up = (changePct ?? 0) >= 0
  const fundingUp = (ctx?.funding ?? 0) >= 0
  const basisUp = (ctx?.basisPct ?? 0) >= 0

  return (
    <div className="flex h-full flex-col">
      <div className="hairline-b flex items-center justify-between gap-3 px-3 py-2">
        <div className="flex items-baseline gap-2.5">
          <span className="text-sm font-semibold tracking-tight text-terminal-text">{market}</span>
          <span className="accent-wash terminal-theme-caption rounded px-1.5 py-0.5 text-[10px] uppercase text-terminal-accent">
            Perp
          </span>
          {last != null && (
            <span
              key={last}
              className="font-mono text-lg font-semibold leading-none tnum text-terminal-text"
            >
              ${formatPrice(last)}
            </span>
          )}
          {changePct != null && (
            <span
              className={`rounded px-1.5 py-0.5 font-mono text-[11px] font-semibold tnum ${
                up ? 'up-wash text-bull' : 'down-wash text-bear'
              }`}
            >
              <span aria-hidden="true">{up ? '▲' : '▼'}</span> {up ? '+' : ''}
              {changePct.toFixed(2)}%
            </span>
          )}
        </div>
        {ctx && (
          <div className="hidden items-center gap-3.5 font-mono text-[11px] tnum sm:flex">
            <Stat label="Open Interest" value={formatUsd(ctx.oiNotional)} />
            <Stat label="24h Vol" value={formatUsd(ctx.dayVolume)} />
            <Stat
              label="Funding/1h"
              value={`${fundingUp ? '+' : ''}${(ctx.funding * 100).toFixed(4)}%`}
              tone={fundingUp ? 'bull' : 'bear'}
            />
            <Stat
              label="Basis"
              value={`${basisUp ? '+' : ''}${ctx.basisPct.toFixed(3)}%`}
              tone={basisUp ? 'bull' : 'bear'}
            />
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
