/**
 * ErrorMessage - Smart error handling component with actionable suggestions
 * Provides helpful recovery actions based on error type
 */
import { motion, AnimatePresence } from 'framer-motion'

export type ErrorCode =
  | 'SLIPPAGE_TOO_LOW'
  | 'INSUFFICIENT_BALANCE'
  | 'INSUFFICIENT_GAS'
  | 'NETWORK_ERROR'
  | 'RATE_LIMIT'
  | 'WALLET_REJECTED'
  | 'PRICE_IMPACT_HIGH'
  | 'TOKEN_NOT_FOUND'
  | 'ROUTE_NOT_FOUND'
  | 'EXECUTION_REVERTED'
  | 'TIMEOUT'
  | 'UNKNOWN'

export interface ErrorAction {
  label: string
  onClick: () => void
  primary?: boolean
}

export interface ErrorMessageProps {
  /** Error code for smart suggestions */
  code?: ErrorCode
  /** Error message to display */
  message: string
  /** Optional detailed error info */
  details?: string
  /** Recovery actions */
  actions?: ErrorAction[]
  /** Callback when dismissed */
  onDismiss?: () => void
  /** Variant style */
  variant?: 'inline' | 'card' | 'toast'
}

// Error configuration with icons, colors, and default suggestions
const errorConfig: Record<
  ErrorCode,
  {
    icon: string
    title: string
    suggestion: string
    defaultAction?: string
  }
> = {
  SLIPPAGE_TOO_LOW: {
    icon: '📊',
    title: 'Slippage Too Low',
    suggestion: 'Try increasing slippage tolerance to 1-2% for this trade.',
    defaultAction: 'Increase Slippage',
  },
  INSUFFICIENT_BALANCE: {
    icon: '💰',
    title: 'Insufficient Balance',
    suggestion: "You don't have enough tokens to complete this swap.",
    defaultAction: 'Add Funds',
  },
  INSUFFICIENT_GAS: {
    icon: '⛽',
    title: 'Insufficient Gas',
    suggestion: 'You need more native tokens to pay for gas fees.',
    defaultAction: 'Add Gas',
  },
  NETWORK_ERROR: {
    icon: '🌐',
    title: 'Network Error',
    suggestion: 'Check your internet connection and try again.',
    defaultAction: 'Retry',
  },
  RATE_LIMIT: {
    icon: '⏱️',
    title: 'Rate Limited',
    suggestion: 'Too many requests. Please wait a moment and try again.',
    defaultAction: 'Wait',
  },
  WALLET_REJECTED: {
    icon: '🔐',
    title: 'Transaction Rejected',
    suggestion: 'You rejected the transaction in your wallet.',
    defaultAction: 'Try Again',
  },
  PRICE_IMPACT_HIGH: {
    icon: '📉',
    title: 'High Price Impact',
    suggestion: 'This trade has high price impact. Try a smaller amount.',
    defaultAction: 'Reduce Amount',
  },
  TOKEN_NOT_FOUND: {
    icon: '🔍',
    title: 'Token Not Found',
    suggestion: "We couldn't find this token. Check the address and try again.",
    defaultAction: 'Search Again',
  },
  ROUTE_NOT_FOUND: {
    icon: '🛤️',
    title: 'No Route Found',
    suggestion: 'No swap route available for this pair. Try a different token.',
    defaultAction: 'Change Token',
  },
  EXECUTION_REVERTED: {
    icon: '⚠️',
    title: 'Transaction Reverted',
    suggestion: 'The transaction was reverted. Try increasing gas or slippage.',
    defaultAction: 'Retry',
  },
  TIMEOUT: {
    icon: '⏰',
    title: 'Request Timeout',
    suggestion: 'The request took too long. Please try again.',
    defaultAction: 'Retry',
  },
  UNKNOWN: {
    icon: '❓',
    title: 'Something Went Wrong',
    suggestion: 'An unexpected error occurred. Please try again.',
    defaultAction: 'Retry',
  },
}

// Parse error message to determine error code
export function parseErrorCode(error: Error | string): ErrorCode {
  const message = typeof error === 'string' ? error.toLowerCase() : error.message.toLowerCase()

  if (message.includes('slippage') || message.includes('price moved')) {
    return 'SLIPPAGE_TOO_LOW'
  }
  if (message.includes('insufficient') && message.includes('balance')) {
    return 'INSUFFICIENT_BALANCE'
  }
  if (message.includes('gas') || message.includes('insufficient funds for gas')) {
    return 'INSUFFICIENT_GAS'
  }
  if (message.includes('network') || message.includes('fetch') || message.includes('connection')) {
    return 'NETWORK_ERROR'
  }
  if (message.includes('rate limit') || message.includes('429')) {
    return 'RATE_LIMIT'
  }
  if (message.includes('rejected') || message.includes('denied') || message.includes('cancelled')) {
    return 'WALLET_REJECTED'
  }
  if (message.includes('price impact')) {
    return 'PRICE_IMPACT_HIGH'
  }
  if (message.includes('token') && (message.includes('not found') || message.includes('unknown'))) {
    return 'TOKEN_NOT_FOUND'
  }
  if (message.includes('route') && message.includes('not found')) {
    return 'ROUTE_NOT_FOUND'
  }
  if (message.includes('reverted') || message.includes('revert')) {
    return 'EXECUTION_REVERTED'
  }
  if (message.includes('timeout') || message.includes('timed out')) {
    return 'TIMEOUT'
  }

  return 'UNKNOWN'
}

/** Inline error message */
function InlineError({
  config,
  message,
  onDismiss,
}: {
  config: (typeof errorConfig)[ErrorCode]
  message: string
  onDismiss?: () => void
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: -10 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -10 }}
      className="flex items-start gap-2 p-2 bg-suwappu-error/10 rounded-suwappu-md border border-suwappu-error/20"
    >
      <span className="text-lg flex-shrink-0">{config.icon}</span>
      <div className="flex-1 min-w-0">
        <p className="text-sm text-suwappu-error font-medium">{message}</p>
        <p className="text-xs text-suwappu-error/70 mt-0.5">{config.suggestion}</p>
      </div>
      {onDismiss && (
        <button onClick={onDismiss} className="text-suwappu-error/50 hover:text-suwappu-error p-1">
          ✕
        </button>
      )}
    </motion.div>
  )
}

/** Card-style error message */
function CardError({
  config,
  message,
  details,
  actions,
  onDismiss,
}: {
  config: (typeof errorConfig)[ErrorCode]
  message: string
  details?: string
  actions?: ErrorAction[]
  onDismiss?: () => void
}) {
  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.95 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.95 }}
      className="bg-white rounded-suwappu-xl shadow-suwappu-2 overflow-hidden border border-suwappu-error/20"
    >
      {/* Header */}
      <div className="bg-suwappu-error/10 px-4 py-3 flex items-center gap-3">
        <div className="w-10 h-10 rounded-full bg-suwappu-error/20 flex items-center justify-center text-xl">
          {config.icon}
        </div>
        <div className="flex-1">
          <h3 className="font-heading font-semibold text-suwappu-error">{config.title}</h3>
          <p className="text-sm text-suwappu-error/80">{message}</p>
        </div>
        {onDismiss && (
          <button
            onClick={onDismiss}
            className="text-suwappu-error/50 hover:text-suwappu-error transition-colors"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        )}
      </div>

      {/* Body */}
      <div className="px-4 py-3">
        <p className="text-sm text-suwappu-text-secondary">{config.suggestion}</p>
        {details && (
          <details className="mt-2">
            <summary className="text-xs text-suwappu-text-secondary cursor-pointer hover:text-suwappu-text">
              Technical details
            </summary>
            <pre className="mt-1 text-xs bg-suwappu-sakura-light/30 p-2 rounded-suwappu-sm overflow-x-auto">
              {details}
            </pre>
          </details>
        )}
      </div>

      {/* Actions */}
      {actions && actions.length > 0 && (
        <div className="px-4 py-3 bg-suwappu-sakura-light/20 flex gap-2 flex-wrap">
          {actions.map((action, index) => (
            <motion.button
              key={index}
              onClick={action.onClick}
              className={`px-4 py-2 text-sm font-heading font-medium rounded-suwappu-pill transition-all ${
                action.primary
                  ? 'bg-suwappu-gradient text-white shadow-suwappu-button hover:shadow-suwappu-button-hover'
                  : 'bg-white text-suwappu-magenta-mid border border-suwappu-sakura-mid hover:bg-suwappu-sakura-light'
              }`}
              whileTap={{ scale: 0.98 }}
            >
              {action.label}
            </motion.button>
          ))}
        </div>
      )}
    </motion.div>
  )
}

/** Toast-style error notification */
function ToastError({
  config,
  message,
  onDismiss,
}: {
  config: (typeof errorConfig)[ErrorCode]
  message: string
  onDismiss?: () => void
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 50, scale: 0.9 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: 20, scale: 0.9 }}
      className="fixed bottom-20 left-4 right-4 z-50"
    >
      <div className="bg-white rounded-suwappu-xl shadow-suwappu-3 p-4 flex items-start gap-3 border border-suwappu-error/20">
        <div className="w-8 h-8 rounded-full bg-suwappu-error/20 flex items-center justify-center flex-shrink-0">
          {config.icon}
        </div>
        <div className="flex-1 min-w-0">
          <p className="font-heading font-semibold text-sm text-suwappu-error">{config.title}</p>
          <p className="text-xs text-suwappu-text-secondary mt-0.5">{message}</p>
        </div>
        {onDismiss && (
          <button onClick={onDismiss} className="text-suwappu-text-secondary hover:text-suwappu-text p-1">
            ✕
          </button>
        )}
      </div>
    </motion.div>
  )
}

export function ErrorMessage({
  code = 'UNKNOWN',
  message,
  details,
  actions,
  onDismiss,
  variant = 'card',
}: ErrorMessageProps) {
  const config = errorConfig[code]

  return (
    <AnimatePresence>
      {variant === 'inline' && <InlineError config={config} message={message} onDismiss={onDismiss} />}
      {variant === 'card' && (
        <CardError config={config} message={message} details={details} actions={actions} onDismiss={onDismiss} />
      )}
      {variant === 'toast' && <ToastError config={config} message={message} onDismiss={onDismiss} />}
    </AnimatePresence>
  )
}

/** Hook for managing error state */
export function useErrorHandler() {
  const handleError = (error: Error | string, onRetry?: () => void) => {
    const code = parseErrorCode(error)
    const message = typeof error === 'string' ? error : error.message

    return {
      code,
      message,
      actions: onRetry
        ? [
            {
              label: errorConfig[code].defaultAction || 'Retry',
              onClick: onRetry,
              primary: true,
            },
          ]
        : undefined,
    }
  }

  return { handleError, parseErrorCode }
}
