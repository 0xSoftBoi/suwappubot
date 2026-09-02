import { useSwaps } from '../../hooks/useSwaps'
import { parseServerTimestamp } from '../../lib/amounts'
import type { TerminalSwap } from '../../types/api'

const STATUS_STYLE: Record<string, string> = {
  completed: 'text-bull',
  failed: 'text-bear',
  cancelled: 'text-terminal-text-muted',
}

function statusLabel(status: string): string {
  if (status === 'completed') return 'Completed'
  if (status === 'failed') return 'Failed'
  if (status === 'cancelled') return 'Cancelled'
  return 'Pending'
}

function isPending(status: string): boolean {
  return !['completed', 'failed', 'cancelled'].includes(status)
}

function row(swap: TerminalSwap) {
  const style = STATUS_STYLE[swap.status] ?? 'text-yellow-400'
  const whenMs = parseServerTimestamp(swap.createdAt)
  const when = Number.isFinite(whenMs) ? new Date(whenMs).toLocaleString() : ''
  return (
    <div
      key={swap.id}
      className="flex items-center justify-between px-3 py-2 border-b border-terminal-border text-sm"
    >
      <div className="min-w-0">
        <div className="font-mono text-terminal-text-primary truncate">
          {swap.fromAmount} {swap.fromToken} → {swap.toToken}
        </div>
        <div className="text-[11px] text-terminal-text-muted">
          {swap.fromChain === swap.toChain ? swap.fromChain : `${swap.fromChain} → ${swap.toChain}`}
          {when ? ` · ${when}` : ''}
        </div>
      </div>
      <div className={`flex items-center gap-1.5 shrink-0 ${style}`}>
        {isPending(swap.status) && (
          <span className="w-1.5 h-1.5 rounded-full bg-current animate-pulse" />
        )}
        <span className="text-xs font-semibold">{statusLabel(swap.status)}</span>
      </div>
    </div>
  )
}

export function TradeHistory() {
  const { data: swaps, isLoading, error } = useSwaps()

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-full text-terminal-text-muted text-sm">
        Loading…
      </div>
    )
  }
  if (error) {
    return (
      <div className="flex items-center justify-center h-full text-terminal-text-muted text-sm">
        Couldn’t load trade history.
      </div>
    )
  }
  if (!swaps || swaps.length === 0) {
    return (
      <div className="flex items-center justify-center h-full text-terminal-text-muted text-sm">
        No trade history yet
      </div>
    )
  }

  return <div className="overflow-y-auto h-full">{swaps.map(row)}</div>
}
