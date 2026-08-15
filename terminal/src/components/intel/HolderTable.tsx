import type { IntelHolder } from '../../types/api'
import { truncateAddress, formatPct, formatBalance } from '../../lib/intelFormat'
import { TerminalEmptyState } from '../foundation'

interface HolderTableProps {
  holders: IntelHolder[]
  top10Pct: number | null
}

function barTone(pct: number): string {
  if (pct >= 15) return 'bg-bear'
  if (pct >= 5) return 'bg-terminal-warn'
  return 'bg-bull'
}

export function HolderTable({ holders, top10Pct }: HolderTableProps) {
  if (!holders || holders.length === 0) {
    return (
      <TerminalEmptyState
        title="No holder data"
        description="Top holders weren't available for this token."
      />
    )
  }

  const maxPct = Math.max(...holders.map((h) => h.pct), 0.0001)

  return (
    <div className="flex flex-col gap-2" data-testid="holder-table">
      <div className="text-[10px] text-terminal-text-secondary">
        Top {holders.length} holders control{' '}
        <span className="tnum font-semibold text-terminal-text">{formatPct(top10Pct, 1)}</span> of supply.
      </div>
      <div className="flex flex-col divide-y divide-terminal-border">
        {holders.map((holder, index) => (
          <div key={holder.address} className="flex items-center gap-2 py-1.5" data-testid="holder-row">
            <span className="w-4 shrink-0 text-[10px] tnum text-terminal-text-muted">{index + 1}</span>
            <span className="w-24 shrink-0 truncate font-mono text-[11px] text-terminal-text" title={holder.address}>
              {truncateAddress(holder.address)}
            </span>
            <div className="h-1.5 flex-1 rounded-full bg-terminal-bg-tertiary overflow-hidden">
              <div
                className={`h-full rounded-full ${barTone(holder.pct)}`}
                style={{ width: `${Math.max(2, (holder.pct / maxPct) * 100)}%` }}
              />
            </div>
            <span className="w-14 shrink-0 text-right text-[10px] tnum text-terminal-text-secondary">
              {formatPct(holder.pct, 2)}
            </span>
            <span className="w-16 shrink-0 text-right text-[10px] tnum text-terminal-text-muted">
              {formatBalance(holder.balance)}
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}
