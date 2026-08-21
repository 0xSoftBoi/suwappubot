import { TerminalMetricCard, TerminalSkeletonRows, TerminalStatusPill } from '../foundation'
import { formatAge } from '../../lib/marketDataFormat'
import type { MarketDataDatasetStatus, MarketDataStatus } from '../../types/marketData'

interface Props {
  status: MarketDataStatus | undefined
  isLoading: boolean
  error: unknown
}

function DatasetTile({ label, dataset }: { label: string; dataset: MarketDataDatasetStatus | undefined }) {
  const count = dataset?.count ?? 0
  const healthy = dataset?.healthy ?? false
  return (
    <TerminalMetricCard
      label={label}
      value={count.toLocaleString('en-US')}
      detail={`${formatAge(dataset?.age_seconds)}`}
      tone={dataset ? (healthy ? 'up' : 'down') : 'neutral'}
    />
  )
}

// Coverage/status strip for the market-data store: per-dataset row counts +
// freshness so it's obvious at a glance whether the capture pipeline is
// actually populated (it can legitimately be empty pre-deploy).
export function StatusHeader({ status, isLoading, error }: Props) {
  if (isLoading) {
    return <TerminalSkeletonRows rows={2} columns={4} />
  }

  if (error || !status) {
    return (
      <div className="flex items-center gap-2 text-xs text-terminal-text-muted">
        <TerminalStatusPill tone="down">Status unavailable</TerminalStatusPill>
        Couldn't reach the market-data status endpoint.
      </div>
    )
  }

  const timeframeEntries = Object.entries(status.timeframes ?? {})
  const venue = status.venue_datasets

  return (
    <div className="flex flex-wrap gap-2" data-testid="market-data-status">
      {timeframeEntries.map(([tf, dataset]) => (
        <div key={tf} className="w-[120px]">
          <DatasetTile label={`Candles ${tf}`} dataset={dataset} />
        </div>
      ))}
      <div className="w-[120px]">
        <DatasetTile label="Perps" dataset={venue?.perps} />
      </div>
      <div className="w-[120px]">
        <DatasetTile label="Predictions" dataset={venue?.predictions} />
      </div>
      <div className="w-[120px]">
        <DatasetTile label="Lend" dataset={venue?.lend} />
      </div>
    </div>
  )
}
