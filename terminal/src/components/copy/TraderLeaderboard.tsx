import { useState } from 'react'
import { useTopTraders } from '../../hooks/useCopyTrading'
import type { TopTrader } from '../../types/api'

function truncateAddress(addr: string): string {
  if (addr.length <= 12) return addr
  return `${addr.slice(0, 6)}...${addr.slice(-4)}`
}

function formatPnl(value: number): string {
  const prefix = value >= 0 ? '+' : ''
  return `${prefix}$${Math.abs(value).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

type SortKey = 'pnl7d' | 'pnl30d' | 'winRate' | 'followers'
type SortDir = 'asc' | 'desc'

interface TraderLeaderboardProps {
  onSelectTrader: (traderId: string) => void
  onFollow: (traderId: string) => void
}

export function TraderLeaderboard({ onSelectTrader, onFollow }: TraderLeaderboardProps) {
  const [sortKey, setSortKey] = useState<SortKey>('pnl7d')
  const [sortDir, setSortDir] = useState<SortDir>('desc')
  const { data: traders, isLoading } = useTopTraders('7d', 50)

  const handleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    } else {
      setSortKey(key)
      setSortDir('desc')
    }
  }

  const sortArrow = (key: SortKey) => {
    if (sortKey !== key) return <span className="text-terminal-text-muted ml-0.5">&#8597;</span>
    return <span className="text-sakura-400 ml-0.5">{sortDir === 'desc' ? '▼' : '▲'}</span>
  }

  const sorted = [...(traders || [])].sort((a, b) => {
    const mul = sortDir === 'desc' ? -1 : 1
    return mul * (a[sortKey] - b[sortKey])
  })

  return (
    <div className="overflow-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-xs text-terminal-text-muted uppercase tracking-wider border-b border-terminal-border">
            <th className="text-left py-2 px-3 font-medium w-12">Rank</th>
            <th className="text-left py-2 px-3 font-medium">Trader</th>
            <th
              className="text-right py-2 px-3 font-medium cursor-pointer hover:text-terminal-text select-none"
              onClick={() => handleSort('pnl7d')}
            >
              7d PnL{sortArrow('pnl7d')}
            </th>
            <th
              className="text-right py-2 px-3 font-medium cursor-pointer hover:text-terminal-text select-none"
              onClick={() => handleSort('pnl30d')}
            >
              30d PnL{sortArrow('pnl30d')}
            </th>
            <th
              className="text-right py-2 px-3 font-medium cursor-pointer hover:text-terminal-text select-none"
              onClick={() => handleSort('winRate')}
            >
              Win Rate{sortArrow('winRate')}
            </th>
            <th
              className="text-right py-2 px-3 font-medium cursor-pointer hover:text-terminal-text select-none"
              onClick={() => handleSort('followers')}
            >
              Followers{sortArrow('followers')}
            </th>
            <th className="text-right py-2 px-3 font-medium">Action</th>
          </tr>
        </thead>
        <tbody>
          {isLoading && (
            <tr>
              <td colSpan={7} className="text-center text-terminal-text-muted text-sm py-12">
                Loading top traders...
              </td>
            </tr>
          )}
          {!isLoading && !sorted.length && (
            <tr>
              <td colSpan={7} className="text-center text-terminal-text-muted text-sm py-12">
                No traders found
              </td>
            </tr>
          )}
          {sorted.map((trader: TopTrader, i: number) => (
            <tr
              key={trader.id}
              className="border-b border-terminal-border/50 hover:bg-terminal-bg-tertiary/50 transition-colors cursor-pointer"
              onClick={() => onSelectTrader(trader.id)}
            >
              <td className="py-2.5 px-3 text-terminal-text-muted font-mono text-xs">{i + 1}</td>
              <td className="py-2.5 px-3">
                <div className="flex items-center gap-2">
                  <div className="w-6 h-6 rounded-full bg-terminal-bg-tertiary border border-terminal-border flex items-center justify-center text-[10px] font-mono text-terminal-text-secondary shrink-0">
                    {(trader.name || trader.address).slice(0, 2).toUpperCase()}
                  </div>
                  <span className="font-mono text-xs text-terminal-text">
                    {trader.name || truncateAddress(trader.address)}
                  </span>
                </div>
              </td>
              <td className={`py-2.5 px-3 text-right font-mono text-xs ${trader.pnl7d >= 0 ? 'text-bull' : 'text-bear'}`}>
                {formatPnl(trader.pnl7d)}
              </td>
              <td className={`py-2.5 px-3 text-right font-mono text-xs ${trader.pnl30d >= 0 ? 'text-bull' : 'text-bear'}`}>
                {formatPnl(trader.pnl30d)}
              </td>
              <td className="py-2.5 px-3 text-right">
                <div className="flex items-center justify-end gap-2">
                  <div className="w-12 h-1.5 bg-terminal-bg-tertiary rounded-full overflow-hidden">
                    <div
                      className="h-full bg-bull rounded-full"
                      style={{ width: `${Math.min(trader.winRate, 100)}%` }}
                    />
                  </div>
                  <span className="font-mono text-xs text-terminal-text">{trader.winRate.toFixed(1)}%</span>
                </div>
              </td>
              <td className="py-2.5 px-3 text-right font-mono text-xs text-terminal-text-secondary">
                {trader.followers.toLocaleString()}
              </td>
              <td className="py-2.5 px-3 text-right">
                <button
                  onClick={e => { e.stopPropagation(); onFollow(trader.id) }}
                  className="px-3 py-1 rounded text-xs font-semibold bg-sakura-600 hover:bg-sakura-700 text-white transition-colors"
                >
                  Follow
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
