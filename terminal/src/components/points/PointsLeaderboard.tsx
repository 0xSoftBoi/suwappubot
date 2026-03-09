import { useState } from 'react'
import { usePointsLeaderboard } from '../../hooks/usePoints'
import { TierBadge } from './TierBadge'
import type { LeaderboardEntry, TierName } from '../../types/api'

const MOCK_LEADERBOARD: LeaderboardEntry[] = [
  { rank: 1, address: '0x1a2b3c4d5e6f7890abcdef1234567890abcdef12', xp: 125000, level: 42, tier: 'Diamond' },
  { rank: 2, address: '0x2b3c4d5e6f7890abcdef1234567890abcdef1234', xp: 98500, level: 38, tier: 'Platinum' },
  { rank: 3, address: '0x3c4d5e6f7890abcdef1234567890abcdef123456', xp: 87200, level: 35, tier: 'Platinum' },
  { rank: 4, address: '0x4d5e6f7890abcdef1234567890abcdef12345678', xp: 54300, level: 28, tier: 'Platinum' },
  { rank: 5, address: '0x5e6f7890abcdef1234567890abcdef1234567890', xp: 32100, level: 22, tier: 'Gold' },
  { rank: 6, address: '0x6f7890abcdef1234567890abcdef123456789012', xp: 18750, level: 17, tier: 'Gold' },
  { rank: 7, address: '0x7890abcdef1234567890abcdef12345678901234', xp: 12400, level: 14, tier: 'Gold' },
  { rank: 8, address: '0x890abcdef1234567890abcdef1234567890123456', xp: 5200, level: 9, tier: 'Gold' },
  { rank: 9, address: '0x90abcdef1234567890abcdef123456789012345678', xp: 2800, level: 6, tier: 'Silver' },
  { rank: 10, address: '0xabcdef1234567890abcdef12345678901234567890', xp: 950, level: 3, tier: 'Bronze' },
]

const TIMEFRAMES = [
  { id: 'all', label: 'All Time' },
  { id: '30d', label: '30D' },
  { id: '7d', label: '7D' },
  { id: '24h', label: '24H' },
]

function truncateAddress(address: string): string {
  if (address.length <= 10) return address
  return `${address.slice(0, 6)}...${address.slice(-4)}`
}

function getRankDisplay(rank: number): string {
  if (rank === 1) return '\u{1F947}'
  if (rank === 2) return '\u{1F948}'
  if (rank === 3) return '\u{1F949}'
  return `#${rank}`
}

export function PointsLeaderboard() {
  const [timeframe, setTimeframe] = useState('all')
  const { data: entries } = usePointsLeaderboard(timeframe, 10)
  const items = entries ?? MOCK_LEADERBOARD

  return (
    <div className="flex flex-col gap-4 p-4">
      {/* Timeframe filter */}
      <div className="flex items-center gap-1">
        {TIMEFRAMES.map(tf => (
          <button
            key={tf.id}
            onClick={() => setTimeframe(tf.id)}
            className={`terminal-tab ${timeframe === tf.id ? 'terminal-tab-active' : ''}`}
          >
            {tf.label}
          </button>
        ))}
      </div>

      {/* Table */}
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-terminal-text-muted text-xs uppercase tracking-wider border-b border-terminal-border">
              <th className="text-left py-2 px-3 w-16">Rank</th>
              <th className="text-left py-2 px-3">User</th>
              <th className="text-right py-2 px-3">XP</th>
              <th className="text-center py-2 px-3">Level</th>
              <th className="text-center py-2 px-3">Tier</th>
            </tr>
          </thead>
          <tbody>
            {items.map(entry => (
              <tr
                key={entry.rank}
                className="border-b border-terminal-border/50 hover:bg-terminal-bg-tertiary/50 transition-colors"
                data-testid="leaderboard-row"
              >
                <td className="py-2.5 px-3 font-mono text-sm">
                  {getRankDisplay(entry.rank)}
                </td>
                <td className="py-2.5 px-3 font-mono text-terminal-text">
                  {truncateAddress(entry.address)}
                </td>
                <td className="py-2.5 px-3 font-mono text-right text-sakura-400">
                  {entry.xp.toLocaleString()}
                </td>
                <td className="py-2.5 px-3 font-mono text-center text-terminal-text-secondary">
                  {entry.level}
                </td>
                <td className="py-2.5 px-3 text-center">
                  <TierBadge tier={entry.tier as TierName} points={entry.xp} compact />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
