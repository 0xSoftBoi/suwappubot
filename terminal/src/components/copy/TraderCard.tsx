import type { TraderProfile } from '../../types/api'

function truncateAddress(addr: string): string {
  if (addr.length <= 12) return addr
  return `${addr.slice(0, 6)}...${addr.slice(-4)}`
}

function formatPnl(value: number): string {
  const prefix = value >= 0 ? '+' : ''
  return `${prefix}$${Math.abs(value).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

interface TraderCardProps {
  trader: TraderProfile
  onFollow: () => void
  onUnfollow: () => void
}

export function TraderCard({ trader, onFollow, onUnfollow }: TraderCardProps) {
  return (
    <div className="bg-terminal-bg-secondary border border-terminal-border rounded-lg p-4 space-y-4">
      {/* Header */}
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-full bg-terminal-bg-tertiary border border-terminal-border flex items-center justify-center text-terminal-text-secondary text-sm font-mono">
          {(trader.name || trader.address).slice(0, 2).toUpperCase()}
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-sm font-semibold text-terminal-text truncate">
            {trader.name || truncateAddress(trader.address)}
          </div>
          <div className="text-xs font-mono text-terminal-text-muted">
            {truncateAddress(trader.address)}
          </div>
        </div>
        <button
          onClick={trader.isFollowing ? onUnfollow : onFollow}
          className={`px-4 py-1.5 rounded text-xs font-semibold transition-colors ${
            trader.isFollowing
              ? 'bg-terminal-bg-tertiary border border-terminal-border text-terminal-text-secondary hover:border-bear hover:text-bear'
              : 'bg-sakura-600 hover:bg-sakura-700 text-white'
          }`}
        >
          {trader.isFollowing ? 'Unfollow' : 'Follow'}
        </button>
      </div>

      {/* Stats grid */}
      <div className="grid grid-cols-2 gap-3">
        <div className="bg-terminal-bg rounded-lg p-2.5">
          <div className="text-[10px] text-terminal-text-muted uppercase tracking-wider mb-0.5">7d PnL</div>
          <div className={`text-sm font-mono font-semibold ${trader.pnl7d >= 0 ? 'text-bull' : 'text-bear'}`}>
            {formatPnl(trader.pnl7d)}
          </div>
        </div>
        <div className="bg-terminal-bg rounded-lg p-2.5">
          <div className="text-[10px] text-terminal-text-muted uppercase tracking-wider mb-0.5">30d PnL</div>
          <div className={`text-sm font-mono font-semibold ${trader.pnl30d >= 0 ? 'text-bull' : 'text-bear'}`}>
            {formatPnl(trader.pnl30d)}
          </div>
        </div>
        <div className="bg-terminal-bg rounded-lg p-2.5">
          <div className="text-[10px] text-terminal-text-muted uppercase tracking-wider mb-0.5">Win Rate</div>
          <div className="flex items-center gap-2">
            <span className="text-sm font-mono text-terminal-text">{trader.winRate.toFixed(1)}%</span>
            <div className="flex-1 h-1.5 bg-terminal-bg-tertiary rounded-full overflow-hidden">
              <div
                className="h-full bg-bull rounded-full transition-all"
                style={{ width: `${Math.min(trader.winRate, 100)}%` }}
              />
            </div>
          </div>
        </div>
        <div className="bg-terminal-bg rounded-lg p-2.5">
          <div className="text-[10px] text-terminal-text-muted uppercase tracking-wider mb-0.5">Total Trades</div>
          <div className="text-sm font-mono text-terminal-text">{trader.totalTrades.toLocaleString()}</div>
        </div>
        <div className="bg-terminal-bg rounded-lg p-2.5">
          <div className="text-[10px] text-terminal-text-muted uppercase tracking-wider mb-0.5">Best Trade</div>
          <div className="text-sm font-mono text-bull">{formatPnl(trader.bestTrade)}</div>
        </div>
        <div className="bg-terminal-bg rounded-lg p-2.5">
          <div className="text-[10px] text-terminal-text-muted uppercase tracking-wider mb-0.5">Worst Trade</div>
          <div className="text-sm font-mono text-bear">{formatPnl(trader.worstTrade)}</div>
        </div>
      </div>

      {/* Footer */}
      <div className="flex items-center justify-between text-xs text-terminal-text-muted pt-1 border-t border-terminal-border">
        <span>{trader.followers} followers</span>
        <span>Avg trade: ${trader.avgTradeSize.toLocaleString()}</span>
      </div>
    </div>
  )
}
