import { useState } from 'react'
import { useWalletTracker } from '../../hooks/useWalletTracker'
import { AddWalletForm } from './AddWalletForm'
import { WalletActivityFeed } from './WalletActivityFeed'
import { WalletProfileCard } from './WalletProfileCard'

// NOTE: /webapp/wallet-tracker/* endpoints do not exist in api-ts. All add/remove/
// activity calls 404. Gate panel as coming soon until backend routes are built.
// Remove COMING_SOON when that work is done.
const COMING_SOON = true

function truncateAddress(address: string): string {
  return `${address.slice(0, 6)}...${address.slice(-4)}`
}

function formatPnl(value: number): string {
  const prefix = value >= 0 ? '+' : ''
  if (Math.abs(value) >= 1_000) return `${prefix}$${(value / 1_000).toFixed(1)}K`
  return `${prefix}$${value.toFixed(0)}`
}

export function WalletTrackerPanel() {
  const { wallets, activities, addWallet, removeWallet, getStats, statsMap, isLoading, error } = useWalletTracker()
  const [selectedAddress, setSelectedAddress] = useState<string | null>(null)
  const [copiedAddress, setCopiedAddress] = useState<string | null>(null)

  const selectedWallet = wallets.find(w => w.address === selectedAddress)

  const copyAddress = (address: string, e: React.MouseEvent) => {
    e.stopPropagation()
    navigator.clipboard.writeText(address)
    setCopiedAddress(address)
    setTimeout(() => setCopiedAddress(null), 1500)
  }

  // Profile view
  if (selectedWallet) {
    const stats = getStats(selectedWallet.address)
    const walletTrades = activities.filter(a => a.walletAddress === selectedWallet.address)

    return (
      <div className="h-full overflow-y-auto">
        <WalletProfileCard
          wallet={selectedWallet}
          stats={stats}
          recentTrades={walletTrades}
          onRemove={(addr) => {
            removeWallet(addr)
            setSelectedAddress(null)
          }}
          onBack={() => setSelectedAddress(null)}
        />
      </div>
    )
  }

  if (COMING_SOON) {
    return (
      <div className="h-full flex flex-col p-4 gap-3" data-testid="wallet-tracker">
        <h3 className="text-sm font-semibold">Wallet Tracker</h3>
        <div className="rounded-lg border border-terminal-border bg-terminal-bg px-3 py-3 text-sm text-terminal-text-muted">
          <span className="font-semibold text-terminal-text">Coming soon</span> — Wallet tracking is not yet available.
          The backend endpoint is under development.
        </div>
      </div>
    )
  }

  return (
    <div className="h-full flex flex-col" data-testid="wallet-tracker">
      {/* Add wallet form */}
      <div className="px-3 py-2 border-b border-terminal-border shrink-0 space-y-2">
        <AddWalletForm onAdd={addWallet} />
        <div className="text-xs text-terminal-text-muted">
          Tracked wallet persistence is connected. Live wallet activity indexing is not connected yet.
        </div>
        {error && (
          <div className="text-xs text-bear" data-testid="wallet-tracker-error">
            {error instanceof Error ? error.message : 'Wallet tracker request failed.'}
          </div>
        )}
        {isLoading && (
          <div className="text-xs text-terminal-text-muted" data-testid="wallet-tracker-loading">
            Loading tracked wallets...
          </div>
        )}
      </div>

      <div className="flex-1 flex overflow-hidden">
        {/* Tracked wallets list (left side) */}
        <div className="w-72 border-r border-terminal-border flex flex-col shrink-0">
          <div className="px-3 py-1.5 text-xs font-medium text-terminal-text-muted border-b border-terminal-border flex items-center justify-between">
            <span>Tracked Wallets</span>
            <span className="text-[10px] bg-terminal-bg rounded px-1.5 py-0.5">{wallets.length}</span>
          </div>
          <div className="flex-1 overflow-y-auto" data-testid="tracked-wallets-list">
            {wallets.length === 0 ? (
              <div className="text-center text-terminal-text-muted text-xs py-6 px-3">
                No tracked wallets yet.
              </div>
            ) : (
              wallets.map(wallet => {
                const stats = statsMap[wallet.address]
                return (
                  <div
                    key={wallet.address}
                    onClick={() => setSelectedAddress(wallet.address)}
                    className="px-3 py-2 border-b border-terminal-border hover:bg-terminal-bg-secondary cursor-pointer transition-colors"
                    data-testid="tracked-wallet-item"
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-1.5 min-w-0">
                        {/* Active dot */}
                        <span className="w-1.5 h-1.5 rounded-full bg-terminal-text-muted shrink-0" />
                        <span className="text-xs font-medium truncate">
                          {wallet.label || truncateAddress(wallet.address)}
                        </span>
                      </div>
                      <button
                        onClick={(e) => copyAddress(wallet.address, e)}
                        className="text-terminal-text-muted hover:text-terminal-text transition-colors shrink-0 ml-1"
                        title="Copy address"
                      >
                        {copiedAddress === wallet.address ? (
                          <svg className="w-3 h-3 text-green-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                          </svg>
                        ) : (
                          <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                          </svg>
                        )}
                      </button>
                    </div>
                    <div className="flex items-center gap-2 mt-1">
                      <span className="text-[10px] font-mono text-terminal-text-muted">
                        {truncateAddress(wallet.address)}
                      </span>
                      {stats && (
                        <>
                          <span className={`text-[10px] font-mono font-semibold ${stats.pnl7d >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                            {formatPnl(stats.pnl7d)}
                          </span>
                          <span className="text-[10px] text-terminal-text-muted">
                            {stats.winRate}% WR
                          </span>
                        </>
                      )}
                    </div>
                  </div>
                )
              })
            )}
          </div>
        </div>

        {/* Activity feed (right side) */}
        <div className="flex-1 flex flex-col min-w-0">
          <div className="px-3 py-1.5 text-xs font-medium text-terminal-text-muted border-b border-terminal-border flex items-center justify-between">
            <span>Activity Feed</span>
            <span className="text-[10px] bg-terminal-bg rounded px-1.5 py-0.5">{activities.length} trades</span>
          </div>
          {wallets.length > 0 && activities.length === 0 && (
            <div className="px-3 py-2 text-xs text-terminal-text-muted border-b border-terminal-border">
              Live wallet activity indexing is not connected yet.
            </div>
          )}
          <div className="flex-1 overflow-hidden">
            <WalletActivityFeed activities={activities} />
          </div>
        </div>
      </div>
    </div>
  )
}
