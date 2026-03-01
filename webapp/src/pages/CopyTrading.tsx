import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { AppLayout, AppHeader } from '../components/layout'
import {
  useTopTraders,
  useFollowing,
  useFollow,
  useUnfollow,
} from '../hooks/useCopyTrading'
import type { CopyTraderEntry, CopyFollowingEntry, CopyFollowSettings } from '../lib/api'

type FilterTab = 'top' | 'following'

interface TraderFilters {
  minTrades?: number
  minWinRate?: number
  chain?: string
  sortBy?: string
}

function TraderCardSkeleton() {
  return (
    <div className="bg-white rounded-suwappu-xl shadow-suwappu-1 p-3 animate-pulse">
      <div className="flex items-start gap-3 mb-3">
        <div className="w-12 h-12 rounded-full bg-gray-200" />
        <div className="flex-1">
          <div className="h-4 bg-gray-200 rounded w-24 mb-2" />
          <div className="h-3 bg-gray-200 rounded w-32" />
        </div>
      </div>
      <div className="grid grid-cols-3 gap-2">
        <div className="bg-gray-100 rounded-lg p-2 h-12" />
        <div className="bg-gray-100 rounded-lg p-2 h-12" />
        <div className="bg-gray-100 rounded-lg p-2 h-12" />
      </div>
    </div>
  )
}

function TopTraderCard({
  trader,
  onFollow,
  isFollowed,
}: {
  trader: CopyTraderEntry
  onFollow: (trader: CopyTraderEntry) => void
  isFollowed: boolean
}) {
  const pnlColor = trader.totalPnlUsd >= 0 ? 'text-green-600' : 'text-red-600'

  return (
    <div className="bg-white rounded-suwappu-xl shadow-suwappu-1 p-3">
      <div className="flex items-start gap-3 mb-3">
        <div className="w-12 h-12 rounded-full bg-suwappu-sakura-light flex items-center justify-center text-2xl">
          {trader.avatarEmoji}
        </div>
        <div className="flex-1">
          <div className="flex items-center justify-between">
            <p className="font-heading font-semibold text-sm text-suwappu-text">
              {trader.displayName}
            </p>
            <button
              onClick={() => onFollow(trader)}
              className={`px-3 py-1 rounded-full text-xs font-medium transition-colors ${
                isFollowed
                  ? 'bg-suwappu-sakura-light text-suwappu-text-secondary'
                  : 'bg-suwappu-magenta-mid text-white'
              }`}
            >
              {isFollowed ? 'Following' : 'Follow'}
            </button>
          </div>
          <p className="text-xs text-suwappu-text-secondary">
            {trader.followerCount.toLocaleString()} followers &middot; {trader.totalTrades} trades
          </p>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-2">
        <div className="bg-suwappu-sakura-light/30 rounded-lg p-2 text-center">
          <p className="text-[10px] text-suwappu-text-secondary">PnL</p>
          <p className={`font-heading font-bold text-xs ${pnlColor}`}>
            {trader.totalPnlUsd >= 0 ? '+' : ''}${trader.totalPnlUsd.toLocaleString(undefined, { maximumFractionDigits: 0 })}
          </p>
        </div>
        <div className="bg-suwappu-sakura-light/30 rounded-lg p-2 text-center">
          <p className="text-[10px] text-suwappu-text-secondary">Volume</p>
          <p className="font-heading font-bold text-xs text-suwappu-text">
            ${trader.totalVolumeUsd.toLocaleString(undefined, { maximumFractionDigits: 0 })}
          </p>
        </div>
        <div className="bg-suwappu-sakura-light/30 rounded-lg p-2 text-center">
          <p className="text-[10px] text-suwappu-text-secondary">Win Rate</p>
          <p className="font-heading font-bold text-xs text-suwappu-purple-deep">{trader.winRate.toFixed(0)}%</p>
        </div>
      </div>
    </div>
  )
}

function FollowingCard({
  entry,
  onUnfollow,
}: {
  entry: CopyFollowingEntry
  onUnfollow: (traderId: number) => void
}) {
  const pnlColor = (entry.totalCopyPnl ?? 0) >= 0 ? 'text-green-600' : 'text-red-600'

  return (
    <div className="bg-white rounded-suwappu-xl shadow-suwappu-1 p-3">
      <div className="flex items-start gap-3 mb-3">
        <div className="w-12 h-12 rounded-full bg-suwappu-sakura-light flex items-center justify-center text-2xl">
          {entry.avatarEmoji || '🦊'}
        </div>
        <div className="flex-1">
          <div className="flex items-center justify-between">
            <p className="font-heading font-semibold text-sm text-suwappu-text">
              {entry.displayName || 'Unknown'}
            </p>
            <button
              onClick={() => onUnfollow(entry.traderId)}
              className="px-3 py-1 rounded-full text-xs font-medium bg-red-50 text-red-600 transition-colors"
            >
              Unfollow
            </button>
          </div>
          <p className="text-xs text-suwappu-text-secondary">
            {entry.copyMode === 'auto' ? 'Auto copy' : 'Notifications'} &middot; ${entry.copyAmountUsd ?? 10}/trade
          </p>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-2">
        <div className="bg-suwappu-sakura-light/30 rounded-lg p-2 text-center">
          <p className="text-[10px] text-suwappu-text-secondary">Copied</p>
          <p className="font-heading font-bold text-xs text-suwappu-text">{entry.totalCopiedTrades ?? 0}</p>
        </div>
        <div className="bg-suwappu-sakura-light/30 rounded-lg p-2 text-center">
          <p className="text-[10px] text-suwappu-text-secondary">Copy PnL</p>
          <p className={`font-heading font-bold text-xs ${pnlColor}`}>
            ${(entry.totalCopyPnl ?? 0).toFixed(2)}
          </p>
        </div>
        <div className="bg-suwappu-sakura-light/30 rounded-lg p-2 text-center">
          <p className="text-[10px] text-suwappu-text-secondary">Win Rate</p>
          <p className="font-heading font-bold text-xs text-suwappu-purple-deep">{(entry.winRate ?? 0).toFixed(0)}%</p>
        </div>
      </div>
    </div>
  )
}

function CopySettingsModal({
  isOpen,
  onClose,
  onSave,
  trader,
}: {
  isOpen: boolean
  onClose: () => void
  onSave: (settings: CopyFollowSettings) => void
  trader: CopyTraderEntry | null
}) {
  const [copyMode, setCopyMode] = useState<string>('notify')
  const [copyAmount, setCopyAmount] = useState('10')
  const [maxTrade, setMaxTrade] = useState('100')
  const [dailyLimit, setDailyLimit] = useState('500')
  const [autoSell, setAutoSell] = useState(true)

  if (!isOpen || !trader) return null

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/50" onClick={onClose}>
      <div
        className="bg-white w-full max-w-md rounded-t-3xl p-4 pb-8"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="w-12 h-1 bg-gray-200 rounded-full mx-auto mb-4" />

        <div className="flex items-center gap-3 mb-4">
          <div className="w-10 h-10 rounded-full bg-suwappu-sakura-light flex items-center justify-center text-xl">
            {trader.avatarEmoji}
          </div>
          <div>
            <p className="font-heading font-bold text-suwappu-purple-deep">
              Copy {trader.displayName}
            </p>
            <p className="text-xs text-suwappu-text-secondary">{trader.winRate.toFixed(0)}% win rate</p>
          </div>
        </div>

        <div className="space-y-4 mb-4">
          <div>
            <label className="text-xs text-suwappu-text-secondary block mb-1">Copy Mode</label>
            <div className="flex gap-2">
              <button
                onClick={() => setCopyMode('notify')}
                className={`flex-1 py-2 rounded-lg text-xs font-medium ${
                  copyMode === 'notify' ? 'bg-suwappu-magenta-mid text-white' : 'bg-gray-100 text-gray-600'
                }`}
              >
                Notify Me
              </button>
              <button
                onClick={() => setCopyMode('auto')}
                className={`flex-1 py-2 rounded-lg text-xs font-medium ${
                  copyMode === 'auto' ? 'bg-suwappu-magenta-mid text-white' : 'bg-gray-100 text-gray-600'
                }`}
              >
                Auto Copy
              </button>
            </div>
          </div>
          <div>
            <label className="text-xs text-suwappu-text-secondary block mb-1">Amount per trade (USD)</label>
            <input
              type="number"
              value={copyAmount}
              onChange={(e) => setCopyAmount(e.target.value)}
              className="w-full p-3 rounded-suwappu-lg border border-suwappu-sakura-mid/30 text-sm"
            />
          </div>
          <div>
            <label className="text-xs text-suwappu-text-secondary block mb-1">Max per trade (USD)</label>
            <input
              type="number"
              value={maxTrade}
              onChange={(e) => setMaxTrade(e.target.value)}
              className="w-full p-3 rounded-suwappu-lg border border-suwappu-sakura-mid/30 text-sm"
            />
          </div>
          <div>
            <label className="text-xs text-suwappu-text-secondary block mb-1">Daily limit (USD)</label>
            <input
              type="number"
              value={dailyLimit}
              onChange={(e) => setDailyLimit(e.target.value)}
              className="w-full p-3 rounded-suwappu-lg border border-suwappu-sakura-mid/30 text-sm"
            />
          </div>
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={autoSell}
              onChange={(e) => setAutoSell(e.target.checked)}
              className="rounded"
            />
            <span className="text-xs text-suwappu-text-secondary">Auto-sell when trader sells</span>
          </label>
        </div>

        <button
          onClick={() =>
            onSave({
              copyMode,
              copyAmountUsd: parseFloat(copyAmount) || 10,
              maxTradeUsd: parseFloat(maxTrade) || 100,
              dailyLimitUsd: parseFloat(dailyLimit) || 500,
              autoSellEnabled: autoSell,
            })
          }
          className="w-full py-3 bg-gradient-to-r from-suwappu-magenta-mid to-suwappu-purple-deep text-white font-heading font-semibold rounded-suwappu-xl"
        >
          Start Copying
        </button>
      </div>
    </div>
  )
}

function FilterBar({
  filters,
  onChange,
}: {
  filters: TraderFilters
  onChange: (f: TraderFilters) => void
}) {
  return (
    <div className="flex gap-2 overflow-x-auto pb-1">
      <select
        value={filters.sortBy || 'rank'}
        onChange={(e) => onChange({ ...filters, sortBy: e.target.value === 'rank' ? undefined : e.target.value })}
        className="text-xs bg-white border border-gray-200 rounded-lg px-2 py-1.5"
      >
        <option value="rank">Sort: Rank</option>
        <option value="pnl">Sort: PnL</option>
        <option value="volume">Sort: Volume</option>
        <option value="followers">Sort: Followers</option>
      </select>
      <select
        value={filters.minWinRate || ''}
        onChange={(e) => onChange({ ...filters, minWinRate: e.target.value ? Number(e.target.value) : undefined })}
        className="text-xs bg-white border border-gray-200 rounded-lg px-2 py-1.5"
      >
        <option value="">Win Rate: Any</option>
        <option value="50">Win Rate: 50%+</option>
        <option value="60">Win Rate: 60%+</option>
        <option value="70">Win Rate: 70%+</option>
      </select>
      <select
        value={filters.minTrades || ''}
        onChange={(e) => onChange({ ...filters, minTrades: e.target.value ? Number(e.target.value) : undefined })}
        className="text-xs bg-white border border-gray-200 rounded-lg px-2 py-1.5"
      >
        <option value="">Trades: 5+</option>
        <option value="10">Trades: 10+</option>
        <option value="50">Trades: 50+</option>
        <option value="100">Trades: 100+</option>
      </select>
    </div>
  )
}

export function CopyTrading() {
  const navigate = useNavigate()
  const [tab, setTab] = useState<FilterTab>('top')
  const [filters, setFilters] = useState<TraderFilters>({})
  const [selectedTrader, setSelectedTrader] = useState<CopyTraderEntry | null>(null)
  const [showSettings, setShowSettings] = useState(false)

  const { data: topTraders, isLoading: loadingTop, error: topError } = useTopTraders(filters)
  const { data: following, isLoading: loadingFollowing } = useFollowing()
  const followMutation = useFollow()
  const unfollowMutation = useUnfollow()

  const followedTraderIds = new Set((following ?? []).map((f) => f.traderId))

  const handleFollowClick = (trader: CopyTraderEntry) => {
    if (followedTraderIds.has(trader.userId)) {
      unfollowMutation.mutate(trader.userId)
    } else {
      setSelectedTrader(trader)
      setShowSettings(true)
    }
  }

  const handleSaveSettings = (settings: CopyFollowSettings) => {
    if (selectedTrader) {
      followMutation.mutate({ traderId: selectedTrader.userId, settings })
    }
    setShowSettings(false)
    setSelectedTrader(null)
  }

  const handleUnfollow = (traderId: number) => {
    unfollowMutation.mutate(traderId)
  }

  const traderCount = topTraders?.length ?? 0
  const followingCount = following?.length ?? 0
  const avgWinRate =
    traderCount > 0
      ? (topTraders!.reduce((sum, t) => sum + t.winRate, 0) / traderCount).toFixed(0)
      : '0'

  return (
    <AppLayout
      header={<AppHeader title="Copy Trading" showBack onBack={() => navigate(-1)} />}
      activeNav="home"
    >
      <div className="p-3 pb-20 space-y-4">
        {/* Stats Banner */}
        <div className="bg-gradient-to-br from-suwappu-magenta-mid to-suwappu-purple-deep rounded-suwappu-xl p-4 text-white">
          <p className="text-white/70 text-xs mb-1">Copy Top Traders</p>
          <p className="font-heading font-bold text-lg mb-2">
            Automatically mirror successful traders' moves
          </p>
          <div className="flex gap-4 text-sm">
            <div>
              <p className="text-white/70 text-[10px]">Traders</p>
              <p className="font-bold">{traderCount}</p>
            </div>
            <div>
              <p className="text-white/70 text-[10px]">Avg Win Rate</p>
              <p className="font-bold">{avgWinRate}%</p>
            </div>
            <div>
              <p className="text-white/70 text-[10px]">Following</p>
              <p className="font-bold">{followingCount}</p>
            </div>
          </div>
        </div>

        {/* Filter Tabs */}
        <div className="flex gap-2">
          <button
            onClick={() => setTab('top')}
            className={`flex-1 py-2 rounded-suwappu-lg text-sm font-medium transition-colors ${
              tab === 'top'
                ? 'bg-suwappu-magenta-mid text-white'
                : 'bg-white text-suwappu-text-secondary'
            }`}
          >
            Top Traders
          </button>
          <button
            onClick={() => setTab('following')}
            className={`flex-1 py-2 rounded-suwappu-lg text-sm font-medium transition-colors ${
              tab === 'following'
                ? 'bg-suwappu-magenta-mid text-white'
                : 'bg-white text-suwappu-text-secondary'
            }`}
          >
            Following ({followingCount})
          </button>
        </div>

        {/* Filters (only for Top tab) */}
        {tab === 'top' && <FilterBar filters={filters} onChange={setFilters} />}

        {/* Content */}
        {tab === 'top' && (
          <>
            {loadingTop ? (
              <div className="space-y-3">
                <TraderCardSkeleton />
                <TraderCardSkeleton />
                <TraderCardSkeleton />
              </div>
            ) : topError ? (
              <div className="bg-white rounded-suwappu-xl shadow-suwappu-1 p-8 text-center">
                <p className="text-red-500 text-sm">Failed to load traders. Try again later.</p>
              </div>
            ) : topTraders && topTraders.length > 0 ? (
              <div className="space-y-3">
                {topTraders.map((trader) => (
                  <TopTraderCard
                    key={trader.userId}
                    trader={trader}
                    onFollow={handleFollowClick}
                    isFollowed={followedTraderIds.has(trader.userId)}
                  />
                ))}
              </div>
            ) : (
              <div className="bg-white rounded-suwappu-xl shadow-suwappu-1 p-8 text-center">
                <div className="w-16 h-16 mx-auto mb-4 bg-suwappu-sakura-light rounded-full flex items-center justify-center">
                  <span className="text-3xl">🏆</span>
                </div>
                <p className="font-heading font-semibold text-suwappu-purple-deep mb-1">
                  No traders yet
                </p>
                <p className="text-xs text-suwappu-text-secondary">
                  Be the first to go public and appear on the leaderboard!
                </p>
              </div>
            )}
          </>
        )}

        {tab === 'following' && (
          <>
            {loadingFollowing ? (
              <div className="space-y-3">
                <TraderCardSkeleton />
                <TraderCardSkeleton />
              </div>
            ) : following && following.length > 0 ? (
              <div className="space-y-3">
                {following.map((entry) => (
                  <FollowingCard
                    key={entry.traderId}
                    entry={entry}
                    onUnfollow={handleUnfollow}
                  />
                ))}
              </div>
            ) : (
              <div className="bg-white rounded-suwappu-xl shadow-suwappu-1 p-8 text-center">
                <div className="w-16 h-16 mx-auto mb-4 bg-suwappu-sakura-light rounded-full flex items-center justify-center">
                  <span className="text-3xl">👥</span>
                </div>
                <p className="font-heading font-semibold text-suwappu-purple-deep mb-1">
                  Not following anyone yet
                </p>
                <p className="text-xs text-suwappu-text-secondary">
                  Browse top traders and start copying!
                </p>
              </div>
            )}
          </>
        )}

        {/* Info */}
        <div className="bg-suwappu-sakura-light/30 rounded-suwappu-lg p-3">
          <p className="text-xs text-suwappu-text-secondary">
            <strong>Copy Trading</strong> automatically mirrors a trader's moves.
            Set your budget and risk limits, then let pros trade for you!
          </p>
        </div>
      </div>

      <CopySettingsModal
        isOpen={showSettings}
        onClose={() => setShowSettings(false)}
        onSave={handleSaveSettings}
        trader={selectedTrader}
      />
    </AppLayout>
  )
}
