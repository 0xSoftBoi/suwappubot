import { useNavigate } from 'react-router-dom'
import { AppLayout, UserHeader } from '../components/layout'
import { BalanceCard, TokenItem } from '../components/cards'
import { QuickActions, FeatureGrid, QuickSwap } from '../components/ui'
import { usePortfolio } from '../hooks/usePortfolio'
import type { Token } from '../types/api'

// Chain icons mapping
const chainIcons: Record<string, string> = {
  ethereum: 'Ξ',
  eth: 'Ξ',
  solana: '◎',
  sol: '◎',
  polygon: '⬡',
  matic: '⬡',
  arbitrum: '🔵',
  optimism: '🔴',
  base: '🔷',
  bsc: '🟡',
  tempo: '⏱️',
}

// Get icon for token based on symbol or chain
function getTokenIcon(token: Token): string {
  const symbolLower = token.symbol.toLowerCase()
  const chainLower = token.chain.toLowerCase()

  // Check symbol first
  if (symbolLower === 'eth') return 'Ξ'
  if (symbolLower === 'sol') return '◎'
  if (symbolLower === 'usdc' || symbolLower === 'usdt') return '$'
  if (symbolLower === 'matic') return '⬡'

  // Fall back to chain icon
  return chainIcons[chainLower] || token.symbol.charAt(0).toUpperCase()
}

// Format USD value
function formatUsd(value: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value)
}

export function Home() {
  const navigate = useNavigate()
  const { data: portfolio, isLoading, error, refetch } = usePortfolio()

  // Format portfolio data for display - show $0.00 on error (graceful degradation)
  const balance = portfolio ? formatUsd(portfolio.totalUsdValue) : '$0.00'
  // Note: 24h change requires historical price data which API doesn't provide yet
  const tokens = portfolio?.tokens || []

  const header = (
    <UserHeader
      showSettings={true}
      onSettingsClick={() => navigate('/settings')}
    />
  )

  return (
    <AppLayout header={header} activeNav="home">
      <div className="p-3 space-y-4">
        <BalanceCard balance={balance} />

        <QuickActions />

        <button
          type="button"
          onClick={() => navigate('/discover')}
          className="w-full flex items-center justify-between gap-3 rounded-suwappu-xl border border-suwappu-sakura-mid/20 bg-white px-4 py-3 text-left shadow-suwappu-1 transition-colors hover:border-suwappu-magenta-mid/40"
        >
          <span>
            <span className="block font-heading font-semibold text-sm text-suwappu-purple-deep">Social pulse</span>
            <span className="mt-0.5 block text-xs text-suwappu-text-secondary">Discover real JellyJelly creator moments and claim your audience.</span>
          </span>
          <span className="shrink-0 text-sm font-semibold text-suwappu-magenta-mid">Explore →</span>
        </button>

        <FeatureGrid />

        <QuickSwap />

        <div className="bg-white rounded-suwappu-xl shadow-suwappu-1 overflow-hidden">
          <div className="flex items-center justify-between px-3 py-2 border-b border-suwappu-sakura-mid/10">
            <span className="font-heading font-semibold text-sm text-suwappu-purple-deep">Assets</span>
            <button className="text-xs text-suwappu-magenta-mid font-medium">See All</button>
          </div>
          {isLoading ? (
            <div className="p-6 text-center">
              <div className="animate-pulse flex flex-col items-center">
                <div className="w-10 h-10 bg-suwappu-sakura-light rounded-full mb-2" />
                <div className="h-3 bg-suwappu-sakura-light rounded w-24 mb-1" />
                <div className="h-2 bg-suwappu-sakura-light/50 rounded w-16" />
              </div>
            </div>
          ) : error || tokens.length === 0 ? (
            <div className="p-6 text-center">
              <div className="w-16 h-16 mx-auto mb-3 bg-suwappu-sakura-light rounded-full flex items-center justify-center">
                <span className="text-3xl">🌸</span>
              </div>
              <p className="font-heading font-semibold text-suwappu-purple-deep mb-1">No assets yet</p>
              <p className="text-xs text-suwappu-text-secondary mb-3">
                {error ? 'Tap to refresh' : 'Add funds to start trading'}
              </p>
              <button 
                onClick={() => error ? refetch() : navigate('/wallet')}
                className="px-4 py-2 bg-suwappu-gradient text-white text-sm font-heading font-bold rounded-suwappu-pill shadow-suwappu-button"
              >
                {error ? 'Refresh' : 'Add Funds'}
              </button>
            </div>
          ) : (
            <div className="divide-y divide-suwappu-sakura-mid/10">
              {tokens.map((token) => (
                <TokenItem
                  key={`${token.chain}-${token.symbol}-${token.address}`}
                  symbol={token.symbol}
                  name={token.name}
                  value={formatUsd(token.usdValue)}
                  balance={token.balance}
                  icon={getTokenIcon(token)}
                />
              ))}
            </div>
          )}
        </div>
      </div>
    </AppLayout>
  )
}
