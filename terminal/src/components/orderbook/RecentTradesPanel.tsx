import { useRecentTrades } from '../../hooks/useRecentTrades'

function formatTime(ts: number): string {
  const d = new Date(ts)
  return d.toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' })
}

export function RecentTradesPanel() {
  const { trades, status, isConnected } = useRecentTrades()
  const emptyTitle =
    status === 'unsupported' ? 'No public trade feed for DEX pairs'
    : status === 'error' ? "Couldn't load recent trades"
    : 'Loading recent trades…'
  const emptySub =
    status === 'unsupported' ? 'On-chain pairs trade against pool liquidity — there is no central trade tape.'
    : status === 'error' ? 'Retrying automatically…'
    : ''

  return (
    <div className="flex flex-col h-full" data-testid="recent-trades">
      {/* Header */}
      <div className="flex items-center justify-between px-2 py-1.5 border-b border-terminal-border shrink-0">
        <span className="text-xs font-medium text-terminal-text-secondary">Recent Trades</span>
        <span
          role="status"
          aria-label={isConnected ? 'Live feed connected' : 'Feed disconnected'}
          className={`w-1.5 h-1.5 rounded-full ${isConnected ? 'bg-bull pulse-live' : 'bg-bear'}`}
        />
      </div>

      {/* Column headers */}
      <div className="grid grid-cols-3 px-2 py-1 text-[10px] text-terminal-text-muted border-b border-terminal-border shrink-0">
        <span>Price</span>
        <span className="text-right">Size</span>
        <span className="text-right">Time</span>
      </div>

      {/* Trades list */}
      <div className="flex-1 overflow-y-auto font-mono text-[11px] leading-[18px]">
        {trades.length === 0 && (
          <div className="flex h-full items-center justify-center px-4 text-center font-sans">
            <div>
              <div className="text-[11px] text-terminal-text-secondary">{emptyTitle}</div>
              {emptySub && <div className="mt-1 text-[10px] text-terminal-text-muted">{emptySub}</div>}
            </div>
          </div>
        )}
        {trades.map(trade => (
          <div
            // Keyed by trade id, so a genuinely new trade is a new DOM node —
            // that remount is what lets `.flash-up`/`.flash-down` replay their
            // animation per row (re-rendering an existing node would not).
            key={trade.id}
            className={`grid grid-cols-3 px-2 ${trade.isNew ? (trade.side === 'buy' ? 'flash-up' : 'flash-down') : ''}`}
            data-testid="trade-row"
          >
            <span className={`tnum ${trade.side === 'buy' ? 'text-bull' : 'text-bear'}`}>
              {trade.side === 'buy' ? '▲' : '▼'} {trade.price.toFixed(2)}
            </span>
            <span className="tnum text-right text-terminal-text-secondary">
              {trade.size.toFixed(4)}
            </span>
            <span className="tnum text-right text-terminal-text-muted">
              {formatTime(trade.time)}
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}
