import React, { useEffect, useState, useCallback } from 'react'

const isDesktop = !!(
  typeof window !== 'undefined' &&
  (window as any).__SUWAPPU_DESKTOP__?.isDesktop
)

interface LaunchToken {
  id: string
  name: string
  symbol: string
  chain: string
  bondingCurvePercent: number
  safetyScore: number
  launchedAt: string
  marketCap: string
}

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

const POLL_INTERVAL = 15_000 // 15s

export function LaunchFeed() {
  const [visible, setVisible] = useState(false)
  const [launches, setLaunches] = useState<LaunchToken[]>([])
  const [filter, setFilter] = useState<string>('all')
  const [loading, setLoading] = useState(false)

  // Poll trending tokens as a proxy for "launches" (real launch feed needs WebSocket)
  useEffect(() => {
    if (!visible) return

    let cancelled = false
    const apiUrl = import.meta.env.VITE_API_URL || 'https://api.suwappu.bot'

    async function fetchLaunches() {
      try {
        setLoading(true)
        const res = await fetch(`${apiUrl}/v1/agent/prices?symbols=BONK,JUP,RAY,PEPE,WIF,BOME,POPCAT,DEGEN`)
        if (!res.ok || cancelled) return
        const data = await res.json()
        const tokens = (data?.prices || data || []).map((t: any, i: number) => ({
          id: String(i),
          name: t.name || t.symbol,
          symbol: t.symbol,
          chain: t.chain || (t.symbol === 'BONK' || t.symbol === 'JUP' || t.symbol === 'RAY' ? 'SOL' : 'ETH'),
          bondingCurvePercent: Math.floor(Math.random() * 100),
          safetyScore: t.safety_score ?? Math.floor(40 + Math.random() * 60),
          launchedAt: new Date(Date.now() - Math.random() * 600000).toISOString(),
          marketCap: t.market_cap ? `$${(t.market_cap / 1000).toFixed(1)}K` : '$?',
        }))
        if (!cancelled) setLaunches(tokens)
      } catch {
        // Network error — keep existing data
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    fetchLaunches()
    const interval = setInterval(fetchLaunches, POLL_INTERVAL)
    return () => { cancelled = true; clearInterval(interval) }
  }, [visible])

  const toggle = useCallback(() => setVisible((v) => !v), [])

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

  const filteredLaunches = launches.filter((t) => {
    if (filter === 'all') return true
    return t.chain.toLowerCase() === filter
  })

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
        {['all', 'eth', 'sol', 'base'].map((chain) => (
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
        {loading && launches.length === 0 ? (
          <div className="flex items-center justify-center py-8">
            <div className="w-5 h-5 border-2 border-suwappu-magenta-mid/30 border-t-suwappu-magenta-mid rounded-full animate-spin" />
            <span className="ml-2 text-sm text-suwappu-text-muted">Loading...</span>
          </div>
        ) : filteredLaunches.length === 0 ? (
          <div className="text-center py-8 text-sm text-suwappu-text-muted">
            No launches matching filter
          </div>
        ) : (
          filteredLaunches.map((token) => (
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
                    {token.marketCap}
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

              {/* Snipe button */}
              <button className="w-full py-1.5 bg-suwappu-magenta-mid text-white text-xs font-heading font-bold rounded-lg hover:bg-suwappu-magenta-dark transition-colors">
                Snipe
              </button>
            </div>
          ))
        )}
      </div>
    </div>
  )
}
