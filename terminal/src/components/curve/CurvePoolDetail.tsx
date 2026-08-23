import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import {
  CURVE_CANDLE_SIZES,
  fetchCurvePoolDetail,
  fetchLpCandles,
  type CurvePool,
} from '../../lib/curve'
import { CandleChartCore } from '../chart/CandleChartCore'

function compactUsd(value: number): string {
  const sign = value < 0 ? '-' : ''
  const magnitude = Math.abs(value)
  if (magnitude >= 1e12) return `${sign}$${(magnitude / 1e12).toFixed(2)}t`
  if (magnitude >= 1e9) return `${sign}$${(magnitude / 1e9).toFixed(2)}b`
  if (magnitude >= 1e6) return `${sign}$${(magnitude / 1e6).toFixed(2)}m`
  if (magnitude >= 1e3) return `${sign}$${(magnitude / 1e3).toFixed(2)}k`
  if (magnitude === 0) return '$0'
  return `${sign}$${magnitude.toFixed(2)}`
}

interface Props {
  pool: CurvePool
  chain: string
  tradable: boolean
  onBack: () => void
  onTrade: (pool: CurvePool) => void
}

// The view flet-curve opens each pool onto (and the video leads with): a
// pan/zoom candlestick chart of the pool's LP token price plus the pool's
// composition and figures, with the actions beside it. Chart pan/zoom comes
// from CandleChartCore (lightweight-charts), same as the spot/perps desks.
export function CurvePoolDetail({ pool, chain, tradable, onBack, onTrade }: Props) {
  const [size, setSize] = useState(CURVE_CANDLE_SIZES[2]) // 4h default

  const { data: candles, isLoading: candlesLoading } = useQuery({
    queryKey: ['curve', 'lp-candles', chain, pool.address, size.label],
    queryFn: () => fetchLpCandles({ chain, pool: pool.address, size }),
    staleTime: 60_000,
  })

  const { data: detail } = useQuery({
    queryKey: ['curve', 'pool-detail', pool.chainId, pool.address],
    queryFn: () => fetchCurvePoolDetail(pool.chainId, pool.address),
    staleTime: 5 * 60_000,
  })

  const coins = detail?.coins?.length ? detail.coins : pool.coins
  const balances = detail?.balancesUsd ?? []
  const balancesTotal = balances.reduce((a, b) => a + b, 0)

  const withdrawUrl = pool.poolUrl ? pool.poolUrl.replace(/\/deposit$/, '/withdraw') : ''

  return (
    <div className="flex h-full flex-col overflow-hidden" data-testid="curve-pool-detail">
      <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-terminal-border px-2 py-1.5">
        <button
          onClick={onBack}
          className="terminal-button-secondary px-2 py-1 text-xs"
          data-testid="curve-detail-back"
        >
          ← Pools
        </button>
        <span className="text-sm font-medium text-terminal-text">{pool.name}</span>
        <span className="rounded-full border border-terminal-border px-1.5 py-0.5 text-[10px] text-terminal-text-muted">
          {chain}
        </span>
        <div className="ml-auto flex items-center gap-2">
          {tradable && (
            <button
              onClick={() => onTrade(pool)}
              className="terminal-button px-2.5 py-1 text-xs"
              data-testid="curve-detail-trade"
            >
              Trade in desk
            </button>
          )}
          {pool.poolUrl && (
            <>
              <a
                href={pool.poolUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="terminal-button-secondary px-2.5 py-1 text-xs"
              >
                Deposit ↗
              </a>
              <a
                href={withdrawUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="terminal-button-secondary px-2.5 py-1 text-xs"
              >
                Withdraw ↗
              </a>
            </>
          )}
        </div>
      </div>

      <div className="flex shrink-0 items-center gap-1 border-b border-terminal-border px-2 py-1">
        <span className="mr-1 text-[10px] uppercase tracking-wide text-terminal-text-muted">
          LP token price
        </span>
        {CURVE_CANDLE_SIZES.map((s) => (
          <button
            key={s.label}
            onClick={() => setSize(s)}
            className={`terminal-tab text-xs ${s.label === size.label ? 'terminal-tab-active' : ''}`}
            aria-pressed={s.label === size.label}
          >
            {s.label}
          </button>
        ))}
      </div>

      <div className="min-h-0 flex-1">
        <CandleChartCore
          candles={candles}
          isLoading={candlesLoading}
          chartType="candle"
          label={`${pool.name} · LP price`}
          emptyState={{
            title: 'No chart data',
            subtitle: 'The Curve Prices API has no LP OHLC history for this pool.',
          }}
        />
      </div>

      <div className="shrink-0 border-t border-terminal-border px-2 py-1.5">
        <div className="mb-1.5 flex flex-wrap gap-x-4 gap-y-1 text-xs">
          <span className="text-terminal-text-muted">
            TVL <span className="tnum text-terminal-text">{compactUsd(detail?.tvlUsd ?? pool.tvlUsd)}</span>
          </span>
          <span className="text-terminal-text-muted">
            24h vol <span className="tnum text-terminal-text">{compactUsd(detail?.volume24h ?? pool.volume24h)}</span>
          </span>
          <span className="text-terminal-text-muted">
            Base APR <span className="tnum text-terminal-text">{pool.baseApr.toFixed(2)}%</span>
          </span>
          {detail ? (
            <span className="text-terminal-text-muted">
              24h fees <span className="tnum text-terminal-text">{compactUsd(detail.tradingFee24h)}</span>
            </span>
          ) : null}
        </div>
        {coins.length > 0 && (
          <div className="flex flex-col gap-1" data-testid="curve-detail-composition">
            {coins.map((coin, i) => {
              const usd = balances[i] ?? 0
              const pct = balancesTotal > 0 ? (usd / balancesTotal) * 100 : 0
              return (
                <div key={`${coin.address}-${i}`} className="flex items-center gap-2 text-xs">
                  <span className="w-16 shrink-0 truncate text-terminal-text" title={coin.address}>
                    {coin.symbol}
                  </span>
                  <div className="h-1.5 min-w-0 flex-1 overflow-hidden rounded bg-terminal-bg-secondary">
                    <div
                      className="h-full rounded bg-terminal-accent/70"
                      style={{ width: `${Math.max(pct, usd > 0 ? 2 : 0)}%` }}
                    />
                  </div>
                  <span className="tnum w-20 shrink-0 text-right text-terminal-text-secondary">
                    {balancesTotal > 0 ? compactUsd(usd) : '—'}
                  </span>
                  <span className="tnum w-12 shrink-0 text-right text-terminal-text-muted">
                    {balancesTotal > 0 ? `${pct.toFixed(1)}%` : ''}
                  </span>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
