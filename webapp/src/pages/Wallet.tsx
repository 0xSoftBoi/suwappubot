import { useState } from 'react'
import { AppLayout, AppHeader } from '../components/layout'
import { AddressCard, TokenItem } from '../components/cards'
import { ChainSelector } from '../components/ui'

const chains = [
  { id: 'eth', name: 'Ethereum', icon: 'Ξ' },
  { id: 'bsc', name: 'BSC', icon: '🔶' },
  { id: 'polygon', name: 'Polygon', icon: '⬡' },
  { id: 'sol', name: 'Solana', icon: '◎' },
]

const mockBalances = [
  { symbol: 'ETH', name: 'Ethereum', balance: '0.5432', value: '$1,842.50', icon: 'Ξ' },
  { symbol: 'USDC', name: 'USD Coin', balance: '500.00', value: '$500.00', icon: '$' },
  { symbol: 'PEPE', name: 'Pepe', balance: '1,234,567', value: '$123.45', icon: '🐸' },
]

type WalletView = 'overview' | 'receive' | 'send'

export function Wallet() {
  const [view, setView] = useState<WalletView>('overview')
  const [selectedChain, setSelectedChain] = useState('eth')
  const [sendAmount, setSendAmount] = useState('')

  const address = '0x1234567890abcdef1234567890abcdef12345678'

  if (view === 'receive') {
    return (
      <AppLayout
        header={<AppHeader title="Receive" showBack onBack={() => setView('overview')} />}
        activeNav="wallet"
      >
        <div className="p-3 pb-20 space-y-4">
          <div className="bg-white rounded-suwappu-xl p-4 shadow-suwappu-1 text-center">
            <div className="w-40 h-40 mx-auto mb-3 bg-suwappu-sakura-light rounded-suwappu-lg flex items-center justify-center">
              {/* QR Code placeholder */}
              <div className="w-32 h-32 bg-white rounded-lg grid grid-cols-5 gap-0.5 p-2">
                {Array(25).fill(0).map((_, i) => (
                  <div key={i} className={`${Math.random() > 0.5 ? 'bg-suwappu-purple-deep' : 'bg-transparent'}`} />
                ))}
              </div>
            </div>
            <p className="font-mono text-xs text-suwappu-text break-all mb-3">
              {address.slice(0, 20)}...{address.slice(-6)}
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
        </div>
      </AppLayout>
    )
  }

  if (view === 'send') {
    return (
      <AppLayout
        header={<AppHeader title="Send" showBack onBack={() => setView('overview')} />}
        activeNav="wallet"
      >
        <div className="p-3 pb-20 space-y-4">
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
                value={sendAmount}
                onChange={(e) => setSendAmount(e.target.value)}
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
        </div>
      </AppLayout>
    )
  }

  // Overview
  return (
    <AppLayout header={<AppHeader title="Wallet" />} activeNav="wallet">
      <div className="p-3 pb-20 space-y-4 overflow-hidden">
        <AddressCard address={address} label="Connected Wallet" />

        <ChainSelector
          chains={chains}
          selected={selectedChain}
          onSelect={setSelectedChain}
        />

        <div className="bg-white rounded-suwappu-xl shadow-suwappu-1 overflow-hidden">
          <div className="px-3 py-2 border-b border-suwappu-sakura-mid/10">
            <span className="font-heading font-semibold text-sm text-suwappu-purple-deep">Balances</span>
          </div>
          <div className="divide-y divide-suwappu-sakura-mid/10">
            {mockBalances.map((token) => (
              <TokenItem key={token.symbol} {...token} />
            ))}
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <button
            onClick={() => setView('receive')}
            className="flex items-center justify-center gap-2 px-4 py-3 bg-suwappu-gradient text-white font-heading font-bold text-sm rounded-suwappu-pill shadow-suwappu-button"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 14l-7 7m0 0l-7-7m7 7V3" />
            </svg>
            Receive
          </button>
          <button
            onClick={() => setView('send')}
            className="flex items-center justify-center gap-2 px-4 py-3 bg-white text-suwappu-magenta-mid font-heading font-bold text-sm rounded-suwappu-pill border-2 border-suwappu-sakura-mid shadow-suwappu-1"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 10l7-7m0 0l7 7m-7-7v18" />
            </svg>
            Send
          </button>
        </div>
      </div>
    </AppLayout>
  )
}
