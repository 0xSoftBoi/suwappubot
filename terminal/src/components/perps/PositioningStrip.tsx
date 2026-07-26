import type { ReactNode } from 'react'
import { usePerpsPositioning } from '../../hooks/usePerpsPositioning'
import { TerminalSkeleton } from '../foundation'

function fundingPct(n: number) {
  return `${(n * 100).toFixed(4)}%`
}

// One inline tile: uppercase caption + mono value, same idiom as
// MarketRegimeStrip's Tile. `flex-wrap` on the parent row is what degrades
// this to a stacked layout on narrow viewports instead of a fixed grid.
function Tile({ label, title, children }: { label: string; title?: string; children: ReactNode }) {
  return (
    <div className="flex shrink-0 items-baseline gap-1.5" title={title}>
      <span className="terminal-theme-caption text-[9px] uppercase">{label}</span>
      <span className="tnum font-mono text-[12px] leading-none">{children}</span>
    </div>
  )
}

// Retail (OKX) positioning mounted above the whale desk below it — retail vs
// smart money, in one glance. OKX doesn't publish long/short or taker flow
// for every market HL lists; those tiles degrade to an honest caption
// instead of a fabricated number. The OKX-vs-HL funding spread works for any
// HL market since it only needs HL's own funding rate.
export function PositioningStrip({ market }: { market: string }) {
  const coin = market.split('-')[0].split('/')[0].toUpperCase()
  const { data, isLoading } = usePerpsPositioning(coin)

  if (isLoading && !data) {
    return (
      <div className="hairline-b flex items-center gap-3 px-3 py-2">
        <TerminalSkeleton width={240} height={12} label="Reading positioning" />
      </div>
    )
  }
  if (!data) return null

  const spread = data.fundingSpreadBps8h

  return (
    <div className="hairline-b px-3 py-2">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5">
        <span className="terminal-theme-caption shrink-0 text-[9px] uppercase text-terminal-text-muted">
          Retail (OKX) · {coin}
        </span>

        {data.longShort ? (
          <Tile label="L/S ratio">
            <span className={data.longShort.value >= 1 ? 'text-bull' : 'text-bear'}>
              {data.longShort.value.toFixed(2)}
            </span>
            <span className={`ml-1 ${data.longShort.change24h >= 0 ? 'text-bull' : 'text-bear'}`}>
              <span aria-hidden="true">{data.longShort.change24h >= 0 ? '▲' : '▼'}</span>{' '}
              {Math.abs(data.longShort.change24h).toFixed(2)}
            </span>
          </Tile>
        ) : (
          <span
            className="text-[11px] text-terminal-text-muted"
            title={`OKX doesn't publish positioning for ${coin}`}
          >
            L/S — not published for {coin}
          </span>
        )}

        {data.takerFlow ? (
          <Tile label={`Taker buy/sell (${data.takerFlow.windowHours}h)`}>
            <span className={data.takerFlow.buySellRatio >= 1 ? 'text-bull' : 'text-bear'}>
              {data.takerFlow.buySellRatio.toFixed(2)}
            </span>
          </Tile>
        ) : (
          <span className="text-[11px] text-terminal-text-muted">Taker flow —</span>
        )}

        <Tile label="Funding 8h · OKX vs HL">
          {data.okx ? fundingPct(data.okx.fundingRate8h) : <span className="text-terminal-text-muted">—</span>}
          <span className="mx-1 text-terminal-text-muted">vs</span>
          {data.hl ? fundingPct(data.hl.funding8h) : <span className="text-terminal-text-muted">—</span>}
          {spread != null && (
            <span
              className={`ml-1.5 rounded px-1 py-0.5 text-[9px] font-semibold ${spread <= 0 ? 'bg-bull-dim text-bull' : 'bg-bear-dim text-bear'}`}
            >
              {spread >= 0 ? '+' : ''}
              {spread.toFixed(1)}bps
            </span>
          )}
        </Tile>
      </div>

      {data.read && <p className="mt-1 text-[11px] leading-snug text-terminal-text-secondary">{data.read}</p>}
    </div>
  )
}
