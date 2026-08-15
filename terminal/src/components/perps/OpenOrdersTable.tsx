import { useState } from 'react'
import toast from 'react-hot-toast'
import type { TerminalPerpsOrder } from '../../types/api'
import { useAuth } from '../../contexts/AuthContext'
import { useTerminalPerpsOrders, useCancelPerpsOrder } from '../../hooks/useTerminalPerps'
import { TerminalEmptyState, TerminalSkeletonRows } from '../foundation'

// Resting HyperLiquid orders (limit entries + TP/SL triggers) for the signed-in
// user, each cancellable. Pairs with the positions table in the perps desk.
export function PerpsOpenOrders() {
  const { isAuthenticated } = useAuth()
  const { data: orders, isLoading } = useTerminalPerpsOrders()
  const cancel = useCancelPerpsOrder()
  const [cancellingId, setCancellingId] = useState<string | null>(null)

  async function doCancel(order: TerminalPerpsOrder) {
    setCancellingId(order.orderId)
    try {
      await cancel.mutateAsync({ market: order.market, orderId: order.orderId })
      toast.success('Order cancelled')
    } catch (e) {
      toast.error((e as { detail?: string })?.detail || 'Could not cancel order')
    } finally {
      setCancellingId(null)
    }
  }

  if (!isAuthenticated) {
    return (
      <TerminalEmptyState
        className="h-full"
        kicker="Perps"
        title="Sign in to view your orders"
        description="Resting limit entries and TP/SL triggers show here, each cancellable in one click."
      />
    )
  }

  if (isLoading) {
    return (
      <div className="p-3">
        <TerminalSkeletonRows rows={4} columns={5} label="Loading orders" />
      </div>
    )
  }

  if (!orders || orders.length === 0) {
    return (
      <TerminalEmptyState
        className="h-full"
        kicker="Perps"
        title="No resting orders"
        description="Place a limit entry from the ticket and it waits here until price reaches it — cancel any time."
      />
    )
  }

  return (
    <table className="w-full text-xs">
      <thead>
        <tr className="hairline-b text-terminal-text-muted">
          <th className="terminal-theme-caption px-3 py-2 text-left text-[10px] uppercase">Market</th>
          <th className="terminal-theme-caption px-3 py-2 text-left text-[10px] uppercase">Type</th>
          <th className="terminal-theme-caption px-3 py-2 text-left text-[10px] uppercase">Side</th>
          <th className="terminal-theme-caption px-3 py-2 text-right text-[10px] uppercase">Size</th>
          <th className="terminal-theme-caption px-3 py-2 text-right text-[10px] uppercase">Price</th>
          <th className="terminal-theme-caption px-3 py-2 text-right text-[10px] uppercase">Cancel</th>
        </tr>
      </thead>
      <tbody>
        {orders.map((o) => {
          const busy = cancellingId === o.orderId && cancel.isPending
          // A trigger order (TP/SL) shows its trigger price; a limit shows limitPx.
          const shownPrice = (o.isTrigger && o.triggerPrice ? o.triggerPrice : o.price) ?? 0
          return (
            <tr key={o.orderId} className="hairline-b terminal-row">
              <td className="px-3 py-2 font-medium text-terminal-text">{o.market}</td>
              <td className="px-3 py-2 text-terminal-text-secondary">
                {o.orderType}
                {o.reduceOnly && (
                  <span className="hairline ml-1 rounded-terminal-pill px-1.5 py-0.5 font-mono text-[10px] text-terminal-text-muted">
                    RO
                  </span>
                )}
              </td>
              <td className="px-3 py-2">
                <span
                  className={`font-mono text-[11px] font-semibold ${o.side === 'buy' ? 'text-bull' : 'text-bear'}`}
                >
                  <span aria-hidden="true">{o.side === 'buy' ? '▲' : '▼'}</span>{' '}
                  {o.side.toUpperCase()}
                </span>
              </td>
              <td className="px-3 py-2 text-right font-mono tnum">{(o.size ?? 0).toFixed(4)}</td>
              <td className="px-3 py-2 text-right font-mono tnum">${shownPrice.toFixed(2)}</td>
              <td className="px-3 py-2 text-right">
                <button
                  onClick={() => doCancel(o)}
                  disabled={busy}
                  aria-label={`Cancel ${o.orderType} order on ${o.market}`}
                  className="rounded-terminal-control border border-terminal-border px-2 py-1 text-[10px] text-terminal-text-secondary transition-colors hover:border-bear hover:text-terminal-text disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {busy ? '…' : 'Cancel'}
                </button>
              </td>
            </tr>
          )
        })}
      </tbody>
    </table>
  )
}
