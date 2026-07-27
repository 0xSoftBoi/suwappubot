import type { WalletActivity } from '../../types/api'

interface WalletActivityFeedProps {
  activities: WalletActivity[]
  filterAddress?: string
}

function timeAgo(timestamp: string): string {
  const seconds = Math.floor((Date.now() - new Date(timestamp).getTime()) / 1000)
  if (seconds < 60) return `${seconds}s ago`
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  return `${Math.floor(hours / 24)}d ago`
}

function formatUsd(value: number): string {
  if (value >= 1_000_000) return `$${(value / 1_000_000).toFixed(2)}M`
  if (value >= 1_000) return `$${(value / 1_000).toFixed(1)}K`
  return `$${value.toFixed(2)}`
}

export function WalletActivityFeed({ activities, filterAddress }: WalletActivityFeedProps) {
  const filtered = filterAddress
    ? activities.filter(a => a.walletAddress === filterAddress)
    : activities

  if (filtered.length === 0) {
    return (
      <div className="flex items-center justify-center h-full text-terminal-text-muted text-sm" data-testid="activity-feed-empty">
        {filterAddress ? 'No live activity from this wallet yet' : 'Live wallet activity is not connected yet.'}
      </div>
    )
  }

  return (
    <div className="overflow-y-auto h-full" data-testid="activity-feed">
      <table className="w-full text-xs">
        <thead className="sticky top-0 bg-terminal-panel">
          <tr className="text-terminal-text-muted text-left">
            <th className="px-3 py-1.5 font-medium">Wallet</th>
            <th className="px-3 py-1.5 font-medium">Action</th>
            <th className="px-3 py-1.5 font-medium">Token</th>
            <th className="px-3 py-1.5 font-medium text-right">Amount</th>
            <th className="px-3 py-1.5 font-medium text-right">Price</th>
            <th className="px-3 py-1.5 font-medium text-right">Chain</th>
            <th className="px-3 py-1.5 font-medium text-right">Time</th>
          </tr>
        </thead>
        <tbody>
          {filtered.map(activity => (
            <tr
              key={activity.id}
              className="border-t border-terminal-border hover:bg-terminal-bg-secondary transition-colors cursor-pointer"
              data-testid="activity-row"
            >
              <td className="px-3 py-1.5 font-mono tnum text-terminal-text-secondary">
                {activity.walletLabel || `${activity.walletAddress.slice(0, 6)}...${activity.walletAddress.slice(-4)}`}
              </td>
              <td className="px-3 py-1.5">
                <span className={`font-semibold ${activity.action === 'buy' ? 'text-bull' : 'text-bear'}`}>
                  {activity.action.toUpperCase()}
                </span>
              </td>
              <td className="px-3 py-1.5 font-medium">{activity.tokenSymbol}</td>
              <td className="px-3 py-1.5 text-right font-mono tnum">{formatUsd(activity.amount)}</td>
              <td className="px-3 py-1.5 text-right font-mono tnum text-terminal-text-secondary">
                ${activity.priceUsd < 0.01 ? activity.priceUsd.toFixed(6) : activity.priceUsd.toFixed(2)}
              </td>
              <td className="px-3 py-1.5 text-right text-terminal-text-muted capitalize">{activity.chain}</td>
              <td className="px-3 py-1.5 text-right text-terminal-text-muted">{timeAgo(activity.timestamp)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
