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
      className={`rounded-terminal-card border p-3 transition-colors
        ${onSelect ? 'cursor-pointer' : ''}
        ${
          selected
            ? 'accent-wash border-terminal-border-active'
            : 'border-terminal-border bg-terminal-bg hover:border-terminal-border-active hover:bg-terminal-bg-tertiary/40'
        }`}
    >
      <div className="mb-2.5 flex items-start justify-between gap-2">
        <p className="line-clamp-2 text-[13px] font-semibold leading-snug text-terminal-text">
          {market.question}
        </p>
        {/* Probability is the hero number of a prediction market. */}
        <span className="flex shrink-0 flex-col items-end leading-none">
          <span className="font-mono text-2xl font-semibold leading-none tnum text-terminal-text">
            {yesPct}
            <span className="text-sm text-terminal-text-muted">%</span>
          </span>
          <span className="terminal-theme-caption mt-1 text-[9px] uppercase">Yes</span>
        </span>
      </div>

      {/* Yes/No probability split bar */}
      <div
        className="mb-2 flex h-1.5 overflow-hidden rounded-full bg-bear/25"
        role="progressbar"
        aria-label="Implied probability of Yes"
        aria-valuenow={yesPct}
        aria-valuemin={0}
        aria-valuemax={100}
      >
        <div className="h-full bg-bull transition-all" style={{ width: `${yesPct}%` }} />
      </div>
      <div className="mb-2 flex justify-between font-mono text-[11px] tnum">
        <span className="text-bull">
          <span aria-hidden="true">▲</span> Yes {yesPct}¢
        </span>
        <span className="text-bear">
          No {noPct}¢ <span aria-hidden="true">▼</span>
        </span>
      </div>

      <div className="flex items-center justify-between text-[10px] text-terminal-text-muted">
        <span className="font-mono tnum">Vol {formatVol(market.volume)}</span>
        {ends && (
          <span className="hairline rounded-terminal-pill px-1.5 py-0.5 font-mono text-[10px] tnum">
            {ends}
          </span>
        )}
      </div>
    </div>
  )
}
