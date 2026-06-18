import React, { useMemo, useState } from 'react'
import { TokenPair } from './TokenPair'
import { ChainBadge } from './ChainBadge'

// --- Types ---

export interface SwapHistoryEntry {
  id: string
  fromToken: { symbol: string; logoUrl?: string }
  toToken: { symbol: string; logoUrl?: string }
  fromChain: string
  toChain: string
  fromAmount: number
  toAmount: number
  fromAmountUsd: number
  toAmountUsd: number
  status: 'completed' | 'pending' | 'failed' | 'cancelled'
  provider: string
  txHash?: string
  explorerUrl?: string
  pnl?: number
  pnlPercent?: number
  createdAt: string
  completedAt?: string
}

export type ChainFilter = 'all' | string
export type StatusFilter = 'all' | 'completed' | 'pending' | 'failed'

export interface SwapHistoryProps {
  entries: SwapHistoryEntry[]
  isLoading?: boolean
  chainFilter?: ChainFilter
  statusFilter?: StatusFilter
  onChainFilterChange?: (filter: ChainFilter) => void
  onStatusFilterChange?: (filter: StatusFilter) => void
  className?: string
}

// --- Helpers ---

const CHAIN_LABELS: Record<string, string> = {
  ethereum: 'ETH',
  arbitrum: 'ARB',
  optimism: 'OP',
  base: 'Base',
  polygon: 'MATIC',
  bsc: 'BNB',
  avalanche: 'AVAX',
  solana: 'SOL',
  fantom: 'FTM',
  linea: 'Linea',
  mantle: 'MNT',
  gnosis: 'xDAI',
  scroll: 'Scroll',
  sui: 'SUI',
  ton: 'TON',
  tempo: 'Tempo',
}

const STATUS_CONFIG = {
  completed: {
    label: 'Completed',
    bgClass: 'bg-tx-state-success/10',
    textClass: 'text-tx-state-success',
    animation: '',
  },
  pending: {
    label: 'Pending',
    bgClass: 'bg-tx-state-pending/10',
    textClass: 'text-tx-state-pending',
    animation: 'suwappu-pulse-pending',
  },
  failed: {
    label: 'Failed',
    bgClass: 'bg-tx-state-failed/10',
    textClass: 'text-tx-state-failed',
    animation: '',
  },
  cancelled: {
    label: 'Cancelled',
    bgClass: 'bg-tx-state-failed/10',
    textClass: 'text-tx-state-failed',
    animation: '',
  },
} as const

function formatRelativeTime(isoDate: string): string {
  const now = Date.now()
  const then = new Date(isoDate).getTime()
  const diffMs = now - then
  const diffSec = Math.floor(diffMs / 1000)
  const diffMin = Math.floor(diffSec / 60)
  const diffHour = Math.floor(diffMin / 60)
  const diffDay = Math.floor(diffHour / 24)

  if (diffMin < 1) return 'Just now'
  if (diffHour < 1) return `${diffMin}m ago`
  if (diffDay < 1) return `${diffHour}h ago`
  if (diffDay < 7) return `${diffDay}d ago`

  const d = new Date(isoDate)
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
  return `${months[d.getMonth()]} ${d.getDate()}`
}

function formatUsd(value: number): string {
  return value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

function formatTokenAmount(value: number): string {
  return parseFloat(value.toFixed(6)).toString()
}

function truncateHash(hash: string): string {
  if (hash.length <= 12) return hash
  return `${hash.slice(0, 6)}...${hash.slice(-4)}`
}

// --- Sub-components ---

function StatusBadge({ status }: { status: SwapHistoryEntry['status'] }) {
  const config = STATUS_CONFIG[status]
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-suwappu-pill px-2 py-0.5 text-xs font-medium ${config.bgClass} ${config.textClass} ${config.animation}`}
    >
      {config.label}
    </span>
  )
}

function PnlDisplay({ pnl, pnlPercent, size = 'md' }: { pnl?: number; pnlPercent?: number; size?: 'sm' | 'md' }) {
  if (pnl === undefined) return null

  const isPositive = pnl >= 0
  const colorClass = isPositive ? 'text-green-500' : 'text-red-500'
  const sizeClass = size === 'sm' ? 'text-xs' : 'text-sm'
  const sign = isPositive ? '+' : ''

  return (
    <span className={`inline-flex flex-col items-end ${colorClass}`}>
      <span className={`${sizeClass} font-semibold`}>
        {sign}${formatUsd(Math.abs(pnl))}
      </span>
      {pnlPercent !== undefined && (
        <span className="text-xs">
          {sign}{pnlPercent.toFixed(1)}%
        </span>
      )}
    </span>
  )
}

function ChainFilterPill({
  chainId,
  isSelected,
  onClick,
}: {
  chainId: 'all' | string
  isSelected: boolean
  onClick: () => void
}) {
  const selectedClass = isSelected
    ? 'bg-suwappu-magenta text-white shadow-suwappu-2'
    : 'bg-white shadow-suwappu-1 text-suwappu-text'

  return (
    <button
      type="button"
      onClick={onClick}
      className={`inline-flex items-center gap-1 rounded-suwappu-pill px-3 py-1.5 text-xs font-medium whitespace-nowrap transition-colors ${selectedClass}`}
    >
      {chainId === 'all' ? (
        'All'
      ) : (
        <>
          <ChainBadge chainId={chainId} size="sm" />
          <span>{CHAIN_LABELS[chainId] ?? chainId}</span>
        </>
      )}
    </button>
  )
}

function StatusFilterPill({
  status,
  isSelected,
  onClick,
}: {
  status: StatusFilter
  isSelected: boolean
  onClick: () => void
}) {
  const label = status === 'all' ? 'All' : status.charAt(0).toUpperCase() + status.slice(1)
  const selectedClass = isSelected
    ? 'bg-suwappu-magenta text-white shadow-suwappu-2'
    : 'bg-white shadow-suwappu-1 text-suwappu-text'

  return (
    <button
      type="button"
      onClick={onClick}
      className={`inline-flex items-center rounded-suwappu-pill px-3 py-1.5 text-xs font-medium whitespace-nowrap transition-colors ${selectedClass}`}
    >
      {label}
    </button>
  )
}

function ExpandedDetails({ entry }: { entry: SwapHistoryEntry }) {
  const [copied, setCopied] = useState(false)

  const handleCopy = () => {
    if (entry.txHash) {
      navigator.clipboard.writeText(entry.txHash).then(() => {
        setCopied(true)
        setTimeout(() => setCopied(false), 2000)
      })
    }
  }

  const timeDiff =
    entry.completedAt && entry.createdAt
      ? Math.round((new Date(entry.completedAt).getTime() - new Date(entry.createdAt).getTime()) / 1000)
      : null

  return (
    <div className="mt-3 pt-3 border-t border-suwappu-sakura-100/30 space-y-2 text-xs text-suwappu-text-secondary">
      {entry.txHash && (
        <div className="flex items-center justify-between">
          <span className="font-medium text-suwappu-text">Transaction:</span>
          <span className="inline-flex items-center gap-1.5">
            <code className="bg-suwappu-sakura-50 px-1.5 py-0.5 rounded font-mono text-[11px]">
              {truncateHash(entry.txHash)}
            </code>
            <button
              type="button"
              onClick={handleCopy}
              className="text-suwappu-magenta hover:text-suwappu-magenta/80 transition-colors text-[11px] font-medium"
            >
              {copied ? 'Copied!' : 'Copy'}
            </button>
            {entry.explorerUrl && (
              <a
                href={entry.explorerUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="text-suwappu-magenta hover:text-suwappu-magenta/80 transition-colors text-[11px] font-medium"
              >
                Explorer
              </a>
            )}
          </span>
        </div>
      )}
      <div className="flex items-center justify-between">
        <span className="font-medium text-suwappu-text">Provider:</span>
        <span>{entry.provider}</span>
      </div>
      {timeDiff !== null && (
        <div className="flex items-center justify-between">
          <span className="font-medium text-suwappu-text">Time:</span>
          <span>{timeDiff}s (submit to confirm)</span>
        </div>
      )}
    </div>
  )
}

function HistoryEntryCard({
  entry,
  isExpanded,
  onToggle,
  animationDelay,
}: {
  entry: SwapHistoryEntry
  isExpanded: boolean
  onToggle: () => void
  animationDelay: number
}) {
  return (
    <div
      className="rounded-suwappu-lg shadow-suwappu-1 bg-white p-4 transition-all"
      style={{ animationDelay: `${animationDelay}ms` }}
    >
      {/* Top row: TokenPair + PnL */}
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <TokenPair
            fromToken={entry.fromToken}
            toToken={entry.toToken}
            fromChain={entry.fromChain}
            toChain={entry.toChain}
            size="sm"
          />
          <span className="text-sm font-heading font-semibold text-suwappu-text truncate">
            {entry.fromToken.symbol} &rarr; {entry.toToken.symbol}
          </span>
        </div>
        <PnlDisplay pnl={entry.pnl} pnlPercent={entry.pnlPercent} />
      </div>

      {/* Middle row: Chain + provider */}
      <div className="mt-2 flex items-center gap-2 text-xs text-suwappu-text-secondary">
        <ChainBadge chainId={entry.fromChain} size="sm" showLabel />
        <span>via {entry.provider}</span>
      </div>

      {/* Amount row */}
      <div className="mt-1 text-xs text-suwappu-text-secondary font-body">
        {formatTokenAmount(entry.fromAmount)} {entry.fromToken.symbol} (${formatUsd(entry.fromAmountUsd)})
        {' \u2192 '}
        {formatTokenAmount(entry.toAmount)} {entry.toToken.symbol}
        <span className="ml-4">{formatRelativeTime(entry.createdAt)}</span>
      </div>

      {/* Bottom row: Status + expand */}
      <div className="mt-2 flex items-center justify-between">
        <StatusBadge status={entry.status} />
        <button
          type="button"
          onClick={onToggle}
          className="text-xs text-suwappu-text-secondary hover:text-suwappu-text transition-colors font-medium"
        >
          {isExpanded ? 'Collapse \u25B2' : 'Expand \u25BC'}
        </button>
      </div>

      {/* Expanded details */}
      {isExpanded && <ExpandedDetails entry={entry} />}
    </div>
  )
}

function SkeletonCard() {
  return (
    <div className="rounded-suwappu-lg shadow-suwappu-1 bg-white p-4 space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="suwappu-quote-shimmer inline-block w-5 h-5 rounded-suwappu-pill bg-suwappu-sakura-200/30" />
          <span className="suwappu-quote-shimmer inline-block w-5 h-5 rounded-suwappu-pill bg-suwappu-sakura-200/30" />
          <span className="suwappu-quote-shimmer inline-block w-24 h-4 rounded bg-suwappu-sakura-200/30" />
        </div>
        <span className="suwappu-quote-shimmer inline-block w-16 h-4 rounded bg-suwappu-sakura-200/30" />
      </div>
      <div className="flex items-center gap-2">
        <span className="suwappu-quote-shimmer inline-block w-3 h-3 rounded-suwappu-pill bg-suwappu-sakura-200/30" />
        <span className="suwappu-quote-shimmer inline-block w-32 h-3 rounded bg-suwappu-sakura-200/30" />
      </div>
      <div className="flex items-center justify-between">
        <span className="suwappu-quote-shimmer inline-block w-40 h-3 rounded bg-suwappu-sakura-200/30" />
        <span className="suwappu-quote-shimmer inline-block w-12 h-3 rounded bg-suwappu-sakura-200/30" />
      </div>
    </div>
  )
}

// --- Main Component ---

export const SwapHistory = React.memo(function SwapHistory({
  entries,
  isLoading = false,
  chainFilter = 'all',
  statusFilter = 'all',
  onChainFilterChange,
  onStatusFilterChange,
  className = '',
}: SwapHistoryProps) {
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set())

  const toggleExpanded = (id: string) => {
    setExpandedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) {
        next.delete(id)
      } else {
        next.add(id)
      }
      return next
    })
  }

  // Unique chains from all entries (for filter pills)
  const uniqueChains = useMemo(() => {
    const chains = new Set<string>()
    entries.forEach((e) => {
      chains.add(e.fromChain)
      chains.add(e.toChain)
    })
    return Array.from(chains)
  }, [entries])

  // Filtered entries
  const filteredEntries = useMemo(() => {
    return entries.filter((e) => {
      if (chainFilter !== 'all' && e.fromChain !== chainFilter && e.toChain !== chainFilter) {
        return false
      }
      if (statusFilter !== 'all' && e.status !== statusFilter) {
        return false
      }
      return true
    })
  }, [entries, chainFilter, statusFilter])

  // Summary stats from filtered entries
  const summary = useMemo(() => {
    const count = filteredEntries.length
    const volume = filteredEntries.reduce((acc, e) => acc + e.fromAmountUsd, 0)
    const totalPnl = filteredEntries.reduce((acc, e) => acc + (e.pnl ?? 0), 0)
    const pnlPercent = volume > 0 ? (totalPnl / volume) * 100 : 0
    return { count, volume, totalPnl, pnlPercent }
  }, [filteredEntries])

  const handleClearFilters = () => {
    onChainFilterChange?.('all')
    onStatusFilterChange?.('all')
  }

  // Loading state
  if (isLoading) {
    return (
      <div className={`space-y-4 ${className}`}>
        <div className="flex gap-2 overflow-x-auto pb-2">
          {[1, 2, 3, 4].map((i) => (
            <span key={i} className="suwappu-quote-shimmer inline-block w-16 h-8 rounded-suwappu-pill bg-suwappu-sakura-200/30 shrink-0" />
          ))}
        </div>
        <div className="space-y-3">
          {[1, 2, 3].map((i) => (
            <SkeletonCard key={i} />
          ))}
        </div>
      </div>
    )
  }

  // Empty state: no entries at all
  if (entries.length === 0) {
    return (
      <div className={`flex flex-col items-center justify-center py-16 text-center ${className}`}>
        <div className="w-16 h-16 rounded-suwappu-pill bg-suwappu-sakura-100/50 flex items-center justify-center mb-4">
          <svg
            className="w-8 h-8 text-suwappu-text-secondary/60"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={1.5}
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M7.5 21L3 16.5m0 0L7.5 12M3 16.5h13.5m0-13.5L21 7.5m0 0L16.5 12M21 7.5H7.5"
            />
          </svg>
        </div>
        <p className="text-sm font-heading font-semibold text-suwappu-text">No swaps yet</p>
        <p className="text-xs text-suwappu-text-secondary mt-1">Make your first trade!</p>
      </div>
    )
  }

  return (
    <div className={`space-y-4 ${className}`}>
      {/* Filter Bar */}
      <div className="sticky top-0 z-10 bg-suwappu-sakura-50/95 backdrop-blur-sm pb-3 space-y-2">
        {/* Chain filters */}
        <div className="flex items-center gap-2">
          <span className="text-xs font-medium text-suwappu-text-secondary shrink-0">Chain:</span>
          <div className="flex gap-1.5 overflow-x-auto pb-1 scrollbar-hide">
            <ChainFilterPill
              chainId="all"
              isSelected={chainFilter === 'all'}
              onClick={() => onChainFilterChange?.('all')}
            />
            {uniqueChains.map((chain) => (
              <ChainFilterPill
                key={chain}
                chainId={chain}
                isSelected={chainFilter === chain}
                onClick={() => onChainFilterChange?.(chain)}
              />
            ))}
          </div>
        </div>

        {/* Status filters */}
        <div className="flex items-center gap-2">
          <span className="text-xs font-medium text-suwappu-text-secondary shrink-0">Status:</span>
          <div className="flex gap-1.5">
            {(['all', 'completed', 'pending', 'failed'] as StatusFilter[]).map((status) => (
              <StatusFilterPill
                key={status}
                status={status}
                isSelected={statusFilter === status}
                onClick={() => onStatusFilterChange?.(status)}
              />
            ))}
          </div>
        </div>
      </div>

      {/* Summary Stats */}
      <div className="text-xs font-body text-suwappu-text-secondary flex items-center gap-1.5 flex-wrap">
        <span className="font-semibold text-suwappu-text">{summary.count} swaps</span>
        <span className="text-gray-300">|</span>
        <span>${formatUsd(summary.volume)} volume</span>
        <span className="text-gray-300">|</span>
        <span className={summary.totalPnl >= 0 ? 'text-green-500 font-semibold' : 'text-red-500 font-semibold'}>
          {summary.totalPnl >= 0 ? '+' : ''}${formatUsd(Math.abs(summary.totalPnl))} PnL (
          {summary.pnlPercent >= 0 ? '+' : ''}
          {summary.pnlPercent.toFixed(1)}%)
        </span>
      </div>

      {/* Empty filter state */}
      {filteredEntries.length === 0 && (
        <div className="flex flex-col items-center justify-center py-12 text-center">
          <p className="text-sm font-heading text-suwappu-text">No swaps match your filters</p>
          <button
            type="button"
            onClick={handleClearFilters}
            className="mt-2 text-xs font-medium text-suwappu-magenta hover:text-suwappu-magenta/80 transition-colors"
          >
            Clear filters
          </button>
        </div>
      )}

      {/* Entry list */}
      <div className="space-y-3">
        {filteredEntries.map((entry, index) => (
          <HistoryEntryCard
            key={entry.id}
            entry={entry}
            isExpanded={expandedIds.has(entry.id)}
            onToggle={() => toggleExpanded(entry.id)}
            animationDelay={index * 50}
          />
        ))}
      </div>
    </div>
  )
})
