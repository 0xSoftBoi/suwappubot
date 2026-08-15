import { useEffect, useState, useCallback, useRef } from 'react'
import { useQuery } from '@tanstack/react-query'
import { api } from '../../lib/api'
import { useSnipe } from '../../hooks/useSnipe'
import type { LaunchToken } from '../../types/snipe'

const isDesktop = !!(
  typeof window !== 'undefined' &&
  (window as any).__SUWAPPU_DESKTOP__?.isDesktop
)

function getSafetyColor(score: number): string {
  if (score >= 80) return 'text-green-400'
  if (score >= 50) return 'text-yellow-400'
  return 'text-red-400'
}

function getBondingCurveColor(percent: number): string {
  if (percent >= 90) return 'bg-red-400'
  if (percent >= 60) return 'bg-yellow-400'
  return 'bg-green-400'
}

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime()
  const seconds = Math.floor(diff / 1000)
  if (seconds < 60) return `${seconds}s`
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m`
  return `${Math.floor(minutes / 60)}h`
}

function formatMarketCap(mc: number): string {
  if (mc >= 1_000_000) return `$${(mc / 1_000_000).toFixed(1)}M`
  if (mc >= 1_000) return `$${(mc / 1_000).toFixed(1)}K`
  return `$${mc.toFixed(0)}`
}

const SNIPE_PRESETS: { label: string; amount: string }[] = [
  { label: '0.1', amount: '0.1' },
  { label: '0.5', amount: '0.5' },
  { label: '1.0', amount: '1.0' },
]

function nativeSymbol(chain: string): string {
  const lower = chain.toLowerCase()
  if (lower === 'sol' || lower === 'solana') return 'SOL'
  if (lower === 'tempo') return 'USD'
  return 'ETH'
}

interface SnipeDropdownProps {
  token: LaunchToken
  onClose: () => void
}

function SnipeDropdown({ token, onClose }: SnipeDropdownProps) {
  const { snipe, isLoading } = useSnipe()
  const ref = useRef<HTMLDivElement>(null)

  // Close on click outside
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        onClose()
      }
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [onClose])

  const symbol = nativeSymbol(token.chain)

  return (
    <div
      ref={ref}
      className="absolute bottom-full left-0 right-0 mb-1 bg-white rounded-lg shadow-lg border border-suwappu-sakura-mid/20 overflow-hidden z-10"
    >
      <div className="px-2 py-1.5 text-[10px] text-suwappu-text-muted border-b border-suwappu-sakura-mid/10">
        Snipe with {symbol}
      </div>
      <div className="flex gap-1 p-1.5">
        {SNIPE_PRESETS.map((preset) => (
          <button
            key={preset.amount}
            disabled={isLoading}
            onClick={() => {
              snipe({
                tokenAddress: token.address,
                chain: token.chain,
                amount: preset.amount,
              })
              onClose()
            }}
            className="flex-1 py-1 text-xs font-heading font-bold bg-suwappu-magenta-mid text-white rounded hover:bg-suwappu-magenta-dark transition-colors disabled:opacity-50"
          >
            {preset.label}
          </button>
        ))}
      </div>
    </div>
  )
}

export function LaunchFeed() {
  const [visible, setVisible] = useState(false)
  const [filter, setFilter] = useState<string>('all')
  const [snipeOpenId, setSnipeOpenId] = useState<string | null>(null)

  const toggle = useCallback(() => setVisible((v) => !v), [])

  // Fetch launches from API, poll every 10 seconds
  const chainParam = filter === 'all' ? undefined : filter
  const { data: launches = [], isLoading, error } = useQuery({
    queryKey: ['launches', chainParam],
    queryFn: () => api.getLaunches(chainParam),
    refetchInterval: 10_000,
    enabled: visible,
  })

  // Sort by launch time (newest first)
  const sortedLaunches = [...launches].sort(
    (a, b) => new Date(b.launchedAt).getTime() - new Date(a.launchedAt).getTime()
  )

  // Listen for toggle-launch-feed hotkey
  useEffect(() => {
    if (!isDesktop) return

    function handleHotkey(e: Event) {
      const { action } = (e as CustomEvent<{ action: string }>).detail
      if (action === 'toggle-launch-feed') {
        toggle()
      }
    }

    window.addEventListener('suwappu:hotkey', handleHotkey)
    return () => window.removeEventListener('suwappu:hotkey', handleHotkey)
  }, [toggle])

  if (!isDesktop || !visible) return null

  return (
    <div className="fixed top-0 right-0 z-30 h-full w-80 bg-white/95 backdrop-blur-md border-l border-suwappu-sakura-mid/20 shadow-xl flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-suwappu-sakura-mid/10">
        <div className="flex items-center gap-2">
          <div className="w-2 h-2 rounded-full bg-green-400 animate-pulse" />
          <span className="font-heading font-bold text-sm text-suwappu-text">
            Launch Scanner
          </span>
        </div>
        <button
          onClick={toggle}
          aria-label="Close"
          className="text-suwappu-text-muted hover:text-suwappu-text p-1 rounded-lg hover:bg-suwappu-sakura-50 transition-colors"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>

      {/* Chain filters */}
      <div className="flex gap-1.5 px-4 py-2 border-b border-suwappu-sakura-mid/10">
        {['all', 'eth', 'sol', 'base', 'tempo'].map((chain) => (
          <button
            key={chain}
            onClick={() => setFilter(chain)}
            className={`px-2.5 py-1 text-xs font-heading font-semibold rounded-lg transition-colors ${
              filter === chain
                ? 'bg-suwappu-magenta-mid text-white'
                : 'bg-suwappu-sakura-50 text-suwappu-text-secondary hover:bg-suwappu-sakura-100'
            }`}
          >
            {chain.toUpperCase()}
          </button>
        ))}
      </div>

      {/* Feed */}
      <div className="flex-1 overflow-y-auto">
        {isLoading ? (
          <div className="flex items-center justify-center py-8">
            <div className="w-5 h-5 border-2 border-suwappu-magenta-mid/30 border-t-suwappu-magenta-mid rounded-full animate-spin" />
            <span className="ml-2 text-sm text-suwappu-text-secondary">Loading launches...</span>
          </div>
        ) : error ? (
          <div className="text-center py-8 text-sm text-red-400">
            Failed to load launches
          </div>
        ) : sortedLaunches.length === 0 ? (
          <div className="text-center py-8 text-sm text-suwappu-text-muted">
            No launches matching filter
          </div>
        ) : (
          sortedLaunches.map((token) => (
            <div
              key={token.id}
              className="px-4 py-3 border-b border-suwappu-sakura-mid/10 hover:bg-suwappu-sakura-50/50 transition-colors"
            >
              {/* Token header */}
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2">
                  <span className="font-heading font-bold text-sm text-suwappu-text">
                    {token.symbol}
                  </span>
                  <span className="px-1.5 py-0.5 text-[10px] font-mono bg-suwappu-sakura-100 text-suwappu-text-secondary rounded">
                    {token.chain}
                  </span>
                </div>
                <span className="text-xs text-suwappu-text-muted">
                  {timeAgo(token.launchedAt)} ago
                </span>
              </div>

              {/* Token name */}
              <div className="text-xs text-suwappu-text-secondary mb-2">
                {token.name}
              </div>

              {/* Stats row */}
              <div className="flex items-center gap-3 mb-2">
                <div className="flex items-center gap-1">
                  <span className="text-[10px] text-suwappu-text-muted">MC:</span>
                  <span className="text-xs font-heading font-semibold text-suwappu-text">
                    {formatMarketCap(token.marketCap)}
                  </span>
                </div>
                <div className="flex items-center gap-1">
                  <span className="text-[10px] text-suwappu-text-muted">Safety:</span>
                  <span className={`text-xs font-bold ${getSafetyColor(token.safetyScore)}`}>
                    {token.safetyScore}
                  </span>
                </div>
              </div>

              {/* Bonding curve bar */}
              <div className="flex items-center gap-2 mb-2">
                <span className="text-[10px] text-suwappu-text-muted">Bonding:</span>
                <div className="flex-1 h-1.5 bg-suwappu-sakura-100 rounded-full overflow-hidden">
                  <div
                    className={`h-full rounded-full ${getBondingCurveColor(token.bondingCurvePercent)}`}
                    style={{ width: `${token.bondingCurvePercent}%` }}
                  />
                </div>
                <span className="text-[10px] font-mono text-suwappu-text-secondary">
                  {token.bondingCurvePercent}%
                </span>
              </div>

              {/* Snipe button with dropdown */}
              <div className="relative">
                {snipeOpenId === token.id && (
                  <SnipeDropdown
                    token={token}
                    onClose={() => setSnipeOpenId(null)}
                  />
                )}
                <button
                  onClick={() =>
                    setSnipeOpenId((prev) => (prev === token.id ? null : token.id))
                  }
                  className="w-full py-1.5 bg-suwappu-magenta-mid text-white text-xs font-heading font-bold rounded-lg hover:bg-suwappu-magenta-dark transition-colors"
                >
                  Snipe
                </button>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  )
}
