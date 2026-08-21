import { useAuth } from '../../contexts/AuthContext'
import { usePerpsRisk } from '../../hooks/usePerpsRisk'
import type { PerpsRiskLevel } from '../../types/api'
import type { MarginMode } from '../../types/perps'
import { TerminalSkeleton } from '../foundation'

interface Props {
  coin: string
  side: 'long' | 'short'
  size: number
  leverage: number
  marginMode: MarginMode
}

// Per mission spec: ok = muted (no wash), warn = accent-wash, alert = the
// bear tint already used for downside elsewhere (down-wash).
const LEVEL_STYLE: Record<PerpsRiskLevel, { wash: string; text: string }> = {
  ok: { wash: 'hairline bg-terminal-bg', text: 'text-terminal-text-secondary' },
  warn: { wash: 'accent-wash hairline', text: 'text-terminal-accent' },
  alert: { wash: 'down-wash hairline', text: 'text-bear' },
}

function formatUsd(n: number) {
  const abs = Math.abs(n)
  if (abs >= 1e6) return `$${(n / 1e6).toFixed(2)}M`
  if (abs >= 1e3) return `$${Math.round(n).toLocaleString('en-US')}`
  return `$${Math.round(n)}`
}

// Capital-at-risk guard mounted inside the order ticket — turns "est. liq
// price" into a concrete dollar-and-percent number before the user submits.
// Never blocks trading: an error renders nothing (silent, not a red banner),
// and a new estimate keeps showing the last one instead of flickering blank
// while the debounced request is in flight.
export function CapitalAtRiskStrip({ coin, side, size, leverage, marginMode }: Props) {
  const { isAuthenticated } = useAuth()
  const { data, isLoading } = usePerpsRisk({ coin, side, size, leverage, marginMode })

  if (!isAuthenticated || !coin || !(size > 0)) return null

  if (isLoading && !data) {
    return (
      <div className="hairline flex items-center gap-2 rounded-terminal-inset bg-terminal-bg px-3 py-2">
        <TerminalSkeleton width={170} height={12} label="Estimating capital at risk" />
      </div>
    )
  }

  // Errors never block the ticket — just don't show the guard.
  if (!data) return null

  // Keep-previous-data means a market switch can briefly serve the PRIOR
  // coin's numbers under the new coin's ticket — a wrong number is worse than
  // a skeleton, so treat a coin mismatch as still-loading.
  if (data.coin?.toUpperCase() !== coin.toUpperCase()) {
    return (
      <div className="hairline flex items-center gap-2 rounded-terminal-inset bg-terminal-bg px-3 py-2">
        <TerminalSkeleton width={170} height={12} label="Estimating capital at risk" />
      </div>
    )
  }

  const style = LEVEL_STYLE[data.level] ?? LEVEL_STYLE.ok
  const pct = data.pctOfPerpsEquity ?? data.pctOfTotalEquity
  const pctLabel = data.pctOfPerpsEquity != null ? 'perps equity' : 'total equity'

  return (
    <div className={`rounded-terminal-inset px-3 py-2 text-xs ${style.wash}`}>
      <div className="flex flex-wrap items-baseline gap-x-1.5 gap-y-0.5">
        <span className="text-terminal-text-secondary">Risk to liq · {data.coin}:</span>
        <span className={`font-mono font-semibold tnum ${style.text}`}>
          {formatUsd(data.worstCaseLossUsd)}
        </span>
        {pct != null && (
          <span className={`font-mono tnum ${style.text}`}>
            · {pct.toFixed(1)}% of {pctLabel}
          </span>
        )}
        {data.liqPxEst != null && (
          <span
            className="ml-auto font-mono tnum text-terminal-text-muted"
            title="Estimate — HyperLiquid's own liquidation price after opening is authoritative"
          >
            liq ${data.liqPxEst.toLocaleString('en-US', { maximumFractionDigits: 2 })} est.
          </span>
        )}
      </div>
      <p className="mt-1 text-[11px] leading-snug text-terminal-text-secondary">{data.note}</p>
      {data.crossNote && (
        <p className="mt-0.5 text-[11px] leading-snug text-terminal-text-muted">{data.crossNote}</p>
      )}
    </div>
  )
}
