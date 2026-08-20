import { useAuth } from '../../contexts/AuthContext'
import { useExecutionQuality } from '../../hooks/useExecutionQuality'
import type {
  ExecutionFill,
  ExecutionPerpsAggregates,
  ExecutionSpotQuality,
} from '../../types/api'
import { TerminalEmptyState, TerminalSkeletonRows } from '../foundation'

const MARKOUT_TITLE =
  'Signed price drift after your fill, measured against 1-minute candle closes (±60s precision): negative = the market moved against you (adverse selection).'

function formatUsd(n: number) {
  const abs = Math.abs(n)
  if (abs >= 1e6) return `$${(n / 1e6).toFixed(2)}M`
  if (abs >= 1e3) return `$${(n / 1e3).toFixed(1)}K`
  return `$${n.toFixed(2)}`
}

function formatSize(n: number) {
  if (n >= 1000) return n.toLocaleString('en-US', { maximumFractionDigits: 1 })
  if (n >= 1) return n.toFixed(2)
  return n.toFixed(4)
}

// Compact local time — matches LimitOrderPanel's formatDate idiom, since
// fills/swaps here span days, not a same-session tape.
function formatTime(iso: string) {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '—'
  return d.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

// Signed bps: bull/bear + arrow by sign, em-dash when null — never a
// fabricated 0 for "too recent" / "no candle yet".
function BpsCell({ value }: { value: number | null }) {
  if (value == null) return <span className="text-terminal-text-muted">—</span>
  const up = value >= 0
  return (
    <span className={`font-mono tnum ${up ? 'text-bull' : 'text-bear'}`}>
      <span aria-hidden="true">{up ? '▲' : '▼'}</span> {up ? '+' : ''}
      {value.toFixed(1)}
    </span>
  )
}

function MarkoutChip({ label, value }: { label: string; value: number | null }) {
  return (
    <div className="flex flex-col items-start gap-0.5">
      <span className="terminal-theme-caption text-[9px] uppercase">{label}</span>
      <BpsCell value={value} />
    </div>
  )
}

// The verdict row — avg markout at three horizons, fill count, fees, win
// rate, then the plain-language `read` beneath. This is the header the whole
// panel exists to deliver.
function PerpsHeader({ aggregates }: { aggregates: ExecutionPerpsAggregates }) {
  const { avgMarkoutBps, fillCount, totalFeesUsd, winRate, read } = aggregates
  return (
    <div className="hairline-b px-3 py-2.5">
      <div className="flex flex-wrap items-end gap-x-5 gap-y-2">
        <div title={MARKOUT_TITLE}>
          <span className="terminal-theme-caption text-[9px] uppercase">Markout</span>
          <div className="mt-0.5 flex items-center gap-3">
            <MarkoutChip label="1m" value={avgMarkoutBps.m1} />
            <MarkoutChip label="5m" value={avgMarkoutBps.m5} />
            <MarkoutChip label="30m" value={avgMarkoutBps.m30} />
          </div>
        </div>
        <div className="flex items-baseline gap-1.5">
          <span className="terminal-theme-caption text-[9px] uppercase">Fills</span>
          <span className="font-mono text-[12px] tnum text-terminal-text">{fillCount}</span>
        </div>
        <div className="flex items-baseline gap-1.5">
          <span className="terminal-theme-caption text-[9px] uppercase">Fees</span>
          <span className="font-mono text-[12px] tnum text-terminal-text">
            {formatUsd(totalFeesUsd)}
          </span>
        </div>
        <div className="flex items-baseline gap-1.5">
          <span className="terminal-theme-caption text-[9px] uppercase">Win rate</span>
          <span className="font-mono text-[12px] tnum text-terminal-text">
            {winRate != null ? (
              `${Math.round(winRate * 100)}%`
            ) : (
              <span className="text-terminal-text-muted">—</span>
            )}
          </span>
        </div>
      </div>
      {read && <p className="mt-1.5 text-[11px] leading-snug text-terminal-text-secondary">{read}</p>}
    </div>
  )
}

function FillsTable({ fills }: { fills: ExecutionFill[] }) {
  if (fills.length === 0) {
    return (
      <div className="px-3 py-4 text-center text-[11px] text-terminal-text-muted">
        No recent fills to score yet.
      </div>
    )
  }
  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      <table className="w-full text-xs">
        <thead className="sticky top-0 bg-terminal-panel">
          <tr className="hairline-b text-terminal-text-muted">
            <th className="terminal-theme-caption px-3 py-1.5 text-left text-[10px] uppercase">
              Time
            </th>
            <th className="terminal-theme-caption px-2 py-1.5 text-left text-[10px] uppercase">
              Coin
            </th>
            <th className="terminal-theme-caption px-2 py-1.5 text-left text-[10px] uppercase">
              Side
            </th>
            <th className="terminal-theme-caption px-2 py-1.5 text-right text-[10px] uppercase">
              Px
            </th>
            <th className="terminal-theme-caption px-2 py-1.5 text-right text-[10px] uppercase">
              Size
            </th>
            <th className="terminal-theme-caption px-2 py-1.5 text-right text-[10px] uppercase">
              Fee
            </th>
            <th
              className="terminal-theme-caption px-2 py-1.5 text-right text-[10px] uppercase"
              title={MARKOUT_TITLE}
            >
              1m
            </th>
            <th
              className="terminal-theme-caption px-2 py-1.5 text-right text-[10px] uppercase"
              title={MARKOUT_TITLE}
            >
              5m
            </th>
            <th
              className="terminal-theme-caption px-3 py-1.5 text-right text-[10px] uppercase"
              title={MARKOUT_TITLE}
            >
              30m
            </th>
          </tr>
        </thead>
        <tbody>
          {fills.map((f, i) => (
            <tr key={`${f.time}-${i}`} className="hairline-b">
              <td className="px-3 py-1.5 font-mono text-[10px] text-terminal-text-muted">
                {formatTime(f.time)}
              </td>
              <td className="px-2 py-1.5 font-mono text-[11px] text-terminal-text">{f.coin}</td>
              <td className="px-2 py-1.5">
                <span
                  className={`font-mono text-[10px] ${f.side === 'buy' ? 'text-bull' : 'text-bear'}`}
                >
                  {f.side === 'buy' ? 'Buy' : 'Sell'}
                </span>
              </td>
              <td className="px-2 py-1.5 text-right font-mono tnum text-terminal-text-secondary">
                ${f.px.toLocaleString('en-US', { maximumFractionDigits: 2 })}
              </td>
              <td className="px-2 py-1.5 text-right font-mono tnum text-terminal-text-secondary">
                {formatSize(f.sz)}
              </td>
              <td className="px-2 py-1.5 text-right font-mono tnum text-terminal-text-secondary">
                {formatUsd(f.feeUsd)}
              </td>
              <td className="px-2 py-1.5 text-right">
                <BpsCell value={f.markoutBps.m1} />
              </td>
              <td className="px-2 py-1.5 text-right">
                <BpsCell value={f.markoutBps.m5} />
              </td>
              <td className="px-3 py-1.5 text-right">
                <BpsCell value={f.markoutBps.m30} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

// Spot swap shortfall vs the quote you saw, beneath the perps section. Null
// spot degrades to one honest line, not a big empty-state block — the panel
// as a whole already carries the empty state when there's nothing at all.
function SpotSection({ spot }: { spot: ExecutionSpotQuality | null }) {
  if (!spot) {
    return (
      <div className="hairline-t px-3 py-2 text-[11px] text-terminal-text-muted">
        No swap history yet — shortfall vs quote shows up here once you trade.
      </div>
    )
  }

  const { aggregates, swaps } = spot

  return (
    <div className="hairline-t shrink-0">
      <div className="px-3 py-2">
        <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
          <span className="terminal-theme-caption text-[9px] uppercase">Swap shortfall vs quote</span>
          <BpsCell value={aggregates.avgShortfallBps} />
          <span className="text-[11px] text-terminal-text-muted">
            {aggregates.count} swaps · {formatUsd(aggregates.totalFeesUsd)} fees
          </span>
        </div>
        {aggregates.read && (
          <p className="mt-1 text-[11px] leading-snug text-terminal-text-secondary">
            {aggregates.read}
          </p>
        )}
      </div>

      {aggregates.byRoute.length > 0 && (
        <div className="hairline-t px-3 py-2">
          <table className="w-full text-xs">
            <thead>
              <tr className="text-terminal-text-muted">
                <th className="terminal-theme-caption pb-1 text-left text-[9px] uppercase">
                  Route
                </th>
                <th className="terminal-theme-caption pb-1 text-right text-[9px] uppercase">
                  Count
                </th>
                <th className="terminal-theme-caption pb-1 text-right text-[9px] uppercase">
                  Avg bps
                </th>
              </tr>
            </thead>
            <tbody>
              {aggregates.byRoute.map((r) => (
                <tr key={r.route} className="terminal-row">
                  <td className="py-1 font-mono text-[11px] text-terminal-text-secondary">
                    {r.route}
                  </td>
                  <td className="py-1 text-right font-mono tnum text-terminal-text-secondary">
                    {r.count}
                  </td>
                  <td className="py-1 text-right">
                    <BpsCell value={r.avgShortfallBps} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {swaps.length > 0 && (
        <div className="hairline-t px-3 py-2">
          <div className="terminal-theme-caption mb-1 text-[9px] uppercase">Recent swaps</div>
          <div className="space-y-1">
            {swaps.slice(0, 8).map((s, i) => (
              <div key={`${s.time}-${i}`} className="flex items-center justify-between gap-2 text-[11px]">
                <span className="flex min-w-0 items-center gap-1.5">
                  <span className="font-mono text-[10px] text-terminal-text-muted">
                    {formatTime(s.time)}
                  </span>
                  <span className="truncate text-terminal-text-secondary">{s.pair}</span>
                  <span className="rounded bg-terminal-bg-tertiary/70 px-1 py-0.5 font-mono text-[9px] text-terminal-text-muted">
                    {s.route}
                  </span>
                </span>
                <span className="shrink-0 text-right">
                  {s.shortfallBps != null ? (
                    <BpsCell value={s.shortfallBps} />
                  ) : (
                    <span title={s.note ?? undefined} className="text-terminal-text-muted">
                      {s.note ?? '—'}
                    </span>
                  )}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

const EMPTY_TITLE = 'Your execution quality lives here.'
const EMPTY_DESCRIPTION =
  "Connect and trade — we'll show whether the market moves against your fills (adverse selection), what fees really cost you, and how your fills compare to your quotes."

// Per-user execution quality — the terminal's flagship depth feature.
// Markouts on your own fills (adverse selection self-test), swap
// implementation shortfall vs quote, and fee drag, in plain language. No
// retail terminal ships this; it's the kind of self-audit institutional
// desks run as a matter of course.
export function ExecutionQualityPanel() {
  const { isAuthenticated } = useAuth()
  const { data, isLoading, isError, refetch } = useExecutionQuality()

  if (!isAuthenticated || (!isLoading && data && !data.perps && !data.spot)) {
    return (
      <TerminalEmptyState
        className="h-full"
        kicker="Execution"
        title={EMPTY_TITLE}
        description={EMPTY_DESCRIPTION}
      />
    )
  }

  if (isLoading && !data) {
    return (
      <div className="p-3">
        <TerminalSkeletonRows rows={6} columns={6} label="Scoring your execution" />
      </div>
    )
  }

  if (!data) {
    return (
      <TerminalEmptyState
        className="h-full"
        kicker="Execution"
        title={isError ? "Couldn't load execution quality" : 'Execution quality unavailable'}
        description="Try again shortly."
        action={
          isError ? (
            <button type="button" onClick={() => refetch()} className="terminal-button-secondary px-3 py-1 text-xs">
              Retry
            </button>
          ) : undefined
        }
      />
    )
  }

  return (
    <div className="flex h-full flex-col">
      {data.perps ? (
        <>
          <PerpsHeader aggregates={data.perps.aggregates} />
          <FillsTable fills={data.perps.fills} />
        </>
      ) : (
        <div className="hairline-b px-3 py-2 text-[11px] text-terminal-text-muted">
          No HyperLiquid account linked — connect to see fill-level execution quality.
        </div>
      )}

      <SpotSection spot={data.spot} />

      <div className="hairline-t px-3 py-1 text-[9px] text-terminal-text-muted">
        Markouts vs HyperLiquid 1m candles · shortfall vs your quoted route · refreshes 2m
      </div>
    </div>
  )
}
