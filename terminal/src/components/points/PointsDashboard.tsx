import { useState } from 'react'
import { XPBar } from './XPBar'
import { TierBadge } from './TierBadge'
import { StreakTracker } from './StreakTracker'
import { MilestoneWall } from './MilestoneWall'
import { RewardStore } from './RewardStore'
import { PointsLeaderboard } from './PointsLeaderboard'
import { usePoints } from '../../hooks/usePoints'

type Tab = 'overview' | 'milestones' | 'rewards' | 'leaderboard'

const TABS: { id: Tab; label: string }[] = [
  { id: 'overview', label: 'Overview' },
  { id: 'milestones', label: 'Milestones' },
  { id: 'rewards', label: 'Rewards' },
  { id: 'leaderboard', label: 'Leaderboard' },
]

export function PointsDashboard() {
  const [activeTab, setActiveTab] = useState<Tab>('overview')
  const { data: profile, isLoading } = usePoints()

  if (isLoading) {
    return (
      <div className="h-full flex items-center justify-center text-terminal-text-muted text-sm">
        Loading points...
      </div>
    )
  }

  const xp = profile?.xp ?? 0
  const level = profile?.level ?? 1
  const tier = profile?.tier ?? 'Bronze'
  const nextLevelXp = profile?.nextLevelXp ?? 100
  const currentLevelXp = profile?.currentLevelXp ?? 0
  const streak = profile?.streak ?? 0
  const longestStreak = profile?.longestStreak ?? 0
  const lastCheckin = profile?.lastCheckin ?? null

  return (
    <div className="h-full flex flex-col bg-terminal-bg">
      {/* Tab bar */}
      <div className="flex items-center border-b border-terminal-border px-2 shrink-0">
        {TABS.map(tab => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`terminal-tab ${activeTab === tab.id ? 'terminal-tab-active' : ''}`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Tab content */}
      <div className="flex-1 overflow-auto">
        {activeTab === 'overview' && (
          <div className="p-4 flex flex-col gap-6">
            {/* Tier badge + XP bar row */}
            <div className="flex items-start gap-6">
              <TierBadge tier={tier} points={xp} />
              <div className="flex-1 flex flex-col gap-4">
                <XPBar
                  xp={xp}
                  level={level}
                  currentLevelXp={currentLevelXp}
                  nextLevelXp={nextLevelXp}
                />
              </div>
            </div>

            {/* Streak tracker */}
            <div className="terminal-panel p-4">
              <StreakTracker
                streak={streak}
                longestStreak={longestStreak}
                lastCheckin={lastCheckin}
              />
            </div>

            {/* Quick stats */}
            <div className="grid grid-cols-3 gap-3">
              <div className="terminal-panel p-3 text-center">
                <div className="text-xs text-terminal-text-secondary uppercase tracking-wider mb-1">Total XP</div>
                <div className="font-mono text-lg font-bold text-sakura-400">{xp.toLocaleString()}</div>
              </div>
              <div className="terminal-panel p-3 text-center">
                <div className="text-xs text-terminal-text-secondary uppercase tracking-wider mb-1">Rank</div>
                <div className="font-mono text-lg font-bold text-terminal-text">#{profile?.rank ?? '--'}</div>
              </div>
              <div className="terminal-panel p-3 text-center">
                <div className="text-xs text-terminal-text-secondary uppercase tracking-wider mb-1">Level</div>
                <div className="font-mono text-lg font-bold text-terminal-text">{level}</div>
              </div>
            </div>
          </div>
        )}

        {activeTab === 'milestones' && <MilestoneWall />}
        {activeTab === 'rewards' && <RewardStore />}
        {activeTab === 'leaderboard' && <PointsLeaderboard />}
      </div>
    </div>
  )
}
