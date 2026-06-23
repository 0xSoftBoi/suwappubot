import { useState } from 'react'
import toast from 'react-hot-toast'
import type { TerminalPerpsOrder } from '../../types/api'
import { useAuth } from '../../contexts/AuthContext'
import { useTerminalPerpsOrders, useCancelPerpsOrder } from '../../hooks/useTerminalPerps'

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
      <div className="flex h-full items-center justify-center text-sm text-terminal-text-muted">
        Sign in to view your orders
      </div>
    )
  }

  if (isLoading) {
    return (
      <div className="flex h-full animate-pulse items-center justify-center text-sm text-terminal-text-muted">
        Loading orders...
      </div>
    )
  }

  if (!orders || orders.length === 0) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-terminal-text-muted">
        No open orders
      </div>
    )
  }

  return (
    <table className="w-full text-xs">
      <thead>
        <tr className="border-b border-terminal-border text-terminal-text-muted">
          <th className="px-3 py-2 text-left font-medium">Market</th>
          <th className="px-3 py-2 text-left font-medium">Type</th>
          <th className="px-3 py-2 text-left font-medium">Side</th>
          <th className="px-3 py-2 text-right font-medium">Size</th>
          <th className="px-3 py-2 text-right font-medium">Price</th>
          <th className="px-3 py-2 text-right font-medium">Cancel</th>
        </tr>
      </thead>
      <tbody>
        {orders.map((o) => {
          const busy = cancellingId === o.orderId && cancel.isPending
          // A trigger order (TP/SL) shows its trigger price; a limit shows limitPx.
          const shownPrice = o.isTrigger && o.triggerPrice ? o.triggerPrice : o.price
          return (
            <tr
              key={o.orderId}
              className="border-b border-terminal-border/50 transition-colors hover:bg-terminal-bg-tertiary/50"
            >
              <td className="px-3 py-2 font-medium text-terminal-text">{o.market}</td>
              <td className="px-3 py-2 text-terminal-text-secondary">
                {o.orderType}
                {o.reduceOnly && (
                  <span className="ml-1 text-[10px] text-terminal-text-muted">RO</span>
                )}
              </td>
              <td className="px-3 py-2">
                <span className={o.side === 'buy' ? 'text-bull' : 'text-bear'}>
                  {o.side.toUpperCase()}
                </span>
              </td>
              <td className="px-3 py-2 text-right font-mono">{o.size.toFixed(4)}</td>
              <td className="px-3 py-2 text-right font-mono">${shownPrice.toFixed(2)}</td>
              <td className="px-3 py-2 text-right">
                <button
                  onClick={() => doCancel(o)}
                  disabled={busy}
                  className="rounded border border-terminal-border px-2 py-1 text-[10px] text-terminal-text-secondary transition-colors hover:border-bear hover:text-terminal-text disabled:cursor-not-allowed disabled:opacity-50"
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
