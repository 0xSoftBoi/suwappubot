import type { Meta, StoryObj } from '@storybook/react'
import { useState } from 'react'
import '../../theme/suwappu.css'

const meta: Meta = {
  title: 'Suwappu App/Swap',
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

// Header
function Header({ title }: { title: string }) {
  return (
    <header className="sticky top-0 z-50 bg-white/80 backdrop-blur-md border-b border-suwappu-sakura-mid/20">
      <div className="flex items-center justify-center h-12 px-3">
        <span className="font-heading font-bold text-sm text-suwappu-purple-deep">{title}</span>
      </div>
    </header>
  )
}

// Bottom Nav
function BottomNav({ active = 'swap' }: { active?: string }) {
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

// Token Input Component
function TokenInput({
  label,
  amount,
  token,
  balance,
  usdValue,
  onAmountChange,
}: {
  label: string
  amount: string
  token: { symbol: string; icon: string; name: string }
  balance?: string
  usdValue?: string
  onAmountChange?: (value: string) => void
}) {
  return (
    <div className="bg-white rounded-suwappu-xl p-3 shadow-suwappu-1">
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs text-suwappu-text-secondary">{label}</span>
        {balance && (
          <span className="text-xs text-suwappu-text-secondary">
            Balance: {balance}
          </span>
        )}
      </div>
      <div className="flex items-center gap-2">
        <input
          type="text"
          value={amount}
          onChange={(e) => onAmountChange?.(e.target.value)}
          placeholder="0.0"
          className="flex-1 text-xl font-heading font-bold text-suwappu-text bg-transparent focus:outline-none min-w-0"
        />
        <button className="flex items-center gap-2 px-3 py-2 bg-suwappu-sakura-light rounded-suwappu-lg hover:bg-suwappu-sakura-mid/30 transition-colors">
          <span className="text-lg">{token.icon}</span>
          <span className="font-heading font-semibold text-sm">{token.symbol}</span>
          <svg className="w-4 h-4 text-suwappu-text-secondary" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
          </svg>
        </button>
      </div>
      {usdValue && (
        <div className="flex items-center justify-between mt-2">
          <span className="text-xs text-suwappu-text-secondary">{usdValue}</span>
          {balance && (
            <button className="text-xs text-suwappu-magenta-mid font-medium">Max</button>
          )}
        </div>
      )}
    </div>
  )
}

// Swap Arrow Button
function SwapArrow({ onClick }: { onClick?: () => void }) {
  return (
    <div className="flex justify-center -my-2 relative z-10">
      <button
        onClick={onClick}
        className="w-10 h-10 bg-white rounded-full shadow-suwappu-2 flex items-center justify-center text-suwappu-magenta-mid hover:bg-suwappu-sakura-light transition-colors"
      >
        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16V4m0 0L3 8m4-4l4 4m6 0v12m0 0l4-4m-4 4l-4-4" />
        </svg>
      </button>
    </div>
  )
}

export const SwapForm: Story = {
  render: () => {
    const [fromAmount, setFromAmount] = useState('0.5')
    const [toAmount, setToAmount] = useState('920.50')

    return (
      <div className="min-h-screen bg-suwappu-bg overflow-x-hidden max-w-full">
        <Header title="Swap" />
        <main className="p-3 pb-20 space-y-1">
          <TokenInput
            label="From"
            amount={fromAmount}
            onAmountChange={setFromAmount}
            token={{ symbol: 'ETH', icon: 'Ξ', name: 'Ethereum' }}
            balance="0.5432"
            usdValue="~$1,841.00"
          />

          <SwapArrow />

          <TokenInput
            label="To"
            amount={toAmount}
            onAmountChange={setToAmount}
            token={{ symbol: 'USDC', icon: '$', name: 'USD Coin' }}
            usdValue="~$920.50"
          />

          <div className="bg-white rounded-suwappu-xl p-3 shadow-suwappu-1 mt-4">
            <div className="space-y-2 text-xs">
              <div className="flex items-center justify-between">
                <span className="text-suwappu-text-secondary">Rate</span>
                <span className="text-suwappu-text">1 ETH = 1,841.00 USDC</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-suwappu-text-secondary">Price Impact</span>
                <span className="text-suwappu-success">{'<'}0.01%</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-suwappu-text-secondary">Network Fee</span>
                <span className="text-suwappu-text">~$2.50</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-suwappu-text-secondary">Route</span>
                <span className="text-suwappu-magenta-mid">Via Li.Fi</span>
              </div>
            </div>
          </div>

          <button className="w-full px-4 py-3 bg-suwappu-gradient text-white font-heading font-bold text-sm rounded-suwappu-pill shadow-suwappu-button mt-4">
            Review Swap
          </button>
        </main>
        <BottomNav active="swap" />
      </div>
    )
  },
}

export const CrossChainSwap: Story = {
  render: () => {
    const [fromAmount, setFromAmount] = useState('100')

    return (
      <div className="min-h-screen bg-suwappu-bg overflow-x-hidden max-w-full">
        <Header title="Cross-Chain Swap" />
        <main className="p-3 pb-20 space-y-1">
          <div className="bg-white rounded-suwappu-xl p-3 shadow-suwappu-1">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs text-suwappu-text-secondary">From</span>
              <button className="flex items-center gap-1 px-2 py-1 bg-suwappu-sakura-light rounded-suwappu-pill text-xs">
                <span>Ξ</span>
                <span className="font-medium">Ethereum</span>
              </button>
            </div>
            <div className="flex items-center gap-2">
              <input
                type="text"
                value={fromAmount}
                onChange={(e) => setFromAmount(e.target.value)}
                placeholder="0.0"
                className="flex-1 text-xl font-heading font-bold text-suwappu-text bg-transparent focus:outline-none"
              />
              <button className="flex items-center gap-2 px-3 py-2 bg-suwappu-sakura-light rounded-suwappu-lg">
                <span>$</span>
                <span className="font-heading font-semibold text-sm">USDC</span>
              </button>
            </div>
          </div>

          <SwapArrow />

          <div className="bg-white rounded-suwappu-xl p-3 shadow-suwappu-1">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs text-suwappu-text-secondary">To</span>
              <button className="flex items-center gap-1 px-2 py-1 bg-suwappu-info/10 rounded-suwappu-pill text-xs text-suwappu-info">
                <span>⬡</span>
                <span className="font-medium">Polygon</span>
              </button>
            </div>
            <div className="flex items-center gap-2">
              <span className="flex-1 text-xl font-heading font-bold text-suwappu-text">99.50</span>
              <button className="flex items-center gap-2 px-3 py-2 bg-suwappu-sakura-light rounded-suwappu-lg">
                <span>$</span>
                <span className="font-heading font-semibold text-sm">USDC</span>
              </button>
            </div>
          </div>

          <div className="bg-suwappu-info/10 border border-suwappu-info/20 rounded-suwappu-lg p-2 mt-3">
            <div className="flex items-center gap-2">
              <svg className="w-4 h-4 text-suwappu-info flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              <p className="text-xs text-suwappu-info">Cross-chain swap via Li.Fi bridge</p>
            </div>
          </div>

          <div className="bg-white rounded-suwappu-xl p-3 shadow-suwappu-1 mt-3">
            <div className="space-y-2 text-xs">
              <div className="flex items-center justify-between">
                <span className="text-suwappu-text-secondary">Bridge Fee</span>
                <span className="text-suwappu-text">~$0.50</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-suwappu-text-secondary">Est. Time</span>
                <span className="text-suwappu-text">~2 min</span>
              </div>
            </div>
          </div>

          <button className="w-full px-4 py-3 bg-suwappu-gradient text-white font-heading font-bold text-sm rounded-suwappu-pill shadow-suwappu-button mt-4">
            Bridge & Swap
          </button>
        </main>
        <BottomNav active="swap" />
      </div>
    )
  },
}

export const SwapConfirmation: Story = {
  render: () => (
    <div className="min-h-screen bg-suwappu-bg overflow-x-hidden max-w-full">
      <Header title="Confirm Swap" />
      <main className="p-3 pb-20 space-y-4">
        <div className="bg-white rounded-suwappu-xl p-4 shadow-suwappu-1 text-center">
          <div className="flex items-center justify-center gap-4 mb-4">
            <div className="text-center">
              <div className="w-12 h-12 rounded-full bg-suwappu-sakura-light flex items-center justify-center text-2xl mb-1">Ξ</div>
              <span className="font-heading font-bold text-lg text-suwappu-text">0.5</span>
              <span className="text-xs text-suwappu-text-secondary block">ETH</span>
            </div>
            <svg className="w-6 h-6 text-suwappu-magenta-mid" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 8l4 4m0 0l-4 4m4-4H3" />
            </svg>
            <div className="text-center">
              <div className="w-12 h-12 rounded-full bg-suwappu-sakura-light flex items-center justify-center text-2xl mb-1">$</div>
              <span className="font-heading font-bold text-lg text-suwappu-text">920.50</span>
              <span className="text-xs text-suwappu-text-secondary block">USDC</span>
            </div>
          </div>
        </div>

        <div className="bg-white rounded-suwappu-xl p-3 shadow-suwappu-1">
          <h3 className="font-heading font-semibold text-sm text-suwappu-purple-deep mb-2">Transaction Details</h3>
          <div className="space-y-2 text-xs">
            <div className="flex items-center justify-between">
              <span className="text-suwappu-text-secondary">Rate</span>
              <span className="text-suwappu-text">1 ETH = 1,841.00 USDC</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-suwappu-text-secondary">Min. Received</span>
              <span className="text-suwappu-text">915.38 USDC</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-suwappu-text-secondary">Slippage</span>
              <span className="text-suwappu-text">0.5%</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-suwappu-text-secondary">Network Fee</span>
              <span className="text-suwappu-text">~$2.50</span>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <button className="px-4 py-3 bg-white text-suwappu-text-secondary font-heading font-bold text-sm rounded-suwappu-pill border border-suwappu-sakura-mid">
            Cancel
          </button>
          <button className="px-4 py-3 bg-suwappu-gradient text-white font-heading font-bold text-sm rounded-suwappu-pill shadow-suwappu-button">
            Confirm
          </button>
        </div>
      </main>
      <BottomNav active="swap" />
    </div>
  ),
}

export const SwapPending: Story = {
  render: () => (
    <div className="min-h-screen bg-suwappu-bg overflow-x-hidden max-w-full">
      <Header title="Swap" />
      <main className="p-3 pb-20 flex flex-col items-center justify-center min-h-[60vh]">
        <div className="bg-white rounded-suwappu-xxl p-6 shadow-suwappu-2 text-center max-w-xs">
          <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-suwappu-gradient flex items-center justify-center">
            <svg className="w-8 h-8 text-white animate-spin" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
            </svg>
          </div>
          <h3 className="font-heading font-bold text-lg text-suwappu-purple-deep mb-1">Swap in Progress</h3>
          <p className="text-xs text-suwappu-text-secondary mb-4">
            Swapping 0.5 ETH for USDC...
          </p>
          <div className="w-full h-1.5 bg-suwappu-sakura-light rounded-full overflow-hidden">
            <div className="h-full bg-suwappu-gradient animate-pulse w-2/3" />
          </div>
        </div>
      </main>
      <BottomNav active="swap" />
    </div>
  ),
}

export const SwapSuccess: Story = {
  render: () => (
    <div className="min-h-screen bg-suwappu-bg overflow-x-hidden max-w-full">
      <Header title="Swap" />
      <main className="p-3 pb-20 flex flex-col items-center justify-center min-h-[60vh]">
        <div className="bg-white rounded-suwappu-xxl p-6 shadow-suwappu-2 text-center max-w-xs">
          <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-suwappu-success/20 flex items-center justify-center">
            <svg className="w-8 h-8 text-suwappu-success" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
            </svg>
          </div>
          <h3 className="font-heading font-bold text-lg text-suwappu-purple-deep mb-1">Swap Complete!</h3>
          <p className="text-xs text-suwappu-text-secondary mb-4">
            Successfully swapped 0.5 ETH for 920.50 USDC
          </p>
          <div className="space-y-2">
            <button className="w-full px-4 py-2 bg-suwappu-gradient text-white font-heading font-bold text-sm rounded-suwappu-pill shadow-suwappu-button">
              View Transaction
            </button>
            <button className="w-full px-4 py-2 text-suwappu-magenta-mid font-heading font-semibold text-sm">
              Swap Again
            </button>
          </div>
        </div>
      </main>
      <BottomNav active="swap" />
    </div>
  ),
}
