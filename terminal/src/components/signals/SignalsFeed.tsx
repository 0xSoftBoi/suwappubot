import { useSignals } from '../../hooks/useSignals'
import { useCatalysts } from '../../hooks/useCatalysts'
import type { Catalyst, MarketSignal } from '../../types/api'
import { TerminalSkeletonRows } from '../foundation'

const SEVERITY: Record<MarketSignal['severity'], { border: string; chip: string }> = {
  alert: { border: 'border-l-bear', chip: 'bg-bear-dim text-bear' },
  warn: { border: 'border-l-terminal-warn', chip: 'bg-terminal-warn/15 text-terminal-warn' },
  info: { border: 'border-l-terminal-accent/60', chip: 'accent-wash text-terminal-accent' },
}

// Known category labels. Cards are schema-driven — a category the frontend
// doesn't recognize yet still renders (falls back to the raw string) instead
// of crashing, so the backend can add new card categories independently.
const CATEGORY_LABEL: Partial<Record<MarketSignal['category'], string>> = {
  regime: 'Regime',
  mover: 'Mover',
  funding: 'Funding',
  squeeze: 'Squeeze',
  positioning: 'Positioning',
  'funding-arb': 'Funding Arb',
  vol: 'Vol',
  event: 'Event',
}

function categoryLabel(category: string): string {
  return CATEGORY_LABEL[category as MarketSignal['category']] ?? category
}

function SignalCard({ s }: { s: MarketSignal }) {
  const sev = SEVERITY[s.severity] ?? SEVERITY.info
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
              {categoryLabel(s.category)}
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

const CATALYST_KIND_LABEL: Record<Catalyst['kind'], string> = {
  fomc: 'FOMC',
  cpi: 'CPI',
  'options-expiry': 'Expiry',
}

// "Jul 29, 2:00 PM" in the viewer's local time when a time is known;
// otherwise just the calendar date (kept in UTC so it doesn't shift across
// the midnight boundary depending on the viewer's timezone).
function formatCatalystWhen(c: Catalyst): string {
  if (!c.timeUtc) {
    const d = new Date(`${c.date}T00:00:00Z`)
    return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', timeZone: 'UTC' })
  }
  const d = new Date(`${c.date}T${c.timeUtc}:00Z`)
  return d.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
}

function CatalystRow({ c }: { c: Catalyst }) {
  return (
    <div className="flex items-center gap-2 py-1 text-[11px]">
      <span className="w-[104px] shrink-0 font-mono tnum text-terminal-text-secondary">
        {formatCatalystWhen(c)}
      </span>
      <span className="shrink-0 rounded bg-terminal-bg-tertiary/70 px-1.5 py-0.5 text-[9px] font-semibold uppercase text-terminal-text-muted">
        {CATALYST_KIND_LABEL[c.kind]}
      </span>
      <span className="truncate text-terminal-text">{c.title}</span>
    </div>
  )
}

// Compact "what's coming up" rail — next 3 macro catalysts (FOMC/CPI/options
// expiries) above the signal cards. Nothing renders when the calendar is
// empty; this isn't the kind of gap that needs an empty-state block.
function CatalystsRail() {
  const { data } = useCatalysts()
  if (!data || data.length === 0) return null
  return (
    <div className="hairline-b shrink-0 px-3 py-2">
      <span className="terminal-theme-caption text-[9px] uppercase">Catalysts</span>
      <div className="mt-1 divide-y divide-terminal-border/60">
        {data.slice(0, 3).map((c, i) => (
          <CatalystRow key={`${c.date}-${c.kind}-${i}`} c={c} />
        ))}
      </div>
    </div>
  )
}

// Cross-market "what matters right now" feed — top movers, funding extremes,
// squeeze setups and the macro regime, scanned from HyperLiquid's all-markets
// data + Fear & Greed. The terminal's living market monitor.
export function SignalsFeed() {
  const { data, isLoading, isError, refetch } = useSignals()

  return (
    <div className="flex h-full flex-col">
      <div className="flex shrink-0 items-center justify-between border-b border-terminal-border px-3 py-2">
        <h3 className="text-sm font-semibold text-terminal-text">Signals</h3>
        <span className="flex items-center gap-1 text-[10px] text-terminal-text-muted" role="status">
          <span className="h-1.5 w-1.5 rounded-full bg-bull pulse-live" /> live · cross-market
        </span>
      </div>

      <CatalystsRail />

      <div className="min-h-0 flex-1 space-y-2 overflow-y-auto p-3">
        {isLoading && !data ? (
          <TerminalSkeletonRows rows={4} columns={2} label="Scanning the market" />
        ) : isError ? (
          <div className="flex flex-col items-center gap-2 py-8 text-center text-sm text-terminal-text-muted">
            <span>Couldn't reach the signals feed.</span>
            <button type="button" onClick={() => refetch()} className="terminal-button-secondary px-3 py-1 text-xs">
              Retry
            </button>
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
