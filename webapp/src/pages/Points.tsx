import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { AppLayout, AppHeader } from '../components/layout'
import { api } from '../lib/api'
import type { PointsStats, WebappPointTransaction, WebappLeaderboardEntry, WebappReward } from '../lib/api'

// Action icons and colors
const actionConfig: Record<string, { icon: string; color: string }> = {
  checkin: { icon: '📅', color: 'text-green-600' },
  swap: { icon: '🔄', color: 'text-blue-600' },
  referral: { icon: '👥', color: 'text-purple-600' },
  bonus: { icon: '🎁', color: 'text-yellow-600' },
  redeem: { icon: '🎯', color: 'text-red-600' },
}

function formatDate(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

// Stats Card Component
function StatsCard({ stats, onCheckin, isCheckinLoading }: { 
  stats: PointsStats
  onCheckin: () => void
  isCheckinLoading: boolean 
}) {
  return (
    <div className="bg-gradient-to-br from-suwappu-magenta-mid to-suwappu-purple-deep rounded-suwappu-xl p-4 text-white shadow-suwappu-2">
      <div className="flex items-center justify-between mb-4">
        <div>
          <p className="text-white/70 text-xs">Total Points</p>
          <p className="text-3xl font-heading font-bold">{stats.totalPoints.toLocaleString()}</p>
        </div>
        <div className="text-4xl">🌸</div>
      </div>
      
      <div className="grid grid-cols-3 gap-3 mb-4">
        <div className="bg-white/10 rounded-lg p-2 text-center">
          <p className="text-lg font-bold">🔥 {stats.currentStreak}</p>
          <p className="text-[10px] text-white/70">Current Streak</p>
        </div>
        <div className="bg-white/10 rounded-lg p-2 text-center">
          <p className="text-lg font-bold">🏆 {stats.longestStreak}</p>
          <p className="text-[10px] text-white/70">Best Streak</p>
        </div>
        <div className="bg-white/10 rounded-lg p-2 text-center">
          <p className="text-lg font-bold">#{stats.rank || '—'}</p>
          <p className="text-[10px] text-white/70">Rank</p>
        </div>
      </div>

      <button
        onClick={onCheckin}
        disabled={!stats.canCheckin || isCheckinLoading}
        className={`w-full py-2.5 rounded-suwappu-lg font-heading font-semibold text-sm transition-all ${
          stats.canCheckin
            ? 'bg-white text-suwappu-magenta-mid hover:bg-white/90 active:scale-[0.98]'
            : 'bg-white/20 text-white/50 cursor-not-allowed'
        }`}
      >
        {isCheckinLoading ? '...' : stats.canCheckin ? '✨ Daily Check-in' : '✓ Checked in today'}
      </button>
    </div>
  )
}

// Leaderboard Component
function Leaderboard({ entries }: { entries: WebappLeaderboardEntry[] }) {
  const medals = ['🥇', '🥈', '🥉']
  
  return (
    <div className="bg-white rounded-suwappu-xl shadow-suwappu-1 overflow-hidden">
      <div className="px-3 py-2 border-b border-suwappu-sakura-mid/10">
        <span className="font-heading font-semibold text-sm text-suwappu-purple-deep">
          🏆 Leaderboard
        </span>
      </div>
      <div className="divide-y divide-suwappu-sakura-mid/10">
        {entries.map((entry, i) => (
          <div key={entry.userId} className="px-3 py-2 flex items-center gap-3">
            <span className="text-lg w-6 text-center">
              {i < 3 ? medals[i] : entry.rank}
            </span>
            <div className="flex-1 min-w-0">
              <p className="font-medium text-sm text-suwappu-text truncate">
                {entry.firstName || entry.username || `User ${entry.userId}`}
              </p>
              <p className="text-[10px] text-suwappu-text-secondary">
                🔥 {entry.currentStreak} day streak
              </p>
            </div>
            <p className="font-heading font-bold text-suwappu-magenta-mid">
              {entry.totalPoints.toLocaleString()}
            </p>
          </div>
        ))}
      </div>
    </div>
  )
}

// History Component
function PointsHistory({ transactions }: { transactions: WebappPointTransaction[] }) {
  return (
    <div className="bg-white rounded-suwappu-xl shadow-suwappu-1 overflow-hidden">
      <div className="px-3 py-2 border-b border-suwappu-sakura-mid/10">
        <span className="font-heading font-semibold text-sm text-suwappu-purple-deep">
          📜 Recent Activity
        </span>
      </div>
      {transactions.length === 0 ? (
        <div className="p-6 text-center">
          <p className="text-sm text-suwappu-text-secondary">No activity yet</p>
        </div>
      ) : (
        <div className="divide-y divide-suwappu-sakura-mid/10">
          {transactions.map((tx) => {
            const config = actionConfig[tx.action] || { icon: '•', color: 'text-gray-600' }
            return (
              <div key={tx.id} className="px-3 py-2 flex items-center gap-3">
                <span className="text-lg">{config.icon}</span>
                <div className="flex-1 min-w-0">
                  <p className="text-sm text-suwappu-text capitalize">{tx.action}</p>
                  <p className="text-[10px] text-suwappu-text-secondary">
                    {tx.description || formatDate(tx.createdAt)}
                  </p>
                </div>
                <p className={`font-heading font-bold ${tx.amount >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                  {tx.amount >= 0 ? '+' : ''}{tx.amount}
                </p>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

// Rewards Component
function RewardsSection({ rewards, onRedeem }: { rewards: WebappReward[]; onRedeem: (id: number) => void }) {
  return (
    <div className="bg-white rounded-suwappu-xl shadow-suwappu-1 overflow-hidden">
      <div className="px-3 py-2 border-b border-suwappu-sakura-mid/10">
        <span className="font-heading font-semibold text-sm text-suwappu-purple-deep">
          🎁 Rewards
        </span>
      </div>
      {rewards.length === 0 ? (
        <div className="p-6 text-center">
          <p className="text-sm text-suwappu-text-secondary">No rewards available</p>
        </div>
      ) : (
        <div className="p-3 grid gap-2">
          {rewards.map((reward) => (
            <div key={reward.id} className="flex items-center gap-3 p-2 bg-suwappu-sakura-light/30 rounded-lg">
              <span className="text-2xl">{reward.emoji}</span>
              <div className="flex-1 min-w-0">
                <p className="font-medium text-sm text-suwappu-text">{reward.name}</p>
                <p className="text-[10px] text-suwappu-text-secondary">{reward.description}</p>
              </div>
              <button
                onClick={() => onRedeem(reward.id)}
                className="px-3 py-1 bg-suwappu-magenta-mid text-white text-xs font-medium rounded-full"
              >
                {reward.pointsCost} pts
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

export function Points() {
  const [tab, setTab] = useState<'overview' | 'leaderboard' | 'rewards'>('overview')
  const queryClient = useQueryClient()

  // Queries
  const { data: stats, isLoading: statsLoading } = useQuery({
    queryKey: ['points', 'stats'],
    queryFn: () => api.getPointsStats(),
  })

  const { data: history } = useQuery({
    queryKey: ['points', 'history'],
    queryFn: () => api.getPointsHistory(10),
  })

  const { data: leaderboard } = useQuery({
    queryKey: ['points', 'leaderboard'],
    queryFn: () => api.getWebappLeaderboard(10),
  })

  const { data: rewards } = useQuery({
    queryKey: ['points', 'rewards'],
    queryFn: () => api.getWebappRewards(),
  })

  // Mutations
  const checkinMutation = useMutation({
    mutationFn: () => api.webappCheckin(),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['points'] })
    },
  })

  const redeemMutation = useMutation({
    mutationFn: (rewardId: number) => api.redeemWebappReward(rewardId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['points'] })
    },
  })

  if (statsLoading) {
    return (
      <AppLayout header={<AppHeader title="Points" />} activeNav="home">
        <div className="p-3 pb-20">
          <div className="animate-pulse space-y-4">
            <div className="bg-suwappu-sakura-light rounded-suwappu-xl h-48" />
            <div className="bg-suwappu-sakura-light rounded-suwappu-xl h-32" />
          </div>
        </div>
      </AppLayout>
    )
  }

  return (
    <AppLayout header={<AppHeader title="Points" />} activeNav="home">
      <div className="p-3 pb-20 space-y-4">
        {/* Stats Card */}
        {stats && (
          <StatsCard
            stats={stats}
            onCheckin={() => checkinMutation.mutate()}
            isCheckinLoading={checkinMutation.isPending}
          />
        )}

        {/* Tabs */}
        <div className="flex gap-2">
          {(['overview', 'leaderboard', 'rewards'] as const).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`flex-1 py-2 rounded-suwappu-lg text-xs font-medium transition-colors ${
                tab === t
                  ? 'bg-suwappu-magenta-mid text-white'
                  : 'bg-white text-suwappu-text-secondary'
              }`}
            >
              {t === 'overview' && '📊 Activity'}
              {t === 'leaderboard' && '🏆 Leaders'}
              {t === 'rewards' && '🎁 Rewards'}
            </button>
          ))}
        </div>

        {/* Tab Content */}
        {tab === 'overview' && history && <PointsHistory transactions={history} />}
        {tab === 'leaderboard' && leaderboard && <Leaderboard entries={leaderboard} />}
        {tab === 'rewards' && rewards && (
          <RewardsSection rewards={rewards} onRedeem={(id) => redeemMutation.mutate(id)} />
        )}
      </div>
    </AppLayout>
  )
}
