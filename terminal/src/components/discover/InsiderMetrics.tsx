interface InsiderMetricsProps {
  topHolderPercent: number
  devPercent: number
  sniperPercent: number
}

function getColor(value: number): string {
  if (value < 20) return 'text-green-400'
  if (value < 50) return 'text-yellow-400'
  return 'text-red-400'
}

function getBarColor(value: number): string {
  if (value < 20) return 'bg-green-500'
  if (value < 50) return 'bg-yellow-500'
  return 'bg-red-500'
}

function MiniBar({ label, value }: { label: string; value: number }) {
  const clamped = Math.min(100, Math.max(0, value))
  return (
    <div className="flex items-center gap-1" title={`${label}: ${value.toFixed(1)}%`}>
      <span className="text-[9px] text-terminal-text-muted w-7 shrink-0">{label}</span>
      <div className="w-8 h-1.5 bg-terminal-bg-tertiary rounded-full overflow-hidden">
        <div
          className={`h-full rounded-full ${getBarColor(value)}`}
          style={{ width: `${clamped}%` }}
        />
      </div>
      <span className={`text-[9px] font-mono w-7 text-right ${getColor(value)}`}>
        {value.toFixed(0)}%
      </span>
    </div>
  )
}

export function InsiderMetrics({ topHolderPercent, devPercent, sniperPercent }: InsiderMetricsProps) {
  return (
    <div className="flex flex-col gap-0.5" data-testid="insider-metrics">
      <MiniBar label="Top10" value={topHolderPercent} />
      <MiniBar label="Dev" value={devPercent} />
      <MiniBar label="Snipe" value={sniperPercent} />
    </div>
  )
}
