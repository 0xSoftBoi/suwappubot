import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import toast from 'react-hot-toast'
import { AppLayout, AppHeader } from '../components/layout'
import { api, type TraderEntry, type CopyFollow } from '../lib/api'

const sortOptions = [
  { value: 'pnl7d', label: '7D PnL' },
  { value: 'pnl30d', label: '30D PnL' },
  { value: 'winRate', label: 'Win Rate' },
  { value: 'followers', label: 'Followers' },
]

function formatPercent(value: number): string {
  const sign = value >= 0 ? '+' : ''
  return `${sign}${value.toFixed(1)}%`
}

function TraderCard({ 
  trader, 
  isFollowing,
  onFollow, 
  onUnfollow 
}: { 
  trader: TraderEntry
  isFollowing: boolean
  onFollow: (id: number) => void
  onUnfollow: (id: number) => void
}) {
  return (
    <div className="bg-white rounded-suwappu-xl shadow-suwappu-1 p-3">
      <div className="flex items-start justify-between mb-3">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-full bg-gradient-suwappu flex items-center justify-center text-white font-bold">
            {trader.displayName?.[0] || '?'}
          </div>
          <div>
            <p className="font-heading font-semibold text-sm text-suwappu-text">
              {trader.displayName || `Trader #${trader.userId}`}
            </p>
            <p className="text-[10px] text-suwappu-text-secondary">
              {trader.followerCount} followers • {trader.totalTrades} trades
            </p>
          </div>
        </div>
        <button
          onClick={() => isFollowing ? onUnfollow(trader.userId) : onFollow(trader.userId)}
          className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
            isFollowing
              ? 'bg-gray-100 text-gray-600'
              : 'bg-suwappu-purple-deep text-white'
          }`}
        >
          {isFollowing ? 'Following' : 'Follow'}
        </button>
      </div>

      <div className="grid grid-cols-3 gap-2">
        <div className="bg-suwappu-sakura-light/30 rounded-lg p-2 text-center">
          <p className="text-[10px] text-suwappu-text-secondary">7D PnL</p>
          <p className={`font-heading font-bold text-sm ${
            trader.pnl7d >= 0 ? 'text-green-600' : 'text-red-500'
          }`}>
            {formatPercent(trader.pnl7dPercent)}
          </p>
        </div>
        <div className="bg-suwappu-sakura-light/30 rounded-lg p-2 text-center">
          <p className="text-[10px] text-suwappu-text-secondary">30D PnL</p>
          <p className={`font-heading font-bold text-sm ${
            trader.pnl30d >= 0 ? 'text-green-600' : 'text-red-500'
          }`}>
            {formatPercent(trader.pnl30dPercent)}
          </p>
        </div>
        <div className="bg-suwappu-sakura-light/30 rounded-lg p-2 text-center">
          <p className="text-[10px] text-suwappu-text-secondary">Win Rate</p>
          <p className="font-heading font-bold text-sm text-suwappu-text">
            {trader.winRate.toFixed(0)}%
          </p>
        </div>
      </div>
    </div>
  )
}

function FollowModal({ 
  isOpen, 
  trader,
  onClose, 
  onConfirm 
}: {
  isOpen: boolean
  trader: TraderEntry | null
  onClose: () => void
  onConfirm: (settings: { maxAmountPerTrade?: number; totalBudget?: number; stopLossPercent?: number }) => void
}) {
  const [maxAmount, setMaxAmount] = useState('')
  const [budget, setBudget] = useState('')
  const [stopLoss, setStopLoss] = useState('')

  if (!isOpen || !trader) return null

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />
      <div className="relative bg-white rounded-t-3xl sm:rounded-2xl w-full sm:max-w-md p-4 pb-8">
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-heading font-semibold text-lg">Copy {trader.displayName}</h3>
          <button onClick={onClose} className="text-2xl text-suwappu-text-secondary">×</button>
        </div>

        <div className="space-y-4 mb-6">
          <div>
            <label className="block text-xs text-suwappu-text-secondary mb-1">
              Max per trade (USD)
            </label>
            <input
              type="number"
              value={maxAmount}
              onChange={(e) => setMaxAmount(e.target.value)}
              placeholder="100"
              className="w-full p-3 rounded-lg border border-gray-200"
            />
          </div>

          <div>
            <label className="block text-xs text-suwappu-text-secondary mb-1">
              Total budget (USD)
            </label>
            <input
              type="number"
              value={budget}
              onChange={(e) => setBudget(e.target.value)}
              placeholder="1000"
              className="w-full p-3 rounded-lg border border-gray-200"
            />
          </div>

          <div>
            <label className="block text-xs text-suwappu-text-secondary mb-1">
              Stop loss (%)
            </label>
            <input
              type="number"
              value={stopLoss}
              onChange={(e) => setStopLoss(e.target.value)}
              placeholder="10"
              className="w-full p-3 rounded-lg border border-gray-200"
            />
          </div>
        </div>

        <button
          onClick={() => onConfirm({
            maxAmountPerTrade: maxAmount ? parseFloat(maxAmount) : undefined,
            totalBudget: budget ? parseFloat(budget) : undefined,
            stopLossPercent: stopLoss ? parseFloat(stopLoss) : undefined,
          })}
          className="w-full py-3 bg-gradient-suwappu text-white font-heading font-semibold rounded-xl"
        >
          Start Copying
        </button>
      </div>
    </div>
  )
}

export function CopyTrading() {
  const navigate = useNavigate()
  const [traders, setTraders] = useState<TraderEntry[]>([])
  const [following, setFollowing] = useState<CopyFollow[]>([])
  const [loading, setLoading] = useState(true)
  const [sortBy, setSortBy] = useState('pnl7d')
  const [selectedTrader, setSelectedTrader] = useState<TraderEntry | null>(null)
  const [showFollowModal, setShowFollowModal] = useState(false)

  useEffect(() => {
    loadData()
  }, [sortBy])

  const loadData = async () => {
    try {
      setLoading(true)
      const [tradersData, followingData] = await Promise.all([
        api.getTraderLeaderboard(sortBy, 50),
        api.getFollowing(),
      ])
      setTraders(tradersData)
      setFollowing(followingData)
    } catch (err: any) {
      toast.error(err.detail || 'Failed to load data')
    } finally {
      setLoading(false)
    }
  }

  const handleFollow = (traderId: number) => {
    const trader = traders.find(t => t.userId === traderId)
    if (trader) {
      setSelectedTrader(trader)
      setShowFollowModal(true)
    }
  }

  const handleConfirmFollow = async (settings: { maxAmountPerTrade?: number; totalBudget?: number; stopLossPercent?: number }) => {
    if (!selectedTrader) return
    
    try {
      await api.followTrader(selectedTrader.userId, {
        walletId: 1, // TODO: Get from wallet context
        ...settings,
      })
      setShowFollowModal(false)
      toast.success(`Now following ${selectedTrader.displayName}!`)
      loadData()
    } catch (err: any) {
      toast.error(err.detail || 'Failed to follow trader')
    }
  }

  const handleUnfollow = async (traderId: number) => {
    try {
      await api.unfollowTrader(traderId)
      setFollowing(following.filter(f => f.traderId !== traderId))
      toast.success('Unfollowed trader')
    } catch (err: any) {
      toast.error(err.detail || 'Failed to unfollow trader')
    }
  }

  const isFollowing = (traderId: number) => following.some(f => f.traderId === traderId && f.isActive)

  return (
    <AppLayout 
      header={<AppHeader title="Copy Trading" showBack onBack={() => navigate(-1)} />} 
      activeNav="earn"
    >
      <div className="p-3 pb-20 space-y-4">
        {/* Following count */}
        {following.length > 0 && (
          <div className="bg-gradient-suwappu rounded-suwappu-xl p-3 text-white">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium">Currently copying</p>
                <p className="text-2xl font-heading font-bold">{following.length} traders</p>
              </div>
              <span className="text-4xl">📈</span>
            </div>
          </div>
        )}

        {/* Sort options */}
        <div className="flex gap-2 overflow-x-auto pb-1">
          {sortOptions.map((option) => (
            <button
              key={option.value}
              onClick={() => setSortBy(option.value)}
              className={`px-3 py-1.5 rounded-full text-xs font-medium whitespace-nowrap transition-colors ${
                sortBy === option.value
                  ? 'bg-suwappu-purple-deep text-white'
                  : 'bg-suwappu-sakura-light/50 text-suwappu-text-secondary'
              }`}
            >
              {option.label}
            </button>
          ))}
        </div>

        {/* Loading state */}
        {loading && (
          <div className="text-center py-8">
            <div className="animate-spin w-8 h-8 border-2 border-suwappu-purple-deep border-t-transparent rounded-full mx-auto mb-2" />
            <p className="text-suwappu-text-secondary text-sm">Loading traders...</p>
          </div>
        )}

        {/* Traders list */}
        {!loading && traders.length > 0 && (
          <div className="space-y-3">
            {traders.map((trader) => (
              <TraderCard
                key={trader.userId}
                trader={trader}
                isFollowing={isFollowing(trader.userId)}
                onFollow={handleFollow}
                onUnfollow={handleUnfollow}
              />
            ))}
          </div>
        )}

        {/* Empty state */}
        {!loading && traders.length === 0 && (
          <div className="bg-white rounded-suwappu-xl shadow-suwappu-1 p-8 text-center">
            <span className="text-4xl block mb-2">🔍</span>
            <p className="font-heading font-semibold text-suwappu-text mb-1">
              No traders found
            </p>
            <p className="text-xs text-suwappu-text-secondary">
              Check back later for top performers
            </p>
          </div>
        )}

        {/* Info card */}
        <div className="bg-suwappu-sakura-light/30 rounded-suwappu-lg p-3">
          <p className="text-xs text-suwappu-text-secondary">
            💡 <strong>Copy Trading</strong> lets you automatically mirror trades from 
            successful traders. Set your budget and risk limits, and your trades execute 
            automatically when they trade!
          </p>
        </div>
      </div>

      <FollowModal
        isOpen={showFollowModal}
        trader={selectedTrader}
        onClose={() => setShowFollowModal(false)}
        onConfirm={handleConfirmFollow}
      />
    </AppLayout>
  )
}
