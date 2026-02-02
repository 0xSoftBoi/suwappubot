import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { AppLayout, AppHeader } from '../components/layout'

interface Trader {
  id: string
  username: string
  avatar: string
  pnl7d: number
  pnl30d: number
  winRate: number
  totalTrades: number
  followers: number
  isFollowing: boolean
}

const mockTraders: Trader[] = [
  {
    id: '1',
    username: 'CryptoWhale',
    avatar: '🐋',
    pnl7d: 23.5,
    pnl30d: 156.2,
    winRate: 78,
    totalTrades: 342,
    followers: 1250,
    isFollowing: false,
  },
  {
    id: '2',
    username: 'DeFiDegen',
    avatar: '🦊',
    pnl7d: 15.2,
    pnl30d: 89.4,
    winRate: 72,
    totalTrades: 567,
    followers: 890,
    isFollowing: false,
  },
  {
    id: '3',
    username: 'AlphaHunter',
    avatar: '🎯',
    pnl7d: 31.8,
    pnl30d: 203.1,
    winRate: 81,
    totalTrades: 189,
    followers: 2100,
    isFollowing: false,
  },
  {
    id: '4',
    username: 'TokenMaster',
    avatar: '👑',
    pnl7d: -5.2,
    pnl30d: 45.6,
    winRate: 65,
    totalTrades: 890,
    followers: 560,
    isFollowing: false,
  },
]

interface CopySettings {
  maxPerTrade: string
  totalBudget: string
  stopLoss: string
}

function TraderCard({ trader, onFollow }: { trader: Trader; onFollow: (id: string) => void }) {
  const pnlColor = trader.pnl7d >= 0 ? 'text-green-600' : 'text-red-600'
  
  return (
    <div className="bg-white rounded-suwappu-xl shadow-suwappu-1 p-3">
      <div className="flex items-start gap-3 mb-3">
        <div className="w-12 h-12 rounded-full bg-suwappu-sakura-light flex items-center justify-center text-2xl">
          {trader.avatar}
        </div>
        <div className="flex-1">
          <div className="flex items-center justify-between">
            <p className="font-heading font-semibold text-sm text-suwappu-text">
              @{trader.username}
            </p>
            <button
              onClick={() => onFollow(trader.id)}
              className={`px-3 py-1 rounded-full text-xs font-medium transition-colors ${
                trader.isFollowing
                  ? 'bg-suwappu-sakura-light text-suwappu-text-secondary'
                  : 'bg-suwappu-magenta-mid text-white'
              }`}
            >
              {trader.isFollowing ? 'Following' : 'Follow'}
            </button>
          </div>
          <p className="text-xs text-suwappu-text-secondary">
            {trader.followers.toLocaleString()} followers · {trader.totalTrades} trades
          </p>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-2">
        <div className="bg-suwappu-sakura-light/30 rounded-lg p-2 text-center">
          <p className="text-[10px] text-suwappu-text-secondary">7d PnL</p>
          <p className={`font-heading font-bold ${pnlColor}`}>
            {trader.pnl7d >= 0 ? '+' : ''}{trader.pnl7d}%
          </p>
        </div>
        <div className="bg-suwappu-sakura-light/30 rounded-lg p-2 text-center">
          <p className="text-[10px] text-suwappu-text-secondary">30d PnL</p>
          <p className={`font-heading font-bold ${trader.pnl30d >= 0 ? 'text-green-600' : 'text-red-600'}`}>
            {trader.pnl30d >= 0 ? '+' : ''}{trader.pnl30d}%
          </p>
        </div>
        <div className="bg-suwappu-sakura-light/30 rounded-lg p-2 text-center">
          <p className="text-[10px] text-suwappu-text-secondary">Win Rate</p>
          <p className="font-heading font-bold text-suwappu-purple-deep">{trader.winRate}%</p>
        </div>
      </div>
    </div>
  )
}

function CopySettingsModal({ isOpen, onClose, onSave, trader }: {
  isOpen: boolean
  onClose: () => void
  onSave: (settings: CopySettings) => void
  trader: Trader | null
}) {
  const [settings, setSettings] = useState<CopySettings>({
    maxPerTrade: '100',
    totalBudget: '1000',
    stopLoss: '10',
  })

  if (!isOpen || !trader) return null

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/50" onClick={onClose}>
      <div 
        className="bg-white w-full max-w-md rounded-t-3xl p-4 pb-8"
        onClick={e => e.stopPropagation()}
      >
        <div className="w-12 h-1 bg-gray-200 rounded-full mx-auto mb-4" />
        
        <div className="flex items-center gap-3 mb-4">
          <div className="w-10 h-10 rounded-full bg-suwappu-sakura-light flex items-center justify-center text-xl">
            {trader.avatar}
          </div>
          <div>
            <p className="font-heading font-bold text-suwappu-purple-deep">Copy @{trader.username}</p>
            <p className="text-xs text-suwappu-text-secondary">{trader.winRate}% win rate</p>
          </div>
        </div>

        <div className="space-y-4 mb-4">
          <div>
            <label className="text-xs text-suwappu-text-secondary block mb-1">Max per trade (USD)</label>
            <input
              type="number"
              value={settings.maxPerTrade}
              onChange={(e) => setSettings({...settings, maxPerTrade: e.target.value})}
              className="w-full p-3 rounded-suwappu-lg border border-suwappu-sakura-mid/30 text-sm"
            />
          </div>
          <div>
            <label className="text-xs text-suwappu-text-secondary block mb-1">Total budget (USD)</label>
            <input
              type="number"
              value={settings.totalBudget}
              onChange={(e) => setSettings({...settings, totalBudget: e.target.value})}
              className="w-full p-3 rounded-suwappu-lg border border-suwappu-sakura-mid/30 text-sm"
            />
          </div>
          <div>
            <label className="text-xs text-suwappu-text-secondary block mb-1">Stop loss (%)</label>
            <input
              type="number"
              value={settings.stopLoss}
              onChange={(e) => setSettings({...settings, stopLoss: e.target.value})}
              className="w-full p-3 rounded-suwappu-lg border border-suwappu-sakura-mid/30 text-sm"
            />
          </div>
        </div>

        <button
          onClick={() => onSave(settings)}
          className="w-full py-3 bg-gradient-to-r from-suwappu-magenta-mid to-suwappu-purple-deep text-white font-heading font-semibold rounded-suwappu-xl"
        >
          Start Copying
        </button>
      </div>
    </div>
  )
}

export function CopyTrading() {
  const navigate = useNavigate()
  const [traders, setTraders] = useState(mockTraders)
  const [filter, setFilter] = useState<'top' | 'following'>('top')
  const [selectedTrader, setSelectedTrader] = useState<Trader | null>(null)
  const [showSettings, setShowSettings] = useState(false)

  const handleFollow = (id: string) => {
    const trader = traders.find(t => t.id === id)
    if (trader && !trader.isFollowing) {
      setSelectedTrader(trader)
      setShowSettings(true)
    } else {
      setTraders(traders.map(t => 
        t.id === id ? { ...t, isFollowing: !t.isFollowing } : t
      ))
    }
  }

  const handleSaveSettings = (_settings: CopySettings) => {
    if (selectedTrader) {
      setTraders(traders.map(t => 
        t.id === selectedTrader.id ? { ...t, isFollowing: true } : t
      ))
    }
    setShowSettings(false)
    setSelectedTrader(null)
  }

  const filteredTraders = filter === 'following' 
    ? traders.filter(t => t.isFollowing)
    : traders.sort((a, b) => b.pnl30d - a.pnl30d)

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
              <p className="font-bold">{traders.length}</p>
            </div>
            <div>
              <p className="text-white/70 text-[10px]">Avg Win Rate</p>
              <p className="font-bold">74%</p>
            </div>
            <div>
              <p className="text-white/70 text-[10px]">Following</p>
              <p className="font-bold">{traders.filter(t => t.isFollowing).length}</p>
            </div>
          </div>
        </div>

        {/* Filter Tabs */}
        <div className="flex gap-2">
          <button
            onClick={() => setFilter('top')}
            className={`flex-1 py-2 rounded-suwappu-lg text-sm font-medium transition-colors ${
              filter === 'top'
                ? 'bg-suwappu-magenta-mid text-white'
                : 'bg-white text-suwappu-text-secondary'
            }`}
          >
            🏆 Top Traders
          </button>
          <button
            onClick={() => setFilter('following')}
            className={`flex-1 py-2 rounded-suwappu-lg text-sm font-medium transition-colors ${
              filter === 'following'
                ? 'bg-suwappu-magenta-mid text-white'
                : 'bg-white text-suwappu-text-secondary'
            }`}
          >
            ⭐ Following
          </button>
        </div>

        {/* Traders List */}
        {filteredTraders.length === 0 ? (
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
        ) : (
          <div className="space-y-3">
            {filteredTraders.map((trader) => (
              <TraderCard key={trader.id} trader={trader} onFollow={handleFollow} />
            ))}
          </div>
        )}

        {/* Info */}
        <div className="bg-suwappu-sakura-light/30 rounded-suwappu-lg p-3">
          <p className="text-xs text-suwappu-text-secondary">
            💡 <strong>Copy Trading</strong> automatically mirrors a trader's moves. 
            Set your budget and risk limits, then let pros trade for you!
          </p>
        </div>

        {/* Coming Soon */}
        <div className="text-center">
          <span className="inline-flex items-center gap-1 px-3 py-1 bg-yellow-100 text-yellow-700 text-xs font-medium rounded-full">
            🚧 Live trading integration coming soon
          </span>
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
