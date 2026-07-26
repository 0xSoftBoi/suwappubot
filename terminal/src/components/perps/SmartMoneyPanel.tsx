import { usePerpsWhales } from '../../hooks/usePerpsWhales'
import type { WhalePosition } from '../../types/api'
import { TerminalEmptyState, TerminalSkeletonRows } from '../foundation'
import { PositioningStrip } from './PositioningStrip'

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
      <div className="flex h-full flex-col">
        <PositioningStrip market={market} />
        <div className="p-3">
          <TerminalSkeletonRows rows={6} columns={5} label="Reading whale positions on-chain" />
        </div>
      </div>
    )
  }
  if (!data || data.sampled === 0 || data.positions.length === 0) {
    return (
      <div className="flex h-full flex-col">
        <PositioningStrip market={market} />
        <TerminalEmptyState
          className="h-full"
          kicker="Smart money"
          title={`No whale positions in ${market} right now`}
          description="This desk reconstructs the top HyperLiquid accounts' positioning on-chain. None of them hold this perp at the moment — try a higher-volume market."
        />
      </div>
    )
  }

  const longPct = Math.round(data.longPct)
  const shortPct = 100 - longPct
  const r = read(data.longPct)
  const toneClass = r.tone === 'bull' ? 'text-bull' : r.tone === 'bear' ? 'text-bear' : 'text-terminal-text'

  return (
    <div className="flex h-full flex-col">
      <PositioningStrip market={market} />
      {/* Whale positioning headline */}
      <div className="hairline-b px-3 py-2.5">
        <div className="flex items-center justify-between">
          <span className="terminal-theme-caption text-[10px] uppercase">
            Smart money · {data.coin} · top {data.sampled} accounts
          </span>
          <span className={`text-xs font-semibold ${toneClass}`}>
            {r.tone !== 'neutral' && (
              <span aria-hidden="true">{r.tone === 'bull' ? '▲' : '▼'} </span>
            )}
            {r.label}
          </span>
        </div>
        <div
          className="mt-2 flex h-2.5 overflow-hidden rounded-full bg-bear/25"
          role="progressbar"
          aria-label="Share of whale notional that is long"
          aria-valuenow={longPct}
          aria-valuemin={0}
          aria-valuemax={100}
        >
          <div className="h-full bg-bull transition-all" style={{ width: `${longPct}%` }} />
        </div>
        <div className="mt-1 flex justify-between font-mono text-[11px] tnum">
          <span className="text-bull">
            {longPct}% Long · {formatUsd(data.longNotional)} ({data.longCount})
          </span>
          <span className="text-bear">
            ({data.shortCount}) {formatUsd(data.shortNotional)} · Short {shortPct}%
          </span>
        </div>

        {/* Squeeze fuel both directions */}
        <div className="mt-2 grid grid-cols-2 gap-2 text-[10px]">
          <div className="up-wash rounded px-2 py-1">
            <div className="text-terminal-text-muted">Squeeze fuel (above)</div>
            <div className="font-mono font-semibold tnum text-bull">
              {formatUsd(data.shortLiqAboveNotional)} shorts
            </div>
          </div>
          <div className="down-wash rounded px-2 py-1">
            <div className="text-terminal-text-muted">Downside liq (below)</div>
            <div className="font-mono font-semibold tnum text-bear">
              {formatUsd(data.longLiqBelowNotional)} longs
            </div>
          </div>
        </div>
      </div>

      {/* Biggest whale positions */}
      <div className="min-h-0 flex-1 overflow-y-auto">
        <table className="w-full text-xs">
          <thead className="sticky top-0 bg-terminal-panel">
            <tr className="hairline-b text-terminal-text-muted">
              <th className="terminal-theme-caption px-3 py-1.5 text-left text-[10px] uppercase">
                Trader
              </th>
              <th className="terminal-theme-caption px-2 py-1.5 text-right text-[10px] uppercase">
                Notional
              </th>
              <th className="terminal-theme-caption px-2 py-1.5 text-right text-[10px] uppercase">
                Lev
              </th>
              <th className="terminal-theme-caption px-2 py-1.5 text-right text-[10px] uppercase">
                Entry
              </th>
              <th className="terminal-theme-caption px-3 py-1.5 text-right text-[10px] uppercase">
                → Liq
              </th>
              <th className="terminal-theme-caption px-3 py-1.5 text-right text-[10px] uppercase">
                uPnL
              </th>
            </tr>
          </thead>
          <tbody>
            {data.positions.map((p, i) => {
              const lq = liqRow(p, data.markPrice)
              return (
                <tr key={`${p.address}-${i}`} className="hairline-b">
                  <td className="px-3 py-1.5">
                    <span className="flex items-center gap-1.5">
                      <span
                        aria-hidden="true"
                        className={`font-mono text-[10px] ${p.side === 'long' ? 'text-bull' : 'text-bear'}`}
                      >
                        {p.side === 'long' ? '▲' : '▼'}
                      </span>
                      <span className="font-mono text-[11px] text-terminal-text-secondary">
                        {p.address}
                      </span>
                    </span>
                  </td>
                  <td className="px-2 py-1.5 text-right">
                    <span
                      className={`font-mono font-semibold tnum ${p.side === 'long' ? 'text-bull' : 'text-bear'}`}
                    >
                      {formatUsd(p.notional)}
                    </span>
                  </td>
                  <td className="px-2 py-1.5 text-right">
                    <span className="rounded bg-terminal-bg-tertiary/70 px-1 py-0.5 font-mono text-[10px] tnum text-terminal-text-secondary">
                      {p.leverage}×
                    </span>
                  </td>
                  <td className="px-2 py-1.5 text-right font-mono tnum text-terminal-text-secondary">
                    ${formatPrice(p.entryPrice)}
                  </td>
                  <td className="px-3 py-1.5 text-right">
                    {p.liquidationPrice ? (
                      <span className="flex flex-col items-end gap-0.5">
                        <span className="font-mono text-[11px] tnum text-terminal-text">
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
                    className={`px-3 py-1.5 text-right font-mono tnum ${p.unrealizedPnl >= 0 ? 'text-bull' : 'text-bear'}`}
                  >
                    <span aria-hidden="true">{p.unrealizedPnl >= 0 ? '▲' : '▼'}</span>{' '}
                    {p.unrealizedPnl >= 0 ? '+' : '−'}
                    {formatUsd(Math.abs(p.unrealizedPnl))}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      <div className="hairline-t px-3 py-1 text-[9px] text-terminal-text-muted">
        Live on-chain positions via HyperLiquid · only possible because HL is on-chain
      </div>
    </div>
  )
}
