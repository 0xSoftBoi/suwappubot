import { usePerpsWhales } from '../../hooks/usePerpsWhales'
import type { WhalePosition } from '../../types/api'

function formatUsd(n: number) {
  if (n >= 1e9) return `$${(n / 1e9).toFixed(2)}B`
  if (n >= 1e6) return `$${(n / 1e6).toFixed(1)}M`
  if (n >= 1e3) return `$${(n / 1e3).toFixed(0)}K`
  return `$${n.toFixed(0)}`
}

function formatPrice(n: number) {
  if (n >= 1000) return n.toLocaleString('en-US', { maximumFractionDigits: 1 })
  if (n >= 1) return n.toFixed(2)
  return n.toPrecision(4)
}

// Plain-language read of the positioning, with a contrarian nudge.
function read(longPct: number): { label: string; tone: 'bull' | 'bear' | 'neutral' } {
  if (longPct >= 65) return { label: 'Smart money heavily long', tone: 'bull' }
  if (longPct >= 55) return { label: 'Smart money leans long', tone: 'bull' }
  if (longPct <= 35) return { label: 'Smart money heavily short', tone: 'bear' }
  if (longPct <= 45) return { label: 'Smart money leans short', tone: 'bear' }
  return { label: 'Positioning is split', tone: 'neutral' }
}

// Distance from mark to this position's liquidation, as a 0–100 "danger" bar.
function liqRow(p: WhalePosition, mark: number) {
  if (!p.liquidationPrice || !mark) return null
  const distPct = (Math.abs(p.liquidationPrice - mark) / mark) * 100
  // Closer to liq = fuller, redder bar (clamp at 30% away = empty).
  const danger = Math.max(0, Math.min(100, 100 - (distPct / 30) * 100))
  return { distPct, danger }
}

// Smart-money positioning desk — reconstructed from public HyperLiquid
// positions (only possible because HL is on-chain). Shows whether the top
// accounts are net long or short, the "squeeze fuel" on each side, and the
// biggest individual whale positions with distance-to-liquidation.
export function SmartMoneyPanel({ market }: { market: string }) {
  const { data, isLoading } = usePerpsWhales(market)

  if (isLoading && !data) {
    return (
      <div className="py-8 text-center text-sm text-terminal-text-muted animate-pulse">
        Reading whale positions on-chain…
      </div>
    )
  }
  if (!data || data.sampled === 0 || data.positions.length === 0) {
    return (
      <div className="flex h-full items-center justify-center px-4 text-center text-sm text-terminal-text-muted">
        No whale positions found for {market} in the top accounts right now.
      </div>
    )
  }

  const longPct = Math.round(data.longPct)
  const shortPct = 100 - longPct
  const r = read(data.longPct)
  const toneClass = r.tone === 'bull' ? 'text-bull' : r.tone === 'bear' ? 'text-bear' : 'text-terminal-text'

  return (
    <div className="flex h-full flex-col">
      {/* Positioning headline */}
      <div className="border-b border-terminal-border px-3 py-2.5">
        <div className="flex items-center justify-between">
          <span className="text-[10px] font-medium uppercase tracking-wide text-terminal-text-muted">
            Smart money · {data.coin} · top {data.sampled} accounts
          </span>
          <span className={`text-xs font-bold ${toneClass}`}>{r.label}</span>
        </div>
        <div className="mt-2 flex h-2.5 overflow-hidden rounded-full bg-bear/25">
          <div className="h-full bg-bull transition-all" style={{ width: `${longPct}%` }} />
        </div>
        <div className="mt-1 flex justify-between font-mono text-[11px]">
          <span className="text-bull">
            {longPct}% Long · {formatUsd(data.longNotional)} ({data.longCount})
          </span>
          <span className="text-bear">
            ({data.shortCount}) {formatUsd(data.shortNotional)} · Short {shortPct}%
          </span>
        </div>

        {/* Squeeze fuel both directions */}
        <div className="mt-2 grid grid-cols-2 gap-2 text-[10px]">
          <div className="rounded bg-bull-dim/60 px-2 py-1">
            <div className="text-terminal-text-muted">Squeeze fuel (above)</div>
            <div className="font-mono font-semibold text-bull">
              {formatUsd(data.shortLiqAboveNotional)} shorts
            </div>
          </div>
          <div className="rounded bg-bear-dim/60 px-2 py-1">
            <div className="text-terminal-text-muted">Downside liq (below)</div>
            <div className="font-mono font-semibold text-bear">
              {formatUsd(data.longLiqBelowNotional)} longs
            </div>
          </div>
        </div>
      </div>

      {/* Biggest whale positions */}
      <div className="min-h-0 flex-1 overflow-y-auto">
        <table className="w-full text-xs">
          <thead className="sticky top-0 bg-terminal-panel">
            <tr className="text-terminal-text-muted border-b border-terminal-border">
              <th className="py-1.5 px-3 text-left font-medium">Trader</th>
              <th className="py-1.5 px-2 text-right font-medium">Notional</th>
              <th className="py-1.5 px-2 text-right font-medium">Lev</th>
              <th className="py-1.5 px-2 text-right font-medium">Entry</th>
              <th className="py-1.5 px-3 text-right font-medium">→ Liq</th>
              <th className="py-1.5 px-3 text-right font-medium">uPnL</th>
            </tr>
          </thead>
          <tbody>
            {data.positions.map((p, i) => {
              const lq = liqRow(p, data.markPrice)
              return (
                <tr key={`${p.address}-${i}`} className="border-b border-terminal-border/30">
                  <td className="py-1.5 px-3">
                    <span className="flex items-center gap-1.5">
                      <span className={`h-1.5 w-1.5 rounded-full ${p.side === 'long' ? 'bg-bull' : 'bg-bear'}`} />
                      <span className="font-mono text-[11px] text-terminal-text-secondary">{p.address}</span>
                    </span>
                  </td>
                  <td className="py-1.5 px-2 text-right">
                    <span className={`font-mono font-semibold ${p.side === 'long' ? 'text-bull' : 'text-bear'}`}>
                      {formatUsd(p.notional)}
                    </span>
                  </td>
                  <td className="py-1.5 px-2 text-right">
                    <span className="rounded bg-terminal-bg-tertiary/70 px-1 py-0.5 font-mono text-[10px] text-terminal-text-secondary">
                      {p.leverage}×
                    </span>
                  </td>
                  <td className="py-1.5 px-2 text-right font-mono text-terminal-text-secondary">
                    ${formatPrice(p.entryPrice)}
                  </td>
                  <td className="py-1.5 px-3 text-right">
                    {p.liquidationPrice ? (
                      <span className="flex flex-col items-end gap-0.5">
                        <span className="font-mono text-[11px] text-terminal-text">
                          ${formatPrice(p.liquidationPrice)}
                        </span>
                        {lq && (
                          <span className="h-1 w-12 overflow-hidden rounded-full bg-terminal-bg-tertiary">
                            <span
                              className="block h-full bg-bear"
                              style={{ width: `${lq.danger}%` }}
                              title={`${lq.distPct.toFixed(1)}% to liquidation`}
                            />
                          </span>
                        )}
                      </span>
                    ) : (
                      <span className="text-terminal-text-muted">—</span>
                    )}
                  </td>
                  <td
                    className={`py-1.5 px-3 text-right font-mono ${p.unrealizedPnl >= 0 ? 'text-bull' : 'text-bear'}`}
                  >
                    {p.unrealizedPnl >= 0 ? '+' : ''}
                    {formatUsd(Math.abs(p.unrealizedPnl))}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      <div className="border-t border-terminal-border px-3 py-1 text-[9px] text-terminal-text-muted">
        Live on-chain positions via HyperLiquid · only possible because HL is on-chain
      </div>
    </div>
  )
}
