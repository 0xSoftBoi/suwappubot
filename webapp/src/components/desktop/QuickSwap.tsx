import React, { useEffect, useState, useCallback } from 'react'

const isDesktop = !!(
  typeof window !== 'undefined' &&
  (window as any).__SUWAPPU_DESKTOP__?.isDesktop
)

export function QuickSwap() {
  const [visible, setVisible] = useState(false)
  const [fromToken, setFromToken] = useState('ETH')
  const [toToken, setToToken] = useState('')
  const [amount, setAmount] = useState('')
  const [executing, setExecuting] = useState(false)

  const dismiss = useCallback(() => {
    setVisible(false)
    setAmount('')
    setToToken('')
  }, [])

  // Listen for quick-swap hotkey
  useEffect(() => {
    if (!isDesktop) return

    function handleHotkey(e: Event) {
      const { action } = (e as CustomEvent<{ action: string }>).detail
      if (action === 'quick-swap') {
        setVisible((v) => !v)
      }
    }

    window.addEventListener('suwappu:hotkey', handleHotkey)
    return () => window.removeEventListener('suwappu:hotkey', handleHotkey)
  }, [])

  // Close on Escape
  useEffect(() => {
    if (!visible) return

    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') dismiss()
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [visible, dismiss])

  const [quote, setQuote] = useState<{ outputAmount?: string; rate?: string } | null>(null)
  const [error, setError] = useState<string | null>(null)

  // Fetch quote when inputs change
  useEffect(() => {
    if (!amount || !toToken || !fromToken) {
      setQuote(null)
      return
    }
    const controller = new AbortController()
    const apiUrl = import.meta.env.VITE_API_URL || 'https://api.suwappu.bot'
    fetch(`${apiUrl}/v1/agent/quote`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ from_token: fromToken, to_token: toToken, amount }),
      signal: controller.signal,
    })
      .then((r) => (r.ok ? r.json() : r.json().then((d) => Promise.reject(d.error || 'Quote failed'))))
      .then((data) => setQuote({ outputAmount: data.output_amount, rate: data.exchange_rate }))
      .catch((e) => { if (e !== 'AbortError') setQuote(null) })
    return () => controller.abort()
  }, [fromToken, toToken, amount])

  const handleExecute = async () => {
    if (!amount || !toToken) return
    setExecuting(true)
    setError(null)
    try {
      const apiUrl = import.meta.env.VITE_API_URL || 'https://api.suwappu.bot'
      const res = await fetch(`${apiUrl}/v1/agent/quote`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ from_token: fromToken, to_token: toToken, amount }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data.error || `Failed (${res.status})`)
      }
      dismiss()
    } catch (e: any) {
      setError(e.message || 'Swap failed')
    } finally {
      setExecuting(false)
    }
  }

  if (!isDesktop || !visible) return null

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 z-40 bg-black/20 backdrop-blur-sm"
        onClick={dismiss}
      />

      {/* Panel */}
      <div role="dialog" aria-modal="true" className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 z-50 w-96 bg-white/95 backdrop-blur-md rounded-2xl shadow-2xl border border-suwappu-sakura-mid/20 overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-suwappu-sakura-mid/10">
          <span className="font-heading font-bold text-lg text-suwappu-text">
            Quick Swap
          </span>
          <div className="flex items-center gap-2">
            <kbd className="px-1.5 py-0.5 text-[10px] font-mono bg-suwappu-sakura-50 text-suwappu-text-muted rounded border border-suwappu-sakura-mid/20">
              Esc
            </kbd>
            <button
              onClick={dismiss}
              aria-label="Close"
              className="text-suwappu-text-muted hover:text-suwappu-text p-1 rounded-lg hover:bg-suwappu-sakura-50 transition-colors"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>

        {/* Form */}
        <div className="p-5 space-y-4">
          {/* From */}
          <div>
            <label className="block text-xs font-heading font-semibold text-suwappu-text-secondary mb-1.5 uppercase tracking-wider">
              From
            </label>
            <div className="flex gap-2">
              <input
                type="text"
                value={fromToken}
                onChange={(e) => setFromToken(e.target.value)}
                placeholder="Token"
                className="w-28 px-3 py-2.5 bg-suwappu-sakura-50 border border-suwappu-sakura-mid/20 rounded-xl text-sm font-heading focus:outline-none focus:ring-2 focus:ring-suwappu-magenta-mid/30"
              />
              <input
                type="number"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder="Amount"
                autoFocus
                className="flex-1 px-3 py-2.5 bg-suwappu-sakura-50 border border-suwappu-sakura-mid/20 rounded-xl text-sm font-heading focus:outline-none focus:ring-2 focus:ring-suwappu-magenta-mid/30"
              />
            </div>
          </div>

          {/* Swap arrow */}
          <div className="flex justify-center">
            <div className="w-8 h-8 flex items-center justify-center bg-suwappu-sakura-100 rounded-full">
              <svg className="w-4 h-4 text-suwappu-magenta-mid" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16V4m0 0L3 8m4-4l4 4m6 0v12m0 0l4-4m-4 4l-4-4" />
              </svg>
            </div>
          </div>

          {/* To */}
          <div>
            <label className="block text-xs font-heading font-semibold text-suwappu-text-secondary mb-1.5 uppercase tracking-wider">
              To
            </label>
            <input
              type="text"
              value={toToken}
              onChange={(e) => setToToken(e.target.value)}
              placeholder="Token name or address"
              className="w-full px-3 py-2.5 bg-suwappu-sakura-50 border border-suwappu-sakura-mid/20 rounded-xl text-sm font-heading focus:outline-none focus:ring-2 focus:ring-suwappu-magenta-mid/30"
            />
          </div>

          {/* Quote preview */}
          {quote && (
            <div className="px-3 py-2 bg-suwappu-sakura-50 rounded-xl text-xs text-suwappu-text-secondary">
              <div className="flex justify-between">
                <span>You receive:</span>
                <span className="font-heading font-bold text-suwappu-text">{quote.outputAmount} {toToken}</span>
              </div>
              {quote.rate && (
                <div className="flex justify-between mt-1">
                  <span>Rate:</span>
                  <span>1 {fromToken} = {quote.rate} {toToken}</span>
                </div>
              )}
            </div>
          )}

          {/* Error */}
          {error && (
            <div className="px-3 py-2 bg-red-50 text-red-600 text-xs rounded-xl">
              {error}
            </div>
          )}

          {/* Execute */}
          <button
            onClick={handleExecute}
            disabled={!amount || !toToken || executing}
            className="w-full py-3 bg-suwappu-magenta-mid text-white font-heading font-bold rounded-xl hover:bg-suwappu-magenta-dark transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
          >
            {executing ? (
              <>
                <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                Executing...
              </>
            ) : (
              'Execute Swap'
            )}
          </button>
        </div>
      </div>
    </>
  )
}
