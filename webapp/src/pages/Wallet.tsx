import { useState, useCallback } from 'react'
import { QRCodeSVG } from 'qrcode.react'
import { AppLayout, AppHeader } from '../components/layout'
import { AddressCard, TokenItem } from '../components/cards'
import { ChainSelector } from '../components/ui'
import { useWallets } from '../hooks/useWallets'
import { useBalances, usePortfolioValue } from '../hooks/useBalances'

const chains = [
  { id: 'all', name: 'All Chains', icon: '🌐' },
  { id: 'ethereum', name: 'Ethereum', icon: 'Ξ' },
  { id: 'polygon', name: 'Polygon', icon: '⬡' },
  { id: 'arbitrum', name: 'Arbitrum', icon: '◆' },
  { id: 'base', name: 'Base', icon: '🔵' },
  { id: 'optimism', name: 'Optimism', icon: '⚡' },
]

type WalletView = 'overview' | 'receive' | 'send'

export function Wallet() {
  const [view, setView] = useState<WalletView>('overview')
  const [selectedChain, setSelectedChain] = useState('all')
  const [sendAmount, setSendAmount] = useState('')
  const [copied, setCopied] = useState(false)

  // Fetch wallets and balances
  const { data: wallets, isLoading: walletsLoading } = useWallets()
  const { data: balances, isLoading: balancesLoading } = useBalances({
    chain: selectedChain === 'all' ? undefined : selectedChain,
  })
  const { formattedValue: totalValue } = usePortfolioValue()

  // Get primary wallet address
  const primaryWallet = wallets?.find((w) => w.isDefault) || wallets?.[0]
  const address = primaryWallet?.address || ''

  // Copy address to clipboard
  const copyAddress = useCallback(async () => {
    if (address) {
      await navigator.clipboard.writeText(address)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    }
  }, [address])

  // Loading state
  if (walletsLoading) {
    return (
      <AppLayout header={<AppHeader title="Wallet" />} activeNav="wallet">
        <div className="flex items-center justify-center h-64">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-suwappu-magenta-mid" />
        </div>
      </AppLayout>
    )
  }

  // No wallet state
  if (!wallets || wallets.length === 0) {
    return (
      <AppLayout header={<AppHeader title="Wallet" />} activeNav="wallet">
        <div className="p-3 pb-20 space-y-4">
          <div className="bg-white rounded-suwappu-xl p-6 shadow-suwappu-1 text-center">
            <div className="text-4xl mb-3">👛</div>
            <h2 className="font-heading font-bold text-lg text-suwappu-purple-deep mb-2">
              No Wallet Connected
            </h2>
            <p className="text-sm text-suwappu-text-secondary mb-4">
              Connect your wallet to view balances and start swapping.
            </p>
          </div>
        </div>
      </AppLayout>
    )
  }

  // Receive view with QR code
  if (view === 'receive') {
    return (
      <AppLayout
        header={<AppHeader title="Receive" showBack onBack={() => setView('overview')} />}
        activeNav="wallet"
      >
        <div className="p-3 pb-20 space-y-4">
          <div className="bg-white rounded-suwappu-xl p-4 shadow-suwappu-1 text-center">
            <div className="w-48 h-48 mx-auto mb-4 p-3 bg-white rounded-lg shadow-inner">
              <QRCodeSVG
                value={address}
                size={168}
                level="M"
                bgColor="#FFFFFF"
                fgColor="#3D1E5C"
                includeMargin={false}
              />
            </div>
            <p className="font-mono text-xs text-suwappu-text break-all mb-4 px-2">
              {address}
            </p>
            <button
              onClick={copyAddress}
              className="px-4 py-2 bg-suwappu-sakura-light text-suwappu-magenta-mid font-heading font-semibold text-sm rounded-suwappu-pill transition-all active:scale-95"
            >
              {copied ? '✓ Copied!' : 'Copy Address'}
            </button>
          </div>

          <div className="bg-suwappu-info/10 border border-suwappu-info/20 rounded-suwappu-lg p-3">
            <p className="text-xs text-suwappu-info">
              Only send EVM-compatible tokens (ETH, USDC, etc.) to this address. Sending
              unsupported assets may result in permanent loss.
            </p>
          </div>

          {/* Chain badges */}
          <div className="flex flex-wrap gap-2 justify-center">
            {['Ethereum', 'Polygon', 'Arbitrum', 'Base', 'Optimism'].map((chain) => (
              <span
                key={chain}
                className="px-2 py-1 bg-suwappu-sakura-light/50 rounded-full text-xs font-medium text-suwappu-purple-deep"
              >
                {chain}
              </span>
            ))}
          </div>
        </div>
      </AppLayout>
    )
  }

  // Send view
  if (view === 'send') {
    const selectedToken = balances?.tokens?.[0]

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
              <span className="text-xs text-suwappu-text-secondary">
                Balance: {selectedToken?.balance || '0'} {selectedToken?.symbol || 'ETH'}
              </span>
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
                <span className="text-sm font-heading font-semibold">
                  {selectedToken?.symbol || 'ETH'}
                </span>
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M19 9l-7 7-7-7"
                  />
                </svg>
              </button>
            </div>
            <button
              onClick={() => setSendAmount(selectedToken?.balance || '0')}
              className="text-xs text-suwappu-magenta-mid font-medium mt-2"
            >
              Max
            </button>
          </div>

          <div className="bg-white rounded-suwappu-xl p-3 shadow-suwappu-1">
            <div className="flex items-center justify-between text-xs">
              <span className="text-suwappu-text-secondary">Network Fee</span>
              <span className="text-suwappu-text">~$2.50</span>
            </div>
          </div>

          <button className="w-full px-4 py-3 bg-suwappu-gradient text-white font-heading font-bold text-sm rounded-suwappu-pill shadow-suwappu-button transition-all active:scale-[0.98]">
            Review Transaction
          </button>
        </div>
      </AppLayout>
    )
  }

  // Overview view
  return (
    <AppLayout header={<AppHeader title="Wallet" />} activeNav="wallet">
      <div className="p-3 pb-20 space-y-4 overflow-hidden">
        {/* Total Value Card */}
        <div className="bg-suwappu-gradient rounded-suwappu-xl p-4 shadow-suwappu-2 text-white">
          <p className="text-sm opacity-80 mb-1">Total Balance</p>
          <p className="text-2xl font-heading font-bold">{totalValue}</p>
        </div>

        {/* Address Card */}
        <AddressCard address={address} label={primaryWallet?.name || 'My Wallet'} />

        {/* Chain Selector */}
        <ChainSelector chains={chains} selected={selectedChain} onSelect={setSelectedChain} />

        {/* Balances */}
        <div className="bg-white rounded-suwappu-xl shadow-suwappu-1 overflow-hidden">
          <div className="px-3 py-2 border-b border-suwappu-sakura-mid/10">
            <span className="font-heading font-semibold text-sm text-suwappu-purple-deep">
              Balances
            </span>
          </div>

          {balancesLoading ? (
            <div className="p-4 text-center">
              <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-suwappu-magenta-mid mx-auto" />
            </div>
          ) : balances?.tokens && balances.tokens.length > 0 ? (
            <div className="divide-y divide-suwappu-sakura-mid/10">
              {balances.tokens.map((token) => (
                <TokenItem
                  key={`${token.symbol}-${token.chains?.[0]?.chain || 'unknown'}`}
                  symbol={token.symbol}
                  name={token.name}
                  balance={token.balance}
                  value={`$${token.usdValue.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`}
                  icon={getTokenIcon(token.symbol)}
                />
              ))}
            </div>
          ) : (
            <div className="p-4 text-center text-sm text-suwappu-text-secondary">
              No tokens found
            </div>
          )}
        </div>

        {/* Action Buttons */}
        <div className="grid grid-cols-2 gap-3">
          <button
            onClick={() => setView('receive')}
            className="flex items-center justify-center gap-2 px-4 py-3 bg-suwappu-gradient text-white font-heading font-bold text-sm rounded-suwappu-pill shadow-suwappu-button transition-all active:scale-[0.98]"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M19 14l-7 7m0 0l-7-7m7 7V3"
              />
            </svg>
            Receive
          </button>
          <button
            onClick={() => setView('send')}
            className="flex items-center justify-center gap-2 px-4 py-3 bg-white text-suwappu-magenta-mid font-heading font-bold text-sm rounded-suwappu-pill border-2 border-suwappu-sakura-mid shadow-suwappu-1 transition-all active:scale-[0.98]"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M5 10l7-7m0 0l7 7m-7-7v18"
              />
            </svg>
            Send
          </button>
        </div>

        {/* Multiple Wallets Info */}
        {wallets && wallets.length > 1 && (
          <div className="bg-suwappu-sakura-light/50 rounded-suwappu-lg p-3">
            <p className="text-xs text-suwappu-text-secondary">
              Showing balances from {wallets.length} wallets
            </p>
          </div>
        )}
      </div>
    </AppLayout>
  )
}

// Helper to get token icon
function getTokenIcon(symbol: string): string {
  const icons: Record<string, string> = {
    ETH: 'Ξ',
    WETH: 'Ξ',
    POL: '⬡',
    MATIC: '⬡',
    BNB: '⬡',
    USDC: '$',
    USDT: '$',
    DAI: '◈',
    WBTC: '₿',
    PEPE: '🐸',
    SHIB: '🐕',
    LINK: '⬡',
    UNI: '🦄',
    AAVE: '👻',
  }
  return icons[symbol.toUpperCase()] || '●'
}
