import { useState } from 'react'
import toast from 'react-hot-toast'
import { useAuth } from '../../contexts/AuthContext'
import { useReferralStats, useReferralsList, useReferralLeaderboard } from '../../hooks/useReferrals'
import {
  TerminalPanel,
  TerminalPanelHeader,
  TerminalMetricCard,
  TerminalStatusPill,
  TerminalEmptyState,
  TerminalEyebrow,
} from '../foundation/TerminalPrimitives'

type Tab = 'overview' | 'referrals' | 'leaderboard'

const TABS: { id: Tab; label: string }[] = [
  { id: 'overview', label: 'Overview' },
  { id: 'referrals', label: 'Your Referrals' },
  { id: 'leaderboard', label: 'Leaderboard' },
]

function getRankDisplay(rank: number): string {
  if (rank === 1) return '\u{1F947}'
  if (rank === 2) return '\u{1F948}'
  if (rank === 3) return '\u{1F949}'
  return `#${rank}`
}

function formatUsd(value: number): string {
  return `$${value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })
  } catch {
    return iso
  }
}

function TierLabel({ tier }: { tier: 'standard' | 'power' | 'elite' }) {
  const map = {
    standard: { label: 'Standard', tone: 'neutral' as const },
    power: { label: 'Power Partner', tone: 'sky' as const },
    elite: { label: 'Elite Partner', tone: 'warm' as const },
  }
  const { label, tone } = map[tier]
  return <TerminalStatusPill tone={tone}>{label}</TerminalStatusPill>
}

function OverviewTab() {
  const { data: stats, isLoading } = useReferralStats()

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-32 text-terminal-text-muted text-sm">
        Loading referral data...
      </div>
    )
  }

  if (!stats) {
    return (
      <TerminalEmptyState
        title="No referral data"
        description="We could not load your referral stats. Try again in a moment."
      />
    )
  }

  const copyCode = () => {
    navigator.clipboard.writeText(stats.referral_code).then(() => toast('Referral code copied'))
  }

  const copyLink = () => {
    navigator.clipboard.writeText(stats.referral_link).then(() => toast('Referral link copied'))
  }

  return (
    <div className="flex flex-col gap-5 p-4">
      {/* Header */}
      <TerminalPanelHeader
        eyebrow={<TerminalEyebrow>Referral Program</TerminalEyebrow>}
        title={`Earn ${stats.reward_rate_pct}% of every trade — forever`}
        description={
          stats.tier !== 'elite'
            ? `You are on the ${stats.tier === 'power' ? 'Power' : 'Standard'} tier (${stats.reward_rate_pct}%). Refer more active traders to unlock Elite (40%).`
            : 'You are an Elite Partner earning 40% on every trade your referrals make.'
        }
        meta={<TierLabel tier={stats.tier} />}
      />

      {/* Code + link */}
      <TerminalPanel>
        <div className="flex flex-col gap-3">
          <div className="flex items-center gap-3">
            <div className="flex-1">
              <div className="text-[10px] uppercase text-terminal-text-muted tracking-wider mb-1">Your Code</div>
              <div className="font-mono text-sm text-terminal-text bg-terminal-bg-tertiary border border-terminal-border rounded px-3 py-1.5 select-all">
                {stats.referral_code}
              </div>
            </div>
            <button
              className="terminal-button-secondary text-xs self-end"
              onClick={copyCode}
            >
              Copy Code
            </button>
          </div>
          <div className="flex items-center gap-3">
            <div className="flex-1 min-w-0">
              <div className="text-[10px] uppercase text-terminal-text-muted tracking-wider mb-1">Your Link</div>
              <div className="font-mono text-xs text-terminal-text-secondary bg-terminal-bg-tertiary border border-terminal-border rounded px-3 py-1.5 truncate">
                {stats.referral_link}
              </div>
            </div>
            <button
              className="terminal-button-secondary text-xs self-end shrink-0"
              onClick={copyLink}
            >
              Copy Link
            </button>
          </div>
        </div>
      </TerminalPanel>

      {/* Stat cards */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <TerminalMetricCard
          label="Lifetime Earnings"
          value={formatUsd(stats.total_earnings_usd)}
          tone="warm"
        />
        <TerminalMetricCard
          label="Pending Rewards"
          value={formatUsd(stats.pending_rewards_usd)}
          detail={stats.pending_rewards_count > 0 ? `${stats.pending_rewards_count} pending` : undefined}
        />
        <TerminalMetricCard
          label="Total Referrals"
          value={String(stats.total_referrals)}
          detail={`${stats.code_times_used} code uses`}
        />
        <TerminalMetricCard
          label="Active Referrals"
          value={String(stats.active_referrals)}
        />
      </div>

      {/* Claim note */}
      <div className="text-[12px] text-terminal-text-muted text-center border border-terminal-border/50 rounded px-3 py-2">
        Claim pending rewards in the Telegram bot with <span className="font-mono text-sakura-400">/ref</span>
      </div>
    </div>
  )
}

function ReferralsListTab() {
  const { data: referrals, isLoading } = useReferralsList()

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-32 text-terminal-text-muted text-sm">
        Loading referrals...
      </div>
    )
  }

  const items = referrals ?? []

  if (items.length === 0) {
    return (
      <div className="p-4">
        <TerminalEmptyState
          title="No referrals yet"
          description="Share your referral link to start earning. You will see your referred users here once they join."
        />
      </div>
    )
  }

  return (
    <div className="p-4 overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-terminal-text-muted text-xs uppercase tracking-wider border-b border-terminal-border">
            <th className="text-left py-2 px-3">User</th>
            <th className="text-left py-2 px-3">Joined</th>
            <th className="text-right py-2 px-3">Rewards Earned</th>
          </tr>
        </thead>
        <tbody>
          {items.map((entry) => (
            <tr
              key={entry.user_id}
              className="border-b border-terminal-border/50 hover:bg-terminal-bg-tertiary/50 transition-colors"
            >
              <td className="py-2.5 px-3 font-mono text-terminal-text">
                {entry.username || entry.user_id}
              </td>
              <td className="py-2.5 px-3 text-terminal-text-secondary text-xs">
                {formatDate(entry.joined_at)}
              </td>
              <td className="py-2.5 px-3 font-mono text-right text-sakura-400">
                {formatUsd(entry.total_rewards_usd)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function LeaderboardTab() {
  const { data: entries, isLoading } = useReferralLeaderboard()

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-32 text-terminal-text-muted text-sm">
        Loading leaderboard...
      </div>
    )
  }

  const items = entries ?? []

  if (items.length === 0) {
    return (
      <div className="p-4">
        <TerminalEmptyState
          title="Leaderboard is empty"
          description="No referral activity yet. Be the first to top the leaderboard."
        />
      </div>
    )
  }

  return (
    <div className="p-4 overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-terminal-text-muted text-xs uppercase tracking-wider border-b border-terminal-border">
            <th className="text-left py-2 px-3 w-16">Rank</th>
            <th className="text-left py-2 px-3">User</th>
            <th className="text-right py-2 px-3">Total Rewards</th>
          </tr>
        </thead>
        <tbody>
          {items.map((entry) => (
            <tr
              key={entry.rank}
              className="border-b border-terminal-border/50 hover:bg-terminal-bg-tertiary/50 transition-colors"
            >
              <td className="py-2.5 px-3 font-mono text-sm">
                {getRankDisplay(entry.rank)}
              </td>
              <td className="py-2.5 px-3 font-mono text-terminal-text">
                {entry.username}
              </td>
              <td className="py-2.5 px-3 font-mono text-right text-sakura-400">
                {formatUsd(entry.total_reward_usd)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

export function ReferralsPanel() {
  const [activeTab, setActiveTab] = useState<Tab>('overview')
  const { isAuthenticated } = useAuth()

  if (!isAuthenticated) {
    return (
      <div className="flex items-center justify-center h-full text-terminal-text-muted text-sm">
        Sign in to view your referrals
      </div>
    )
  }

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
        {activeTab === 'overview' && <OverviewTab />}
        {activeTab === 'referrals' && <ReferralsListTab />}
        {activeTab === 'leaderboard' && <LeaderboardTab />}
      </div>
    </div>
  )
}
