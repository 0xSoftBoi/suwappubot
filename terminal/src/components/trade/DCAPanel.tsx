import { useEffect, useMemo, useState } from 'react'
import toast from 'react-hot-toast'
import { TokenInput } from '../swap/TokenInput'
import { useAuth } from '../../contexts/AuthContext'
import { useDCA } from '../../hooks/useDCA'
import { usePopularTokens } from '../../hooks/useTokens'
import type { DCAFrequency, SwapToken } from '../../types/api'

const FREQUENCIES: { id: DCAFrequency; label: string }[] = [
  { id: 'hourly', label: 'Hourly' },
  { id: 'daily', label: 'Daily' },
  { id: 'weekly', label: 'Weekly' },
]

export function DCAPanel() {
  const { isAuthenticated } = useAuth()
  const { orders, createOrder, pauseOrder, cancelOrder } = useDCA()
  const { data: popularTokens } = usePopularTokens('ethereum')
  const [fromToken, setFromToken] = useState<SwapToken | null>(null)
  const [toToken, setToToken] = useState<SwapToken | null>(null)
  const [totalAmount, setTotalAmount] = useState('')
  const [frequency, setFrequency] = useState<DCAFrequency>('daily')
  const [numOrders, setNumOrders] = useState('7')

  useEffect(() => {
    if (!popularTokens?.length || fromToken || toToken) return
    const usdc = popularTokens.find(token => token.symbol === 'USDC')
    const eth = popularTokens.find(token => token.symbol === 'ETH')
    if (usdc && eth) {
      setFromToken(usdc)
      setToToken(eth)
    }
  }, [fromToken, popularTokens, toToken])

  const parsedTotal = parseFloat(totalAmount)
  const parsedOrders = parseInt(numOrders, 10)
  const formReady = isAuthenticated && !!fromToken && !!toToken
    && fromToken.address !== toToken?.address
    && parsedTotal > 0 && parsedOrders > 0

  const activeOrders = useMemo(
    () => orders.data?.filter(o => o.status === 'active' || o.status === 'paused') ?? [],
    [orders.data],
  )

  const submit = () => {
    if (!formReady || !fromToken || !toToken) return
    createOrder.mutate(
      {
        fromToken: fromToken.symbol,
        toToken: toToken.symbol,
        totalAmount: parsedTotal,
        frequency,
        numberOfOrders: parsedOrders,
      },
      {
        onSuccess: () => {
          toast.success('DCA schedule created')
          setTotalAmount('')
          setNumOrders('7')
        },
        onError: (err: unknown) => {
          const message = err && typeof err === 'object' && 'detail' in err
            ? (err as { detail: string }).detail
            : 'Failed to create DCA schedule'
          toast.error(message)
        },
      },
    )
  }

  const cancel = (orderId: string) => {
    if (!window.confirm('Cancel this DCA schedule?')) return
    cancelOrder.mutate(orderId, {
      onSuccess: () => toast.success('DCA schedule cancelled'),
      onError: () => toast.error('Cancel failed'),
    })
  }

  return (
    <div className="flex flex-col gap-3 mt-3">
      <TokenInput
        label="From"
        token={fromToken}
        amount=""
        onTokenSelect={setFromToken}
        readOnly
      />
      <TokenInput
        label="To"
        token={toToken}
        amount=""
        onTokenSelect={setToToken}
        readOnly
      />

      <div>
        <label className="text-xs text-terminal-text-secondary mb-1 block">Total Amount (USD)</label>
        <input
          type="text"
          value={totalAmount}
          onChange={e => setTotalAmount(e.target.value)}
          placeholder="100.00"
          className="terminal-input w-full font-mono"
        />
      </div>

      <div>
        <label className="text-xs text-terminal-text-secondary mb-1 block">Frequency</label>
        <div className="flex gap-1">
          {FREQUENCIES.map(opt => (
            <button
              key={opt.id}
              onClick={() => setFrequency(opt.id)}
              className={`flex-1 py-1.5 rounded text-xs font-medium transition-colors
                ${frequency === opt.id
                  ? 'bg-sakura-600/20 text-sakura-400 border border-sakura-600'
                  : 'bg-terminal-bg border border-terminal-border text-terminal-text-secondary hover:text-terminal-text'
                }`}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      <div>
        <label className="text-xs text-terminal-text-secondary mb-1 block">Number of Orders</label>
        <input
          type="number"
          value={numOrders}
          onChange={e => setNumOrders(e.target.value)}
          min="2"
          max="365"
          className="terminal-input w-full font-mono"
        />
      </div>

      {totalAmount && numOrders && (
        <div className="bg-terminal-bg rounded px-3 py-2 text-xs text-terminal-text-secondary">
          <span className="font-mono text-terminal-text">
            ${(parseFloat(totalAmount || '0') / parseInt(numOrders || '1')).toFixed(2)}
          </span>{' '}
          per {frequency} order &times; {numOrders} orders
        </div>
      )}

      <button
        onClick={submit}
        disabled={!formReady || createOrder.isPending}
        className="terminal-button w-full py-3 mt-2 font-semibold disabled:opacity-50 disabled:cursor-not-allowed"
      >
        {!isAuthenticated
          ? 'Create Turnkey wallet'
          : createOrder.isPending
            ? 'Scheduling...'
            : 'Schedule DCA'}
      </button>

      <div className="border-t border-terminal-border pt-3">
        <div className="mb-2 flex items-center justify-between">
          <span className="text-xs font-semibold uppercase tracking-[0.12em] text-terminal-text-secondary">
            Active Schedules
          </span>
          <span className="font-mono text-xs text-terminal-text-muted">{activeOrders.length}</span>
        </div>

        {orders.isLoading ? (
          <div className="rounded border border-terminal-border bg-terminal-bg px-3 py-4 text-center text-xs text-terminal-text-muted">
            Loading schedules...
          </div>
        ) : activeOrders.length === 0 ? (
          <div className="rounded border border-terminal-border bg-terminal-bg px-3 py-4 text-center text-xs text-terminal-text-muted">
            No DCA schedules
          </div>
        ) : (
          <div className="flex max-h-56 flex-col gap-2 overflow-y-auto pr-1">
            {activeOrders.map(order => (
              <div key={order.id} className="rounded border border-terminal-border bg-terminal-bg px-3 py-2">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <div className="text-sm font-semibold text-terminal-text">
                      {order.fromToken}/{order.toToken}
                    </div>
                    <div className="font-mono text-xs text-terminal-text-secondary">
                      {order.completedOrders}/{order.totalOrders} {order.frequency} orders
                    </div>
                  </div>
                  <div className="flex gap-1">
                    <button
                      onClick={() => pauseOrder.mutate(order.id)}
                      disabled={pauseOrder.isPending || order.status === 'paused'}
                      className="rounded border border-terminal-border px-2 py-1 text-xs text-terminal-text-secondary transition-colors hover:text-terminal-text disabled:opacity-40"
                    >
                      {order.status === 'paused' ? 'Paused' : 'Pause'}
                    </button>
                    <button
                      onClick={() => cancel(order.id)}
                      disabled={cancelOrder.isPending}
                      className="rounded border border-terminal-border px-2 py-1 text-xs text-terminal-text-secondary transition-colors hover:border-bear/50 hover:text-bear disabled:opacity-40"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
