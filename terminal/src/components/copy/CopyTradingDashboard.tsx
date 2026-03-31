import { useState } from 'react'
import { TraderLeaderboard } from './TraderLeaderboard'
import { TraderCard } from './TraderCard'
import { FollowingList } from './FollowingList'
import { CopyFeed } from './CopyFeed'
import { CopySettingsModal } from './CopySettingsModal'
import { useTraderProfile, useFollowTrader, useUnfollowTrader } from '../../hooks/useCopyTrading'
import type { FollowSettings } from '../../types/api'

type Tab = 'top-traders' | 'following' | 'copy-feed'

const TABS: { id: Tab; label: string }[] = [
  { id: 'top-traders', label: 'Top Traders' },
  { id: 'following', label: 'Following' },
  { id: 'copy-feed', label: 'Copy Feed' },
]

export function CopyTradingDashboard() {
  const [activeTab, setActiveTab] = useState<Tab>('top-traders')
  const [selectedTraderId, setSelectedTraderId] = useState<string | null>(null)
  const [followModalTraderId, setFollowModalTraderId] = useState<string | null>(null)

  const { data: selectedTrader } = useTraderProfile(selectedTraderId)
  const { mutate: followTrader } = useFollowTrader()
  const { mutate: unfollowTrader } = useUnfollowTrader()

  const handleFollow = (traderId: string) => {
    setFollowModalTraderId(traderId)
  }

  const handleConfirmFollow = (settings: FollowSettings) => {
    if (!followModalTraderId) return
    followTrader({ traderId: followModalTraderId, settings })
    setFollowModalTraderId(null)
  }

  const handleUnfollow = (traderId: string) => {
    unfollowTrader(traderId)
    if (selectedTraderId === traderId) setSelectedTraderId(null)
  }

  return (
    <div className="h-full flex flex-col">
      {/* Tab bar */}
      <div className="flex items-center border-b border-terminal-border px-2 shrink-0">
        {TABS.map(tab => (
          <button
            key={tab.id}
            onClick={() => { setActiveTab(tab.id); setSelectedTraderId(null) }}
            className={`terminal-tab ${activeTab === tab.id ? 'terminal-tab-active' : ''}`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Tab content */}
      <div className="flex-1 overflow-auto">
        {activeTab === 'top-traders' && (
          selectedTrader ? (
            <div className="p-3">
              <button
                onClick={() => setSelectedTraderId(null)}
                className="text-xs text-terminal-text-muted hover:text-terminal-text mb-3 flex items-center gap-1"
              >
                <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
                </svg>
                Back to leaderboard
              </button>
              <TraderCard
                trader={selectedTrader}
                onFollow={() => handleFollow(selectedTrader.id)}
                onUnfollow={() => handleUnfollow(selectedTrader.id)}
              />
            </div>
          ) : (
            <TraderLeaderboard
              onSelectTrader={setSelectedTraderId}
              onFollow={handleFollow}
            />
          )
        )}
        {activeTab === 'following' && <FollowingList />}
        {activeTab === 'copy-feed' && <CopyFeed />}
      </div>

      {/* Follow settings modal */}
      <CopySettingsModal
        isOpen={!!followModalTraderId}
        onClose={() => setFollowModalTraderId(null)}
        onSave={handleConfirmFollow}
      />
    </div>
  )
}
