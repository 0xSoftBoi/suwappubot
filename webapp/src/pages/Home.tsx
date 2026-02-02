import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { AppLayout, UserHeader } from '../components/layout'
import { BalanceCard, TokenItem } from '../components/cards'
import { QuickActions, NotificationBanner, FeatureGrid, QuickSwap } from '../components/ui'
import { usePortfolio } from '../hooks/usePortfolio'
import type { Token } from '../types/api'
import { getTokenIcon } from '../lib/icons'

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
      {showBanner && (
        <NotificationBanner
          message="New: Solana swaps are now live!"
          type="info"
          onClose={() => setShowBanner(false)}
        />
      )}

      <div className="p-3 space-y-4">
        <BalanceCard balance={balance} />

        <QuickActions />

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
