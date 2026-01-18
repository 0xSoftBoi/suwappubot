import { useState } from 'react'
import { AppLayout, AppHeader } from '../components/layout'
import { BalanceCard, TokenItem } from '../components/cards'
import { QuickActions, NotificationBanner } from '../components/ui'

// Mock data - replace with real data from hooks
const mockTokens = [
  { symbol: 'ETH', name: 'Ethereum', value: '$1,842.50', change: 2.4, icon: 'Ξ' },
  { symbol: 'USDC', name: 'USD Coin', value: '$500.00', change: 0.01, icon: '$' },
  { symbol: 'SOL', name: 'Solana', value: '$187.50', change: -1.2, icon: '◎' },
]

export function Home() {
  const [showBanner, setShowBanner] = useState(true)

  // TODO: Replace with real data from usePortfolio()
  const balance = '$1,234.56'
  const change = 12.5
  const tokens = mockTokens

  const header = (
    <AppHeader
      title="Suwappu"
      rightAction={
        <button className="p-1.5 text-suwappu-text-secondary hover:text-suwappu-text transition-colors">
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
          </svg>
        </button>
      }
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
          {tokens.length > 0 ? (
            <div className="divide-y divide-suwappu-sakura-mid/10">
              {tokens.map((token) => (
                <TokenItem key={token.symbol} {...token} />
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
