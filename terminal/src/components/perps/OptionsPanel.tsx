import type { ReactNode } from 'react'
import { useOptionsContext } from '../../hooks/useOptionsContext'
import type { OptionsStrikeRow } from '../../types/api'
import { TerminalEmptyState, TerminalSkeletonRows } from '../foundation'

function formatUsd(n: number) {
  if (n >= 1e9) return `$${(n / 1e9).toFixed(2)}B`
  if (n >= 1e6) return `$${(n / 1e6).toFixed(1)}M`
  if (n >= 1e3) return `$${(n / 1e3).toFixed(0)}K`
  return `$${n.toFixed(0)}`
}

function formatStrike(n: number) {
  return n >= 1000 ? `$${Math.round(n).toLocaleString('en-US')}` : `$${n.toFixed(2)}`
}

function daysOutLabel(d: number) {
  return d <= 0 ? 'today' : d === 1 ? '1d' : `${d}d`
}

// "ETH-USD" / "BTC/USD" / "BTC" -> the base asset; null when it isn't one of
// Deribit's two listed currencies.
function mapMarketToCurrency(market: string): 'BTC' | 'ETH' | null {
  const base = market.split('-')[0].split('/')[0].toUpperCase()
  return base === 'BTC' || base === 'ETH' ? base : null
}

// One header tile: uppercase caption over a mono value. `grid-cols-2
// sm:grid-cols-5` on the parent is what stacks these into rows on mobile.
function Tile({ label, title, children }: { label: string; title?: string; children: ReactNode }) {
  return (
    <div title={title}>
      <div className="terminal-theme-caption text-[9px] uppercase">{label}</div>
      <div className="tnum mt-0.5 font-mono text-[13px] font-semibold text-terminal-text">{children}</div>
    </div>
  )
}

// A tiny inline call-vs-put bar for one strike's OI wall.
function StrikeBar({ row }: { row: OptionsStrikeRow }) {
  const callPct = row.oiUsd > 0 ? Math.round((row.callOiUsd / row.oiUsd) * 100) : 50
  return (
    <span
      className="flex h-1.5 w-14 shrink-0 overflow-hidden rounded-full bg-bear/25"
      title={`${formatUsd(row.callOiUsd)} calls · ${formatUsd(row.putOiUsd)} puts`}
    >
      <span className="h-full bg-bull" style={{ width: `${callPct}%` }} />
    </span>
  )
}

// Deribit options intel for BTC/ETH — DVOL, skew, max pain, and the OI
// "walls" that perps desks don't show. Compact, one-screen, data-dense.
export function OptionsPanel({ market }: { market: string }) {
  const currency = mapMarketToCurrency(market)
  const { data, isLoading } = useOptionsContext(currency)

  if (!currency) {
    return (
      <TerminalEmptyState
        className="h-full"
        kicker="Options"
        title="Options intel covers BTC and ETH"
        description="Deribit's listed markets — the majority of crypto options open interest. Switch to a BTC or ETH perp to see it."
      />
    )
  }

  if (isLoading && !data) {
    return (
      <div className="p-3">
        <TerminalSkeletonRows rows={6} columns={4} label={`Reading ${currency} options`} />
      </div>
    )
  }

  if (!data) {
    return (
      <TerminalEmptyState
        className="h-full"
        kicker="Options"
        title="Couldn't reach Deribit"
        description="Options data is temporarily unavailable — try again shortly."
      />
    )
  }

  const dvolUp = data.dvol ? data.dvol.change24h >= 0 : null

  return (
    <div className="flex h-full flex-col">
      {/* Header strip */}
      <div className="hairline-b grid grid-cols-2 gap-3 px-3 py-2.5 sm:grid-cols-5">
        <Tile label="DVOL">
          {data.dvol ? (
            <>
              {data.dvol.value.toFixed(1)}
              <span
                className={`ml-1.5 text-[11px] ${dvolUp ? 'text-bull' : 'text-bear'}`}
                title="24h change in DVOL index points"
              >
                <span aria-hidden="true">{dvolUp ? '▲' : '▼'}</span> {Math.abs(data.dvol.change24h).toFixed(1)}
              </span>
            </>
          ) : (
            <span className="text-terminal-text-muted">—</span>
          )}
        </Tile>
        <Tile label="ATM IV">
          {data.atmIv != null ? (
            `${data.atmIv.toFixed(1)}%`
          ) : (
            <span className="text-terminal-text-muted">—</span>
          )}
        </Tile>
        <Tile
          label="Skew (10Δ proxy)"
          title="Put IV minus call IV at ~10% out-of-the-money — positive means puts are bid (downside hedging demand)."
        >
          {data.skew10pct != null ? (
            <span className={data.skew10pct >= 0 ? 'text-bear' : 'text-bull'}>
              {data.skew10pct >= 0 ? '+' : ''}
              {data.skew10pct.toFixed(1)}
            </span>
          ) : (
            <span className="text-terminal-text-muted">—</span>
          )}
        </Tile>
        <Tile label="Put/Call OI">
          {data.putCallOiRatio != null ? (
            data.putCallOiRatio.toFixed(2)
          ) : (
            <span className="text-terminal-text-muted">—</span>
          )}
        </Tile>
        <Tile label="Total OI">
          {data.totalOiUsd != null ? formatUsd(data.totalOiUsd) : <span className="text-terminal-text-muted">—</span>}
        </Tile>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {/* Max pain */}
        <div className="hairline-b px-3 py-2">
          {data.maxPain ? (
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <span className="terminal-theme-caption text-[9px] uppercase">
                  Max pain · {data.maxPain.expiry}
                </span>
                <div className="tnum font-mono text-[15px] font-semibold text-terminal-text">
                  {formatStrike(data.maxPain.strike)}
                </div>
              </div>
              <span className="max-w-[55%] text-right text-[11px] leading-snug text-terminal-text-secondary">
                Price gravitates toward max pain into expiry — {formatUsd(data.maxPain.oiUsd)} pinned there.
              </span>
            </div>
          ) : (
            <span className="text-[11px] text-terminal-text-muted">Max pain unavailable right now.</span>
          )}
        </div>

        {/* Top strikes — the OI "walls" */}
        <div className="hairline-b px-3 py-2">
          <div className="terminal-theme-caption mb-1.5 text-[9px] uppercase">Open interest walls</div>
          {data.topStrikes.length === 0 ? (
            <span className="text-[11px] text-terminal-text-muted">No strike-level OI reported.</span>
          ) : (
            <table className="w-full text-xs">
              <tbody>
                {data.topStrikes.slice(0, 4).map((row) => (
                  <tr key={row.strike} className="terminal-row">
                    <td className="py-1 font-mono tnum text-terminal-text">{formatStrike(row.strike)}</td>
                    <td className="py-1 text-right font-mono tnum text-terminal-text-secondary">
                      {formatUsd(row.oiUsd)}
                    </td>
                    <td className="py-1 pl-2 text-right">
                      <StrikeBar row={row} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        {/* Expiries */}
        <div className="px-3 py-2">
          <div className="terminal-theme-caption mb-1.5 text-[9px] uppercase">Next expiries</div>
          {data.expiries.length === 0 ? (
            <span className="text-[11px] text-terminal-text-muted">No upcoming expiries reported.</span>
          ) : (
            <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-3">
              {data.expiries.slice(0, 3).map((exp) => (
                <div key={exp.date} className="terminal-theme-card px-2 py-1.5">
                  <div className="font-mono text-[11px] text-terminal-text">{exp.date}</div>
                  <div className="tnum mt-0.5 flex items-baseline justify-between text-[11px]">
                    <span className="text-terminal-text-secondary">{formatUsd(exp.oiUsd)}</span>
                    <span className="text-terminal-text-muted">{daysOutLabel(exp.daysOut)}</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="hairline-t px-3 py-1 text-[9px] text-terminal-text-muted">
        Deribit listed options · refreshes 5m
      </div>
    </div>
  )
}
