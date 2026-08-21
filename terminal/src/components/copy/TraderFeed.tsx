import { useTraderFeed } from '../../hooks/useCopyTrading'
import type { TraderActivity, TraderFeedItem } from '../../types/api'

function truncateAddress(address: string): string {
  if (address.length <= 12) return address
  return `${address.slice(0, 6)}...${address.slice(-4)}`
}

function formatPnl(value: number): string {
  const prefix = value >= 0 ? '+' : '-'
  return `${prefix}$${Math.abs(value).toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`
}

function timeAgo(timestamp: string): string {
  const seconds = Math.max(0, Math.floor((Date.now() - new Date(timestamp).getTime()) / 1000))
  if (seconds < 60) return `${seconds}s ago`
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  return `${Math.floor(hours / 24)}d ago`
}

interface TraderFeedProps {
  onSelectTrader: (traderId: string) => void
  onTrade: (activity: TraderActivity) => void
}

export function TraderFeed({ onSelectTrader, onTrade }: TraderFeedProps) {
  const { data: trades = [], isLoading, isError, refetch } = useTraderFeed(50)

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12 text-sm text-terminal-text-muted">
        Loading live trader activity...
      </div>
    )
  }

  if (isError) {
    return (
      <div className="flex items-center justify-center py-12 text-sm text-terminal-text-muted">
        <button type="button" onClick={() => void refetch()} className="text-sakura-400 hover:text-sakura-300">
          Live trader activity unavailable — retry
        </button>
      </div>
    )
  }

  return (
    <div>
      <div className="border-b border-terminal-border px-3 py-2">
        <div className="text-xs font-semibold text-terminal-text">Live public trades</div>
        <p className="mt-0.5 text-[10px] text-terminal-text-muted">
          Real Suwappu activity from public trader profiles. Open a trader or load the market into your ticket; every trade still requires your review.
        </p>
      </div>

      <div className="divide-y divide-terminal-border/50">
        {trades.map((trade: TraderFeedItem) => (
          <div
            key={`${trade.traderId}-${trade.id}`}
            className="flex items-center gap-3 px-3 py-2.5 transition-colors hover:bg-terminal-bg-tertiary/50"
          >
            <span className={`w-9 shrink-0 rounded px-1.5 py-0.5 text-center text-[10px] font-semibold uppercase ${
              trade.action === 'buy' ? 'bg-bull-dim text-bull' : 'bg-bear-dim text-bear'
            }`}>
              {trade.action}
            </span>

            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-x-1.5 gap-y-1">
                <button
                  type="button"
                  onClick={() => onSelectTrader(trade.traderId)}
                  className="truncate text-left text-xs font-semibold text-terminal-text hover:text-sakura-400"
                >
                  {trade.traderName || truncateAddress(trade.traderAddress)}
                </button>
                {trade.jellyLinked && trade.jellyUsername && trade.jellyWatchUrl && (
                  <a
                    href={trade.jellyWatchUrl}
                    target="_blank"
                    rel="noreferrer"
                    aria-label={`Jelly-linked @${trade.jellyUsername}`}
                    className="rounded border border-sakura-500/30 bg-sakura-500/10 px-1.5 py-0.5 text-[9px] text-sakura-400 hover:text-sakura-300"
                  >
                    @{trade.jellyUsername}
                  </a>
                )}
                <span className="text-[10px] text-terminal-text-muted">{trade.winRate.toFixed(1)}% win</span>
              </div>
              <div className="mt-0.5 flex flex-wrap items-center gap-2 text-[10px] text-terminal-text-muted">
                <span className="font-mono tnum text-xs text-terminal-text">{trade.tokenPair}</span>
                <span>{trade.chain}</span>
                <span>${trade.amountUsd.toLocaleString()}</span>
                {trade.pnlUsd !== 0 && (
                  <span className={`font-mono tnum ${trade.pnlUsd >= 0 ? 'text-bull' : 'text-bear'}`}>
                    {formatPnl(trade.pnlUsd)}
                  </span>
                )}
                <span>{timeAgo(trade.timestamp)}</span>
              </div>
            </div>

            <button
              type="button"
              onClick={() => void onTrade(trade)}
              className="terminal-button-secondary shrink-0 px-2 py-1 text-[10px]"
            >
              Trade {trade.token}
            </button>
          </div>
        ))}

        {!trades.length && (
          <div className="flex items-center justify-center py-12 text-sm text-terminal-text-muted">
            No public trader activity yet
          </div>
        )}
      </div>
    </div>
  )
}
