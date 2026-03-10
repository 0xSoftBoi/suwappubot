import React, { useEffect, useState, useCallback, useMemo } from 'react'
import { CompactSimulation } from '../swap/TransactionSimulation'
import { useSwapQuote } from '../../hooks/useSwapQuote'
import { useTransactionSimulation } from '../../hooks/useTransactionSimulation'
import { useSwapExecute } from '../../hooks/useSwapExecute'
import type { SwapToken } from '../../types/swap'

const isDesktop = !!(
  typeof window !== 'undefined' &&
  (window as any).__SUWAPPU_DESKTOP__?.isDesktop
)

export function QuickSwap() {
  const [visible, setVisible] = useState(false)
  const [fromToken, setFromToken] = useState('ETH')
  const [toToken, setToToken] = useState('')
  const [amount, setAmount] = useState('')
  const [showPreview, setShowPreview] = useState(false)

  const dismiss = useCallback(() => {
    setVisible(false)
    setAmount('')
    setToToken('')
    setShowPreview(false)
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

  // Build mock SwapToken objects for the simulation hook
  const fromSwapToken: SwapToken | null = useMemo(() => {
    if (!fromToken) return null
    return {
      symbol: fromToken.toUpperCase(),
      name: fromToken,
      address: '',
      chain: '1',
      decimals: 18,
    }
  }, [fromToken])

  const toSwapToken: SwapToken | null = useMemo(() => {
    if (!toToken) return null
    return {
      symbol: toToken.toUpperCase(),
      name: toToken,
      address: '',
      chain: '1',
      decimals: 18,
    }
  }, [toToken])

  // Build quote request when both tokens and amount are set
  const quoteRequest = useMemo(() => {
    if (!fromToken || !toToken || !amount || parseFloat(amount) <= 0) return null
    return {
      fromToken: '',
      toToken: '',
      fromChain: '1',
      toChain: '1',
      amount,
      fromDecimals: 18,
      slippage: 0.5,
    }
  }, [fromToken, toToken, amount])

  // Fetch quote for preview (only when inputs are filled)
  const {
    data: quote,
    isFetching: quoteFetching,
  } = useSwapQuote(quoteRequest)

  // Run simulation on quote
  const { simulation, isLoading: simLoading } = useTransactionSimulation(
    quote,
    fromSwapToken,
    toSwapToken,
  )

  // Show preview automatically when we have a quote
  useEffect(() => {
    if (quote && !quoteFetching) {
      setShowPreview(true)
    } else {
      setShowPreview(false)
    }
  }, [quote, quoteFetching])

  // Swap execution
  const {
    mutate: executeSwap,
    isPending: executing,
  } = useSwapExecute()

  const handleExecute = () => {
    if (!quote) return
    executeSwap(
      { quoteId: quote.id },
      {
        onSuccess: () => {
          dismiss()
        },
      },
    )
  }

  // Fallback for when quote API isn't available (original behavior)
  const handleExecuteFallback = async () => {
    if (!amount || !toToken) return
    // Simulated delay for demo
    setTimeout(() => {
      dismiss()
    }, 1500)
  }

  const canExecute = amount && toToken && !executing

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

          {/* Compact simulation preview */}
          {showPreview && quote && fromSwapToken && toSwapToken && (
            <CompactSimulation
              quote={quote}
              fromToken={fromSwapToken}
              toToken={toSwapToken}
              simulation={simulation}
              isLoading={simLoading}
            />
          )}

          {/* Loading indicator when fetching quote */}
          {quoteFetching && amount && toToken && (
            <div className="text-center py-1">
              <span className="text-xs text-suwappu-text-secondary animate-pulse">
                Getting preview...
              </span>
            </div>
          )}

          {/* Execute / Confirm */}
          <button
            onClick={quote ? handleExecute : handleExecuteFallback}
            disabled={!canExecute}
            className="w-full py-3 bg-suwappu-magenta-mid text-white font-heading font-bold rounded-xl hover:bg-suwappu-magenta-dark transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
          >
            {executing ? (
              <>
                <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                Executing...
              </>
            ) : showPreview && quote ? (
              'Confirm Swap'
            ) : (
              'Execute Swap'
            )}
          </button>
        </div>
      </div>
    </>
  )
}
