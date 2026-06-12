import React, { useState, useEffect, useRef, useCallback } from 'react'
import { TokenPair } from './TokenPair'
import { ImpactIndicator } from './ImpactIndicator'
import { AnimatedNumber } from './AnimatedNumber'
import { TransactionSimulation } from './TransactionSimulation'
import { useTransactionSimulation } from '../../hooks/useTransactionSimulation'
import type { SwapQuote, SwapToken } from '../../types/swap'

// ── Legacy props (for backward compatibility) ──────────

export interface SwapConfirmationLegacyProps {
  isOpen: boolean
  onConfirm: () => void
  onCancel: () => void
  fromToken: { symbol: string; name?: string; logoUrl?: string }
  toToken: { symbol: string; name?: string; logoUrl?: string }
  fromChain?: string
  toChain?: string
  fromAmount: number
  toAmount: number
  fromAmountUsd: number
  toAmountUsd: number
  priceImpact: number
  networkFeeUsd: number
  route: string
  provider: string
  mevProtected: boolean
  slippage: number
  minReceived: number
  estimatedTime?: string
  quoteExpiresIn: number
  isLargeTrade?: boolean
  className?: string
}

// ── New simulation-powered props ───────────────────────

export interface SwapConfirmationProps {
  quote: SwapQuote
  fromToken: SwapToken
  toToken: SwapToken
  onConfirm: () => void
  onCancel: () => void
  isExecuting: boolean
  className?: string
}

// ── Helpers ────────────────────────────────────────────

function formatUsd(value: number): string {
  return `$${value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

function formatTokenAmount(value: number): string {
  return value.toLocaleString('en-US', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 6,
  })
}

/** Circular countdown ring, 28px diameter */
function CountdownRing({ seconds, total }: { seconds: number; total: number }) {
  const radius = 11
  const circumference = 2 * Math.PI * radius
  const progress = total > 0 ? seconds / total : 0
  const offset = circumference * (1 - progress)

  const colorClass =
    seconds > 15 ? 'text-green-500' : seconds > 5 ? 'text-yellow-500' : 'text-red-500'

  return (
    <svg width={28} height={28} className={`-rotate-90 ${colorClass}`} aria-hidden="true">
      <circle
        cx={14}
        cy={14}
        r={radius}
        fill="none"
        stroke="currentColor"
        strokeOpacity={0.15}
        strokeWidth={3}
      />
      <circle
        cx={14}
        cy={14}
        r={radius}
        fill="none"
        stroke="currentColor"
        strokeWidth={3}
        strokeDasharray={circumference}
        strokeDashoffset={offset}
        strokeLinecap="round"
        className="transition-[stroke-dashoffset] duration-1000 ease-linear"
      />
    </svg>
  )
}

function WarningBanner({
  variant,
  children,
}: {
  variant: 'yellow' | 'blue' | 'purple'
  children: React.ReactNode
}) {
  const styles = {
    yellow: 'bg-yellow-50 border-yellow-200 text-yellow-800',
    blue: 'bg-blue-50 border-blue-200 text-blue-800',
    purple: 'bg-purple-50 border-purple-200 text-purple-800',
  }

  return (
    <div className={`rounded-suwappu-md border px-3 py-2 text-sm ${styles[variant]}`}>
      {children}
    </div>
  )
}

// ── New Simulation-powered Confirmation ────────────────

export const SwapConfirmationWithSimulation = React.memo(function SwapConfirmationWithSimulation({
  quote,
  fromToken,
  toToken,
  onConfirm,
  onCancel,
  isExecuting,
  className = '',
}: SwapConfirmationProps) {
  const { simulation, isLoading } = useTransactionSimulation(quote, fromToken, toToken)

  // Quote expiry countdown
  const expiresAt = quote.expiresAt ? new Date(quote.expiresAt).getTime() : 0
  const [secondsLeft, setSecondsLeft] = useState(() => {
    if (!expiresAt) return 30
    return Math.max(0, Math.floor((expiresAt - Date.now()) / 1000))
  })
  const totalRef = useRef(secondsLeft)

  useEffect(() => {
    if (secondsLeft <= 0) return
    const id = setInterval(() => {
      if (expiresAt) {
        setSecondsLeft(Math.max(0, Math.floor((expiresAt - Date.now()) / 1000)))
      } else {
        setSecondsLeft((s) => Math.max(0, s - 1))
      }
    }, 1000)
    return () => clearInterval(id)
  }, [expiresAt, secondsLeft])

  const expired = secondsLeft <= 0

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 z-50 bg-black/40 backdrop-blur-sm"
        onClick={onCancel}
        aria-hidden="true"
      />

      {/* Bottom sheet */}
      <div
        className={`fixed inset-x-0 bottom-0 z-50 animate-slide-up rounded-t-suwappu-xxl bg-white shadow-suwappu-4 ${className}`}
        style={{ maxHeight: '85vh' }}
        role="dialog"
        aria-modal="true"
        aria-label="Transaction simulation preview"
      >
        <div className="overflow-y-auto" style={{ maxHeight: '85vh' }}>
          {/* Drag handle */}
          <div className="flex justify-center pt-3 pb-2">
            <div className="h-1 w-10 rounded-suwappu-pill bg-gray-300" />
          </div>

          <div className="px-5 pb-6">
            {/* Header */}
            <div className="flex items-center justify-between mb-4">
              <h2 className="font-heading font-bold text-base text-suwappu-text">
                Transaction Preview
              </h2>
              {/* Quote countdown */}
              {expired ? (
                <div className="flex items-center gap-1.5">
                  <span className="text-xs font-medium text-red-500">Expired</span>
                  <button
                    type="button"
                    onClick={onCancel}
                    className="rounded-suwappu-pill bg-suwappu-gradient px-2.5 py-0.5 text-[10px] font-medium text-white shadow-suwappu-button"
                  >
                    Refresh
                  </button>
                </div>
              ) : (
                <div className="flex items-center gap-1.5">
                  <span className="text-xs text-suwappu-text-secondary">Expires:</span>
                  <div className="relative flex items-center justify-center">
                    <CountdownRing seconds={secondsLeft} total={totalRef.current} />
                    <span
                      className={`absolute text-[10px] font-bold ${
                        secondsLeft > 15
                          ? 'text-green-600'
                          : secondsLeft > 5
                            ? 'text-yellow-600'
                            : 'text-red-600'
                      }`}
                    >
                      {secondsLeft}
                    </span>
                  </div>
                </div>
              )}
            </div>

            {/* Simulation content */}
            <TransactionSimulation
              quote={quote}
              fromToken={fromToken}
              toToken={toToken}
              simulation={simulation}
              isLoading={isLoading}
              onConfirm={expired ? onCancel : onConfirm}
              onCancel={onCancel}
              isExecuting={isExecuting}
            />
          </div>
        </div>
      </div>
    </>
  )
})

// ── Legacy Confirmation (preserved for backward compat) ──

export const SwapConfirmation = React.memo(function SwapConfirmation({
  isOpen,
  onConfirm,
  onCancel,
  fromToken,
  toToken,
  fromChain,
  toChain,
  fromAmount,
  toAmount,
  fromAmountUsd,
  toAmountUsd,
  priceImpact,
  networkFeeUsd,
  route,
  provider,
  mevProtected,
  slippage,
  minReceived,
  estimatedTime,
  quoteExpiresIn,
  isLargeTrade = false,
  className = '',
}: SwapConfirmationLegacyProps) {
  // ── Countdown timer ──────────────────────────────────────────
  const [secondsLeft, setSecondsLeft] = useState(quoteExpiresIn)
  const totalRef = useRef(quoteExpiresIn)

  useEffect(() => {
    setSecondsLeft(quoteExpiresIn)
    totalRef.current = quoteExpiresIn
  }, [quoteExpiresIn])

  useEffect(() => {
    if (!isOpen || secondsLeft <= 0) return
    const id = setInterval(() => {
      setSecondsLeft((s) => Math.max(0, s - 1))
    }, 1000)
    return () => clearInterval(id)
  }, [isOpen, secondsLeft])

  const expired = secondsLeft <= 0

  // ── Hold-to-confirm ──────────────────────────────────────────
  const [holdProgress, setHoldProgress] = useState(0)
  const holdTimerRef = useRef<ReturnType<typeof setInterval>>()
  const holdStartRef = useRef<number>(0)
  const HOLD_DURATION = 1500 // ms

  const startHold = useCallback(() => {
    if (expired) return
    holdStartRef.current = Date.now()
    holdTimerRef.current = setInterval(() => {
      const elapsed = Date.now() - holdStartRef.current
      const progress = Math.min(elapsed / HOLD_DURATION, 1)
      setHoldProgress(progress)
      if (progress >= 1) {
        clearInterval(holdTimerRef.current)
        onConfirm()
      }
    }, 16)
  }, [expired, onConfirm])

  const cancelHold = useCallback(() => {
    if (holdTimerRef.current) clearInterval(holdTimerRef.current)
    setHoldProgress(0)
  }, [])

  // Cleanup hold timer on unmount
  useEffect(() => {
    return () => {
      if (holdTimerRef.current) clearInterval(holdTimerRef.current)
    }
  }, [])

  if (!isOpen) return null

  const isCrossChain = fromChain && toChain && fromChain !== toChain
  const showHighImpactWarning = priceImpact > 2
  const showLargeTradeWarning = isLargeTrade
  const showCrossChainWarning = isCrossChain

  const detailRows: { label: string; value: React.ReactNode }[] = [
    {
      label: 'Price Impact',
      value: <ImpactIndicator value={priceImpact} format="percent" variant="inline" size="sm" />,
    },
    {
      label: 'Min. Received',
      value: (
        <span className="text-sm text-suwappu-text">
          <AnimatedNumber value={minReceived} format="token" size="sm" /> {toToken.symbol}
        </span>
      ),
    },
    {
      label: 'Network Fee',
      value: <span className="text-sm text-suwappu-text">{formatUsd(networkFeeUsd)}</span>,
    },
    {
      label: 'Route',
      value: (
        <span className="text-sm text-suwappu-text">
          {route} via {provider}
        </span>
      ),
    },
    {
      label: 'MEV Protection',
      value: (
        <span className="text-sm text-suwappu-text">
          {mevProtected ? '\u{1F6E1}\uFE0F Active' : 'Inactive'}
        </span>
      ),
    },
    {
      label: 'Slippage',
      value: <span className="text-sm text-suwappu-text">{slippage}%</span>,
    },
  ]

  if (estimatedTime) {
    detailRows.push({
      label: 'Est. Time',
      value: <span className="text-sm text-suwappu-text">~{estimatedTime}</span>,
    })
  }

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 z-50 bg-black/40 backdrop-blur-sm"
        onClick={onCancel}
        aria-hidden="true"
      />

      {/* Bottom sheet */}
      <div
        className={`fixed inset-x-0 bottom-0 z-50 animate-slide-up rounded-t-suwappu-xxl bg-white shadow-suwappu-4 ${className}`}
        style={{ maxHeight: '85vh' }}
        role="dialog"
        aria-modal="true"
        aria-label="Swap confirmation"
      >
        <div className="overflow-y-auto" style={{ maxHeight: '85vh' }}>
          {/* Drag handle */}
          <div className="flex justify-center pt-3 pb-2">
            <div className="h-1 w-10 rounded-suwappu-pill bg-gray-300" />
          </div>

          <div className="space-y-5 px-5 pb-6">
            {/* ── Section 1: Header ── */}
            <div className="flex flex-col items-center gap-3">
              <p className="text-sm font-body text-suwappu-text-secondary">You're swapping</p>
              <TokenPair
                fromToken={fromToken}
                toToken={toToken}
                fromChain={fromChain}
                toChain={toChain}
                size="lg"
                showNames
                showArrow
              />
              <div className="flex flex-col items-center gap-1 pt-1">
                <div className="text-center">
                  <span className="text-2xl font-bold text-suwappu-text">
                    {formatTokenAmount(fromAmount)} {fromToken.symbol}
                  </span>
                  <p className="text-sm text-suwappu-text-secondary">
                    ({formatUsd(fromAmountUsd)})
                  </p>
                </div>
                <span className="text-lg text-suwappu-text-secondary select-none">&darr;</span>
                <div className="text-center">
                  <span className="text-2xl font-bold text-suwappu-text">
                    {formatTokenAmount(toAmount)} {toToken.symbol}
                  </span>
                  <p className="text-sm text-suwappu-text-secondary">
                    ({formatUsd(toAmountUsd)})
                  </p>
                </div>
              </div>
            </div>

            {/* ── Section 2: Quote Countdown ── */}
            <div className="flex items-center justify-center gap-2">
              {expired ? (
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium text-red-500">Quote expired</span>
                  <button
                    type="button"
                    onClick={onCancel}
                    className="rounded-suwappu-pill bg-suwappu-gradient px-3 py-1 text-xs font-medium text-white shadow-suwappu-button"
                  >
                    Refresh
                  </button>
                </div>
              ) : (
                <>
                  <span className="text-sm text-suwappu-text-secondary">Quote expires in:</span>
                  <div className="relative flex items-center justify-center">
                    <CountdownRing seconds={secondsLeft} total={totalRef.current} />
                    <span
                      className={`absolute text-[10px] font-bold ${
                        secondsLeft > 15
                          ? 'text-green-600'
                          : secondsLeft > 5
                            ? 'text-yellow-600'
                            : 'text-red-600'
                      }`}
                    >
                      {secondsLeft}
                    </span>
                  </div>
                </>
              )}
            </div>

            {/* ── Section 3: Safety Checklist ── */}
            <div className="rounded-suwappu-lg border border-suwappu-sakura-100/30 bg-suwappu-sakura-50/50">
              {detailRows.map((row, i) => (
                <div
                  key={row.label}
                  className={`flex items-center justify-between px-4 py-2.5 ${
                    i < detailRows.length - 1 ? 'border-b border-suwappu-sakura-100/30' : ''
                  }`}
                >
                  <span className="text-sm text-suwappu-text-secondary">{row.label}</span>
                  {row.value}
                </div>
              ))}
            </div>

            {/* ── Section 4: Warnings ── */}
            {(showHighImpactWarning || showLargeTradeWarning || showCrossChainWarning) && (
              <div className="space-y-2">
                {showHighImpactWarning && (
                  <WarningBanner variant="yellow">
                    High price impact — you may receive less than expected
                  </WarningBanner>
                )}
                {showLargeTradeWarning && (
                  <WarningBanner variant="blue">
                    Large trade — hold button to confirm
                  </WarningBanner>
                )}
                {showCrossChainWarning && (
                  <WarningBanner variant="purple">
                    Cross-chain swap takes ~{estimatedTime ?? '2-5 min'} and cannot be reversed
                  </WarningBanner>
                )}
              </div>
            )}

            {/* ── Section 5: Action Buttons ── */}
            <div className="space-y-2 pt-1">
              {isLargeTrade ? (
                /* Hold-to-confirm button */
                <button
                  type="button"
                  disabled={expired}
                  onMouseDown={startHold}
                  onMouseUp={cancelHold}
                  onMouseLeave={cancelHold}
                  onTouchStart={startHold}
                  onTouchEnd={cancelHold}
                  onTouchCancel={cancelHold}
                  className="relative w-full overflow-hidden rounded-suwappu-pill py-3.5 text-base font-heading font-bold text-white shadow-suwappu-button transition-shadow hover:shadow-suwappu-button-hover disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {/* Static gradient background */}
                  <span className="absolute inset-0 bg-suwappu-gradient opacity-30" />
                  {/* Progress fill */}
                  <span
                    className="absolute inset-y-0 left-0 bg-suwappu-gradient transition-[width] duration-75 ease-linear"
                    style={{ width: `${holdProgress * 100}%` }}
                  />
                  <span className="relative z-10">
                    {holdProgress > 0 && holdProgress < 1
                      ? 'Hold to Confirm...'
                      : 'Hold to Confirm Swap'}
                  </span>
                </button>
              ) : (
                <button
                  type="button"
                  disabled={expired}
                  onClick={onConfirm}
                  className="w-full rounded-suwappu-pill bg-suwappu-gradient py-3.5 text-base font-heading font-bold text-white shadow-suwappu-button transition-shadow hover:shadow-suwappu-button-hover disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  Confirm Swap
                </button>
              )}
              <button
                type="button"
                onClick={onCancel}
                className="w-full py-2 text-sm font-body text-suwappu-text-secondary transition-colors hover:text-suwappu-text"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      </div>
    </>
  )
})
