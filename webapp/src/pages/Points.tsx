import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { AppLayout, AppHeader } from '../components/layout'
import { api } from '../lib/api'
import { a11yToast } from '@/lib/a11yToast'
import type {
  PointsStats,
  PointTransaction,
  LeaderboardEntry,
  Reward,
  SeasonStanding,
  SeasonLeaderboardEntry,
} from '../lib/api'

// Format a token amount with up to 4 significant figures, no trailing noise.
function formatTokens(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return '0'
  const rounded = Number(value.toPrecision(4))
  return rounded.toLocaleString(undefined, { maximumFractionDigits: 4 })
}

// Multiplier values render like x1.20.
function formatMultiplier(value: number): string {
  return `x${value.toFixed(2)}`
}

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
function Leaderboard({ entries }: { entries: LeaderboardEntry[] }) {
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
function PointsHistory({ transactions }: { transactions: PointTransaction[] }) {
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
function RewardsSection({ rewards, onRedeem }: { rewards: Reward[]; onRedeem: (id: number) => void }) {
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

// Season Banner — name, countdown, my season points + rank, estimated allocation,
// and the engagement multiplier chips.
function SeasonBanner({ data }: { data: SeasonStanding }) {
  const { season, standing, multiplier, estimatedAllocation, totalSeasonPoints } = data

  if (!season) {
    return (
      <div className="bg-white rounded-suwappu-xl shadow-suwappu-1 p-6 text-center">
        <div className="text-4xl mb-2">☀️</div>
        <p className="font-heading font-semibold text-sm text-suwappu-purple-deep">No active season yet</p>
        <p className="text-[11px] text-suwappu-text-secondary mt-1">
          Convertible points start when the next season opens.
        </p>
      </div>
    )
  }

  const countdown =
    season.daysRemaining === null
      ? null
      : season.daysRemaining <= 0
        ? 'Ending soon'
        : `Ends in ${season.daysRemaining} day${season.daysRemaining === 1 ? '' : 's'}`

  const poolSharePct = (estimatedAllocation.poolShare * 100).toFixed(2)

  const weatherEmoji: Record<string, string> = {
    Summer: '☀️',
    Fall: '🍂',
    Winter: '❄️',
    Spring: '🌱',
  }
  const seasonEmoji = (season.weather && weatherEmoji[season.weather]) || '☀️'

  return (
    <div className="bg-gradient-to-br from-suwappu-purple-deep to-suwappu-magenta-mid rounded-suwappu-xl p-4 text-white shadow-suwappu-2 space-y-4">
      {/* Header: weather season + official quarter + countdown */}
      <div className="flex items-start justify-between">
        <div className="min-w-0">
          <p className="text-white/70 text-[10px] uppercase tracking-wide">
            {seasonEmoji} Season{season.quarter ? ` · ${season.quarter}` : ''}
          </p>
          <p className="font-heading font-bold text-lg truncate">{season.name}</p>
        </div>
        {countdown && (
          <span className="flex-shrink-0 bg-white/15 rounded-full px-2.5 py-1 text-[11px] font-medium">
            {countdown}
          </span>
        )}
      </div>

      {/* My season points (big) + rank */}
      <div className="flex items-end justify-between">
        <div>
          <p className="text-white/70 text-xs">My Season Points</p>
          <p className="text-3xl font-heading font-bold">{Math.round(standing.points).toLocaleString()}</p>
        </div>
        <div className="text-right">
          <p className="text-white/70 text-xs">Rank</p>
          <p className="text-2xl font-heading font-bold">#{standing.rank ?? '—'}</p>
        </div>
      </div>

      {/* Estimated allocation */}
      <div className="bg-white/10 rounded-lg p-3">
        <p className="text-xl font-heading font-bold">
          ≈ {formatTokens(estimatedAllocation.tokens)} {estimatedAllocation.tokenSymbol}
        </p>
        <p className="text-[10px] text-white/70 mt-0.5">Estimated · finalizes at season end</p>
        <p className="text-[10px] text-white/70">
          {poolSharePct}% of the {formatTokens(season.tokenPool)} {season.tokenSymbol} pool
          {totalSeasonPoints > 0 && ` · ${Math.round(totalSeasonPoints).toLocaleString()} pts in play`}
        </p>
      </div>

      {/* Multiplier chips — the engagement hook */}
      <div className="grid grid-cols-3 gap-2">
        <div className="bg-white/10 rounded-lg p-2 text-center">
          <p className="text-sm font-bold">{formatMultiplier(multiplier.level)}</p>
          <p className="text-[9px] text-white/70 capitalize truncate">{multiplier.levelName || 'Level'}</p>
        </div>
        <div className="bg-white/10 rounded-lg p-2 text-center">
          <p className="text-sm font-bold">{formatMultiplier(multiplier.streak)}</p>
          <p className="text-[9px] text-white/70">Streak</p>
        </div>
        <div className="bg-white/20 rounded-lg p-2 text-center">
          <p className="text-sm font-bold">{formatMultiplier(multiplier.combined)}</p>
          <p className="text-[9px] text-white/70">Combined</p>
        </div>
      </div>
    </div>
  )
}

// Emission note — disinflationary schedule + fee-based earning explainer.
// Rendered under the banner; only shown when the API supplies the emission block.
function SeasonEmissionNote({ data }: { data: SeasonStanding }) {
  const { emission, standing } = data
  if (!emission) return null

  const supplyPct = (emission.poolPctOfSupply * 100).toFixed(2)
  const decayPct = (emission.decayPerSeason * 100).toFixed(0)
  const inflation =
    emission.inflationRate != null ? (emission.inflationRate * 100).toFixed(1) : null

  return (
    <div className="bg-white rounded-suwappu-xl shadow-suwappu-1 px-3 py-2.5 space-y-1">
      <p className="text-[11px] text-suwappu-text">
        Season {emission.seasonIndex} of {emission.totalSeasons} · {supplyPct}% of supply ·
        disinflating {decayPct}%/season
      </p>
      {inflation != null && (
        <p className="text-[10px] text-suwappu-text-secondary">Season inflation {inflation}%</p>
      )}
      <p className="text-[10px] text-suwappu-text-secondary">
        Points = 100 × fees you pay — wash-trading earns nothing free.
      </p>
      {standing.feePaidUsd > 0 && (
        <p className="text-[10px] text-suwappu-text-secondary">
          Your season fees: ${standing.feePaidUsd.toFixed(2)}
        </p>
      )}
    </div>
  )
}

// Season Leaderboard — top entries by season points, with estimated tokens.
function SeasonLeaderboard({ entries }: { entries: SeasonLeaderboardEntry[] }) {
  const medals = ['🥇', '🥈', '🥉']

  return (
    <div className="bg-white rounded-suwappu-xl shadow-suwappu-1 overflow-hidden">
      <div className="px-3 py-2 border-b border-suwappu-sakura-mid/10">
        <span className="font-heading font-semibold text-sm text-suwappu-purple-deep">
          ☀️ Season Leaderboard
        </span>
      </div>
      {entries.length === 0 ? (
        <div className="p-6 text-center">
          <p className="text-sm text-suwappu-text-secondary">No season standings yet</p>
        </div>
      ) : (
        <div className="divide-y divide-suwappu-sakura-mid/10">
          {entries.map((entry, i) => (
            <div key={entry.userId} className="px-3 py-2 flex items-center gap-3">
              <span className="text-lg w-6 text-center">{i < 3 ? medals[i] : entry.rank}</span>
              <div className="flex-1 min-w-0">
                <p className="font-medium text-sm text-suwappu-text truncate">
                  {entry.username || `User ${entry.userId}`}
                </p>
                <p className="text-[10px] text-suwappu-text-secondary">
                  ≈ {formatTokens(entry.estimatedTokens)} tokens
                </p>
              </div>
              <p className="font-heading font-bold text-suwappu-magenta-mid">
                {Math.round(entry.points).toLocaleString()}
              </p>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

export function Points() {
  const [tab, setTab] = useState<'overview' | 'leaderboard' | 'season' | 'rewards'>('overview')
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
    queryFn: () => api.getLeaderboard(10),
  })

  const { data: rewards } = useQuery({
    queryKey: ['points', 'rewards'],
    queryFn: () => api.getRewards(),
  })

  const { data: season, isError: seasonError } = useQuery({
    queryKey: ['points', 'season'],
    queryFn: () => api.getSeasonStanding(),
  })

  const { data: seasonLeaderboard } = useQuery({
    queryKey: ['points', 'season', 'leaderboard'],
    queryFn: () => api.getSeasonLeaderboard(20),
    enabled: !!season?.season,
  })

  if (seasonError) {
    a11yToast.error("We couldn't load your season standing. Pull to refresh or try again shortly.", {
      id: 'season-load-error',
    })
  }

  // Mutations
  const checkinMutation = useMutation({
    mutationFn: () => api.dailyCheckin(),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['points'] })
    },
  })

  const redeemMutation = useMutation({
    mutationFn: (rewardId: number) => api.redeemReward(rewardId),
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

        {/* Season Banner */}
        {season && <SeasonBanner data={season} />}

        {/* Emission economics (under the banner; guarded by API support) */}
        {season?.season && <SeasonEmissionNote data={season} />}

        {/* Tabs */}
        <div className="flex gap-2">
          {(['overview', 'leaderboard', 'season', 'rewards'] as const).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`flex-1 py-2 rounded-suwappu-lg text-[11px] font-medium transition-colors ${
                tab === t
                  ? 'bg-suwappu-magenta-mid text-white'
                  : 'bg-white text-suwappu-text-secondary'
              }`}
            >
              {t === 'overview' && '📊 Activity'}
              {t === 'leaderboard' && '🏆 Leaders'}
              {t === 'season' && '☀️ Season'}
              {t === 'rewards' && '🎁 Rewards'}
            </button>
          ))}
        </div>

        {/* Tab Content */}
        {tab === 'overview' && history && <PointsHistory transactions={history} />}
        {tab === 'leaderboard' && leaderboard && <Leaderboard entries={leaderboard} />}
        {tab === 'season' &&
          (season?.season ? (
            <SeasonLeaderboard entries={seasonLeaderboard ?? []} />
          ) : (
            <div className="bg-white rounded-suwappu-xl shadow-suwappu-1 p-6 text-center">
              <p className="text-sm text-suwappu-text-secondary">No active season yet</p>
            </div>
          ))}
        {tab === 'rewards' && rewards && (
          <RewardsSection rewards={rewards} onRedeem={(id) => redeemMutation.mutate(id)} />
        )}
      </div>
    </AppLayout>
  )
}
