import React, { useEffect, useState, useCallback } from 'react'

interface ClipboardDetection {
  address: string
  chain: 'ethereum' | 'solana' | 'unknown'
}

interface TokenInfo {
  name: string
  symbol: string
  price: string
  safetyScore: number
  chain: string
  address: string
}

const isDesktop = !!(
  typeof window !== 'undefined' &&
  (window as any).__SUWAPPU_DESKTOP__?.isDesktop
)

function shortenAddress(address: string): string {
  if (address.length <= 12) return address
  return `${address.slice(0, 6)}...${address.slice(-4)}`
}

function getSafetyColor(score: number): string {
  if (score >= 80) return 'text-green-400'
  if (score >= 50) return 'text-yellow-400'
  return 'text-red-400'
}

function getSafetyLabel(score: number): string {
  if (score >= 80) return 'Safe'
  if (score >= 50) return 'Caution'
  return 'Risky'
}

export function ClipboardLookup() {
  const [detection, setDetection] = useState<ClipboardDetection | null>(null)
  const [tokenInfo, setTokenInfo] = useState<TokenInfo | null>(null)
  const [loading, setLoading] = useState(false)
  const [visible, setVisible] = useState(false)
  const [mounted, setMounted] = useState(false)

  const dismiss = useCallback(() => {
    setVisible(false)
    setTimeout(() => {
      setMounted(false)
      setDetection(null)
      setTokenInfo(null)
    }, 300)
  }, [])

  // Listen for clipboard address detections from desktop bridge
  useEffect(() => {
    if (!isDesktop) return

    function handleClipboardAddress(e: Event) {
      const { address, chain } = (e as CustomEvent<ClipboardDetection>).detail
      setDetection({ address, chain })
      setMounted(true)
      setVisible(true)
      setLoading(true)

      // Look up token by address via API
      const apiUrl = import.meta.env.VITE_API_URL || 'https://api.suwappu.bot'
      fetch(`${apiUrl}/v1/agent/tokens?search=${encodeURIComponent(address)}&chain=${chain === 'unknown' ? '' : chain}`)
        .then((res) => (res.ok ? res.json() : null))
        .then((data) => {
          const token = data?.tokens?.[0] || data?.[0]
          setTokenInfo({
            name: token?.name || 'Unknown Token',
            symbol: token?.symbol || address.slice(0, 6).toUpperCase(),
            price: token?.price ? `$${Number(token.price).toFixed(token.price < 0.01 ? 6 : 2)}` : '$0.00',
            safetyScore: token?.safety_score ?? 0,
            chain: chain === 'ethereum' ? 'Ethereum' : chain === 'solana' ? 'Solana' : 'Unknown',
            address,
          })
        })
        .catch(() => {
          setTokenInfo({
            name: 'Unknown Token',
            symbol: address.slice(0, 6).toUpperCase(),
            price: '$0.00',
            safetyScore: 0,
            chain: chain === 'ethereum' ? 'Ethereum' : chain === 'solana' ? 'Solana' : 'Unknown',
            address,
          })
        })
        .finally(() => setLoading(false))
    }

    window.addEventListener('suwappu:clipboard-address', handleClipboardAddress)
    return () => {
      window.removeEventListener('suwappu:clipboard-address', handleClipboardAddress)
    }
  }, [])

  // Auto-dismiss after 15 seconds
  useEffect(() => {
    if (!visible) return
    const timer = setTimeout(dismiss, 15000)
    return () => clearTimeout(timer)
  }, [visible, dismiss])

  if (!isDesktop || !mounted) return null

  return (
    <div
      className={`fixed top-4 right-4 z-50 w-80 bg-white/95 backdrop-blur-md rounded-2xl shadow-xl border border-suwappu-sakura-mid/20 overflow-hidden transition-all duration-300 ${
        visible ? 'opacity-100 translate-y-0' : 'opacity-0 -translate-y-2'
      }`}
    >
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-suwappu-sakura-mid/10">
        <div className="flex items-center gap-2">
          <div className="w-2 h-2 rounded-full bg-suwappu-magenta-mid animate-pulse" />
          <span className="text-xs font-heading font-semibold text-suwappu-text-secondary uppercase tracking-wider">
            Address Detected
          </span>
        </div>
        <button
          onClick={dismiss}
          aria-label="Dismiss"
          className="text-suwappu-text-muted hover:text-suwappu-text p-1 rounded-lg hover:bg-suwappu-sakura-50 transition-colors"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>

      {/* Content */}
      <div className="p-4">
        {loading ? (
          <div className="flex items-center justify-center py-4">
            <div className="w-5 h-5 border-2 border-suwappu-magenta-mid/30 border-t-suwappu-magenta-mid rounded-full animate-spin" />
            <span className="ml-2 text-sm text-suwappu-text-secondary">Looking up token...</span>
          </div>
        ) : tokenInfo ? (
          <div className="space-y-3">
            {/* Token identity */}
            <div className="flex items-center justify-between">
              <div>
                <div className="font-heading font-bold text-suwappu-text">
                  {tokenInfo.name}
                </div>
                <div className="text-xs text-suwappu-text-muted">
                  {shortenAddress(tokenInfo.address)}
                </div>
              </div>
              <div className="text-right">
                <div className="font-heading font-bold text-suwappu-text">
                  {tokenInfo.price}
                </div>
                <div className="text-xs text-suwappu-text-muted">
                  {tokenInfo.chain}
                </div>
              </div>
            </div>

            {/* Safety score */}
            <div className="flex items-center gap-2 px-3 py-2 bg-suwappu-sakura-50 rounded-xl">
              <span className="text-xs text-suwappu-text-secondary">Safety:</span>
              <span className={`text-xs font-bold ${getSafetyColor(tokenInfo.safetyScore)}`}>
                {tokenInfo.safetyScore}/100 ({getSafetyLabel(tokenInfo.safetyScore)})
              </span>
            </div>

            {/* Quick actions */}
            <div className="flex gap-2">
              <button className="flex-1 px-3 py-2 bg-suwappu-magenta-mid text-white text-sm font-heading font-semibold rounded-xl hover:bg-suwappu-magenta-dark transition-colors">
                Swap
              </button>
              <button className="flex-1 px-3 py-2 bg-suwappu-sakura-100 text-suwappu-magenta-mid text-sm font-heading font-semibold rounded-xl hover:bg-suwappu-sakura-200 transition-colors">
                Alert
              </button>
              <button className="flex-1 px-3 py-2 bg-suwappu-sakura-50 text-suwappu-text-secondary text-sm font-heading font-semibold rounded-xl hover:bg-suwappu-sakura-100 transition-colors">
                Chart
              </button>
            </div>
          </div>
        ) : (
          <div className="text-center py-4 text-sm text-suwappu-text-muted">
            {detection
              ? `Detected ${detection.chain} address: ${shortenAddress(detection.address)}`
              : 'No address detected'}
          </div>
        )}
      </div>
    </div>
  )
}
