import type { PredictionMarket } from '../../types/api'

interface Props {
  market: PredictionMarket
  selected?: boolean
  onSelect?: (market: PredictionMarket) => void
}

function formatVol(v: number) {
  if (v >= 1_000_000) return `$${(v / 1_000_000).toFixed(1)}M`
  if (v >= 1_000) return `$${(v / 1_000).toFixed(0)}K`
  return `$${v.toFixed(0)}`
}

// Compact, human countdown to resolution ("3d", "5h", "Soon", "Ended").
function formatEnds(endDate?: string) {
  if (!endDate) return null
  const ms = new Date(endDate).getTime() - Date.now()
  if (ms <= 0) return 'Ended'
  const days = Math.floor(ms / 86_400_000)
  if (days >= 1) return `${days}d`
  const hours = Math.floor(ms / 3_600_000)
  if (hours >= 1) return `${hours}h`
  return 'Soon'
}

export function MarketCard({ market, selected, onSelect }: Props) {
  const yesPct = Math.round((market.outcomePrices[0] || 0) * 100)
  const noPct = Math.round((market.outcomePrices[1] || 0) * 100)
  const ends = formatEnds(market.endDate)

  return (
    <div
      onClick={() => onSelect?.(market)}
      className={`rounded-lg border p-3 transition-all
        ${onSelect ? 'cursor-pointer' : ''}
        ${
          selected
            ? 'border-sakura-500 bg-sakura-500/10 shadow-[0_2px_10px_rgba(14,165,233,0.12)]'
            : 'border-terminal-border bg-terminal-bg hover:border-terminal-border-active hover:bg-terminal-bg-tertiary/40'
        }`}
    >
      <div className="mb-2.5 flex items-start justify-between gap-2">
        <p className="line-clamp-2 text-[13px] font-semibold leading-snug text-terminal-text">
          {market.question}
        </p>
        <span className="shrink-0 font-mono text-lg font-bold leading-none text-bull tabular-nums">
          {yesPct}
          <span className="text-xs text-terminal-text-muted">%</span>
        </span>
      </div>

      {/* Yes/No probability split bar */}
      <div className="mb-2 flex h-1.5 overflow-hidden rounded-full bg-bear/25">
        <div className="h-full bg-bull transition-all" style={{ width: `${yesPct}%` }} />
      </div>
      <div className="mb-2 flex justify-between font-mono text-[11px]">
        <span className="text-bull">Yes {yesPct}¢</span>
        <span className="text-bear">No {noPct}¢</span>
      </div>

      <div className="flex items-center justify-between text-[10px] text-terminal-text-muted">
        <span>Vol {formatVol(market.volume)}</span>
        {ends && (
          <span className="rounded bg-terminal-bg-tertiary/70 px-1.5 py-0.5 font-medium">{ends}</span>
        )}
      </div>
    </div>
  )
}
