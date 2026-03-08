import type { Meta, StoryObj } from '@storybook/react'
import { useState } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import '../../theme/suwappu.css'
import { ApiProvider } from '../../contexts/ApiContext'
import { usePortfolio } from '../../hooks/usePortfolio'
import { mockPortfolio } from '../mockData'
import type { Token } from '../../types/api'

const meta: Meta = {
  title: 'Suwappu App/Home',
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

// Compact Header
function Header({ onSettingsClick }: { onSettingsClick?: () => void }) {
  return (
    <header className="sticky top-0 z-50 bg-white/80 backdrop-blur-md border-b border-suwappu-sakura-mid/20">
      <div className="flex items-center justify-between h-12 px-3">
        <div className="flex items-center gap-2">
          <div className="w-7 h-7 rounded-full bg-suwappu-gradient flex items-center justify-center">
            <span className="text-white text-xs font-bold">S</span>
          </div>
          <span className="font-heading font-bold text-sm text-suwappu-purple-deep">Suwappu</span>
        </div>
        <button
          onClick={onSettingsClick}
          className="p-1.5 text-suwappu-text-secondary hover:text-suwappu-text transition-colors"
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
          </svg>
        </button>
      </div>
    </header>
  )
}

// Balance Card - Compact
function BalanceCard() {
  return (
    <div className="bg-suwappu-gradient rounded-suwappu-xl p-4 text-white shadow-suwappu-button">
      <p className="text-xs opacity-80 mb-1">Total Balance</p>
      <p className="text-2xl font-heading font-bold">$1,234.56</p>
      <div className="flex items-center gap-1 mt-1">
        <span className="text-xs bg-white/20 px-1.5 py-0.5 rounded-full">+12.5%</span>
        <span className="text-xs opacity-70">24h</span>
      </div>
    </div>
  )
}

// Quick Actions
function QuickActions() {
  const actions = [
    { icon: '↓', label: 'Receive', color: 'bg-suwappu-success/10 text-suwappu-success' },
    { icon: '↑', label: 'Send', color: 'bg-suwappu-info/10 text-suwappu-info' },
    { icon: '⇄', label: 'Swap', color: 'bg-suwappu-magenta-light/30 text-suwappu-magenta-mid' },
    { icon: '◎', label: 'Buy', color: 'bg-suwappu-warning/10 text-suwappu-warning' },
  ]

  return (
    <div className="grid grid-cols-4 gap-2">
      {actions.map((action) => (
        <button
          key={action.label}
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

// Token List Item - Compact
function TokenItem({
  symbol,
  name,
  value,
  change,
  icon,
}: {
  symbol: string
  name: string
  value: string
  change: number
  icon: string
}) {
  return (
    <div className="flex items-center gap-3 p-2 hover:bg-suwappu-sakura-light/20 rounded-suwappu-lg transition-colors">
      <div className="w-9 h-9 rounded-full bg-suwappu-sakura-light flex items-center justify-center text-lg">
        {icon}
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center justify-between">
          <span className="font-heading font-semibold text-sm text-suwappu-text">{symbol}</span>
          <span className="font-heading font-semibold text-sm text-suwappu-text">{value}</span>
        </div>
        <div className="flex items-center justify-between">
          <span className="text-xs text-suwappu-text-secondary truncate">{name}</span>
          <span className={`text-xs ${change >= 0 ? 'text-suwappu-success' : 'text-suwappu-error'}`}>
            {change >= 0 ? '+' : ''}{change}%
          </span>
        </div>
      </div>
    </div>
  )
}

// Bottom Nav
function BottomNav({ active = 'home' }: { active?: string }) {
  const items = [
    { id: 'home', label: 'Home', icon: (
      <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" />
      </svg>
    )},
    { id: 'wallet', label: 'Wallet', icon: (
      <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 10h18M7 15h1m4 0h1m-7 4h12a3 3 0 003-3V8a3 3 0 00-3-3H6a3 3 0 00-3 3v8a3 3 0 003 3z" />
      </svg>
    )},
    { id: 'swap', label: 'Swap', icon: (
      <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16V4m0 0L3 8m4-4l4 4m6 0v12m0 0l4-4m-4 4l-4-4" />
      </svg>
    )},
    { id: 'portfolio', label: 'Portfolio', icon: (
      <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
      </svg>
    )},
  ]

  return (
    <nav className="fixed bottom-0 left-0 right-0 bg-white/95 backdrop-blur-md border-t border-suwappu-sakura-mid/20">
      <div className="flex items-center justify-around h-16 px-2">
        {items.map((item) => (
          <button
            key={item.id}
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

export const Dashboard: Story = {
  render: () => (
    <div className="min-h-screen bg-suwappu-bg overflow-x-hidden max-w-full">
      <Header />
      <main className="p-3 pb-20 space-y-4">
        <BalanceCard />
        <QuickActions />

        <div className="bg-white rounded-suwappu-xl shadow-suwappu-1 overflow-hidden">
          <div className="flex items-center justify-between px-3 py-2 border-b border-suwappu-sakura-mid/10">
            <span className="font-heading font-semibold text-sm text-suwappu-purple-deep">Assets</span>
            <button className="text-xs text-suwappu-magenta-mid font-medium">See All</button>
          </div>
          <div className="divide-y divide-suwappu-sakura-mid/10">
            <TokenItem symbol="ETH" name="Ethereum" value="$1,842.50" change={2.4} icon="Ξ" />
            <TokenItem symbol="USDC" name="USD Coin" value="$500.00" change={0.01} icon="$" />
            <TokenItem symbol="SOL" name="Solana" value="$187.50" change={-1.2} icon="◎" />
          </div>
        </div>
      </main>
      <BottomNav active="home" />
    </div>
  ),
}

export const EmptyState: Story = {
  render: () => (
    <div className="min-h-screen bg-suwappu-bg overflow-x-hidden max-w-full">
      <Header />
      <main className="p-3 pb-20 space-y-4">
        <div className="bg-suwappu-gradient rounded-suwappu-xl p-4 text-white shadow-suwappu-button">
          <p className="text-xs opacity-80 mb-1">Total Balance</p>
          <p className="text-2xl font-heading font-bold">$0.00</p>
        </div>
        <QuickActions />

        <div className="bg-white rounded-suwappu-xl shadow-suwappu-1 p-6 text-center">
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
      </main>
      <BottomNav active="home" />
    </div>
  ),
}

export const WithNotification: Story = {
  render: () => {
    const [showBanner, setShowBanner] = useState(true)
    return (
      <div className="min-h-screen bg-suwappu-bg overflow-x-hidden max-w-full">
        <Header />
        {showBanner && (
          <div className="mx-3 mt-2 p-2 bg-suwappu-info/10 border border-suwappu-info/20 rounded-suwappu-lg flex items-center gap-2">
            <span className="text-suwappu-info">ℹ</span>
            <p className="flex-1 text-xs text-suwappu-info">New: Solana swaps are now live!</p>
            <button onClick={() => setShowBanner(false)} className="text-suwappu-info/60 hover:text-suwappu-info">
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        )}
        <main className="p-3 pb-20 space-y-4">
          <BalanceCard />
          <QuickActions />
          <div className="bg-white rounded-suwappu-xl shadow-suwappu-1 overflow-hidden">
            <div className="flex items-center justify-between px-3 py-2 border-b border-suwappu-sakura-mid/10">
              <span className="font-heading font-semibold text-sm text-suwappu-purple-deep">Assets</span>
              <button className="text-xs text-suwappu-magenta-mid font-medium">See All</button>
            </div>
            <div className="divide-y divide-suwappu-sakura-mid/10">
              <TokenItem symbol="ETH" name="Ethereum" value="$1,842.50" change={2.4} icon="Ξ" />
              <TokenItem symbol="USDC" name="USD Coin" value="$500.00" change={0.01} icon="$" />
            </div>
          </div>
        </main>
        <BottomNav active="home" />
      </div>
    )
  },
}

// === Connected Stories (using real data flow) ===

// Helper to get token icon
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

// Format USD value
function formatUsd(value: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value)
}

// Dynamic Balance Card that accepts portfolio data
function DynamicBalanceCard({ totalValue, isLoading }: { totalValue: number; isLoading?: boolean }) {
  if (isLoading) {
    return (
      <div className="bg-suwappu-gradient rounded-suwappu-xl p-4 text-white shadow-suwappu-button animate-pulse">
        <p className="text-xs opacity-80 mb-1">Total Balance</p>
        <div className="h-8 bg-white/20 rounded w-32" />
      </div>
    )
  }

  return (
    <div className="bg-suwappu-gradient rounded-suwappu-xl p-4 text-white shadow-suwappu-button">
      <p className="text-xs opacity-80 mb-1">Total Balance</p>
      <p className="text-2xl font-heading font-bold">{formatUsd(totalValue)}</p>
    </div>
  )
}

// Loading skeleton for token list
function TokenListSkeleton() {
  return (
    <div className="bg-white rounded-suwappu-xl shadow-suwappu-1 overflow-hidden">
      <div className="flex items-center justify-between px-3 py-2 border-b border-suwappu-sakura-mid/10">
        <span className="font-heading font-semibold text-sm text-suwappu-purple-deep">Assets</span>
      </div>
      <div className="divide-y divide-suwappu-sakura-mid/10">
        {[1, 2, 3].map((i) => (
          <div key={i} className="flex items-center gap-3 p-2 animate-pulse">
            <div className="w-9 h-9 rounded-full bg-suwappu-sakura-light" />
            <div className="flex-1">
              <div className="h-4 bg-suwappu-sakura-light rounded w-16 mb-1" />
              <div className="h-3 bg-suwappu-sakura-light/50 rounded w-24" />
            </div>
            <div className="text-right">
              <div className="h-4 bg-suwappu-sakura-light rounded w-20 mb-1" />
              <div className="h-3 bg-suwappu-sakura-light/50 rounded w-12" />
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

// Dynamic token list that accepts portfolio tokens
function DynamicTokenList({ tokens, isLoading }: { tokens: Token[]; isLoading?: boolean }) {
  if (isLoading) {
    return <TokenListSkeleton />
  }

  return (
    <div className="bg-white rounded-suwappu-xl shadow-suwappu-1 overflow-hidden">
      <div className="flex items-center justify-between px-3 py-2 border-b border-suwappu-sakura-mid/10">
        <span className="font-heading font-semibold text-sm text-suwappu-purple-deep">Assets</span>
        <button className="text-xs text-suwappu-magenta-mid font-medium">See All</button>
      </div>
      <div className="divide-y divide-suwappu-sakura-mid/10">
        {tokens.slice(0, 5).map((token) => (
          <TokenItem
            key={`${token.chain}-${token.address}`}
            symbol={token.symbol}
            name={token.name}
            value={formatUsd(token.usdValue)}
            change={0} // API doesn't provide 24h change yet
            icon={getTokenIcon(token.symbol)}
          />
        ))}
      </div>
    </div>
  )
}

// Error state display
function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="bg-suwappu-error/10 border border-suwappu-error/20 rounded-suwappu-xl p-4 text-center">
      <div className="w-12 h-12 mx-auto mb-2 bg-suwappu-error/10 rounded-full flex items-center justify-center">
        <svg className="w-6 h-6 text-suwappu-error" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
        </svg>
      </div>
      <p className="text-sm font-heading font-semibold text-suwappu-error mb-1">Failed to load data</p>
      <p className="text-xs text-suwappu-text-secondary mb-3">{message}</p>
      {onRetry && (
        <button
          onClick={onRetry}
          className="px-4 py-2 bg-suwappu-gradient text-white text-sm font-heading font-bold rounded-suwappu-pill"
        >
          Try Again
        </button>
      )}
    </div>
  )
}

// Connected Home Screen component that uses the usePortfolio hook
function ConnectedHomeScreen() {
  const { data: portfolio, isLoading, error, refetch } = usePortfolio()

  return (
    <div className="min-h-screen bg-suwappu-bg overflow-x-hidden max-w-full">
      <Header />
      <main className="p-3 pb-20 space-y-4">
        <DynamicBalanceCard totalValue={portfolio?.totalUsdValue ?? 0} isLoading={isLoading} />
        <QuickActions />
        {error ? (
          <ErrorState message={(error as Error).message} onRetry={() => refetch()} />
        ) : (
          <DynamicTokenList tokens={portfolio?.tokens ?? []} isLoading={isLoading} />
        )}
      </main>
      <BottomNav active="home" />
    </div>
  )
}

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
 * Connected Home Screen - Uses mock API to demonstrate real data flow
 */
export const Connected: Story = {
  decorators: [
    (Story) => (
      <QueryClientProvider client={queryClient}>
        <ApiProvider useMock>
          <Story />
        </ApiProvider>
      </QueryClientProvider>
    ),
  ],
  render: () => <ConnectedHomeScreen />,
}

/**
 * Loading State - Shows skeleton UI while data is being fetched
 */
export const Loading: Story = {
  render: () => (
    <div className="min-h-screen bg-suwappu-bg overflow-x-hidden max-w-full">
      <Header />
      <main className="p-3 pb-20 space-y-4">
        <DynamicBalanceCard totalValue={0} isLoading />
        <QuickActions />
        <TokenListSkeleton />
      </main>
      <BottomNav active="home" />
    </div>
  ),
}

/**
 * Error State - Shows error UI with retry option
 */
export const Error: Story = {
  render: () => (
    <div className="min-h-screen bg-suwappu-bg overflow-x-hidden max-w-full">
      <Header />
      <main className="p-3 pb-20 space-y-4">
        <DynamicBalanceCard totalValue={0} />
        <QuickActions />
        <ErrorState message="Unable to connect to server. Please check your connection." onRetry={() => alert('Retrying...')} />
      </main>
      <BottomNav active="home" />
    </div>
  ),
}

/**
 * With Mock Portfolio Data - Uses imported mock data directly
 */
export const WithMockData: Story = {
  render: () => (
    <div className="min-h-screen bg-suwappu-bg overflow-x-hidden max-w-full">
      <Header />
      <main className="p-3 pb-20 space-y-4">
        <DynamicBalanceCard totalValue={mockPortfolio.totalUsdValue} />
        <QuickActions />
        <DynamicTokenList tokens={mockPortfolio.tokens} />
      </main>
      <BottomNav active="home" />
    </div>
  ),
}
