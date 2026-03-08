/**
 * TransactionProgress - Shows swap/transaction progress status
 * Stub implementation — to be fully built out later.
 */
export type TransactionStatus = 'submitting' | 'pending' | 'confirming' | 'completed' | 'failed'

export interface TransactionProgressProps {
  status: TransactionStatus
  txHash?: string
  chain?: string
  errorMessage?: string | null
  onRetry?: () => void
  onViewExplorer?: () => void
}

export function TransactionProgress({ status, errorMessage, onRetry, onViewExplorer }: TransactionProgressProps) {
  const labels: Record<TransactionStatus, string> = {
    submitting: 'Submitting transaction...',
    pending: 'Transaction pending...',
    confirming: 'Confirming...',
    completed: 'Transaction complete!',
    failed: 'Transaction failed',
  }

  return (
    <div className="bg-white rounded-suwappu-xl p-4 shadow-suwappu-1 text-center space-y-3">
      <p className="text-sm font-heading font-semibold text-suwappu-text">
        {labels[status]}
      </p>
      {status === 'failed' && errorMessage && (
        <p className="text-xs text-suwappu-error">{errorMessage}</p>
      )}
      <div className="flex justify-center gap-2">
        {status === 'failed' && onRetry && (
          <button onClick={onRetry} className="text-xs text-suwappu-magenta-mid font-medium">
            Retry
          </button>
        )}
        {onViewExplorer && (
          <button onClick={onViewExplorer} className="text-xs text-suwappu-purple-deep font-medium">
            View on Explorer
          </button>
        )}
      </div>
    </div>
  )
}

export function TransactionProgressInline({ status }: { status: TransactionStatus }) {
  return <span className="text-xs text-suwappu-text-secondary">{status}</span>
}
