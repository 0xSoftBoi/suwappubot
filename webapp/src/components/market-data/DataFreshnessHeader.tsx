import { StatusBadge } from '../ui'
import { formatAge } from '../../lib/marketDataFormat'
import type { DatasetHealth } from '../../types/marketData'

interface DataFreshnessHeaderProps {
  datasets: Record<string, DatasetHealth> | undefined
  isLoading: boolean
}

const LABELS: Record<string, string> = {
  perps: 'Perps',
  predictions: 'Predictions',
  lend: 'Lend',
}

/** Compact row of dataset coverage/freshness pills shown atop the Data page. */
export function DataFreshnessHeader({ datasets, isLoading }: DataFreshnessHeaderProps) {
  if (isLoading) {
    return (
      <div className="flex gap-2 animate-pulse">
        {[0, 1, 2].map((i) => (
          <div key={i} className="h-14 flex-1 bg-suwappu-sakura-mid/30 rounded-suwappu-lg" />
        ))}
      </div>
    )
  }

  if (!datasets) return null

  const entries = Object.entries(datasets).filter(([key]) => LABELS[key])

  return (
    <div className="grid grid-cols-3 gap-2">
      {entries.map(([key, health]) => (
        <div key={key} className="bg-white rounded-suwappu-lg shadow-suwappu-1 p-2 text-center">
          <p className="text-[10px] text-suwappu-text-secondary font-medium">{LABELS[key] || key}</p>
          <p className="font-heading font-bold text-sm text-suwappu-text">{health.count.toLocaleString()}</p>
          <div className="mt-1 flex items-center justify-center gap-1">
            <StatusBadge status={health.healthy ? 'success' : 'warning'} showDot />
            <span className="text-[9px] text-suwappu-text-secondary">{formatAge(health.age_seconds)}</span>
          </div>
        </div>
      ))}
    </div>
  )
}
