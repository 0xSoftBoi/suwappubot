import { useState, useMemo } from 'react'
import type { DCAFrequency } from '../../types/api'

interface Props {
  onSubmit: (data: {
    fromToken: string
    toToken: string
    totalAmount: number
    frequency: DCAFrequency
    numberOfOrders: number
  }) => void
  isLoading: boolean
}

const frequencies: { value: DCAFrequency; label: string }[] = [
  { value: 'hourly', label: 'Hourly' },
  { value: 'daily', label: 'Daily' },
  { value: 'weekly', label: 'Weekly' },
  { value: 'monthly', label: 'Monthly' },
]

export function CreateDCAForm({ onSubmit, isLoading }: Props) {
  const [fromToken, setFromToken] = useState('USDC')
  const [toToken, setToToken] = useState('ETH')
  const [totalAmount, setTotalAmount] = useState('')
  const [frequency, setFrequency] = useState<DCAFrequency>('daily')
  const [numberOfOrders, setNumberOfOrders] = useState('7')

  const perOrder = useMemo(() => {
    const total = parseFloat(totalAmount)
    const orders = parseInt(numberOfOrders)
    if (!total || !orders || orders <= 0) return 0
    return total / orders
  }, [totalAmount, numberOfOrders])

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    const totalNum = parseFloat(totalAmount)
    const ordersInt = parseInt(numberOfOrders, 10)
    if (!fromToken || !toToken || isNaN(totalNum) || totalNum <= 0 || isNaN(ordersInt) || ordersInt < 1) return
    onSubmit({
      fromToken: fromToken.toUpperCase(),
      toToken: toToken.toUpperCase(),
      totalAmount: totalNum,
      frequency,
      numberOfOrders: ordersInt,
    })
    setTotalAmount('')
    setNumberOfOrders('7')
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-3">
      <div className="flex gap-2">
        <div className="flex-1">
          <label className="text-[10px] text-terminal-text-muted uppercase tracking-wider">From</label>
          <input
            type="text"
            value={fromToken}
            onChange={e => setFromToken(e.target.value)}
            placeholder="USDC"
            className="terminal-input text-sm w-full mt-0.5"
          />
        </div>
        <div className="flex items-end pb-1.5 text-terminal-text-muted text-sm">→</div>
        <div className="flex-1">
          <label className="text-[10px] text-terminal-text-muted uppercase tracking-wider">To</label>
          <input
            type="text"
            value={toToken}
            onChange={e => setToToken(e.target.value)}
            placeholder="ETH"
            className="terminal-input text-sm w-full mt-0.5"
          />
        </div>
      </div>

      <div className="flex gap-2">
        <div className="flex-1">
          <label className="text-[10px] text-terminal-text-muted uppercase tracking-wider">Total Amount ($)</label>
          <input
            type="number"
            value={totalAmount}
            onChange={e => setTotalAmount(e.target.value)}
            placeholder="1000"
            step="any"
            className="terminal-input text-sm w-full mt-0.5"
          />
        </div>
        <div className="w-20">
          <label className="text-[10px] text-terminal-text-muted uppercase tracking-wider">Orders</label>
          <input
            type="number"
            value={numberOfOrders}
            onChange={e => setNumberOfOrders(e.target.value)}
            min="1"
            className="terminal-input text-sm w-full mt-0.5"
          />
        </div>
      </div>

      <div>
        <label className="text-[10px] text-terminal-text-muted uppercase tracking-wider">Frequency</label>
        <div className="flex gap-1 mt-0.5" role="radiogroup" aria-label="DCA frequency">
          {frequencies.map(f => (
            <button
              key={f.value}
              type="button"
              role="radio"
              aria-checked={frequency === f.value}
              onClick={() => setFrequency(f.value)}
              className={`flex-1 px-2 py-1.5 text-[11px] rounded transition-colors ${
                frequency === f.value
                  ? 'bg-terminal-accent/20 text-terminal-accent border border-terminal-accent/40'
                  : 'bg-terminal-bg text-terminal-text-muted border border-terminal-border hover:border-terminal-border-active'
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>

      {perOrder > 0 && (
        <div className="text-xs text-terminal-text-muted">
          Per order: <span className="font-mono text-terminal-text">${perOrder.toFixed(2)}</span>
        </div>
      )}

      <button
        type="submit"
        disabled={isLoading || !fromToken || !toToken || !totalAmount || !numberOfOrders}
        className="terminal-button text-sm w-full py-2 disabled:opacity-50"
      >
        {isLoading ? 'Creating...' : 'Start DCA'}
      </button>
    </form>
  )
}
