import { useState, useMemo, useCallback } from 'react'
import { QRCodeSVG } from 'qrcode.react'
import { AppLayout, AppHeader } from '../components/layout'
import { AddressCard, TokenItem } from '../components/cards'
import { ChainSelector } from '../components/ui'
import { usePortfolio } from '../hooks/usePortfolio'
import { useAuth } from '../contexts/AuthContext'
import type { Token } from '../types/api'

const chains = [
  { id: 'all', name: 'All Chains', icon: '🌐' },
  { id: 'ethereum', name: 'Ethereum', icon: 'Ξ' },
  { id: 'bsc', name: 'BSC', icon: '🔶' },
  { id: 'polygon', name: 'Polygon', icon: '⬡' },
  { id: 'solana', name: 'Solana', icon: '◎' },
  { id: 'arbitrum', name: 'Arbitrum', icon: '🔵' },
  { id: 'optimism', name: 'Optimism', icon: '🔴' },
  { id: 'base', name: 'Base', icon: '🔷' },
]

// Get icon for token based on symbol or chain
function getTokenIcon(token: Token): string {
  const symbolLower = token.symbol.toLowerCase()
  if (symbolLower === 'eth') return 'Ξ'
  if (symbolLower === 'sol') return '◎'
  if (symbolLower === 'usdc' || symbolLower === 'usdt') return '$'
  if (symbolLower === 'matic') return '⬡'
  return token.symbol.charAt(0).toUpperCase()
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

type WalletView = 'overview' | 'receive' | 'send'

export function Wallet() {
  const [view, setView] = useState<WalletView>('overview')
  const [selectedChain, setSelectedChain] = useState('all')
  const [sendAmount, setSendAmount] = useState('')
  const [copied, setCopied] = useState(false)
  const { data: portfolio, isLoading, error } = usePortfolio()
  const { walletInfo, connectedAddress } = useAuth()

  const address = walletInfo?.address || connectedAddress || '0x1234...5678'

  const copyToClipboard = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(address)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch (err) {
      console.error('Failed to copy:', err)
    }
  }, [address])

  // Filter tokens by selected chain
  const filteredTokens = useMemo(() => {
    if (!portfolio?.tokens) return []
    if (selectedChain === 'all') return portfolio.tokens
    return portfolio.tokens.filter(t => t.chain.toLowerCase() === selectedChain)
  }, [portfolio?.tokens, selectedChain])

  if (view === 'receive') {
    return (
      <AppLayout
        header={<AppHeader title="Receive" showBack onBack={() => setView('overview')} />}
        activeNav="wallet"
      >
        <div className="p-3 pb-20 space-y-4">
          <div className="bg-white rounded-suwappu-xl p-4 shadow-suwappu-1 text-center">
            <div className="w-44 h-44 mx-auto mb-3 bg-white rounded-suwappu-lg p-3 border-2 border-suwappu-sakura-mid/30">
              <QRCodeSVG
                value={address}
                size={160}
                level="M"
                bgColor="#ffffff"
                fgColor="#4B1B5F"
                includeMargin={false}
              />
            </div>
            <p className="font-mono text-xs text-suwappu-text break-all mb-3 px-2">
              {address}
            </p>
            <button
              onClick={copyToClipboard}
              className={`px-4 py-2 font-heading font-semibold text-sm rounded-suwappu-pill transition-all ${
                copied
                  ? 'bg-suwappu-success/20 text-suwappu-success'
                  : 'bg-suwappu-sakura-light text-suwappu-magenta-mid hover:bg-suwappu-sakura-mid/30'
              }`}
            >
              {copied ? '✓ Copied!' : 'Copy Address'}
            </button>
          </div>

          <div className="bg-suwappu-info/10 border border-suwappu-info/20 rounded-suwappu-lg p-3">
            <p className="text-xs text-suwappu-info">
              Only send compatible assets to this address. Sending unsupported tokens may result in permanent loss.
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
              <p className="text-sm text-suwappu-error mb-1">Failed to load balances</p>
              <p className="text-xs text-suwappu-text-secondary">Please try again later</p>
            </div>
          ) : filteredTokens.length > 0 ? (
            <div className="divide-y divide-suwappu-sakura-mid/10">
              {filteredTokens.map((token) => (
                <TokenItem
                  key={`${token.chain}-${token.symbol}-${token.address}`}
                  symbol={token.symbol}
                  name={token.name}
                  balance={token.balance}
                  value={formatUsd(token.usdValue)}
                  icon={getTokenIcon(token)}
                />
              ))}
            </div>
          ) : (
            <div className="p-6 text-center">
              <div className="w-12 h-12 mx-auto mb-2 bg-suwappu-sakura-light rounded-full flex items-center justify-center">
                <span className="text-xl">💰</span>
              </div>
              <p className="text-sm text-suwappu-text-secondary">No tokens on this chain</p>
            </div>
          )}
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
