import { useCopyTrades } from '../../hooks/useCopyTrading'
import type { CopyTrade } from '../../types/api'

function truncateAddress(addr: string): string {
  if (addr.length <= 12) return addr
  return `${addr.slice(0, 6)}...${addr.slice(-4)}`
}

function formatPnl(value: number): string {
  const prefix = value >= 0 ? '+' : ''
  return `${prefix}$${Math.abs(value).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

function timeAgo(timestamp: string): string {
  const now = Date.now()
  const then = new Date(timestamp).getTime()
  const seconds = Math.floor((now - then) / 1000)
  if (seconds < 60) return `${seconds}s ago`
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  return `${days}d ago`
}

export function CopyFeed() {
  const { data: trades = [], isLoading } = useCopyTrades(50)

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12 text-terminal-text-muted text-sm">
        Loading copy trades...
      </div>
    )
  }

  return (
    <div className="divide-y divide-terminal-border/50">
      {trades.map((trade: CopyTrade) => (
        <div key={trade.id} className="flex items-center gap-3 px-3 py-2.5 hover:bg-terminal-bg-tertiary/50 transition-colors">
          {/* Action badge */}
          <div className={`px-2 py-0.5 rounded text-[10px] font-semibold uppercase shrink-0 ${
            trade.status === 'failed'
              ? 'bg-bear-dim text-bear'
              : trade.status && trade.status !== 'copied'
                ? 'bg-terminal-bg-tertiary text-terminal-text-secondary'
                : trade.action === 'buy'
              ? 'bg-bull-dim text-bull'
              : 'bg-bear-dim text-bear'
          }`}>
            {trade.status || trade.action}
          </div>

          {/* Details */}
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-1.5">
              <span className="text-xs font-mono tnum text-terminal-text-secondary">
                {truncateAddress(trade.traderAddress)}
              </span>
              <span className="text-terminal-text-muted text-[10px]">traded</span>
              <span className="text-xs font-semibold text-terminal-text">{trade.tokenPair}</span>
            </div>
            <div className="flex items-center gap-2 mt-0.5">
              <span className="text-[10px] font-mono tnum text-terminal-text-muted">
                ${trade.amount.toLocaleString()}
              </span>
              {trade.pnl !== 0 && (
                <span className={`text-[10px] font-mono tnum ${trade.pnl >= 0 ? 'text-bull' : 'text-bear'}`}>
                  {formatPnl(trade.pnl)}
                </span>
              )}
            </div>
          </div>

          {/* Timestamp */}
          <span className="text-[10px] text-terminal-text-muted shrink-0">
            {timeAgo(trade.timestamp)}
          </span>
        </div>
      ))}

      {!trades.length && (
        <div className="flex items-center justify-center py-12 text-terminal-text-muted text-sm">
          No copy trades yet
        </div>
      )}
    </div>
  )
}
