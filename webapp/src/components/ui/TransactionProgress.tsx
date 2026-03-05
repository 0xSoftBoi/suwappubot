/**
 * TransactionProgress - Visual transaction progress stepper
 * Shows transaction stages: Submitted → Pending → Confirmed
 * With animated transitions using Framer Motion
 */
import { motion, AnimatePresence } from 'framer-motion'

export type TransactionStatus = 'idle' | 'submitting' | 'pending' | 'confirming' | 'confirmed' | 'failed'

export interface TransactionProgressProps {
  /** Current transaction status */
  status: TransactionStatus
  /** Transaction hash (shown after submission) */
  txHash?: string
  /** Chain for explorer link */
  chain?: string
  /** Error message if failed */
  errorMessage?: string
  /** Callback for retry action */
  onRetry?: () => void
  /** Callback to view on explorer */
  onViewExplorer?: () => void
  /** Optional estimated time in seconds */
  estimatedTime?: number
}

// Explorer URLs by chain
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
}

// Step configuration
const steps = [
  { key: 'submitting', label: 'Submitting', icon: '📤' },
  { key: 'pending', label: 'Pending', icon: '⏳' },
  { key: 'confirming', label: 'Confirming', icon: '🔄' },
  { key: 'confirmed', label: 'Confirmed', icon: '✓' },
] as const

// Get step index from status
function getStepIndex(status: TransactionStatus): number {
  switch (status) {
    case 'idle':
      return -1
    case 'submitting':
      return 0
    case 'pending':
      return 1
    case 'confirming':
      return 2
    case 'confirmed':
      return 3
    case 'failed':
      return -1
    default:
      return -1
  }
}

// Shorten tx hash for display
function shortenHash(hash: string): string {
  if (hash.length <= 16) return hash
  return `${hash.slice(0, 8)}...${hash.slice(-6)}`
}

/** Individual step indicator */
function StepIndicator({
  step,
  index,
  currentIndex,
  isFailed,
}: {
  step: (typeof steps)[number]
  index: number
  currentIndex: number
  isFailed: boolean
}) {
  const isActive = index === currentIndex
  const isComplete = index < currentIndex

  return (
    <div className="flex flex-col items-center">
      <motion.div
        className={`w-10 h-10 rounded-full flex items-center justify-center text-lg relative ${
          isFailed && isActive
            ? 'bg-suwappu-error/20 text-suwappu-error'
            : isComplete
              ? 'bg-suwappu-success/20 text-suwappu-success'
              : isActive
                ? 'bg-suwappu-magenta/20 text-suwappu-magenta'
                : 'bg-suwappu-sakura-light text-suwappu-text-secondary'
        }`}
        initial={false}
        animate={{
          scale: isActive ? [1, 1.1, 1] : 1,
        }}
        transition={{
          duration: 0.5,
          repeat: isActive && !isFailed ? Infinity : 0,
          repeatDelay: 0.5,
        }}
      >
        {isFailed && isActive ? '✕' : isComplete ? '✓' : step.icon}

        {/* Active ring animation */}
        {isActive && !isFailed && (
          <motion.div
            className="absolute inset-0 rounded-full border-2 border-suwappu-magenta"
            initial={{ scale: 1, opacity: 1 }}
            animate={{ scale: 1.5, opacity: 0 }}
            transition={{
              duration: 1,
              repeat: Infinity,
              ease: 'easeOut',
            }}
          />
        )}
      </motion.div>

      <span
        className={`text-xs mt-1 font-medium ${
          isFailed && isActive
            ? 'text-suwappu-error'
            : isComplete
              ? 'text-suwappu-success'
              : isActive
                ? 'text-suwappu-magenta'
                : 'text-suwappu-text-secondary'
        }`}
      >
        {isFailed && isActive ? 'Failed' : step.label}
      </span>
    </div>
  )
}

/** Progress line between steps */
function ProgressLine({ isComplete }: { isComplete: boolean }) {
  return (
    <div className="flex-1 h-0.5 mx-2 bg-suwappu-sakura-light rounded overflow-hidden">
      <motion.div
        className="h-full bg-suwappu-success"
        initial={{ width: '0%' }}
        animate={{ width: isComplete ? '100%' : '0%' }}
        transition={{ duration: 0.3, ease: 'easeOut' }}
      />
    </div>
  )
}

export function TransactionProgress({
  status,
  txHash,
  chain,
  errorMessage,
  onRetry,
  onViewExplorer,
  estimatedTime,
}: TransactionProgressProps) {
  const currentIndex = getStepIndex(status)
  const isFailed = status === 'failed'
  const isIdle = status === 'idle'

  // Get explorer URL
  const explorerUrl = chain && txHash ? explorerUrls[chain.toLowerCase()] + txHash : null

  if (isIdle) {
    return null
  }

  return (
    <div className="bg-white rounded-suwappu-xl p-4 shadow-suwappu-2">
      {/* Steps */}
      <div className="flex items-center justify-between mb-4">
        {steps.map((step, index) => (
          <div key={step.key} className="flex items-center flex-1 last:flex-none">
            <StepIndicator
              step={step}
              index={index}
              currentIndex={currentIndex}
              isFailed={isFailed && index === currentIndex}
            />
            {index < steps.length - 1 && <ProgressLine isComplete={index < currentIndex} />}
          </div>
        ))}
      </div>

      {/* Status message */}
      <AnimatePresence mode="wait">
        <motion.div
          key={status}
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -10 }}
          className="text-center"
        >
          {status === 'confirmed' && (
            <div className="text-suwappu-success">
              <p className="font-heading font-semibold">Transaction Successful!</p>
              <p className="text-xs text-suwappu-text-secondary mt-1">Your swap has been confirmed on-chain</p>
            </div>
          )}

          {status === 'failed' && (
            <div className="text-suwappu-error">
              <p className="font-heading font-semibold">Transaction Failed</p>
              {errorMessage && <p className="text-xs mt-1 opacity-80">{errorMessage}</p>}
            </div>
          )}

          {status === 'submitting' && (
            <div className="text-suwappu-text-secondary">
              <p className="text-sm">Submitting transaction...</p>
              <p className="text-xs opacity-70 mt-1">Please confirm in your wallet</p>
            </div>
          )}

          {status === 'pending' && (
            <div className="text-suwappu-text-secondary">
              <p className="text-sm">Transaction submitted</p>
              <p className="text-xs opacity-70 mt-1">Waiting for network confirmation</p>
              {estimatedTime && (
                <p className="text-xs text-suwappu-magenta mt-1">~{estimatedTime}s estimated</p>
              )}
            </div>
          )}

          {status === 'confirming' && (
            <div className="text-suwappu-text-secondary">
              <p className="text-sm">Confirming transaction...</p>
              <p className="text-xs opacity-70 mt-1">Almost there!</p>
            </div>
          )}
        </motion.div>
      </AnimatePresence>

      {/* Transaction hash */}
      {txHash && (
        <div className="mt-3 pt-3 border-t border-suwappu-sakura-mid/10">
          <div className="flex items-center justify-between">
            <span className="text-xs text-suwappu-text-secondary">Tx Hash:</span>
            <div className="flex items-center gap-2">
              <code className="text-xs font-mono text-suwappu-purple-deep">{shortenHash(txHash)}</code>
              {explorerUrl && (
                <a
                  href={explorerUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={(e) => {
                    if (onViewExplorer) {
                      e.preventDefault()
                      onViewExplorer()
                    }
                  }}
                  className="text-xs text-suwappu-magenta-mid hover:underline"
                >
                  View ↗
                </a>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Retry button for failed transactions */}
      {isFailed && onRetry && (
        <motion.button
          onClick={onRetry}
          className="w-full mt-3 px-4 py-2 bg-suwappu-gradient text-white text-sm font-heading font-bold rounded-suwappu-pill shadow-suwappu-button hover:shadow-suwappu-button-hover transition-shadow"
          whileTap={{ scale: 0.98 }}
        >
          Try Again
        </motion.button>
      )}
    </div>
  )
}

/** Compact inline progress indicator */
export function TransactionProgressInline({ status }: { status: TransactionStatus }) {
  if (status === 'idle') return null

  const statusConfig = {
    submitting: { text: 'Submitting...', color: 'text-suwappu-text-secondary', icon: '📤' },
    pending: { text: 'Pending...', color: 'text-yellow-600', icon: '⏳' },
    confirming: { text: 'Confirming...', color: 'text-suwappu-magenta', icon: '🔄' },
    confirmed: { text: 'Confirmed', color: 'text-suwappu-success', icon: '✓' },
    failed: { text: 'Failed', color: 'text-suwappu-error', icon: '✕' },
  }

  const config = statusConfig[status]
  if (!config) return null

  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.9 }}
      animate={{ opacity: 1, scale: 1 }}
      className={`inline-flex items-center gap-1.5 px-2 py-1 rounded-full text-xs font-medium ${config.color} bg-current/10`}
    >
      <motion.span
        animate={status !== 'confirmed' && status !== 'failed' ? { rotate: 360 } : {}}
        transition={{ duration: 1, repeat: Infinity, ease: 'linear' }}
      >
        {config.icon}
      </motion.span>
      {config.text}
    </motion.div>
  )
}
