import React, { useState, useCallback } from 'react'

export interface TraderTrade {
  id: string
  fromToken: string
  toToken: string
  chainId: string
  amount: number
  pnl: number
  timestamp: string
}

export interface Trader {
  id: string
  displayName: string
  address: string
  avatar?: string
  verified: boolean
  pnl30d: number
  pnlPercent30d: number
  winRate: number
  totalTrades: number
  avgTradeSize: number
  riskLevel: 'conservative' | 'moderate' | 'aggressive'
  topTokens: { symbol: string; chainId: string }[]
  recentTrades: TraderTrade[]
  followers: number
}

export interface CopyConfig {
  allocationUsd: number
  maxPerTradeUsd: number
  stopLossPercent: number
}

export interface CopyTradeCardProps {
  trader: Trader
  isFollowing?: boolean
  onFollow?: (traderId: string) => void
  onUnfollow?: (traderId: string) => void
  onConfigureCopy?: (traderId: string, config: CopyConfig) => void
  variant?: 'full' | 'compact' | 'leaderboard'
  rank?: number
  className?: string
}

// --- Chain badge colors (inline to stay self-contained) ---

const CHAIN_COLORS: Record<string, string> = {
  ethereum: 'bg-blue-600',
  bsc: 'bg-yellow-500',
  polygon: 'bg-purple-600',
  arbitrum: 'bg-blue-500',
  optimism: 'bg-red-500',
  base: 'bg-blue-700',
  avalanche: 'bg-red-600',
  solana: 'bg-linear-to-r from-purple-500 to-teal-400',
  tempo: 'bg-amber-500',
}

const CHAIN_LABELS: Record<string, string> = {
  ethereum: 'ETH',
  bsc: 'BSC',
  polygon: 'POLY',
  arbitrum: 'ARB',
  optimism: 'OP',
  base: 'BASE',
  avalanche: 'AVAX',
  solana: 'SOL',
  tempo: 'USD',
}

// --- Risk level config ---

const RISK_CONFIG = {
  conservative: { label: 'Conservative', className: 'text-green-500 bg-green-50' },
  moderate: { label: 'Moderate', className: 'text-yellow-600 bg-yellow-50' },
  aggressive: { label: 'Aggressive', className: 'text-red-500 bg-red-50' },
} as const

// --- Avatar gradient palettes ---

const AVATAR_GRADIENTS = [
  'from-pink-400 to-purple-500',
  'from-blue-400 to-teal-400',
  'from-orange-400 to-pink-500',
  'from-green-400 to-blue-500',
  'from-yellow-400 to-red-400',
  'from-indigo-400 to-pink-400',
]

function getAvatarGradient(id: string): string {
  let hash = 0
  for (let i = 0; i < id.length; i++) {
    hash = id.charCodeAt(i) + ((hash << 5) - hash)
  }
  return AVATAR_GRADIENTS[Math.abs(hash) % AVATAR_GRADIENTS.length]
}

function getInitials(name: string): string {
  return name
    .split(' ')
    .map((w) => w[0])
    .join('')
    .toUpperCase()
    .slice(0, 2)
}

function truncateAddress(address: string): string {
  if (address.length <= 10) return address
  return `${address.slice(0, 6)}...${address.slice(-4)}`
}

function formatUsd(value: number): string {
  if (Math.abs(value) >= 1_000_000) return `$${(value / 1_000_000).toFixed(1)}M`
  if (Math.abs(value) >= 1_000) return `$${(value / 1_000).toFixed(1)}K`
  return `$${value.toFixed(2)}`
}

function formatPnl(value: number): string {
  const prefix = value >= 0 ? '+' : ''
  return `${prefix}${formatUsd(value)}`
}

function formatPercent(value: number): string {
  const prefix = value >= 0 ? '+' : ''
  return `${prefix}${value.toFixed(1)}%`
}

function timeAgo(timestamp: string): string {
  const diff = Date.now() - new Date(timestamp).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 60) return `${mins}m ago`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  return `${days}d ago`
}

// --- Sub-components ---

function TraderAvatar({ trader, size = 'md' }: { trader: Trader; size?: 'sm' | 'md' | 'lg' }) {
  const sizeClasses = {
    sm: 'w-8 h-8 text-xs',
    md: 'w-10 h-10 text-sm',
    lg: 'w-12 h-12 text-base',
  }

  return (
    <div
      className={`${sizeClasses[size]} rounded-suwappu-pill bg-linear-to-br ${getAvatarGradient(trader.id)} flex items-center justify-center text-white font-bold shrink-0`}
    >
      {getInitials(trader.displayName)}
    </div>
  )
}

function VerifiedBadge() {
  return (
    <span className="bg-blue-500 text-white rounded-suwappu-pill w-4 h-4 inline-flex items-center justify-center shrink-0">
      <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
        <path d="M2 5L4 7L8 3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </span>
  )
}

function RiskBadge({ level }: { level: Trader['riskLevel'] }) {
  const config = RISK_CONFIG[level]
  return (
    <span className={`text-xs font-medium px-2 py-0.5 rounded-suwappu-pill ${config.className}`}>
      {config.label}
    </span>
  )
}

function MiniChainBadge({ chainId }: { chainId: string }) {
  const color = CHAIN_COLORS[chainId] || 'bg-gray-400'
  const label = CHAIN_LABELS[chainId] || chainId.slice(0, 3).toUpperCase()
  return (
    <span
      className={`${color} text-white text-[8px] font-bold rounded-suwappu-pill w-3.5 h-3.5 inline-flex items-center justify-center ring-1 ring-white`}
      title={label}
    >
      {label.slice(0, 1)}
    </span>
  )
}

function FollowButton({
  isFollowing,
  onFollow,
  onUnfollow,
  traderId,
}: {
  isFollowing: boolean
  onFollow?: (id: string) => void
  onUnfollow?: (id: string) => void
  traderId: string
}) {
  const handleClick = useCallback(() => {
    if (isFollowing) {
      onUnfollow?.(traderId)
    } else {
      onFollow?.(traderId)
    }
  }, [isFollowing, onFollow, onUnfollow, traderId])

  return (
    <button
      type="button"
      onClick={handleClick}
      className={`px-4 py-1.5 text-sm font-medium transition-colors ${
        isFollowing
          ? 'bg-suwappu-sakura-100 text-suwappu-text rounded-suwappu-pill hover:bg-suwappu-sakura-200'
          : 'bg-suwappu-magenta text-white rounded-suwappu-pill hover:bg-suwappu-magenta/90'
      }`}
    >
      {isFollowing ? 'Following' : 'Follow'}
    </button>
  )
}

function CopySettings({
  traderId,
  onConfigure,
}: {
  traderId: string
  onConfigure?: (traderId: string, config: CopyConfig) => void
}) {
  const [allocation, setAllocation] = useState('500')
  const [maxPerTrade, setMaxPerTrade] = useState('100')
  const [stopLoss, setStopLoss] = useState('10')

  const handleSave = useCallback(() => {
    onConfigure?.(traderId, {
      allocationUsd: parseFloat(allocation) || 500,
      maxPerTradeUsd: parseFloat(maxPerTrade) || 100,
      stopLossPercent: parseFloat(stopLoss) || 10,
    })
  }, [traderId, allocation, maxPerTrade, stopLoss, onConfigure])

  return (
    <div className="mt-3 pt-3 border-t border-suwappu-sakura-200/20 space-y-2.5">
      <h4 className="text-xs font-semibold text-suwappu-text-secondary uppercase tracking-wider">
        Copy Settings
      </h4>
      <div className="grid grid-cols-3 gap-2">
        <div>
          <label className="block text-[10px] text-suwappu-text-secondary mb-1">Allocation</label>
          <div className="relative">
            <span className="absolute left-2 top-1/2 -translate-y-1/2 text-suwappu-text-secondary text-xs">$</span>
            <input
              type="number"
              value={allocation}
              onChange={(e) => setAllocation(e.target.value)}
              className="w-full pl-5 pr-2 py-1.5 rounded-suwappu-lg border border-suwappu-sakura-200/40 bg-suwappu-sakura-light/30 text-xs text-suwappu-text font-medium focus:outline-hidden focus:ring-2 focus:ring-suwappu-magenta/30"
            />
          </div>
        </div>
        <div>
          <label className="block text-[10px] text-suwappu-text-secondary mb-1">Max/Trade</label>
          <div className="relative">
            <span className="absolute left-2 top-1/2 -translate-y-1/2 text-suwappu-text-secondary text-xs">$</span>
            <input
              type="number"
              value={maxPerTrade}
              onChange={(e) => setMaxPerTrade(e.target.value)}
              className="w-full pl-5 pr-2 py-1.5 rounded-suwappu-lg border border-suwappu-sakura-200/40 bg-suwappu-sakura-light/30 text-xs text-suwappu-text font-medium focus:outline-hidden focus:ring-2 focus:ring-suwappu-magenta/30"
            />
          </div>
        </div>
        <div>
          <label className="block text-[10px] text-suwappu-text-secondary mb-1">Stop Loss</label>
          <div className="relative">
            <input
              type="number"
              value={stopLoss}
              onChange={(e) => setStopLoss(e.target.value)}
              className="w-full pl-2 pr-5 py-1.5 rounded-suwappu-lg border border-suwappu-sakura-200/40 bg-suwappu-sakura-light/30 text-xs text-suwappu-text font-medium focus:outline-hidden focus:ring-2 focus:ring-suwappu-magenta/30"
            />
            <span className="absolute right-2 top-1/2 -translate-y-1/2 text-suwappu-text-secondary text-xs">%</span>
          </div>
        </div>
      </div>
      <button
        type="button"
        onClick={handleSave}
        className="w-full py-2 rounded-suwappu-xl bg-suwappu-magenta text-white font-medium text-xs transition-all hover:bg-suwappu-magenta/90"
      >
        Save Copy Settings
      </button>
    </div>
  )
}

// --- Compact Variant ---

function CompactCard({
  trader,
  isFollowing = false,
  onFollow,
  onUnfollow,
  className = '',
}: CopyTradeCardProps) {
  return (
    <div className={`bg-white/80 backdrop-blur-sm rounded-suwappu-xl shadow-suwappu-2 border border-suwappu-sakura-mid/20 px-3 py-3 flex items-center gap-3 ${className}`}>
      <TraderAvatar trader={trader} size="sm" />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5">
          <span className="text-sm font-semibold text-suwappu-text truncate">{trader.displayName}</span>
          {trader.verified && <VerifiedBadge />}
        </div>
        <span className="text-xs text-suwappu-text-secondary">{trader.followers} followers</span>
      </div>
      <div className="text-right mr-2">
        <div className={`text-sm font-bold ${trader.pnl30d >= 0 ? 'text-green-500' : 'text-red-500'}`}>
          {formatPnl(trader.pnl30d)}
        </div>
        <div className={`text-xs ${trader.pnlPercent30d >= 0 ? 'text-green-500' : 'text-red-500'}`}>
          {formatPercent(trader.pnlPercent30d)}
        </div>
      </div>
      <FollowButton
        isFollowing={isFollowing}
        onFollow={onFollow}
        onUnfollow={onUnfollow}
        traderId={trader.id}
      />
    </div>
  )
}

// --- Leaderboard Variant ---

function LeaderboardCard({
  trader,
  isFollowing = false,
  onFollow,
  onUnfollow,
  rank,
  className = '',
}: CopyTradeCardProps) {
  const rankColors: Record<number, string> = {
    1: 'text-yellow-500',
    2: 'text-suwappu-text-secondary/60',
    3: 'text-amber-600',
  }

  return (
    <div className={`bg-white/80 backdrop-blur-sm rounded-suwappu-xl shadow-suwappu-2 border border-suwappu-sakura-mid/20 px-3 py-3 flex items-center gap-3 ${className}`}>
      {rank !== undefined && (
        <span className={`text-lg font-bold w-7 text-center shrink-0 ${rankColors[rank] || 'text-suwappu-text-secondary'}`}>
          #{rank}
        </span>
      )}
      <TraderAvatar trader={trader} size="sm" />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5">
          <span className="text-sm font-semibold text-suwappu-text truncate">{trader.displayName}</span>
          {trader.verified && <VerifiedBadge />}
          <RiskBadge level={trader.riskLevel} />
        </div>
        <div className="flex items-center gap-3 mt-0.5 text-xs text-suwappu-text-secondary">
          <span>{trader.winRate}% win</span>
          <span>{trader.totalTrades} trades</span>
          <span>{trader.followers} followers</span>
        </div>
      </div>
      <div className="text-right mr-2">
        <div className={`text-sm font-bold ${trader.pnl30d >= 0 ? 'text-green-500' : 'text-red-500'}`}>
          {formatPnl(trader.pnl30d)}
        </div>
        <div className={`text-xs ${trader.pnlPercent30d >= 0 ? 'text-green-500' : 'text-red-500'}`}>
          {formatPercent(trader.pnlPercent30d)}
        </div>
      </div>
      <FollowButton
        isFollowing={isFollowing}
        onFollow={onFollow}
        onUnfollow={onUnfollow}
        traderId={trader.id}
      />
    </div>
  )
}

// --- Full Variant ---

function FullCard({
  trader,
  isFollowing = false,
  onFollow,
  onUnfollow,
  onConfigureCopy,
  className = '',
}: CopyTradeCardProps) {
  return (
    <div className={`bg-white/80 backdrop-blur-sm rounded-suwappu-xl shadow-suwappu-2 border border-suwappu-sakura-mid/20 ${className}`}>
      {/* Header: avatar + name + follow */}
      <div className="px-4 pt-4 pb-3 flex items-start gap-3">
        <TraderAvatar trader={trader} size="lg" />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className="text-base font-semibold text-suwappu-text">{trader.displayName}</span>
            {trader.verified && <VerifiedBadge />}
            <RiskBadge level={trader.riskLevel} />
          </div>
          <div className="flex items-center gap-1.5 mt-0.5">
            <span className="text-xs text-suwappu-text-secondary font-mono">
              {truncateAddress(trader.address)}
            </span>
            <span className="text-xs text-suwappu-text-secondary">
              {trader.followers} followers
            </span>
          </div>
        </div>
        <FollowButton
          isFollowing={isFollowing}
          onFollow={onFollow}
          onUnfollow={onUnfollow}
          traderId={trader.id}
        />
      </div>

      {/* Performance stats */}
      <div className="px-4 pb-3">
        <div className="grid grid-cols-4 gap-2">
          <div className="bg-suwappu-sakura-light/40 rounded-suwappu-xl px-2.5 py-2 text-center">
            <div className="text-[10px] text-suwappu-text-secondary uppercase tracking-wider">PnL 30d</div>
            <div className={`text-sm font-bold mt-0.5 ${trader.pnl30d >= 0 ? 'text-green-500' : 'text-red-500'}`}>
              {formatPnl(trader.pnl30d)}
            </div>
            <div className={`text-[10px] ${trader.pnlPercent30d >= 0 ? 'text-green-500' : 'text-red-500'}`}>
              {formatPercent(trader.pnlPercent30d)}
            </div>
          </div>
          <div className="bg-suwappu-sakura-light/40 rounded-suwappu-xl px-2.5 py-2 text-center">
            <div className="text-[10px] text-suwappu-text-secondary uppercase tracking-wider">Win Rate</div>
            <div className="text-sm font-bold text-suwappu-text mt-0.5">{trader.winRate}%</div>
          </div>
          <div className="bg-suwappu-sakura-light/40 rounded-suwappu-xl px-2.5 py-2 text-center">
            <div className="text-[10px] text-suwappu-text-secondary uppercase tracking-wider">Avg Size</div>
            <div className="text-sm font-bold text-suwappu-text mt-0.5">{formatUsd(trader.avgTradeSize)}</div>
          </div>
          <div className="bg-suwappu-sakura-light/40 rounded-suwappu-xl px-2.5 py-2 text-center">
            <div className="text-[10px] text-suwappu-text-secondary uppercase tracking-wider">Trades</div>
            <div className="text-sm font-bold text-suwappu-text mt-0.5">{trader.totalTrades}</div>
          </div>
        </div>
      </div>

      {/* Top traded tokens */}
      {trader.topTokens.length > 0 && (
        <div className="px-4 pb-3">
          <h4 className="text-xs font-semibold text-suwappu-text-secondary uppercase tracking-wider mb-2">
            Top Tokens
          </h4>
          <div className="flex flex-wrap gap-1.5">
            {trader.topTokens.map((token, i) => (
              <span
                key={`${token.symbol}-${token.chainId}-${i}`}
                className="inline-flex items-center gap-1 bg-suwappu-sakura-light/50 text-suwappu-text text-xs font-medium px-2 py-1 rounded-suwappu-pill"
              >
                <MiniChainBadge chainId={token.chainId} />
                {token.symbol}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Recent trades timeline */}
      {trader.recentTrades.length > 0 && (
        <div className="px-4 pb-3">
          <h4 className="text-xs font-semibold text-suwappu-text-secondary uppercase tracking-wider mb-2">
            Recent Trades
          </h4>
          <div className="space-y-1.5">
            {trader.recentTrades.map((trade) => (
              <div
                key={trade.id}
                className="flex items-center justify-between bg-suwappu-sakura-light/30 rounded-suwappu-lg px-2.5 py-1.5"
              >
                <div className="flex items-center gap-2 min-w-0">
                  <MiniChainBadge chainId={trade.chainId} />
                  <span className="text-xs font-medium text-suwappu-text truncate">
                    {trade.fromToken} &rarr; {trade.toToken}
                  </span>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <span className="text-xs text-suwappu-text-secondary">{formatUsd(trade.amount)}</span>
                  <span className={`text-xs font-semibold ${trade.pnl >= 0 ? 'text-green-500' : 'text-red-500'}`}>
                    {formatPnl(trade.pnl)}
                  </span>
                  <span className="text-[10px] text-suwappu-text-secondary">{timeAgo(trade.timestamp)}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Copy settings (shown when following) */}
      {isFollowing && (
        <div className="px-4 pb-4">
          <CopySettings traderId={trader.id} onConfigure={onConfigureCopy} />
        </div>
      )}
    </div>
  )
}

// --- Main Component ---

export const CopyTradeCard = React.memo(function CopyTradeCard(props: CopyTradeCardProps) {
  const { variant = 'full' } = props

  switch (variant) {
    case 'compact':
      return <CompactCard {...props} />
    case 'leaderboard':
      return <LeaderboardCard {...props} />
    default:
      return <FullCard {...props} />
  }
})
