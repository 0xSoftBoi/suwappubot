import { useSignals } from '../../hooks/useSignals'
import type { MarketSignal } from '../../types/api'

const SEVERITY: Record<MarketSignal['severity'], { border: string; chip: string }> = {
  alert: { border: 'border-l-bear', chip: 'bg-bear-dim text-bear' },
  warn: { border: 'border-l-[#f59e0b]', chip: 'bg-[#f59e0b]/15 text-[#b45309]' },
  info: { border: 'border-l-sakura-500/60', chip: 'bg-sakura-500/12 text-sakura-600' },
}

const CATEGORY_LABEL: Record<MarketSignal['category'], string> = {
  regime: 'Regime',
  mover: 'Mover',
  funding: 'Funding',
  squeeze: 'Squeeze',
}

function SignalCard({ s }: { s: MarketSignal }) {
  const sev = SEVERITY[s.severity]
  return (
    <div
      className={`rounded-lg border border-terminal-border border-l-[3px] ${sev.border} bg-terminal-bg px-3 py-2 transition-colors hover:bg-terminal-bg-tertiary/40`}
    >
      <div className="flex items-start gap-2.5">
        <span className="text-base leading-none">{s.emoji}</span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-2">
            <span className="truncate text-[13px] font-semibold text-terminal-text">{s.title}</span>
            <span className={`shrink-0 rounded px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide ${sev.chip}`}>
              {CATEGORY_LABEL[s.category]}
            </span>
          </div>
          <p className="mt-0.5 text-[11px] leading-snug text-terminal-text-secondary">{s.detail}</p>
          {s.market && (
            <span className="mt-1 inline-block rounded bg-terminal-bg-tertiary/70 px-1.5 py-0.5 font-mono text-[10px] text-terminal-text-muted">
              {s.market}
            </span>
          )}
        </div>
      </div>
    </div>
  )
}

// Cross-market "what matters right now" feed — top movers, funding extremes,
// squeeze setups and the macro regime, scanned from HyperLiquid's all-markets
// data + Fear & Greed. The terminal's living market monitor.
export function SignalsFeed() {
  const { data, isLoading } = useSignals()

  return (
    <div className="flex h-full flex-col">
      <div className="flex shrink-0 items-center justify-between border-b border-terminal-border px-3 py-2">
        <h3 className="text-sm font-semibold text-terminal-text">Signals</h3>
        <span className="flex items-center gap-1 text-[10px] text-terminal-text-muted">
          <span className="h-1.5 w-1.5 rounded-full bg-bull" /> live · cross-market
        </span>
      </div>

      <div className="min-h-0 flex-1 space-y-2 overflow-y-auto p-3">
        {isLoading && !data ? (
          <div className="py-8 text-center text-sm text-terminal-text-muted animate-pulse">
            Scanning the market…
          </div>
        ) : !data || data.length === 0 ? (
          <div className="py-8 text-center text-sm text-terminal-text-muted">
            Quiet right now — no standout signals across the board.
          </div>
        ) : (
          data.map((s) => <SignalCard key={s.id} s={s} />)
        )}
      </div>
    </div>
  )
}
