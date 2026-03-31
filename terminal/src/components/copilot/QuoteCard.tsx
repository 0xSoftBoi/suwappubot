interface QuoteCardProps {
  data: Record<string, unknown>
  onExecute?: () => void
  onDismiss?: () => void
}

export function QuoteCard({ data, onExecute, onDismiss }: QuoteCardProps) {
  const fromToken = (data.fromToken as { symbol?: string })?.symbol || '?'
  const toToken = (data.toToken as { symbol?: string })?.symbol || '?'
  const fromAmount = (data.fromAmount as string) || '0'
  const toAmount = (data.toAmount as string) || '0'
  const exchangeRate = data.exchangeRate as number | undefined
  const priceImpact = data.priceImpact as number | undefined
  const gasUsd = data.gasUsd as number | undefined

  return (
    <div className="rounded border border-terminal-border bg-terminal-bg-secondary p-3 space-y-2 text-xs">
      {/* From / To */}
      <div className="flex items-center justify-between">
        <div>
          <span className="text-terminal-text-muted">From</span>
          <p className="text-terminal-text font-medium">
            {fromAmount} {fromToken}
          </p>
        </div>
        <svg className="w-4 h-4 text-terminal-text-muted mx-2 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14 5l7 7m0 0l-7 7m7-7H3" />
        </svg>
        <div className="text-right">
          <span className="text-terminal-text-muted">To</span>
          <p className="text-terminal-text font-medium">
            {toAmount} {toToken}
          </p>
        </div>
      </div>

      {/* Details */}
      <div className="flex justify-between text-terminal-text-secondary border-t border-terminal-border pt-2">
        <span>Rate</span>
        <span>
          1 {fromToken} = {exchangeRate?.toFixed(6) || '—'} {toToken}
        </span>
      </div>
      {priceImpact !== undefined && (
        <div className="flex justify-between text-terminal-text-secondary">
          <span>Price Impact</span>
          <span className={priceImpact > 1 ? 'text-impact-high' : 'text-impact-low'}>
            {priceImpact.toFixed(2)}%
          </span>
        </div>
      )}
      {gasUsd !== undefined && (
        <div className="flex justify-between text-terminal-text-secondary">
          <span>Est. Gas</span>
          <span>${gasUsd.toFixed(2)}</span>
        </div>
      )}

      {/* Actions */}
      <div className="flex gap-2 pt-1">
        <button
          onClick={onExecute}
          className="terminal-button flex-1 py-1.5 text-xs"
        >
          Execute Swap
        </button>
        <button
          onClick={onDismiss}
          className="terminal-button-secondary flex-1 py-1.5 text-xs"
        >
          Dismiss
        </button>
      </div>
    </div>
  )
}
