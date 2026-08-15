/**
 * Formatting helpers for the market-data pages. All numeric fields from
 * `/webapp/data/*` arrive as strings (Postgres numeric) — always parse
 * with `parseNum` before formatting or charting.
 */

export function parseNum(v: string | number | null | undefined): number {
  if (v === null || v === undefined) return NaN
  const n = typeof v === 'number' ? v : parseFloat(v)
  return Number.isFinite(n) ? n : NaN
}

/** Compact USD, e.g. $1.23M, $45.6K, $7.89 */
export function formatCompactUsd(v: number): string {
  if (!Number.isFinite(v)) return '—'
  const abs = Math.abs(v)
  if (abs >= 1e9) return `$${(v / 1e9).toFixed(2)}B`
  if (abs >= 1e6) return `$${(v / 1e6).toFixed(2)}M`
  if (abs >= 1e3) return `$${(v / 1e3).toFixed(2)}K`
  return `$${v.toFixed(2)}`
}

/** Price with adaptive decimals depending on magnitude. */
export function formatPrice(v: number): string {
  if (!Number.isFinite(v)) return '—'
  if (v === 0) return '0'
  if (v >= 1000) return v.toLocaleString('en-US', { maximumFractionDigits: 2 })
  if (v >= 1) return v.toFixed(2)
  if (v >= 0.0001) return v.toFixed(6)
  return v.toExponential(2)
}

/** Percent already expressed as a fraction (0.0123 -> +1.23%). */
export function formatPercent(v: number, decimals = 2): string {
  if (!Number.isFinite(v)) return '—'
  const pct = v * 100
  return `${pct >= 0 ? '+' : ''}${pct.toFixed(decimals)}%`
}

/** Probability (0..1) -> 0-100%, no sign. */
export function formatProbability(v: number): string {
  if (!Number.isFinite(v)) return '—'
  const pct = v <= 1 ? v * 100 : v
  return `${pct.toFixed(1)}%`
}

/** APY fraction (0.0512 -> 5.12%) or already-percent values. */
export function formatApy(v: number): string {
  if (!Number.isFinite(v)) return '—'
  const pct = Math.abs(v) <= 2 ? v * 100 : v
  return `${pct.toFixed(2)}%`
}

/** Human-readable "how stale" label from an age in seconds. */
export function formatAge(seconds: number | null | undefined): string {
  if (seconds === null || seconds === undefined || !Number.isFinite(seconds)) return 'unknown'
  if (seconds < 60) return 'just now'
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`
  return `${Math.floor(seconds / 86400)}d ago`
}
