import { useMemo } from 'react'
import { useHyperliquidFlow } from '../../hooks/useHyperliquidFlow'
import type { CvdPoint, HlTrade } from '../../lib/hyperliquidFeed'
import { TerminalEmptyState, TerminalSkeletonRows } from '../foundation'

// Trades at/above this USD notional surface in the whale-print tape.
const PRINT_THRESHOLD = 25_000

function formatSize(n: number) {
  if (n >= 1000) return n.toLocaleString('en-US', { maximumFractionDigits: 1 })
  if (n >= 1) return n.toFixed(2)
  return n.toFixed(4)
}

function formatUsd(n: number) {
  if (n >= 1e6) return `$${(n / 1e6).toFixed(2)}M`
  if (n >= 1e3) return `$${(n / 1e3).toFixed(1)}K`
  return `$${n.toFixed(0)}`
}

function formatTime(ms: number) {
  const d = new Date(ms)
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}:${String(d.getSeconds()).padStart(2, '0')}`
}

// Tiny inline CVD sparkline scaled to its own min/max.
function Sparkline({ points, up }: { points: CvdPoint[]; up: boolean }) {
  const path = useMemo(() => {
    if (points.length < 2) return ''
    const vals = points.map((p) => p.value)
    const min = Math.min(...vals)
    const max = Math.max(...vals)
    const range = max - min || 1
    const w = 120
    const h = 28
    return points
      .map((p, i) => {
        const x = (i / (points.length - 1)) * w
        const y = h - ((p.value - min) / range) * h
        return `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`
      })
      .join(' ')
  }, [points])

  if (!path) return null
  // Institutional register up/down (see the dark theme in src/index.css).
  const color = up ? '#2FBF71' : '#E5484D'
  return (
    <svg width={120} height={28} className="overflow-visible">
      <path d={path} fill="none" stroke={color} strokeWidth={1.5} />
    </svg>
  )
}

// Live HyperLiquid order-flow for a perp: CVD (who's the aggressor), order-book
// imbalance (where the resting liquidity leans), and a whale-print tape. All
// from the public HL WebSocket — real-time, no key.
export function OrderFlowPanel({ market }: { market: string }) {
  const flow = useHyperliquidFlow(market)
  const prints = useMemo(
    () => flow.trades.filter((t) => t.notional >= PRINT_THRESHOLD).slice(0, 25),
    [flow.trades]
  )

  const cvdUp = flow.cvd >= 0
  const bidPct = Math.round(flow.imbalance * 100)
  const askPct = 100 - bidPct
  const bookLean =
    flow.imbalance >= 0.6 ? 'Bid-heavy' : flow.imbalance <= 0.4 ? 'Ask-heavy' : 'Balanced'
  const connecting = flow.status !== 'live' && flow.trades.length === 0

  return (
    <div className="flex h-full flex-col">
      {/* Summary band: CVD + book imbalance */}
      <div className="hairline-b grid grid-cols-2 gap-3 px-3 py-2.5">
        <div>
          <div className="terminal-theme-caption flex items-center gap-1 text-[9px] uppercase">
            CVD (session)
            <span
              className="cursor-help"
              title="Cumulative volume delta — running (taker buys − taker sells) since the feed connected. Rising = buyers are the aggressor."
            >
              ⓘ
            </span>
          </div>
          <div className="mt-0.5 flex items-end justify-between gap-2">
            <span
              className={`font-mono text-lg font-semibold leading-none tnum ${cvdUp ? 'text-bull' : 'text-bear'}`}
            >
              <span aria-hidden="true">{cvdUp ? '▲' : '▼'}</span> {cvdUp ? '+' : ''}
              {formatSize(flow.cvd)}
            </span>
            <Sparkline points={flow.cvdSeries} up={cvdUp} />
          </div>
          <div className="mt-0.5 text-[10px] text-terminal-text-muted">
            {cvdUp ? 'Buyers in control' : 'Sellers in control'}
          </div>
        </div>

        <div>
          <div className="terminal-theme-caption text-[9px] uppercase">
            Book imbalance · {bookLean}
          </div>
          <div
            className="mt-1.5 flex h-2.5 overflow-hidden rounded-full bg-bear/25"
            role="progressbar"
            aria-label="Order book bid share"
            aria-valuenow={bidPct}
            aria-valuemin={0}
            aria-valuemax={100}
          >
            <div className="h-full bg-bull transition-all" style={{ width: `${bidPct}%` }} />
          </div>
          <div className="mt-1 flex justify-between font-mono text-[10px] tnum">
            <span className="text-bull">Bids {bidPct}%</span>
            <span className="text-bear">{askPct}% Asks</span>
          </div>
        </div>
      </div>

      {/* Whale-print tape */}
      <div className="flex items-center justify-between px-3 py-1.5 text-[10px] text-terminal-text-muted">
        <span className="terminal-theme-caption text-[9px] uppercase">
          Whale prints ≥ {formatUsd(PRINT_THRESHOLD)}
        </span>
        <span role="status" className={flow.status === 'live' ? 'text-bull' : ''}>
          {flow.status === 'live' ? (
            <>
              <span aria-hidden="true" className="pulse-live">
                ●
              </span>{' '}
              live
            </>
          ) : (
            flow.status
          )}
        </span>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        {connecting ? (
          <div className="p-3">
            <TerminalSkeletonRows rows={5} columns={4} label="Connecting to HyperLiquid" />
          </div>
        ) : prints.length === 0 ? (
          <TerminalEmptyState
            kicker="Order flow"
            title={`No prints ≥ ${formatUsd(PRINT_THRESHOLD)} yet`}
            description="The tape is live — every taker trade at or above this notional lands here the moment it fills."
          />
        ) : (
          <table className="w-full text-xs">
            <tbody>
              {prints.map((t: HlTrade) => (
                <tr key={t.id} className="hairline-b">
                  <td className="px-3 py-1">
                    <span
                      className={`font-mono text-[11px] font-semibold ${t.side === 'buy' ? 'text-bull' : 'text-bear'}`}
                    >
                      <span aria-hidden="true">{t.side === 'buy' ? '▲' : '▼'}</span>{' '}
                      {t.side === 'buy' ? 'BUY' : 'SELL'}
                    </span>
                  </td>
                  <td className="px-2 py-1 text-right font-mono tnum text-terminal-text-secondary">
                    {formatSize(t.size)}
                  </td>
                  <td className="px-2 py-1 text-right font-mono tnum text-terminal-text">
                    ${t.price.toLocaleString('en-US', { maximumFractionDigits: 2 })}
                  </td>
                  <td
                    className={`px-2 py-1 text-right font-mono font-semibold tnum ${t.side === 'buy' ? 'text-bull' : 'text-bear'}`}
                  >
                    {formatUsd(t.notional)}
                  </td>
                  <td className="px-3 py-1 text-right font-mono text-[10px] tnum text-terminal-text-muted">
                    {formatTime(t.time)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}
