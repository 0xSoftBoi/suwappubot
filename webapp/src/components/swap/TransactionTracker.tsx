import React, { useState, useEffect, useRef, useCallback } from 'react'
import { ChainBadge } from './ChainBadge'
import { AnimatedNumber } from './AnimatedNumber'

export type TxStep = 'submitting' | 'confirming' | 'bridging' | 'destination' | 'complete'
export type TxStatus = 'pending' | 'active' | 'complete' | 'failed'

export interface TransactionStep {
  id: TxStep
  label: string
  description: string
  status: TxStatus
  txHash?: string
  chainId?: string
  explorerUrl?: string
  elapsedSeconds?: number
}

export interface TransactionTrackerProps {
  steps: TransactionStep[]
  isCrossChain: boolean
  fromToken: { symbol: string; amount: number }
  toToken: { symbol: string; amount: number }
  onRetry?: () => void
  onSwapAgain?: () => void
  onViewPortfolio?: () => void
  className?: string
}

function formatElapsed(seconds: number): string {
  if (seconds < 60) return `${seconds}s`
  const mins = Math.floor(seconds / 60)
  const secs = seconds % 60
  return `${mins}m ${secs}s`
}

function truncateHash(hash: string): string {
  if (hash.length <= 12) return hash
  return `${hash.slice(0, 6)}...${hash.slice(-4)}`
}

// --- TxHashLink sub-component ---

interface TxHashLinkProps {
  hash: string
  explorerUrl?: string
}

const TxHashLink = React.memo(function TxHashLink({ hash, explorerUrl }: TxHashLinkProps) {
  const [copied, setCopied] = useState(false)
  const timeoutRef = useRef<ReturnType<typeof setTimeout>>()

  const handleCopy = useCallback(() => {
    navigator.clipboard.writeText(hash).then(() => {
      setCopied(true)
      if (timeoutRef.current) clearTimeout(timeoutRef.current)
      timeoutRef.current = setTimeout(() => setCopied(false), 2000)
    })
  }, [hash])

  useEffect(() => {
    return () => {
      if (timeoutRef.current) clearTimeout(timeoutRef.current)
    }
  }, [])

  return (
    <span className="inline-flex items-center gap-1.5 mt-1 text-xs text-suwappu-text-secondary">
      <span className="font-mono">{truncateHash(hash)}</span>
      <button
        type="button"
        onClick={handleCopy}
        className="hover:text-suwappu-text-primary transition-colors p-0.5"
        aria-label={copied ? 'Copied' : 'Copy transaction hash'}
      >
        {copied ? (
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="20 6 9 17 4 12" />
          </svg>
        ) : (
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
            <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
          </svg>
        )}
      </button>
      {explorerUrl && (
        <a
          href={explorerUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="hover:text-suwappu-text-primary transition-colors p-0.5"
          aria-label="View on explorer"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
            <polyline points="15 3 21 3 21 9" />
            <line x1="10" y1="14" x2="21" y2="3" />
          </svg>
        </a>
      )}
    </span>
  )
})

// --- ElapsedTimer sub-component ---

interface ElapsedTimerProps {
  initialSeconds?: number
}

const ElapsedTimer = React.memo(function ElapsedTimer({ initialSeconds = 0 }: ElapsedTimerProps) {
  const [elapsed, setElapsed] = useState(initialSeconds)

  useEffect(() => {
    setElapsed(initialSeconds)
    const interval = setInterval(() => {
      setElapsed((prev) => prev + 1)
    }, 1000)
    return () => clearInterval(interval)
  }, [initialSeconds])

  return (
    <span className="text-xs text-suwappu-text-secondary">{formatElapsed(elapsed)}</span>
  )
})

// --- TrackerStep sub-component ---

interface TrackerStepProps {
  step: TransactionStep
  stepNumber: number
  isLast: boolean
}

const TrackerStep = React.memo(function TrackerStep({ step, stepNumber, isLast }: TrackerStepProps) {
  const statusStyles = {
    pending: {
      circle: 'bg-gray-300',
      text: 'text-suwappu-text-secondary opacity-60',
      line: 'border-suwappu-sakura-300/25 border-dotted',
    },
    active: {
      circle: 'bg-tx-state-confirming suwappu-pulse-pending',
      text: 'text-suwappu-text-primary font-semibold',
      line: 'border-tx-state-confirming border-dashed',
    },
    complete: {
      circle: 'bg-tx-state-success',
      text: 'text-suwappu-text-primary',
      line: 'border-tx-state-success border-solid',
    },
    failed: {
      circle: 'bg-tx-state-failed',
      text: 'text-tx-state-failed',
      line: 'border-tx-state-failed border-solid',
    },
  }

  const styles = statusStyles[step.status]

  return (
    <div className="relative flex gap-3">
      {/* Timeline column */}
      <div className="flex flex-col items-center">
        {/* Circle indicator */}
        <div
          className={`w-7 h-7 rounded-suwappu-pill flex items-center justify-center text-xs font-bold text-white shrink-0 ${styles.circle}`}
        >
          {step.status === 'complete' ? (
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="20 6 9 17 4 12" />
            </svg>
          ) : step.status === 'failed' ? (
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          ) : (
            stepNumber
          )}
        </div>
        {/* Connector line */}
        {!isLast && (
          <div className={`w-0.5 flex-1 min-h-[24px] border-l-2 ${styles.line}`} />
        )}
      </div>

      {/* Content column */}
      <div className={`pb-5 pt-0.5 min-w-0 ${isLast ? '' : ''}`}>
        <div className="flex items-center gap-2">
          <span className={`text-sm ${styles.text}`}>{step.label}</span>
          {step.chainId && <ChainBadge chainId={step.chainId} size="sm" />}
        </div>
        <p className={`text-xs mt-0.5 ${step.status === 'failed' ? 'text-tx-state-failed' : 'text-suwappu-text-secondary'}`}>
          {step.description}
        </p>
        {step.txHash && (
          <TxHashLink hash={step.txHash} explorerUrl={step.explorerUrl} />
        )}
        {step.status === 'active' && (
          <div className="mt-1">
            <ElapsedTimer initialSeconds={step.elapsedSeconds} />
          </div>
        )}
        {step.status === 'complete' && step.elapsedSeconds != null && (
          <span className="text-xs text-suwappu-text-secondary mt-0.5 block">
            {formatElapsed(step.elapsedSeconds)} ago
          </span>
        )}
      </div>
    </div>
  )
})

// --- Main TransactionTracker component ---

export const TransactionTracker = React.memo(function TransactionTracker({
  steps,
  isCrossChain,
  fromToken,
  toToken,
  onRetry,
  onSwapAgain,
  onViewPortfolio,
  className = '',
}: TransactionTrackerProps) {
  const allComplete = steps.every((s) => s.status === 'complete')
  const hasFailed = steps.some((s) => s.status === 'failed')
  const failedStep = steps.find((s) => s.status === 'failed')

  // Determine wrapper border/bg
  let wrapperClass = 'border border-suwappu-border bg-suwappu-surface'
  if (allComplete) {
    wrapperClass = 'border border-tx-state-success bg-green-50/30'
  } else if (hasFailed) {
    wrapperClass = 'border border-tx-state-failed bg-red-50/30'
  }

  return (
    <div className={`rounded-suwappu-xxl p-5 ${wrapperClass} ${className}`}>
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div className="text-sm text-suwappu-text-secondary">
          {fromToken.amount} {fromToken.symbol}
          <span className="mx-1.5">→</span>
          {toToken.symbol}
          {isCrossChain && (
            <span className="ml-1.5 text-xs bg-suwappu-surface-secondary px-1.5 py-0.5 rounded-suwappu-pill">
              Cross-chain
            </span>
          )}
        </div>
      </div>

      {/* Steps timeline */}
      <div className="flex flex-col">
        {steps.map((step, idx) => (
          <TrackerStep
            key={step.id}
            step={step}
            stepNumber={idx + 1}
            isLast={idx === steps.length - 1}
          />
        ))}
      </div>

      {/* Success state */}
      {allComplete && (
        <div className="mt-4 pt-4 border-t border-tx-state-success/30 animate-slide-up">
          <p className="text-base font-semibold text-tx-state-success mb-2">Swap Complete!</p>
          <div className="flex items-baseline gap-1.5 mb-4">
            <span className="text-sm text-suwappu-text-secondary">Received:</span>
            <AnimatedNumber
              value={toToken.amount}
              format="token"
              suffix={` ${toToken.symbol}`}
              size="lg"
            />
          </div>
          <div className="flex gap-3">
            {onViewPortfolio && (
              <button
                type="button"
                onClick={onViewPortfolio}
                className="flex-1 px-4 py-2.5 rounded-suwappu-xl bg-suwappu-surface-secondary text-suwappu-text-primary text-sm font-medium hover:bg-suwappu-surface-tertiary transition-colors"
              >
                View in Portfolio
              </button>
            )}
            {onSwapAgain && (
              <button
                type="button"
                onClick={onSwapAgain}
                className="flex-1 px-4 py-2.5 rounded-suwappu-xl bg-tx-state-success text-white text-sm font-medium hover:opacity-90 transition-opacity"
              >
                Swap Again
              </button>
            )}
          </div>
        </div>
      )}

      {/* Failed state */}
      {hasFailed && (
        <div className="mt-4 pt-4 border-t border-tx-state-failed/30 animate-slide-up">
          <p className="text-base font-semibold text-tx-state-failed mb-1">Transaction Failed</p>
          {failedStep && (
            <p className="text-sm text-suwappu-text-secondary mb-4">{failedStep.description}</p>
          )}
          <div className="flex gap-3">
            {onRetry && (
              <button
                type="button"
                onClick={onRetry}
                className="flex-1 px-4 py-2.5 rounded-suwappu-xl bg-tx-state-failed text-white text-sm font-medium hover:opacity-90 transition-opacity"
              >
                Try Again
              </button>
            )}
            <a
              href="https://t.me/suwappubot"
              target="_blank"
              rel="noopener noreferrer"
              className="flex-1 px-4 py-2.5 rounded-suwappu-xl bg-suwappu-surface-secondary text-suwappu-text-primary text-sm font-medium text-center hover:bg-suwappu-surface-tertiary transition-colors"
            >
              Get Help
            </a>
          </div>
        </div>
      )}
    </div>
  )
})
