// Formatting helpers for the proprietary market-data store panel. All values
// arrive from the API as strings (postgres numeric) — parse defensively since
// the capture pipeline can emit nulls/partial rows before it's fully warmed.

export function toNum(value: string | number | null | undefined): number | null {
  if (value === null || value === undefined) return null
  const n = typeof value === 'number' ? value : parseFloat(value)
  return Number.isFinite(n) ? n : null
}

export function formatCompactUsd(value: string | number | null | undefined): string {
  const n = toNum(value)
  if (n === null) return '--'
  const abs = Math.abs(n)
  if (abs >= 1_000_000_000) return `$${(n / 1_000_000_000).toFixed(2)}B`
  if (abs >= 1_000_000) return `$${(n / 1_000_000).toFixed(2)}M`
  if (abs >= 1_000) return `$${(n / 1_000).toFixed(1)}K`
  if (abs >= 1) return `$${n.toFixed(2)}`
  return `$${n.toFixed(4)}`
}

export function formatPrice(value: string | number | null | undefined): string {
  const n = toNum(value)
  if (n === null) return '--'
  if (Math.abs(n) >= 1000) return n.toLocaleString('en-US', { maximumFractionDigits: 2 })
  if (Math.abs(n) >= 1) return n.toFixed(4)
  return n.toPrecision(4)
}

// Funding rates from the capture store are stored per-interval fractions
// (e.g. 0.0001 = 0.01%). Display as a signed percentage.
export function formatFundingPct(value: string | number | null | undefined): string {
  const n = toNum(value)
  if (n === null) return '--'
  const pct = n * 100
  const sign = pct >= 0 ? '+' : ''
  return `${sign}${pct.toFixed(4)}%`
}

export function formatApyPct(value: string | number | null | undefined): string {
  const n = toNum(value)
  if (n === null) return '--'
  return `${n.toFixed(2)}%`
}

// Prediction-market outcome price is a 0..1 probability; some feeds already
// send it as 0..100 — normalize defensively.
export function formatProbabilityPct(value: string | number | null | undefined): string {
  const n = toNum(value)
  if (n === null) return '--'
  const pct = n <= 1 ? n * 100 : n
  return `${pct.toFixed(1)}%`
}

export function formatUtilizationPct(value: string | number | null | undefined): string {
  const n = toNum(value)
  if (n === null) return '--'
  const pct = n <= 1 ? n * 100 : n
  return `${pct.toFixed(1)}%`
}

export function formatAge(seconds: number | null | undefined): string {
  if (seconds === null || seconds === undefined || !Number.isFinite(seconds)) return '--'
  if (seconds < 60) return `${Math.round(seconds)}s ago`
  if (seconds < 3600) return `${Math.round(seconds / 60)}m ago`
  if (seconds < 86400) return `${Math.round(seconds / 3600)}h ago`
  return `${Math.round(seconds / 86400)}d ago`
}

export function tsToUnixSeconds(ts: string | number | null | undefined): number | null {
  if (ts === null || ts === undefined) return null
  if (typeof ts === 'number') return ts > 1e12 ? Math.floor(ts / 1000) : Math.floor(ts)
  const n = Date.parse(ts)
  return Number.isFinite(n) ? Math.floor(n / 1000) : null
}
