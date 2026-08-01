import type { DCAOrder } from '../../types/api'

interface Props {
  order: DCAOrder
  onPause: (id: string) => void
  onCancel: (id: string) => void
}

const frequencyLabels: Record<string, string> = {
  hourly: 'Hourly',
  daily: 'Daily',
  weekly: 'Weekly',
  monthly: 'Monthly',
}

function formatCountdown(nextExecution?: string): string {
  if (!nextExecution) return '--'
  const diff = new Date(nextExecution).getTime() - Date.now()
  if (diff <= 0) return 'Now'
  const hours = Math.floor(diff / 3_600_000)
  const mins = Math.floor((diff % 3_600_000) / 60_000)
  if (hours > 24) return `${Math.floor(hours / 24)}d ${hours % 24}h`
  if (hours > 0) return `${hours}h ${mins}m`
  return `${mins}m`
}

export function DCAOrderCard({ order, onPause, onCancel }: Props) {
  const progress = order.totalOrders > 0 ? (order.completedOrders / order.totalOrders) * 100 : 0

  return (
    <div className="bg-terminal-bg rounded-lg p-3 border border-terminal-border hover:border-terminal-border-active transition-colors">
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <span className="text-sm font-semibold text-terminal-text">
            {order.fromToken} → {order.toToken}
          </span>
          <span className="px-1.5 py-0.5 text-[10px] rounded-full bg-terminal-accent/15 text-terminal-accent border border-terminal-accent/30">
            {frequencyLabels[order.frequency] || order.frequency}
          </span>
        </div>
        <span className="text-xs text-terminal-text-muted">
          Next: {formatCountdown(order.nextExecution)}
        </span>
      </div>

      <div className="mb-2">
        <div className="flex justify-between text-[10px] text-terminal-text-muted mb-1">
          <span>{order.completedOrders}/{order.totalOrders} orders</span>
          <span>{progress.toFixed(0)}%</span>
        </div>
        <div className="h-1.5 bg-terminal-border rounded-full overflow-hidden">
          <div
            className="h-full rounded-full bg-terminal-accent transition-all"
            style={{ width: `${progress}%` }}
          />
        </div>
      </div>

      <div className="flex justify-between text-xs mb-2">
        <div>
          <span className="text-terminal-text-muted">Per order: </span>
          <span className="font-mono text-terminal-text">${order.amountPerOrder.toLocaleString()}</span>
        </div>
        <div>
          <span className="text-terminal-text-muted">Invested: </span>
          <span className="font-mono text-terminal-text">${order.totalInvested.toLocaleString()}</span>
        </div>
      </div>

      {order.status === 'active' && (
        <div className="flex gap-2">
          <button
            onClick={() => onPause(order.id)}
            className="flex-1 text-[11px] py-1 rounded border border-terminal-border text-terminal-text-muted hover:text-terminal-text hover:border-terminal-border-active transition-colors"
          >
            Pause
          </button>
          <button
            onClick={() => onCancel(order.id)}
            className="flex-1 text-[11px] py-1 rounded border border-bear/30 text-bear/70 hover:text-bear hover:border-bear transition-colors"
          >
            Cancel
          </button>
        </div>
      )}

      {order.status === 'paused' && (
        <div className="text-center text-[11px] text-terminal-text-muted py-1">Paused</div>
      )}
    </div>
  )
}
