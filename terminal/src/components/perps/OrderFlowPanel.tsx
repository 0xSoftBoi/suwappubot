import { useMemo } from 'react'
import { useHyperliquidFlow } from '../../hooks/useHyperliquidFlow'
import type { CvdPoint, HlTrade } from '../../lib/hyperliquidFeed'

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
  const color = up ? '#22c55e' : '#ef4444'
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
      <div className="grid grid-cols-2 gap-3 border-b border-terminal-border px-3 py-2.5">
        <div>
          <div className="flex items-center gap-1 text-[9px] font-medium uppercase tracking-wide text-terminal-text-muted">
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
              className={`font-mono text-lg font-bold leading-none tabular-nums ${cvdUp ? 'text-bull' : 'text-bear'}`}
            >
              {cvdUp ? '+' : ''}
              {formatSize(flow.cvd)}
            </span>
            <Sparkline points={flow.cvdSeries} up={cvdUp} />
          </div>
          <div className="mt-0.5 text-[10px] text-terminal-text-muted">
            {cvdUp ? 'Buyers in control' : 'Sellers in control'}
          </div>
        </div>

        <div>
          <div className="text-[9px] font-medium uppercase tracking-wide text-terminal-text-muted">
            Book imbalance · {bookLean}
          </div>
          <div className="mt-1.5 flex h-2.5 overflow-hidden rounded-full bg-bear/25">
            <div className="h-full bg-bull transition-all" style={{ width: `${bidPct}%` }} />
          </div>
          <div className="mt-1 flex justify-between font-mono text-[10px]">
            <span className="text-bull">Bids {bidPct}%</span>
            <span className="text-bear">{askPct}% Asks</span>
          </div>
        </div>
      </div>

      {/* Whale-print tape */}
      <div className="flex items-center justify-between px-3 py-1.5 text-[10px] text-terminal-text-muted">
        <span className="font-medium uppercase tracking-wide">Whale prints ≥ {formatUsd(PRINT_THRESHOLD)}</span>
        <span className={flow.status === 'live' ? 'text-bull' : ''}>
          {flow.status === 'live' ? '● live' : flow.status}
        </span>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        {connecting ? (
          <div className="py-6 text-center text-xs text-terminal-text-muted animate-pulse">
            Connecting to HyperLiquid…
          </div>
        ) : prints.length === 0 ? (
          <div className="py-6 text-center text-xs text-terminal-text-muted">
            No prints ≥ {formatUsd(PRINT_THRESHOLD)} yet — watching the tape…
          </div>
        ) : (
          <table className="w-full text-xs">
            <tbody>
              {prints.map((t: HlTrade) => (
                <tr key={t.id} className="border-b border-terminal-border/30">
                  <td className="py-1 px-3">
                    <span className={t.side === 'buy' ? 'text-bull' : 'text-bear'}>
                      {t.side === 'buy' ? '🟢 BUY' : '🔴 SELL'}
                    </span>
                  </td>
                  <td className="py-1 px-2 text-right font-mono tabular-nums text-terminal-text-secondary">
                    {formatSize(t.size)}
                  </td>
                  <td className="py-1 px-2 text-right font-mono tabular-nums text-terminal-text">
                    ${t.price.toLocaleString('en-US', { maximumFractionDigits: 2 })}
                  </td>
                  <td
                    className={`py-1 px-2 text-right font-mono font-semibold tabular-nums ${t.side === 'buy' ? 'text-bull' : 'text-bear'}`}
                  >
                    {formatUsd(t.notional)}
                  </td>
                  <td className="py-1 px-3 text-right font-mono text-[10px] text-terminal-text-muted">
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
