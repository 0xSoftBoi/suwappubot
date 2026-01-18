import type { Meta, StoryObj } from '@storybook/react'
import { useState } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import '../../theme/suwappu.css'
import { ApiProvider } from '../../contexts/ApiContext'
import { usePortfolio } from '../../hooks/usePortfolio'
import { mockPortfolio } from '../mockData'
import type { Token } from '../../types/api'

const meta: Meta = {
  title: 'Suwappu App/Wallet',
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

// Header with back button
function Header({ title, onBack }: { title: string; onBack?: () => void }) {
  return (
    <header className="sticky top-0 z-50 bg-white/80 backdrop-blur-md border-b border-suwappu-sakura-mid/20">
      <div className="flex items-center justify-between h-12 px-3">
        <button onClick={onBack} className="p-1.5 -ml-1.5 text-suwappu-text-secondary">
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
        </button>
        <span className="font-heading font-bold text-sm text-suwappu-purple-deep">{title}</span>
        <div className="w-8" />
      </div>
    </header>
  )
}

// Bottom Nav
function BottomNav({ active = 'wallet' }: { active?: string }) {
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

// Address display
function AddressCard({ address, label }: { address: string; label?: string }) {
  const [copied, setCopied] = useState(false)
  const short = `${address.slice(0, 6)}...${address.slice(-4)}`

  const copy = () => {
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <div className="bg-white rounded-suwappu-xl p-3 shadow-suwappu-1">
      {label && <p className="text-xs text-suwappu-text-secondary mb-1">{label}</p>}
      <div className="flex items-center justify-between gap-2">
        <span className="font-mono text-sm text-suwappu-text">{short}</span>
        <button
          onClick={copy}
          className="p-1.5 text-suwappu-text-secondary hover:text-suwappu-magenta-mid transition-colors"
        >
          {copied ? (
            <svg className="w-4 h-4 text-suwappu-success" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
            </svg>
          ) : (
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
            </svg>
          )}
        </button>
      </div>
    </div>
  )
}

// Chain selector
function ChainSelector({
  selected,
  chains,
  onSelect,
}: {
  selected: string
  chains: { id: string; name: string; icon: string }[]
  onSelect?: (chainId: string) => void
}) {
  return (
    <div className="w-full">
      <div className="flex gap-1.5 flex-wrap">
        {chains.map((chain) => (
          <button
            key={chain.id}
            onClick={() => onSelect?.(chain.id)}
            className={`flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-heading font-medium transition-colors ${
              selected === chain.id
                ? 'bg-suwappu-gradient text-white'
                : 'bg-white text-suwappu-text-secondary border border-suwappu-sakura-mid/30'
            }`}
          >
            <span className="text-sm">{chain.icon}</span>
            <span>{chain.name}</span>
          </button>
        ))}
      </div>
    </div>
  )
}

// Token balance row
function TokenRow({ symbol, name, balance, value, icon }: {
  symbol: string
  name: string
  balance: string
  value: string
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
          <span className="font-heading font-semibold text-sm text-suwappu-text">{balance}</span>
        </div>
        <div className="flex items-center justify-between">
          <span className="text-xs text-suwappu-text-secondary truncate">{name}</span>
          <span className="text-xs text-suwappu-text-secondary">{value}</span>
        </div>
      </div>
    </div>
  )
}

export const WalletOverview: Story = {
  render: () => {
    const chains = [
      { id: 'eth', name: 'Ethereum', icon: 'Ξ' },
      { id: 'bsc', name: 'BSC', icon: '🔶' },
      { id: 'polygon', name: 'Polygon', icon: '⬡' },
      { id: 'sol', name: 'Solana', icon: '◎' },
    ]

    return (
      <div className="min-h-screen bg-suwappu-bg overflow-x-hidden max-w-full">
        <Header title="Wallet" />
        <main className="p-3 pb-20 space-y-4 overflow-hidden">
          <AddressCard address="0x1234567890abcdef1234567890abcdef12345678" label="Connected Wallet" />

          <ChainSelector selected="eth" chains={chains} />

          <div className="bg-white rounded-suwappu-xl shadow-suwappu-1 overflow-hidden">
            <div className="px-3 py-2 border-b border-suwappu-sakura-mid/10">
              <span className="font-heading font-semibold text-sm text-suwappu-purple-deep">Balances</span>
            </div>
            <div className="divide-y divide-suwappu-sakura-mid/10">
              <TokenRow symbol="ETH" name="Ethereum" balance="0.5432" value="$1,842.50" icon="Ξ" />
              <TokenRow symbol="USDC" name="USD Coin" balance="500.00" value="$500.00" icon="$" />
              <TokenRow symbol="PEPE" name="Pepe" balance="1,234,567" value="$123.45" icon="🐸" />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <button className="flex items-center justify-center gap-2 px-4 py-3 bg-suwappu-gradient text-white font-heading font-bold text-sm rounded-suwappu-pill shadow-suwappu-button">
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 14l-7 7m0 0l-7-7m7 7V3" />
              </svg>
              Receive
            </button>
            <button className="flex items-center justify-center gap-2 px-4 py-3 bg-white text-suwappu-magenta-mid font-heading font-bold text-sm rounded-suwappu-pill border-2 border-suwappu-sakura-mid shadow-suwappu-1">
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 10l7-7m0 0l7 7m-7-7v18" />
              </svg>
              Send
            </button>
          </div>
        </main>
        <BottomNav active="wallet" />
      </div>
    )
  },
}

export const ReceiveScreen: Story = {
  render: () => (
    <div className="min-h-screen bg-suwappu-bg overflow-x-hidden max-w-full">
      <Header title="Receive" />
      <main className="p-3 pb-20 space-y-4">
        <div className="bg-white rounded-suwappu-xl p-4 shadow-suwappu-1 text-center">
          <div className="w-40 h-40 mx-auto mb-3 bg-suwappu-sakura-light rounded-suwappu-lg flex items-center justify-center">
            <div className="w-32 h-32 bg-white rounded-lg grid grid-cols-5 gap-0.5 p-2">
              {Array(25).fill(0).map((_, i) => (
                <div key={i} className={`${Math.random() > 0.5 ? 'bg-suwappu-purple-deep' : 'bg-transparent'}`} />
              ))}
            </div>
          </div>
          <p className="font-mono text-xs text-suwappu-text break-all mb-3">
            0x1234...5678
          </p>
          <button className="px-4 py-2 bg-suwappu-sakura-light text-suwappu-magenta-mid font-heading font-semibold text-sm rounded-suwappu-pill">
            Copy Address
          </button>
        </div>

        <div className="bg-suwappu-info/10 border border-suwappu-info/20 rounded-suwappu-lg p-3">
          <p className="text-xs text-suwappu-info">
            Only send Ethereum assets to this address. Sending other assets may result in permanent loss.
          </p>
        </div>
      </main>
      <BottomNav active="wallet" />
    </div>
  ),
}

export const SendScreen: Story = {
  render: () => {
    const [amount, setAmount] = useState('')
    return (
      <div className="min-h-screen bg-suwappu-bg overflow-x-hidden max-w-full">
        <Header title="Send" />
        <main className="p-3 pb-20 space-y-4">
          <div className="bg-white rounded-suwappu-xl p-3 shadow-suwappu-1">
            <label className="text-xs text-suwappu-text-secondary mb-1 block">To Address</label>
            <input
              type="text"
              placeholder="0x..."
              className="w-full px-3 py-2 bg-suwappu-sakura-light/50 rounded-suwappu-lg text-sm font-mono focus:outline-none focus:ring-2 focus:ring-suwappu-magenta-mid/30"
            />
          </div>

          <div className="bg-white rounded-suwappu-xl p-3 shadow-suwappu-1">
            <div className="flex items-center justify-between mb-1">
              <label className="text-xs text-suwappu-text-secondary">Amount</label>
              <span className="text-xs text-suwappu-text-secondary">Balance: 0.5432 ETH</span>
            </div>
            <div className="flex items-center gap-2">
              <input
                type="text"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder="0.0"
                className="flex-1 px-3 py-2 bg-suwappu-sakura-light/50 rounded-suwappu-lg text-sm font-mono focus:outline-none focus:ring-2 focus:ring-suwappu-magenta-mid/30"
              />
              <button className="px-3 py-2 bg-suwappu-sakura-light rounded-suwappu-lg flex items-center gap-1.5">
                <span>Ξ</span>
                <span className="text-sm font-heading font-semibold">ETH</span>
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                </svg>
              </button>
            </div>
            <button className="text-xs text-suwappu-magenta-mid font-medium mt-2">Max</button>
          </div>

          <div className="bg-white rounded-suwappu-xl p-3 shadow-suwappu-1">
            <div className="flex items-center justify-between text-xs">
              <span className="text-suwappu-text-secondary">Network Fee</span>
              <span className="text-suwappu-text">~$2.50</span>
            </div>
          </div>

          <button className="w-full px-4 py-3 bg-suwappu-gradient text-white font-heading font-bold text-sm rounded-suwappu-pill shadow-suwappu-button">
            Review Transaction
          </button>
        </main>
        <BottomNav active="wallet" />
      </div>
    )
  },
}

export const ConnectWallet: Story = {
  render: () => (
    <div className="min-h-screen bg-suwappu-bg overflow-x-hidden max-w-full">
      <Header title="Connect Wallet" />
      <main className="p-3 pb-20 space-y-3">
        <div className="bg-white rounded-suwappu-xl p-4 shadow-suwappu-1 text-center mb-4">
          <div className="w-16 h-16 mx-auto mb-3 bg-suwappu-gradient rounded-full flex items-center justify-center">
            <span className="text-white text-2xl">🌸</span>
          </div>
          <h2 className="font-heading font-bold text-suwappu-purple-deep mb-1">Connect Your Wallet</h2>
          <p className="text-xs text-suwappu-text-secondary">
            Choose how you want to connect
          </p>
        </div>

        <button className="w-full flex items-center gap-3 p-3 bg-white rounded-suwappu-xl shadow-suwappu-1 hover:shadow-suwappu-2 transition-shadow">
          <div className="w-10 h-10 rounded-full bg-gradient-to-br from-orange-400 to-orange-500 flex items-center justify-center">
            <span className="text-white text-lg">🦊</span>
          </div>
          <div className="flex-1 text-left">
            <span className="font-heading font-semibold text-sm text-suwappu-text block">MetaMask</span>
            <span className="text-xs text-suwappu-text-secondary">Connect external wallet</span>
          </div>
          <svg className="w-5 h-5 text-suwappu-text-secondary" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
          </svg>
        </button>

        <button className="w-full flex items-center gap-3 p-3 bg-white rounded-suwappu-xl shadow-suwappu-1 hover:shadow-suwappu-2 transition-shadow">
          <div className="w-10 h-10 rounded-full bg-suwappu-gradient flex items-center justify-center">
            <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 11c0 3.517-1.009 6.799-2.753 9.571m-3.44-2.04l.054-.09A13.916 13.916 0 008 11a4 4 0 118 0c0 1.017-.07 2.019-.203 3m-2.118 6.844A21.88 21.88 0 0015.171 17m3.839 1.132c.645-2.266.99-4.659.99-7.132A8 8 0 008 4.07M3 15.364c.64-1.319 1-2.8 1-4.364 0-1.457.39-2.823 1.07-4" />
            </svg>
          </div>
          <div className="flex-1 text-left">
            <span className="font-heading font-semibold text-sm text-suwappu-text block">Passkey</span>
            <span className="text-xs text-suwappu-text-secondary">Create secure wallet</span>
          </div>
          <svg className="w-5 h-5 text-suwappu-text-secondary" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
          </svg>
        </button>

        <div className="pt-4">
          <p className="text-[10px] text-suwappu-text-secondary text-center">
            By connecting, you agree to our Terms of Service
          </p>
        </div>
      </main>
      <BottomNav active="wallet" />
    </div>
  ),
}

// === Connected Stories (using real data flow) ===

// Available chains with their icons
const CHAINS = [
  { id: 'all', name: 'All', icon: '●' },
  { id: 'ethereum', name: 'Ethereum', icon: 'Ξ' },
  { id: 'bsc', name: 'BSC', icon: '🔶' },
  { id: 'polygon', name: 'Polygon', icon: '⬡' },
  { id: 'arbitrum', name: 'Arbitrum', icon: '🔷' },
  { id: 'solana', name: 'Solana', icon: '◎' },
]

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

// Format balance number
function formatBalance(balance: string): string {
  const num = parseFloat(balance)
  if (num >= 1000000) return (num / 1000000).toFixed(2) + 'M'
  if (num >= 1000) return (num / 1000).toFixed(2) + 'K'
  if (num >= 1) return num.toFixed(4)
  return num.toFixed(6)
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

// Loading skeleton for token list
function BalanceListSkeleton() {
  return (
    <div className="bg-white rounded-suwappu-xl shadow-suwappu-1 overflow-hidden">
      <div className="px-3 py-2 border-b border-suwappu-sakura-mid/10">
        <span className="font-heading font-semibold text-sm text-suwappu-purple-deep">Balances</span>
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

// Dynamic balance list that accepts portfolio tokens
function DynamicBalanceList({ tokens, selectedChain, isLoading }: { tokens: Token[]; selectedChain: string; isLoading?: boolean }) {
  if (isLoading) {
    return <BalanceListSkeleton />
  }

  const filteredTokens = selectedChain === 'all'
    ? tokens
    : tokens.filter(t => t.chain === selectedChain)

  if (filteredTokens.length === 0) {
    return (
      <div className="bg-white rounded-suwappu-xl shadow-suwappu-1 p-6 text-center">
        <div className="w-12 h-12 mx-auto mb-2 bg-suwappu-sakura-light rounded-full flex items-center justify-center">
          <span className="text-2xl">💰</span>
        </div>
        <p className="font-heading font-semibold text-suwappu-purple-deep mb-1">No tokens found</p>
        <p className="text-xs text-suwappu-text-secondary">
          {selectedChain === 'all' ? 'Your wallet is empty' : `No tokens on ${selectedChain}`}
        </p>
      </div>
    )
  }

  return (
    <div className="bg-white rounded-suwappu-xl shadow-suwappu-1 overflow-hidden">
      <div className="px-3 py-2 border-b border-suwappu-sakura-mid/10">
        <span className="font-heading font-semibold text-sm text-suwappu-purple-deep">Balances</span>
      </div>
      <div className="divide-y divide-suwappu-sakura-mid/10">
        {filteredTokens.map((token) => (
          <TokenRow
            key={`${token.chain}-${token.address}`}
            symbol={token.symbol}
            name={token.name}
            balance={formatBalance(token.balance)}
            value={formatUsd(token.usdValue)}
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
      <p className="text-sm font-heading font-semibold text-suwappu-error mb-1">Failed to load balances</p>
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

// Connected Wallet Screen component that uses the usePortfolio hook
function ConnectedWalletScreen() {
  const [selectedChain, setSelectedChain] = useState('all')
  const { data: portfolio, isLoading, error, refetch } = usePortfolio()

  // Get unique chains from portfolio tokens
  const availableChains = portfolio?.tokens
    ? [...new Set(portfolio.tokens.map(t => t.chain))]
    : []

  const chains = CHAINS.filter(c => c.id === 'all' || availableChains.includes(c.id))

  return (
    <div className="min-h-screen bg-suwappu-bg overflow-x-hidden max-w-full">
      <Header title="Wallet" />
      <main className="p-3 pb-20 space-y-4 overflow-hidden">
        <AddressCard address="0x1234567890abcdef1234567890abcdef12345678" label="Connected Wallet" />

        <ChainSelector
          selected={selectedChain}
          chains={chains.map(c => ({ id: c.id, name: c.name, icon: c.icon }))}
          onSelect={setSelectedChain}
        />

        {error ? (
          <ErrorState message={(error as Error).message} onRetry={() => refetch()} />
        ) : (
          <DynamicBalanceList
            tokens={portfolio?.tokens ?? []}
            selectedChain={selectedChain}
            isLoading={isLoading}
          />
        )}

        <div className="grid grid-cols-2 gap-3">
          <button className="flex items-center justify-center gap-2 px-4 py-3 bg-suwappu-gradient text-white font-heading font-bold text-sm rounded-suwappu-pill shadow-suwappu-button">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 14l-7 7m0 0l-7-7m7 7V3" />
            </svg>
            Receive
          </button>
          <button className="flex items-center justify-center gap-2 px-4 py-3 bg-white text-suwappu-magenta-mid font-heading font-bold text-sm rounded-suwappu-pill border-2 border-suwappu-sakura-mid shadow-suwappu-1">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 10l7-7m0 0l7 7m-7-7v18" />
            </svg>
            Send
          </button>
        </div>
      </main>
      <BottomNav active="wallet" />
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
 * Connected Wallet Screen - Uses mock API to demonstrate real data flow
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
  render: () => <ConnectedWalletScreen />,
}

/**
 * Loading State - Shows skeleton UI while data is being fetched
 */
export const Loading: Story = {
  render: () => (
    <div className="min-h-screen bg-suwappu-bg overflow-x-hidden max-w-full">
      <Header title="Wallet" />
      <main className="p-3 pb-20 space-y-4 overflow-hidden">
        <AddressCard address="0x1234567890abcdef1234567890abcdef12345678" label="Connected Wallet" />
        <ChainSelector
          selected="all"
          chains={CHAINS.slice(0, 4).map(c => ({ id: c.id, name: c.name, icon: c.icon }))}
        />
        <BalanceListSkeleton />
        <div className="grid grid-cols-2 gap-3">
          <button className="flex items-center justify-center gap-2 px-4 py-3 bg-suwappu-gradient text-white font-heading font-bold text-sm rounded-suwappu-pill shadow-suwappu-button opacity-50">
            Receive
          </button>
          <button className="flex items-center justify-center gap-2 px-4 py-3 bg-white text-suwappu-magenta-mid font-heading font-bold text-sm rounded-suwappu-pill border-2 border-suwappu-sakura-mid shadow-suwappu-1 opacity-50">
            Send
          </button>
        </div>
      </main>
      <BottomNav active="wallet" />
    </div>
  ),
}

/**
 * With Mock Portfolio Data - Uses imported mock data directly
 */
export const WithMockData: Story = {
  render: () => {
    const [selectedChain, setSelectedChain] = useState('all')
    const availableChains = [...new Set(mockPortfolio.tokens.map(t => t.chain))]
    const chains = CHAINS.filter(c => c.id === 'all' || availableChains.includes(c.id))

    return (
      <div className="min-h-screen bg-suwappu-bg overflow-x-hidden max-w-full">
        <Header title="Wallet" />
        <main className="p-3 pb-20 space-y-4 overflow-hidden">
          <AddressCard address="0x1234567890abcdef1234567890abcdef12345678" label="Connected Wallet" />
          <ChainSelector
            selected={selectedChain}
            chains={chains.map(c => ({ id: c.id, name: c.name, icon: c.icon }))}
            onSelect={setSelectedChain}
          />
          <DynamicBalanceList
            tokens={mockPortfolio.tokens}
            selectedChain={selectedChain}
          />
          <div className="grid grid-cols-2 gap-3">
            <button className="flex items-center justify-center gap-2 px-4 py-3 bg-suwappu-gradient text-white font-heading font-bold text-sm rounded-suwappu-pill shadow-suwappu-button">
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 14l-7 7m0 0l-7-7m7 7V3" />
              </svg>
              Receive
            </button>
            <button className="flex items-center justify-center gap-2 px-4 py-3 bg-white text-suwappu-magenta-mid font-heading font-bold text-sm rounded-suwappu-pill border-2 border-suwappu-sakura-mid shadow-suwappu-1">
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 10l7-7m0 0l7 7m-7-7v18" />
              </svg>
              Send
            </button>
          </div>
        </main>
        <BottomNav active="wallet" />
      </div>
    )
  },
}
