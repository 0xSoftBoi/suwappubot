export function PnLSummary() {
  const stats = [
    { label: 'Total Value', value: '$12,450.00', color: 'text-terminal-text' },
    { label: '24h PnL', value: '+$234.50 (+1.9%)', color: 'text-bull' },
    { label: 'All-Time PnL', value: '+$1,230.00 (+11.0%)', color: 'text-bull' },
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
