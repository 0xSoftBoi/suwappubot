import type { Meta, StoryObj } from '@storybook/react'
import { useState } from 'react'
import '../../theme/suwappu.css'

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
