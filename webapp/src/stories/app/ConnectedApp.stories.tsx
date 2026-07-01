/**
 * Connected App Stories
 *
 * Full interactive app stories demonstrating real data flow
 * with the mock API. Shows navigation between screens and
 * proper loading/error state handling.
 */
import type { Meta, StoryObj } from '@storybook/react'
import { useState } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import '../../theme/suwappu.css'
import { ApiProvider } from '../../contexts/ApiContext'
import { usePortfolio } from '../../hooks/usePortfolio'
import { useSwapHistory } from '../../hooks/useSwapHistory'
import { ConnectionStatus } from '../../components/ConnectionStatus'
import type { Swap } from '../../types/api'

const meta: Meta = {
  title: 'Suwappu App/Connected App',
  parameters: {
    layout: 'fullscreen',
    viewport: {
      viewports: {
        telegram: {
          name: 'Telegram Mini App',
          styles: { width: '390px', height: '680px' },
        },
      },
      defaultViewport: 'telegram',
    },
    backgrounds: {
      default: 'app',
      values: [{ name: 'app', value: '#FFFBFC' }],
    },
  },
}

export default meta
type Story = StoryObj

// ============================================
// Shared Components
// ============================================

// Header with connection status
function AppHeader({
  title,
  showBack = false,
  onBack,
}: {
  title?: string
  showBack?: boolean
  onBack?: () => void
}) {
  return (
    <header className="sticky top-0 z-50 bg-white/80 backdrop-blur-md border-b border-suwappu-sakura-mid/20">
      <div className="flex items-center justify-between h-12 px-3">
        {showBack ? (
          <button onClick={onBack} className="p-1.5 -ml-1.5 text-suwappu-text-secondary">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
          </button>
        ) : (
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-full bg-suwappu-gradient flex items-center justify-center">
              <span className="text-white text-xs font-bold">S</span>
            </div>
            <span className="font-heading font-bold text-sm text-suwappu-purple-deep">
              {title || 'Suwappu'}
            </span>
          </div>
        )}
        {title && showBack && (
          <span className="font-heading font-bold text-sm text-suwappu-purple-deep">{title}</span>
        )}
        <div className="flex items-center gap-2">
          <ConnectionStatus showLabel size="sm" />
        </div>
      </div>
    </header>
  )
}

// Bottom navigation
function BottomNav({
  active,
  onNavigate,
}: {
  active: 'home' | 'wallet' | 'swap' | 'history'
  onNavigate: (screen: 'home' | 'wallet' | 'swap' | 'history') => void
}) {
  const items = [
    { id: 'home' as const, label: 'Home', icon: (
      <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" />
      </svg>
    )},
    { id: 'wallet' as const, label: 'Wallet', icon: (
      <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 10h18M7 15h1m4 0h1m-7 4h12a3 3 0 003-3V8a3 3 0 00-3-3H6a3 3 0 00-3 3v8a3 3 0 003 3z" />
      </svg>
    )},
    { id: 'swap' as const, label: 'Swap', icon: (
      <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16V4m0 0L3 8m4-4l4 4m6 0v12m0 0l4-4m-4 4l-4-4" />
      </svg>
    )},
    { id: 'history' as const, label: 'History', icon: (
      <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
      </svg>
    )},
  ]

  return (
    <nav className="fixed bottom-0 left-0 right-0 bg-white/95 backdrop-blur-md border-t border-suwappu-sakura-mid/20">
      <div className="flex items-center justify-around h-16 px-2">
        {items.map((item) => (
          <button
            key={item.id}
            onClick={() => onNavigate(item.id)}
            className={`flex flex-col items-center gap-1 flex-1 py-2 transition-colors ${
              active === item.id ? 'text-suwappu-magenta-mid' : 'text-suwappu-text-secondary'
            }`}
          >
            {item.icon}
            <span className="text-xs font-heading font-medium">{item.label}</span>
          </button>
        ))}
      </div>
    </nav>
  )
}

// ============================================
// Utility Functions
// ============================================

function getTokenIcon(symbol: string): string {
  const icons: Record<string, string> = {
    ETH: 'Ξ',
    USDC: '$',
    USDT: '$',
    SOL: '◎',
    MATIC: '⬡',
    BNB: '🔶',
    ARB: '🔷',
  }
  return icons[symbol] || '●'
}

function formatUsd(value: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value)
}

function formatTimeAgo(date: string): string {
  const seconds = Math.floor((Date.now() - new Date(date).getTime()) / 1000)
  if (seconds < 60) return 'just now'
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`
  return `${Math.floor(seconds / 86400)}d ago`
}

// ============================================
// Screen Components
// ============================================

// Home Screen
function HomeScreen({ onNavigate }: { onNavigate: (screen: 'home' | 'wallet' | 'swap' | 'history') => void }) {
  const { data: portfolio, isLoading } = usePortfolio()

  const QuickActions = () => {
    const actions = [
      { icon: '↓', label: 'Receive', screen: 'wallet' as const, color: 'bg-suwappu-success/10 text-suwappu-success' },
      { icon: '↑', label: 'Send', screen: 'wallet' as const, color: 'bg-suwappu-info/10 text-suwappu-info' },
      { icon: '⇄', label: 'Swap', screen: 'swap' as const, color: 'bg-suwappu-magenta-light/30 text-suwappu-magenta-mid' },
      { icon: '◎', label: 'History', screen: 'history' as const, color: 'bg-suwappu-warning/10 text-suwappu-warning' },
    ]

    return (
      <div className="grid grid-cols-4 gap-2">
        {actions.map((action) => (
          <button
            key={action.label}
            onClick={() => onNavigate(action.screen)}
            className="flex flex-col items-center gap-1 p-2 rounded-suwappu-lg hover:bg-suwappu-sakura-light/30 transition-colors"
          >
            <div className={`w-10 h-10 rounded-full ${action.color} flex items-center justify-center text-lg`}>
              {action.icon}
            </div>
            <span className="text-[10px] font-heading font-medium text-suwappu-text">{action.label}</span>
          </button>
        ))}
      </div>
    )
  }

  return (
    <>
      <AppHeader />
      <main className="p-3 pb-20 space-y-4">
        {/* Balance Card */}
        <div className="bg-suwappu-gradient rounded-suwappu-xl p-4 text-white shadow-suwappu-button">
          <p className="text-xs opacity-80 mb-1">Total Balance</p>
          {isLoading ? (
            <div className="h-8 bg-white/20 rounded w-32 animate-pulse" />
          ) : (
            <p className="text-2xl font-heading font-bold">{formatUsd(portfolio?.totalUsdValue ?? 0)}</p>
          )}
        </div>

        <QuickActions />

        {/* Token List */}
        <div className="bg-white rounded-suwappu-xl shadow-suwappu-1 overflow-hidden">
          <div className="flex items-center justify-between px-3 py-2 border-b border-suwappu-sakura-mid/10">
            <span className="font-heading font-semibold text-sm text-suwappu-purple-deep">Assets</span>
            <button
              onClick={() => onNavigate('wallet')}
              className="text-xs text-suwappu-magenta-mid font-medium"
            >
              See All
            </button>
          </div>
          <div className="divide-y divide-suwappu-sakura-mid/10">
            {isLoading ? (
              [1, 2, 3].map((i) => (
                <div key={i} className="flex items-center gap-3 p-2 animate-pulse">
                  <div className="w-9 h-9 rounded-full bg-suwappu-sakura-light" />
                  <div className="flex-1">
                    <div className="h-4 bg-suwappu-sakura-light rounded w-16 mb-1" />
                    <div className="h-3 bg-suwappu-sakura-light/50 rounded w-24" />
                  </div>
                </div>
              ))
            ) : (
              portfolio?.tokens.slice(0, 3).map((token) => (
                <div
                  key={`${token.chain}-${token.address}`}
                  className="flex items-center gap-3 p-2 hover:bg-suwappu-sakura-light/20 rounded-suwappu-lg transition-colors"
                >
                  <div className="w-9 h-9 rounded-full bg-suwappu-sakura-light flex items-center justify-center text-lg">
                    {getTokenIcon(token.symbol)}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between">
                      <span className="font-heading font-semibold text-sm text-suwappu-text">{token.symbol}</span>
                      <span className="font-heading font-semibold text-sm text-suwappu-text">{formatUsd(token.usdValue)}</span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-xs text-suwappu-text-secondary truncate">{token.name}</span>
                      <span className="text-xs text-suwappu-text-secondary">{token.balance}</span>
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </main>
    </>
  )
}

// Wallet Screen
function WalletScreen() {
  const { data: portfolio, isLoading } = usePortfolio()

  return (
    <>
      <AppHeader title="Wallet" showBack={false} />
      <main className="p-3 pb-20 space-y-4">
        {/* Address Card */}
        <div className="bg-white rounded-suwappu-xl p-3 shadow-suwappu-1">
          <p className="text-xs text-suwappu-text-secondary mb-1">Connected Wallet</p>
          <div className="flex items-center justify-between gap-2">
            <span className="font-mono text-sm text-suwappu-text">0x1234...5678</span>
            <button className="p-1.5 text-suwappu-text-secondary hover:text-suwappu-magenta-mid transition-colors">
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
              </svg>
            </button>
          </div>
        </div>

        {/* Token List */}
        <div className="bg-white rounded-suwappu-xl shadow-suwappu-1 overflow-hidden">
          <div className="px-3 py-2 border-b border-suwappu-sakura-mid/10">
            <span className="font-heading font-semibold text-sm text-suwappu-purple-deep">All Balances</span>
          </div>
          <div className="divide-y divide-suwappu-sakura-mid/10">
            {isLoading ? (
              [1, 2, 3, 4].map((i) => (
                <div key={i} className="flex items-center gap-3 p-2 animate-pulse">
                  <div className="w-9 h-9 rounded-full bg-suwappu-sakura-light" />
                  <div className="flex-1">
                    <div className="h-4 bg-suwappu-sakura-light rounded w-16 mb-1" />
                    <div className="h-3 bg-suwappu-sakura-light/50 rounded w-24" />
                  </div>
                </div>
              ))
            ) : (
              portfolio?.tokens.map((token) => (
                <div
                  key={`${token.chain}-${token.address}`}
                  className="flex items-center gap-3 p-2 hover:bg-suwappu-sakura-light/20 transition-colors"
                >
                  <div className="w-9 h-9 rounded-full bg-suwappu-sakura-light flex items-center justify-center text-lg">
                    {getTokenIcon(token.symbol)}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between">
                      <span className="font-heading font-semibold text-sm text-suwappu-text">{token.symbol}</span>
                      <span className="font-heading font-semibold text-sm text-suwappu-text">{token.balance}</span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-xs text-suwappu-text-secondary truncate">{token.name}</span>
                      <span className="text-xs text-suwappu-text-secondary">{formatUsd(token.usdValue)}</span>
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </main>
    </>
  )
}

// Swap Screen
function SwapScreen() {
  return (
    <>
      <AppHeader title="Swap" showBack={false} />
      <main className="p-3 pb-20 space-y-4">
        {/* From Token */}
        <div className="bg-white rounded-suwappu-xl p-3 shadow-suwappu-1">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs text-suwappu-text-secondary">From</span>
            <span className="text-xs text-suwappu-text-secondary">Balance: 2.5432 ETH</span>
          </div>
          <div className="flex items-center gap-3">
            <button className="flex items-center gap-2 px-3 py-2 bg-suwappu-sakura-light rounded-suwappu-lg">
              <span className="text-lg">Ξ</span>
              <span className="font-heading font-semibold text-sm">ETH</span>
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
              </svg>
            </button>
            <input
              type="text"
              placeholder="0.0"
              className="flex-1 text-right text-xl font-mono bg-transparent focus:outline-hidden"
            />
          </div>
        </div>

        {/* Swap Arrow */}
        <div className="flex justify-center -my-1">
          <button className="p-2 bg-white rounded-full shadow-suwappu-1 border border-suwappu-sakura-mid/20">
            <svg className="w-5 h-5 text-suwappu-magenta-mid" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16V4m0 0L3 8m4-4l4 4m6 0v12m0 0l4-4m-4 4l-4-4" />
            </svg>
          </button>
        </div>

        {/* To Token */}
        <div className="bg-white rounded-suwappu-xl p-3 shadow-suwappu-1">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs text-suwappu-text-secondary">To</span>
            <span className="text-xs text-suwappu-text-secondary">Balance: 1,250 USDC</span>
          </div>
          <div className="flex items-center gap-3">
            <button className="flex items-center gap-2 px-3 py-2 bg-suwappu-sakura-light rounded-suwappu-lg">
              <span className="text-lg">$</span>
              <span className="font-heading font-semibold text-sm">USDC</span>
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
              </svg>
            </button>
            <input
              type="text"
              placeholder="0.0"
              readOnly
              className="flex-1 text-right text-xl font-mono bg-transparent text-suwappu-text-secondary"
            />
          </div>
        </div>

        {/* Swap Button */}
        <button className="w-full py-3 bg-suwappu-gradient text-white font-heading font-bold rounded-suwappu-pill shadow-suwappu-button">
          Enter Amount
        </button>
      </main>
    </>
  )
}

// History Screen
function HistoryScreen() {
  const { data: swaps, isLoading } = useSwapHistory(10)

  const getStatusColor = (status: Swap['status']) => {
    switch (status) {
      case 'completed':
        return 'text-suwappu-success bg-suwappu-success/10'
      case 'pending':
        return 'text-suwappu-warning bg-suwappu-warning/10'
      case 'failed':
        return 'text-suwappu-error bg-suwappu-error/10'
      case 'cancelled':
        return 'text-suwappu-text-secondary bg-suwappu-sakura-light'
    }
  }

  return (
    <>
      <AppHeader title="History" showBack={false} />
      <main className="p-3 pb-20 space-y-3">
        {isLoading ? (
          [1, 2, 3].map((i) => (
            <div key={i} className="bg-white rounded-suwappu-xl p-3 shadow-suwappu-1 animate-pulse">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-full bg-suwappu-sakura-light" />
                <div className="flex-1">
                  <div className="h-4 bg-suwappu-sakura-light rounded w-32 mb-1" />
                  <div className="h-3 bg-suwappu-sakura-light/50 rounded w-20" />
                </div>
              </div>
            </div>
          ))
        ) : swaps?.length === 0 ? (
          <div className="bg-white rounded-suwappu-xl p-6 shadow-suwappu-1 text-center">
            <div className="w-12 h-12 mx-auto mb-2 bg-suwappu-sakura-light rounded-full flex items-center justify-center">
              <span className="text-2xl">📜</span>
            </div>
            <p className="font-heading font-semibold text-suwappu-purple-deep mb-1">No swaps yet</p>
            <p className="text-xs text-suwappu-text-secondary">Your swap history will appear here</p>
          </div>
        ) : (
          swaps?.map((swap) => (
            <div key={swap.id} className="bg-white rounded-suwappu-xl p-3 shadow-suwappu-1">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-full bg-suwappu-sakura-light flex items-center justify-center">
                  <span className="text-lg">⇄</span>
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between">
                    <span className="font-heading font-semibold text-sm text-suwappu-text">
                      {swap.fromToken} → {swap.toToken}
                    </span>
                    <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${getStatusColor(swap.status)}`}>
                      {swap.status}
                    </span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-suwappu-text-secondary">
                      {swap.fromAmount} → {swap.toAmount || '...'}
                    </span>
                    <span className="text-xs text-suwappu-text-secondary">
                      {formatTimeAgo(swap.createdAt)}
                    </span>
                  </div>
                </div>
              </div>
            </div>
          ))
        )}
      </main>
    </>
  )
}

// ============================================
// Main App Component
// ============================================

function ConnectedApp() {
  const [activeScreen, setActiveScreen] = useState<'home' | 'wallet' | 'swap' | 'history'>('home')

  const renderScreen = () => {
    switch (activeScreen) {
      case 'home':
        return <HomeScreen onNavigate={setActiveScreen} />
      case 'wallet':
        return <WalletScreen />
      case 'swap':
        return <SwapScreen />
      case 'history':
        return <HistoryScreen />
    }
  }

  return (
    <div className="min-h-screen bg-suwappu-bg overflow-x-hidden max-w-full">
      {renderScreen()}
      <BottomNav active={activeScreen} onNavigate={setActiveScreen} />
    </div>
  )
}

// ============================================
// Stories
// ============================================

// Query client for stories
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: false,
      refetchOnWindowFocus: false,
    },
  },
})

/**
 * Full Connected App - Interactive multi-screen app with mock data
 */
export const FullApp: Story = {
  decorators: [
    (Story) => (
      <QueryClientProvider client={queryClient}>
        <ApiProvider useMock>
          <Story />
        </ApiProvider>
      </QueryClientProvider>
    ),
  ],
  render: () => <ConnectedApp />,
}

/**
 * Home Screen Only - Just the home screen with connected data
 */
export const HomeOnly: Story = {
  decorators: [
    (Story) => (
      <QueryClientProvider client={queryClient}>
        <ApiProvider useMock>
          <Story />
        </ApiProvider>
      </QueryClientProvider>
    ),
  ],
  render: () => (
    <div className="min-h-screen bg-suwappu-bg overflow-x-hidden max-w-full">
      <HomeScreen onNavigate={() => {}} />
      <BottomNav active="home" onNavigate={() => {}} />
    </div>
  ),
}

/**
 * History Screen Only - Just the history screen with swap data
 */
export const HistoryOnly: Story = {
  decorators: [
    (Story) => (
      <QueryClientProvider client={queryClient}>
        <ApiProvider useMock>
          <Story />
        </ApiProvider>
      </QueryClientProvider>
    ),
  ],
  render: () => (
    <div className="min-h-screen bg-suwappu-bg overflow-x-hidden max-w-full">
      <HistoryScreen />
      <BottomNav active="history" onNavigate={() => {}} />
    </div>
  ),
}
