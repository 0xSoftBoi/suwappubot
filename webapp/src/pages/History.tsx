import { useState, useMemo } from 'react'
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

const statusConfig: Record<string, { color: string; icon: string; bg: string }> = {
  completed: { color: 'text-green-600', icon: '✓', bg: 'bg-green-100' },
  pending: { color: 'text-yellow-600', icon: '⏳', bg: 'bg-yellow-100' },
  failed: { color: 'text-red-600', icon: '✕', bg: 'bg-red-100' },
  cancelled: { color: 'text-gray-500', icon: '○', bg: 'bg-gray-100' },
}

type DateRange = 'today' | 'week' | 'month' | 'all'
type StatusFilter = 'all' | 'completed' | 'pending' | 'failed'

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

function formatAmount(amount: string, decimals = 4): string {
  const num = parseFloat(amount)
  if (num === 0) return '0'
  if (num < 0.0001) return '<0.0001'
  return num.toLocaleString(undefined, { maximumFractionDigits: decimals })
}

function formatUsd(value: number | undefined): string {
  if (value == null) return '—'
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value)
}

function swapPnl(swap: Swap): number | null {
  if (swap.fromAmountUsd != null && swap.toAmountUsd != null) {
    return swap.toAmountUsd - swap.fromAmountUsd
  }
  return null
}

function isWithinRange(dateStr: string, range: DateRange): boolean {
  const date = new Date(dateStr)
  const now = new Date()
  if (range === 'all') return true
  if (range === 'today') {
    return date.toDateString() === now.toDateString()
  }
  if (range === 'week') {
    const weekAgo = new Date(now.getTime() - 7 * 86400000)
    return date >= weekAgo
  }
  if (range === 'month') {
    return date.getMonth() === now.getMonth() && date.getFullYear() === now.getFullYear()
  }
  return true
}

function exportCsv(swaps: Swap[]) {
  const headers = ['Date', 'From', 'To', 'From Chain', 'To Chain', 'From Amount', 'To Amount', 'From USD', 'To USD', 'PnL USD', 'Status', 'Tx Hash']
  const rows = swaps.map(s => {
    const pnl = swapPnl(s)
    return [
      new Date(s.createdAt).toISOString(),
      s.fromToken,
      s.toToken,
      s.fromChain,
      s.toChain,
      s.fromAmount,
      s.toAmount ?? '',
      s.fromAmountUsd ?? '',
      s.toAmountUsd ?? '',
      pnl != null ? pnl.toFixed(2) : '',
      s.status,
      s.txHash ?? '',
    ]
  })
  const csv = [headers, ...rows].map(r => r.join(',')).join('\n')
  const blob = new Blob([csv], { type: 'text/csv' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `suwappu-history-${new Date().toISOString().slice(0, 10)}.csv`
  a.click()
  URL.revokeObjectURL(url)
}

function SwapItem({ swap }: { swap: Swap }) {
  const status = statusConfig[swap.status] || statusConfig.pending
  const explorerUrl = explorerUrls[swap.fromChain.toLowerCase()]
  const txUrl = swap.txHash && explorerUrl ? `${explorerUrl}${swap.txHash}` : null
  const pnl = swapPnl(swap)

  return (
    <div className="p-3 hover:bg-suwappu-sakura-light/30 transition-colors">
      <div className="flex items-start justify-between gap-2">
        {/* Left: Swap details */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-0.5">
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
            {swap.fromChain}{swap.toChain !== swap.fromChain && ` → ${swap.toChain}`}
          </div>
          {/* USD value row */}
          {(swap.fromAmountUsd != null || swap.toAmountUsd != null) && (
            <div className="flex items-center gap-3 mt-0.5">
              <span className="text-[10px] text-suwappu-text-secondary">
                {formatUsd(swap.fromAmountUsd)} → {formatUsd(swap.toAmountUsd)}
              </span>
              {pnl != null && (
                <span className={`text-[10px] font-semibold ${pnl >= 0 ? 'text-green-600' : 'text-red-500'}`}>
                  {pnl >= 0 ? '+' : ''}{formatUsd(pnl)} PnL
                </span>
              )}
            </div>
          )}
        </div>

        {/* Right: Time and link */}
        <div className="text-right flex-shrink-0">
          <div className="text-xs text-suwappu-text-secondary">{formatRelativeTime(swap.createdAt)}</div>
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

      {swap.status === 'failed' && swap.errorMessage && (
        <div className="mt-2 text-xs text-red-600 bg-red-50 rounded-lg px-2 py-1">
          {swap.errorMessage}
        </div>
      )}
    </div>
  )
}

export function History() {
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all')
  const [dateRange, setDateRange] = useState<DateRange>('all')
  const { data: swaps, isLoading, error, refetch } = useSwapHistory(100)

  const filteredSwaps = useMemo(() => {
    return (swaps || []).filter(s => {
      const matchesStatus = statusFilter === 'all' || s.status === statusFilter
      const matchesDate = isWithinRange(s.createdAt, dateRange)
      return matchesStatus && matchesDate
    })
  }, [swaps, statusFilter, dateRange])

  const totalPnl = useMemo(() => {
    return filteredSwaps.reduce((acc, s) => {
      const p = swapPnl(s)
      return p != null ? acc + p : acc
    }, 0)
  }, [filteredSwaps])

  return (
    <AppLayout header={<AppHeader title="History" />} activeNav="history">
      <div className="p-3 pb-20 space-y-3">

        {/* Status filter */}
        <div className="flex gap-2 overflow-x-auto pb-1 hide-scrollbar">
          {(['all', 'completed', 'pending', 'failed'] as StatusFilter[]).map((f) => (
            <button
              key={f}
              onClick={() => setStatusFilter(f)}
              className={`px-3 py-1.5 rounded-full text-xs font-medium whitespace-nowrap transition-colors ${
                statusFilter === f
                  ? 'bg-suwappu-magenta-mid text-white'
                  : 'bg-white text-suwappu-text-secondary hover:bg-suwappu-sakura-light'
              }`}
            >
              {f.charAt(0).toUpperCase() + f.slice(1)}
            </button>
          ))}
        </div>

        {/* Date range filter */}
        <div className="flex gap-2 overflow-x-auto pb-1 hide-scrollbar">
          {(['today', 'week', 'month', 'all'] as DateRange[]).map((r) => {
            const label = r === 'today' ? 'Today' : r === 'week' ? 'This Week' : r === 'month' ? 'This Month' : 'All Time'
            return (
              <button
                key={r}
                onClick={() => setDateRange(r)}
                className={`px-3 py-1.5 rounded-full text-xs font-medium whitespace-nowrap transition-colors ${
                  dateRange === r
                    ? 'bg-suwappu-purple-deep text-white'
                    : 'bg-white text-suwappu-text-secondary hover:bg-suwappu-sakura-light'
                }`}
              >
                {label}
              </button>
            )
          })}
        </div>

        {/* Swap list */}
        <div className="bg-white rounded-suwappu-xl shadow-suwappu-1 overflow-hidden">
          <div className="flex items-center justify-between px-3 py-2 border-b border-suwappu-sakura-mid/10">
            <span className="font-heading font-semibold text-sm text-suwappu-purple-deep">
              Transactions
              {filteredSwaps.length > 0 && (
                <span className="ml-2 text-xs text-suwappu-text-secondary font-normal">({filteredSwaps.length})</span>
              )}
            </span>
            <div className="flex items-center gap-3">
              {filteredSwaps.length > 0 && (
                <button
                  onClick={() => exportCsv(filteredSwaps)}
                  className="text-xs text-suwappu-magenta-mid hover:underline"
                >
                  Export CSV
                </button>
              )}
              <button onClick={() => refetch()} className="text-xs text-suwappu-text-secondary hover:underline">
                Refresh
              </button>
            </div>
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
              <p className="text-sm text-suwappu-error">Failed to load history</p>
            </div>
          ) : filteredSwaps.length === 0 ? (
            <div className="p-6 text-center">
              <p className="font-heading font-semibold text-suwappu-purple-deep mb-1">
                {statusFilter === 'all' && dateRange === 'all' ? 'No swaps yet' : 'No matching swaps'}
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

        {/* Summary */}
        {swaps && swaps.length > 0 && (
          <div className="bg-white rounded-suwappu-xl p-3 shadow-suwappu-1">
            <h3 className="font-heading font-semibold text-sm text-suwappu-purple-deep mb-2">Summary</h3>
            <div className="grid grid-cols-4 gap-2 text-center">
              <div className="p-2 bg-suwappu-sakura-light/30 rounded-suwappu-lg">
                <p className="text-base font-heading font-bold text-suwappu-purple-deep">{filteredSwaps.length}</p>
                <p className="text-[10px] text-suwappu-text-secondary">Total</p>
              </div>
              <div className="p-2 bg-green-50 rounded-suwappu-lg">
                <p className="text-base font-heading font-bold text-green-600">
                  {filteredSwaps.filter(s => s.status === 'completed').length}
                </p>
                <p className="text-[10px] text-suwappu-text-secondary">Done</p>
              </div>
              <div className="p-2 bg-yellow-50 rounded-suwappu-lg">
                <p className="text-base font-heading font-bold text-yellow-600">
                  {filteredSwaps.filter(s => s.status === 'pending').length}
                </p>
                <p className="text-[10px] text-suwappu-text-secondary">Pending</p>
              </div>
              <div className={`p-2 rounded-suwappu-lg ${totalPnl >= 0 ? 'bg-green-50' : 'bg-red-50'}`}>
                <p className={`text-base font-heading font-bold truncate ${totalPnl >= 0 ? 'text-green-600' : 'text-red-500'}`}>
                  {formatUsd(totalPnl)}
                </p>
                <p className="text-[10px] text-suwappu-text-secondary">PnL</p>
              </div>
            </div>
          </div>
        )}
      </div>
    </AppLayout>
  )
}
