import { useState } from 'react'
import { AppLayout, AppHeader } from '../components/layout'
import { useSwapHistory } from '../hooks/useSwapHistory'
import type { Swap } from '../types/api'

// Chain explorer URLs
const explorerUrls: Record<string, string> = {
  ethereum: 'https://etherscan.io/tx/',
  eth: 'https://etherscan.io/tx/',
  solana: 'https://solscan.io/tx/',
  sol: 'https://solscan.io/tx/',
  polygon: 'https://polygonscan.com/tx/',
  matic: 'https://polygonscan.com/tx/',
  arbitrum: 'https://arbiscan.io/tx/',
  optimism: 'https://optimistic.etherscan.io/tx/',
  base: 'https://basescan.org/tx/',
  bsc: 'https://bscscan.com/tx/',
  tempo: 'https://explore.tempo.xyz/tx/',
}

// Status colors and icons
const statusConfig: Record<string, { color: string; icon: string; bg: string }> = {
  completed: { color: 'text-green-600', icon: '✓', bg: 'bg-green-100' },
  pending: { color: 'text-yellow-600', icon: '⏳', bg: 'bg-yellow-100' },
  failed: { color: 'text-red-600', icon: '✕', bg: 'bg-red-100' },
  cancelled: { color: 'text-gray-500', icon: '○', bg: 'bg-gray-100' },
}

// Format relative time
function formatRelativeTime(dateStr: string): string {
  const date = new Date(dateStr)
  const now = new Date()
  const diffMs = now.getTime() - date.getTime()
  const diffMins = Math.floor(diffMs / 60000)
  const diffHours = Math.floor(diffMs / 3600000)
  const diffDays = Math.floor(diffMs / 86400000)

  if (diffMins < 1) return 'Just now'
  if (diffMins < 60) return `${diffMins}m ago`
  if (diffHours < 24) return `${diffHours}h ago`
  if (diffDays < 7) return `${diffDays}d ago`
  return date.toLocaleDateString()
}

// Format amount with symbol
function formatAmount(amount: string, decimals = 4): string {
  const num = parseFloat(amount)
  if (num === 0) return '0'
  if (num < 0.0001) return '<0.0001'
  return num.toLocaleString(undefined, { maximumFractionDigits: decimals })
}

function SwapItem({ swap }: { swap: Swap }) {
  const status = statusConfig[swap.status] || statusConfig.pending
  const explorerUrl = explorerUrls[swap.fromChain.toLowerCase()]
  const txUrl = swap.txHash && explorerUrl ? `${explorerUrl}${swap.txHash}` : null

  return (
    <div className="p-3 hover:bg-suwappu-sakura-light/30 transition-colors">
      <div className="flex items-start justify-between gap-3">
        {/* Left: Swap details */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <span className="font-heading font-semibold text-sm text-suwappu-purple-deep">
              {swap.fromToken} → {swap.toToken}
            </span>
            <span className={`text-xs px-1.5 py-0.5 rounded-full ${status.bg} ${status.color}`}>
              {status.icon} {swap.status}
            </span>
          </div>
          <div className="text-xs text-suwappu-text-secondary">
            {formatAmount(swap.fromAmount)} {swap.fromToken}
            {swap.toAmount && (
              <span className="text-suwappu-success"> → {formatAmount(swap.toAmount)} {swap.toToken}</span>
            )}
          </div>
          <div className="text-[10px] text-suwappu-text-secondary/60 mt-0.5">
            {swap.fromChain}
            {swap.toChain !== swap.fromChain && ` → ${swap.toChain}`}
          </div>
        </div>

        {/* Right: Time and link */}
        <div className="text-right flex-shrink-0">
          <div className="text-xs text-suwappu-text-secondary">
            {formatRelativeTime(swap.createdAt)}
          </div>
          {txUrl && (
            <a
              href={txUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="text-[10px] text-suwappu-magenta-mid hover:underline"
            >
              View tx ↗
            </a>
          )}
        </div>
      </div>

      {/* Error message if failed */}
      {swap.status === 'failed' && swap.errorMessage && (
        <div className="mt-2 text-xs text-red-600 bg-red-50 rounded-lg px-2 py-1">
          {swap.errorMessage}
        </div>
      )}
    </div>
  )
}

export function History() {
  const [filter, setFilter] = useState<'all' | 'completed' | 'pending' | 'failed'>('all')
  const { data: swaps, isLoading, error, refetch } = useSwapHistory(50)

  const filteredSwaps = swaps?.filter(s => filter === 'all' || s.status === filter) || []

  return (
    <AppLayout header={<AppHeader title="History" />} activeNav="history">
      <div className="p-3 pb-20 space-y-4">
        {/* Filter tabs */}
        <div className="flex gap-2 overflow-x-auto pb-1">
          {(['all', 'completed', 'pending', 'failed'] as const).map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`px-3 py-1.5 rounded-full text-xs font-medium whitespace-nowrap transition-colors ${
                filter === f
                  ? 'bg-suwappu-magenta-mid text-white'
                  : 'bg-white text-suwappu-text-secondary hover:bg-suwappu-sakura-light'
              }`}
            >
              {f.charAt(0).toUpperCase() + f.slice(1)}
            </button>
          ))}
        </div>

        {/* Swap list */}
        <div className="bg-white rounded-suwappu-xl shadow-suwappu-1 overflow-hidden">
          <div className="flex items-center justify-between px-3 py-2 border-b border-suwappu-sakura-mid/10">
            <span className="font-heading font-semibold text-sm text-suwappu-purple-deep">
              Transactions
            </span>
            <button
              onClick={() => refetch()}
              className="text-xs text-suwappu-magenta-mid hover:underline"
            >
              Refresh
            </button>
          </div>

          {isLoading ? (
            <div className="p-6 text-center">
              <div className="animate-pulse flex flex-col items-center">
                <div className="w-10 h-10 bg-suwappu-sakura-light rounded-full mb-2" />
                <div className="h-3 bg-suwappu-sakura-light rounded w-24" />
              </div>
            </div>
          ) : error ? (
            <div className="p-6 text-center">
              <div className="w-12 h-12 mx-auto mb-2 bg-suwappu-error/10 rounded-full flex items-center justify-center">
                <span className="text-xl">⚠️</span>
              </div>
              <p className="text-sm text-suwappu-error">Failed to load history</p>
            </div>
          ) : filteredSwaps.length === 0 ? (
            <div className="p-6 text-center">
              <div className="w-16 h-16 mx-auto mb-3 bg-suwappu-sakura-light rounded-full flex items-center justify-center">
                <span className="text-3xl">📜</span>
              </div>
              <p className="font-heading font-semibold text-suwappu-purple-deep mb-1">
                {filter === 'all' ? 'No swaps yet' : `No ${filter} swaps`}
              </p>
              <p className="text-xs text-suwappu-text-secondary">
                Your swap history will appear here
              </p>
            </div>
          ) : (
            <div className="divide-y divide-suwappu-sakura-mid/10">
              {filteredSwaps.map((swap) => (
                <SwapItem key={swap.id} swap={swap} />
              ))}
            </div>
          )}
        </div>

        {/* Stats summary */}
        {swaps && swaps.length > 0 && (
          <div className="bg-white rounded-suwappu-xl p-3 shadow-suwappu-1">
            <h3 className="font-heading font-semibold text-sm text-suwappu-purple-deep mb-2">
              Summary
            </h3>
            <div className="grid grid-cols-3 gap-2 text-center">
              <div className="p-2 bg-suwappu-sakura-light/30 rounded-suwappu-lg">
                <p className="text-lg font-heading font-bold text-suwappu-purple-deep">
                  {swaps.length}
                </p>
                <p className="text-[10px] text-suwappu-text-secondary">Total</p>
              </div>
              <div className="p-2 bg-green-50 rounded-suwappu-lg">
                <p className="text-lg font-heading font-bold text-green-600">
                  {swaps.filter(s => s.status === 'completed').length}
                </p>
                <p className="text-[10px] text-suwappu-text-secondary">Completed</p>
              </div>
              <div className="p-2 bg-yellow-50 rounded-suwappu-lg">
                <p className="text-lg font-heading font-bold text-yellow-600">
                  {swaps.filter(s => s.status === 'pending').length}
                </p>
                <p className="text-[10px] text-suwappu-text-secondary">Pending</p>
              </div>
            </div>
          </div>
        )}
      </div>
    </AppLayout>
  )
}
