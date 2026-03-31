import { useState, useMemo } from 'react'
import { usePointsLeaderboard } from '../../hooks/usePoints'
import { TierBadge } from './TierBadge'
import type { LeaderboardEntry, TierName } from '../../types/api'

const TIERS: TierName[] = ['Diamond', 'Platinum', 'Gold', 'Silver', 'Bronze']

const MOCK_LEADERBOARD: LeaderboardEntry[] = Array.from({ length: 50 }, (_, i) => {
  const rank = i + 1
  const xp = Math.max(130000 - rank * 2500 + Math.floor(rank * 137 % 500), 100)
  const level = Math.max(45 - Math.floor(rank * 0.85), 1)
  const tierIdx = rank <= 2 ? 0 : rank <= 8 ? 1 : rank <= 20 ? 2 : rank <= 35 ? 3 : 4
  const hex = rank.toString(16).padStart(2, '0')
  return {
    rank,
    address: `0x${hex}${'abcdef1234567890'.repeat(3).slice(0, 38)}`,
    xp,
    level,
    tier: TIERS[tierIdx],
  }
})

const TIMEFRAMES = [
  { id: 'all', label: 'All Time' },
  { id: '30d', label: '30D' },
  { id: '7d', label: '7D' },
  { id: '24h', label: '24H' },
]

const PAGE_SIZE = 10

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
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(1)
  const { data: entries } = usePointsLeaderboard(timeframe, 50)
  const items = entries ?? MOCK_LEADERBOARD

  const filtered = useMemo(() => {
    if (!search.trim()) return items
    const term = search.toLowerCase()
    return items.filter(e => e.address.toLowerCase().includes(term))
  }, [items, search])

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE))
  const currentPage = Math.min(page, totalPages)
  const start = (currentPage - 1) * PAGE_SIZE
  const pageItems = filtered.slice(start, start + PAGE_SIZE)

  const handleSearchChange = (val: string) => {
    setSearch(val)
    setPage(1)
  }

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

      {/* Search */}
      <input
        placeholder="Search by address..."
        className="terminal-input text-xs w-full mb-3"
        value={search}
        onChange={e => handleSearchChange(e.target.value)}
      />

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
            {pageItems.map(entry => (
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

      {/* Pagination */}
      <div className="flex items-center justify-between text-xs text-terminal-text-muted">
        <span>
          Showing {filtered.length === 0 ? 0 : start + 1}-{Math.min(start + PAGE_SIZE, filtered.length)} of {filtered.length}
        </span>
        <div className="flex items-center gap-2">
          <button
            className="terminal-button-secondary text-xs px-3 py-1"
            disabled={currentPage <= 1}
            onClick={() => setPage(p => p - 1)}
          >
            Prev
          </button>
          <button
            className="terminal-button-secondary text-xs px-3 py-1"
            disabled={currentPage >= totalPages}
            onClick={() => setPage(p => p + 1)}
          >
            Next
          </button>
        </div>
      </div>
    </div>
  )
}
