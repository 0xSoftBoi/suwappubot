import { useState } from 'react'
import type { TrackedWallet, WalletStats, WalletActivity } from '../../types/api'

interface WalletProfileCardProps {
  wallet: TrackedWallet
  stats?: WalletStats
  recentTrades: WalletActivity[]
  onRemove: (address: string) => void
  onBack: () => void
}

function formatUsd(value: number): string {
  if (Math.abs(value) >= 1_000_000) return `$${(value / 1_000_000).toFixed(2)}M`
  if (Math.abs(value) >= 1_000) return `$${(value / 1_000).toFixed(1)}K`
  return `$${value.toFixed(2)}`
}

function formatPnl(value: number): string {
  const prefix = value >= 0 ? '+' : ''
  return `${prefix}${formatUsd(value)}`
}

function timeAgo(timestamp: string): string {
  const seconds = Math.floor((Date.now() - new Date(timestamp).getTime()) / 1000)
  if (seconds < 60) return `${seconds}s ago`
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  return `${Math.floor(hours / 24)}d ago`
}

export function WalletProfileCard({ wallet, stats, recentTrades, onRemove, onBack }: WalletProfileCardProps) {
  const [copied, setCopied] = useState(false)

  const copyAddress = () => {
    navigator.clipboard.writeText(wallet.address)
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  return (
    <div className="p-3 space-y-3" data-testid="wallet-profile">
      {/* Back button */}
      <button
        onClick={onBack}
        className="text-xs text-terminal-text-muted hover:text-terminal-text flex items-center gap-1"
      >
        <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
        </svg>
        Back to wallets
      </button>

      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-sm font-semibold">
            {wallet.label || 'Unnamed Wallet'}
          </h3>
          <div className="flex items-center gap-1.5 mt-0.5">
            <span className="text-xs font-mono text-terminal-text-muted">
              {wallet.address.slice(0, 8)}...{wallet.address.slice(-6)}
            </span>
            <button
              onClick={copyAddress}
              className="text-terminal-text-muted hover:text-terminal-text transition-colors"
              title="Copy address"
            >
              {copied ? (
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
        </div>
        <button
          onClick={() => onRemove(wallet.address)}
          className="terminal-button-secondary text-xs px-2 py-1 text-red-400 hover:text-red-300"
        >
          Remove
        </button>
      </div>

      {/* Stats grid */}
      {stats && (
        <div className="grid grid-cols-4 gap-2">
          <div className="bg-terminal-bg rounded p-2">
            <div className="text-[10px] text-terminal-text-muted uppercase tracking-wider">7d PnL</div>
            <div className={`text-sm font-semibold font-mono ${stats.pnl7d >= 0 ? 'text-green-400' : 'text-red-400'}`}>
              {formatPnl(stats.pnl7d)}
            </div>
          </div>
          <div className="bg-terminal-bg rounded p-2">
            <div className="text-[10px] text-terminal-text-muted uppercase tracking-wider">30d PnL</div>
            <div className={`text-sm font-semibold font-mono ${stats.pnl30d >= 0 ? 'text-green-400' : 'text-red-400'}`}>
              {formatPnl(stats.pnl30d)}
            </div>
          </div>
          <div className="bg-terminal-bg rounded p-2">
            <div className="text-[10px] text-terminal-text-muted uppercase tracking-wider">Win Rate</div>
            <div className="text-sm font-semibold font-mono">{stats.winRate}%</div>
          </div>
          <div className="bg-terminal-bg rounded p-2">
            <div className="text-[10px] text-terminal-text-muted uppercase tracking-wider">Trades</div>
            <div className="text-sm font-semibold font-mono">{stats.totalTrades}</div>
          </div>
        </div>
      )}

      {/* Top Holdings */}
      {stats && stats.topHoldings.length > 0 && (
        <div>
          <h4 className="text-xs font-medium text-terminal-text-muted mb-1.5">Top Holdings</h4>
          <div className="flex flex-wrap gap-1.5">
            {stats.topHoldings.map((h, i) => (
              <span key={i} className="bg-terminal-bg rounded px-2 py-1 text-xs font-mono">
                {h.symbol} <span className="text-terminal-text-muted">{formatUsd(h.valueUsd)}</span>
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Recent Trades */}
      <div>
        <h4 className="text-xs font-medium text-terminal-text-muted mb-1.5">Recent Trades</h4>
        {recentTrades.length === 0 ? (
          <div className="text-xs text-terminal-text-muted py-2">No trades yet</div>
        ) : (
          <div className="space-y-1 max-h-40 overflow-y-auto">
            {recentTrades.slice(0, 10).map(trade => (
              <div key={trade.id} className="flex items-center justify-between text-xs bg-terminal-bg rounded px-2 py-1.5">
                <div className="flex items-center gap-2">
                  <span className={`font-semibold ${trade.action === 'buy' ? 'text-green-400' : 'text-red-400'}`}>
                    {trade.action.toUpperCase()}
                  </span>
                  <span className="font-medium">{trade.tokenSymbol}</span>
                </div>
                <div className="flex items-center gap-3">
                  <span className="font-mono">{formatUsd(trade.amount)}</span>
                  <span className="text-terminal-text-muted">{timeAgo(trade.timestamp)}</span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
