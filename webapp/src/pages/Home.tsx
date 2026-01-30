import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { AppLayout, UserHeader } from '../components/layout'
import { BalanceCard, TokenItem } from '../components/cards'
import { QuickActions, NotificationBanner } from '../components/ui'
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
  const [showBanner, setShowBanner] = useState(true)
  const { data: portfolio, isLoading, error } = usePortfolio()

  // Format portfolio data for display
  const balance = portfolio ? formatUsd(portfolio.totalUsdValue) : '$0.00'
  const change = 0 // TODO: Calculate from historical data
  const tokens = portfolio?.tokens || []

  const header = (
    <UserHeader
      showSettings={true}
      onSettingsClick={() => navigate('/settings')}
    />
  )

  return (
    <AppLayout header={header} activeNav="home">
      {showBanner && (
        <NotificationBanner
          message="New: Solana swaps are now live!"
          type="info"
          onClose={() => setShowBanner(false)}
        />
      )}

      <div className="p-3 space-y-4">
        <BalanceCard balance={balance} change={change} />

        <QuickActions />

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
          ) : error ? (
            <div className="p-6 text-center">
              <div className="w-12 h-12 mx-auto mb-2 bg-suwappu-error/10 rounded-full flex items-center justify-center">
                <span className="text-xl">⚠️</span>
              </div>
              <p className="text-sm text-suwappu-error mb-1">Failed to load assets</p>
              <p className="text-xs text-suwappu-text-secondary">Please try again later</p>
            </div>
          ) : tokens.length > 0 ? (
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
          ) : (
            <div className="p-6 text-center">
              <div className="w-16 h-16 mx-auto mb-3 bg-suwappu-sakura-light rounded-full flex items-center justify-center">
                <span className="text-3xl">🌸</span>
              </div>
              <p className="font-heading font-semibold text-suwappu-purple-deep mb-1">No assets yet</p>
              <p className="text-xs text-suwappu-text-secondary mb-3">
                Add funds to start trading
              </p>
              <button className="px-4 py-2 bg-suwappu-gradient text-white text-sm font-heading font-bold rounded-suwappu-pill shadow-suwappu-button">
                Add Funds
              </button>
            </div>
          )}
        </div>
      </div>
    </AppLayout>
  )
}
