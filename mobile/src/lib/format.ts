import type { SnapshotHistoryPoint } from '../types/api'

/** Always 2 decimal places with thousands separators — e.g. $1,234.56. Never
 * shows token-precision (6dp) balances; every screen must route USD amounts
 * through this instead of printing a raw number. */
export function formatUsd(value: number): string {
  return value.toLocaleString('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })
}

export function formatDate(iso: string): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return 'recently'
  return date.toLocaleDateString([], { month: 'short', day: 'numeric' })
}

export function relativeTime(iso: string): string {
  const then = new Date(iso).getTime()
  if (Number.isNaN(then)) return 'recently'
  const minutes = Math.max(0, Math.floor((Date.now() - then) / 60_000))
  if (minutes < 1) return 'just now'
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  return `${Math.floor(hours / 24)}d ago`
}

export function snapshotChange(history: SnapshotHistoryPoint[], current: number) {
  if (history.length < 2) return null
  const first = history[0]
  if (!first || first.valueUsd <= 0) return null
  const delta = current - first.valueUsd
  return { delta, percent: (delta / first.valueUsd) * 100, since: first.date }
}
