import { usePortfolio } from '../../hooks/usePortfolio'

export function PnLSummary() {
  const { data: portfolio, isLoading } = usePortfolio()
  const totalValue = portfolio ? `$${portfolio.totalUsdValue.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : '--'
  const stats = [
    { label: 'Total Value', value: isLoading ? 'Loading...' : totalValue, color: 'text-terminal-text' },
    { label: '24h PnL', value: '--', color: 'text-terminal-text-muted' },
    { label: 'All-Time PnL', value: '--', color: 'text-terminal-text-muted' },
  ]

  return (
    <div className="grid grid-cols-3 gap-3">
      {stats.map(stat => (
        <div key={stat.label} className="terminal-panel p-3 text-center">
          <div className="text-xs uppercase text-terminal-text-muted tracking-wider mb-1">
            {stat.label}
          </div>
          <div className={`font-mono text-lg ${stat.color}`}>
            {stat.value}
          </div>
        </div>
      ))}
    </div>
  )
}
